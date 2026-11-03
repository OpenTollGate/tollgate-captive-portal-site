#!/usr/bin/env node
// Stamp the service worker with a build version, and emit it into the webroot.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// `public/sw.js` ships with a literal `'__SW_VERSION__'` placeholder where its
// cache name goes. If that placeholder reaches a browser, the cache name is the
// constant `tollgate-shell-__SW_VERSION__` for every release — which is the
// exact defect the versioning exists to prevent: the new worker finds the old
// release's responses already in "its" cache and serves them, and the browser
// never even sees an update because the worker body never differs.
//
// So the build stamps it. Two properties matter:
//
//   1. The stamp MUST change when the content changes, not when someone
//      remembers to bump it. The version is derived from the built assets (and
//      the worker's own source), so any real change produces a new cache name.
//   2. It must be DETERMINISTIC for identical inputs. A timestamp would make
//      every rebuild a "new release", which would churn every client's cache
//      on a no-op deploy.
//
// The version is a hash of the worker source plus the names of the precached
// files, so adding/removing a precache entry also bumps it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

/** Files whose CONTENT decides the app-shell version. */
const PRECACHED = [
  'splash.html',
  'balance.html',
  'manifest.json',
  'favicon.ico',
  'logo192.png',
  'logo512.png',
  'logo-maskable-512.png',
];

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * A deterministic version for the given webroot.
 *
 * Includes the worker source itself, so a change to the fetch rules is a new
 * version even when no precached asset moved — otherwise a fixed money-path bug
 * would keep being served by the worker already installed.
 */
export function computeVersion(webroot, swSourcePath) {
  const h = createHash('sha256');
  h.update(readFileSync(swSourcePath));
  for (const rel of PRECACHED) {
    const p = path.join(webroot, rel);
    // A missing file is part of the identity too: its absence changes what the
    // worker will cache, so it must change the version.
    h.update(rel);
    h.update(existsSync(p) ? hashFile(p) : 'MISSING');
  }
  // 12 hex chars is plenty for a cache namespace and stays readable in
  // `caches.keys()` output during a debugging session.
  return h.digest('hex').slice(0, 12);
}

function main() {
  const webroot = process.env.PWA_WEBROOT || path.join(repo, 'build');
  const swSource = path.join(repo, 'public', 'sw.js');
  const swTarget = path.join(webroot, 'sw.js');

  if (!existsSync(webroot)) {
    console.error(`[stamp-sw] no webroot at ${webroot} — run the build first`);
    process.exit(1);
  }
  if (!existsSync(swSource)) {
    console.error(`[stamp-sw] no source worker at ${swSource}`);
    process.exit(1);
  }

  const version = computeVersion(webroot, swSource);
  const src = readFileSync(swSource, 'utf8');

  if (!src.includes('__SW_VERSION__')) {
    console.error(
      '[stamp-sw] public/sw.js has no __SW_VERSION__ placeholder. The cache name' +
        ' would be a constant across releases, so the previous release\'s shell would' +
        ' be served forever. Refusing to emit an unversioned worker.'
    );
    process.exit(1);
  }

  writeFileSync(swTarget, src.replaceAll('__SW_VERSION__', version));

  // Verify the substitution landed rather than assuming it.
  const written = readFileSync(swTarget, 'utf8');
  if (written.includes('__SW_VERSION__')) {
    console.error('[stamp-sw] the placeholder survived substitution — refusing to continue');
    process.exit(1);
  }

  console.log(`[stamp-sw] ${path.relative(repo, swTarget)} stamped with version ${version}`);

  // Leave a machine-readable record so the e2e gate and a human can both read
  // what version the webroot is. Written next to the worker, not inside it.
  writeFileSync(
    path.join(webroot, 'sw-version.json'),
    `${JSON.stringify({ version, cache: `tollgate-shell-${version}` }, null, 2)}\n`
  );
}

// Only run when invoked directly; the export above is what the build uses.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
