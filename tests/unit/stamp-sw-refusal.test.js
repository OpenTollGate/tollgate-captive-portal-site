import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// GATE (card t_98145b7d, W1) — a REFUSED build must leave the tree unchanged.
//
// `scripts/stamp-sw.mjs` will refuse to emit a worker when the source has lost
// its `__SW_VERSION__` or `/*__PRECACHE__*/` block. Both refusals originally ran
// AFTER `build/sw.js` had already been written, so the build exited 1 having
// left a HALF-BUILT worker on disk: version stamped, precache list still the
// placeholder block (which names the HTML and icons but NOT the JS/CSS).
//
// That is worse than a clean failure, because the failure is invisible to
// anything that does not check the exit code — a preview server, an e2e run, a
// packaging script. What gets served is a worker whose precache omits the code,
// i.e. the blank-offline-shell defect this whole module exists to prevent.
//
// These run the REAL script as a subprocess against a throwaway repo, and assert
// on the webroot's BYTES. Asserting on a returned value would not have caught it:
// the bug was in the side effect, not the return.

const REPO = resolve(process.cwd());

/** A minimal fake repo: just enough for stamp-sw.mjs to run to its refusals. */
function fakeRepo({ swSource, webrootSw }) {
  const root = mkdtempSync(join(tmpdir(), 'stamp-sw-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'public'), { recursive: true });
  mkdirSync(join(root, 'build'), { recursive: true });
  cpSync(join(REPO, 'scripts', 'stamp-sw.mjs'), join(root, 'scripts', 'stamp-sw.mjs'));
  cpSync(join(REPO, 'scripts', 'precache-manifest.mjs'), join(root, 'scripts', 'precache-manifest.mjs'));
  writeFileSync(join(root, 'public', 'sw.js'), swSource);
  if (webrootSw !== undefined) writeFileSync(join(root, 'build', 'sw.js'), webrootSw);
  // A built entry document so computePrecache has something to read.
  writeFileSync(
    join(root, 'build', 'splash.html'),
    '<html><head><link rel="stylesheet" href="/assets/index-ABC123.css"></head>' +
      '<body><script src="/assets/portal-XYZ789.js"></script></body></html>'
  );
  writeFileSync(join(root, 'build', 'manifest.json'), '{}');
  return root;
}

const SENTINEL = 'PRE-EXISTING WEBROOT SW — MUST NOT BE TOUCHED\n';

const fullSource = readFileSync(join(REPO, 'public', 'sw.js'), 'utf8');

const dirs = [];
function make(opts) {
  const d = fakeRepo(opts);
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('stamp-sw refuses cleanly — a failed build must not mutate the webroot', () => {
  it('leaves build/sw.js UNCHANGED when the precache marker is missing', () => {
    // Real worker source, with the marker block stripped: the refusal path.
    const broken = fullSource
      .replace(/\/\*__PRECACHE__\*\/[\s\S]*?\/\*__PRECACHE_END__\*\//, '')
      .replace(/var PRECACHE = \[[\s\S]*?\];/, 'var PRECACHE = [];');
    const root = make({ swSource: broken, webrootSw: SENTINEL });

    const r = spawnSync(process.execPath, [join(root, 'scripts', 'stamp-sw.mjs')], {
      cwd: root,
      env: { ...process.env, PWA_WEBROOT: join(root, 'build') },
      encoding: 'utf8',
    });

    expect(r.status, 'the build must FAIL rather than ship an ungenerated list').toBe(1);
    expect(r.stderr).toContain('__PRECACHE__');

    const after = readFileSync(join(root, 'build', 'sw.js'), 'utf8');
    expect(
      after,
      'a refused build must not have written the stamped worker — a half-built ' +
        'worker (version stamped, precache still a placeholder) is served by ' +
        'anything that ignores the exit code'
    ).toBe(SENTINEL);
    expect(after).not.toContain('__SW_VERSION__');
  });

  it('leaves build/sw.js UNCHANGED when the version placeholder is missing', () => {
    const broken = fullSource.replace(/__SW_VERSION__/g, 'deadbeef');
    const root = make({ swSource: broken, webrootSw: SENTINEL });

    const r = spawnSync(process.execPath, [join(root, 'scripts', 'stamp-sw.mjs')], {
      cwd: root,
      env: { ...process.env, PWA_WEBROOT: join(root, 'build') },
      encoding: 'utf8',
    });

    expect(r.status, 'an unversioned worker must not be emitted').toBe(1);
    expect(r.stderr).toContain('__SW_VERSION__');
    expect(readFileSync(join(root, 'build', 'sw.js'), 'utf8')).toBe(SENTINEL);
  });

  it('does NOT create build/sw.js at all when the webroot had none', () => {
    const broken = fullSource.replace(/__SW_VERSION__/g, 'deadbeef');
    const root = make({ swSource: broken, webrootSw: undefined });

    const r = spawnSync(process.execPath, [join(root, 'scripts', 'stamp-sw.mjs')], {
      cwd: root,
      env: { ...process.env, PWA_WEBROOT: join(root, 'build') },
      encoding: 'utf8',
    });

    expect(r.status).toBe(1);
    expect(
      existsSync(join(root, 'build', 'sw.js')),
      'a refused build must not create a worker where there was none'
    ).toBe(false);
  });

  it('DOES write both the version and the generated precache on a good source', () => {
    // Guard the guard: the three refusals above would also pass if the script
    // simply never wrote anything. Prove the happy path still produces a worker
    // whose precache names the document's JS and CSS.
    const root = make({ swSource: fullSource, webrootSw: SENTINEL });

    const r = spawnSync(process.execPath, [join(root, 'scripts', 'stamp-sw.mjs')], {
      cwd: root,
      env: { ...process.env, PWA_WEBROOT: join(root, 'build') },
      encoding: 'utf8',
    });

    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(root, 'build', 'sw.js'), 'utf8');
    expect(out).not.toContain('__SW_VERSION__');
    expect(out).not.toContain('__PRECACHE__');
    // The generated list, derived from the built document above.
    expect(out).toContain("./assets/portal-XYZ789.js");
    expect(out).toContain("./assets/index-ABC123.css");
  });
});
