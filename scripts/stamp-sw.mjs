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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computePrecache, computeVersion, renderPrecacheArray } from './precache-manifest.mjs';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * A deterministic version for the given webroot.
 *
 * Includes the worker source itself, so a change to the fetch rules is a new
 * version even when no precached asset moved — otherwise a fixed money-path bug
 * would keep being served by the worker already installed.
 *
 * The precache LIST and the CONTENT of every entry are part of the identity too
 * (see scripts/precache-manifest.mjs). That is what makes a rebuilt bundle a new
 * shell version: Vite changes the asset filename, and the cache name moves with
 * it instead of serving the previous release's JavaScript forever.
 *
 * computeVersion is re-exported from precache-manifest.mjs so the version and
 * the list can never be computed from two different notions of "the shell".
 */
export { computeVersion } from './precache-manifest.mjs';

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

  // ── VALIDATE BEFORE WRITING ─────────────────────────────────────────────
  //
  // Both refusals below used to run AFTER the stamped worker had already been
  // written to `build/sw.js`, so a build that exited 1 left a HALF-BUILT worker
  // on disk: version stamped, precache list still the hand-written placeholder
  // block. Anything that then served that webroot (a preview, an e2e run, a
  // packaging step that does not check the exit code) shipped a worker whose
  // precache omits the JS and CSS — the exact blank-offline-shell defect this
  // module exists to prevent. A refusal must leave the tree UNCHANGED.
  const PRECACHE_MARKER = /\/\*__PRECACHE__\*\/[\s\S]*?\/\*__PRECACHE_END__\*\//;
  if (!PRECACHE_MARKER.test(src)) {
    console.error(
      '[stamp-sw] public/sw.js has no /*__PRECACHE__*/ … /*__PRECACHE_END__*/ block,' +
        ' so the generated precache list has nowhere to go. Refusing to ship a' +
        ' hand-maintained list that a Vite rename will silently orphan.'
    );
    process.exit(1);
  }

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

  // ── DERIVE the precache list from the built documents ───────────────────
  //
  // The source worker carries a hand-written `/*__PRECACHE__*/` placeholder
  // block. It is replaced here with the list computed from what the built
  // splash.html/balance.html actually reference — the JS and CSS included.
  //
  // Without this, the shipped allow-list named only the HTML and icons, so an
  // offline reload returned the document and then asked for `/assets/*.js`,
  // which the worker bypassed into a dead network: a blank page. The list is
  // generated rather than maintained so a Vite hash rename cannot orphan it.
  // The marker was validated above, BEFORE the version was written — so this
  // replace cannot fail half-way through a build.
  const precache = computePrecache(webroot);
  const stamped = readFileSync(swTarget, 'utf8');
  writeFileSync(swTarget, stamped.replace(PRECACHE_MARKER, renderPrecacheArray(precache)));
  console.log(`[stamp-sw] precache: ${precache.length} entries (${precache.filter((e) => e.startsWith('./assets/')).length} assets)`);


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
