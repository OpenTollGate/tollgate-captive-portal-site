#!/usr/bin/env node
// Generate the app-shell precache manifest from the BUILT entry documents.
//
// ── Why this exists (the defect it fixes) ───────────────────────────────────
//
// `public/sw.js` carried a hand-written PRECACHE list:
//
//     './splash.html', './balance.html', './404.html', './manifest.json',
//     './favicon.ico', './logo192.png', './logo512.png', './logo-maskable-512.png'
//
// Note what is missing: the JavaScript and CSS. Those are the only things that
// make the app render. So the "offline shell" served the HTML document with the
// network cut, the document asked for `/assets/portal-<hash>.js`, that request
// was NOT on the allow-list (the allow-list is exact-path), the worker bypassed
// it, the network was down, and the page stayed an empty white rectangle.
//
// The gate did not catch it because it asserted the things that were true:
// the reload returned 200, the body was >200 chars, and the URL was the entry
// document. All of that holds for an HTML shell whose scripts 404. The
// screenshot was blank, and a blank screenshot is not evidence.
//
// ── What replaces it ────────────────────────────────────────────────────────
//
// The document is the source of truth: parse `splash.html` and `balance.html`,
// take every same-origin `/assets/*.js|css` they reference, and add those to the
// precache. The list is therefore DERIVED, so a Vite hash rename cannot silently
// orphan it again — which is exactly how a hand-maintained list rots.
//
// The assets are content-hashed by Vite, so they are immutable: cache-first is
// correct for them. The HTML documents are NOT hashed, so they must be
// network-first with the cached copy as the offline fallback, or a release
// would never reach a returning visitor. `public/sw.js` implements that split
// (`isImmutableAsset()`).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
export const repo = path.resolve(scriptsDir, '..');

/** The entry documents whose references define the shell. */
export const SHELL_DOCUMENTS = ['splash.html', 'balance.html'];

/** Non-asset files the shell needs, which the documents reference by icon/tag. */
const STATIC_SHELL = [
  '404.html',
  'manifest.json',
  'favicon.ico',
  'logo192.png',
  'logo512.png',
  'logo-maskable-512.png',
];

/**
 * Runtime-fetched shell assets that no <script>/<link> tag names.
 *
 * The localisation catalogues and the brand mark are loaded by application code
 * at runtime, so they are invisible to `extractAssets()`. Without them the
 * offline shell renders RAW i18n KEYS (`install_app_title`) instead of copy — a
 * shell that technically loaded but is unreadable, which is not the offline
 * experience this card claims.
 *
 * Matched by PATTERN, not by literal filename: Vite content-hashes the brand
 * mark, so a hardcoded `TollGate_Logo-C-black-DhKg2Nb7.png` would orphan itself
 * on the next build — the same rot this whole module exists to prevent.
 */
const RUNTIME_SHELL_PATTERNS = [
  /^locales\/[a-zA-Z-]+\.json$/,
  /^assets\/TollGate_Logo-[^/]*\.png$/,
];

/** Files matching a runtime-fetched pattern, found in the built webroot. */
function discoverRuntimeShell(webroot) {
  const out = [];
  const walk = (relDir) => {
    let entries;
    try {
      entries = readdirSync(path.join(webroot, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        // Only the two dirs these patterns can live in; do not walk the admin app.
        if (rel === 'locales' || rel === 'assets') walk(rel);
        continue;
      }
      if (RUNTIME_SHELL_PATTERNS.some((re) => re.test(rel))) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

/**
 * Same-origin asset URLs a document references.
 *
 * Deliberately narrow: only `/assets/**` JS and CSS. Anything absolute to
 * another origin is excluded by construction (this is a shell cache, not a
 * generic CDN cache), and so is every API path — those must never be precached.
 */
export function extractAssets(html) {
  const out = new Set();
  // src="..." / href="..." on script/link tags. Quoted, single or double.
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (!url.startsWith('/assets/')) continue;
    if (!/\.(?:js|css)$/i.test(url)) continue;
    out.add(url);
  }
  return [...out].sort();
}

/** The full precache list for a built webroot, or [] if the tree is absent. */
export function computePrecache(webroot) {
  if (!existsSync(webroot)) return [];
  const entries = [];

  for (const doc of SHELL_DOCUMENTS) {
    const p = path.join(webroot, doc);
    // A document that did not build is not silently dropped: its absence is
    // recorded so the worker's own install step skips it, but `404.html` and the
    // rest of the list are unaffected.
    if (!existsSync(p)) continue;
    entries.push(`./${doc}`);
    for (const asset of extractAssets(readFileSync(p, 'utf8'))) {
      entries.push(`.${asset}`);
    }
  }

  for (const rel of STATIC_SHELL) {
    if (existsSync(path.join(webroot, rel))) entries.push(`./${rel}`);
  }

  for (const rel of discoverRuntimeShell(webroot)) {
    entries.push(`./${rel}`);
  }

  // De-duplicate: splash and balance share the React runtime chunk.
  return [...new Set(entries)];
}

/**
 * A deterministic version for the given webroot.
 *
 * Covers the worker source, the precache LIST, and the CONTENT of every
 * precached entry. Including the assets is what makes a rebuilt bundle a new
 * shell version: Vite renames the file, but the cache name must move too.
 */
export function computeVersion(webroot, swSourcePath) {
  const h = createHash('sha256');
  h.update(readFileSync(swSourcePath));
  for (const rel of computePrecache(webroot)) {
    const p = path.join(webroot, rel.replace(/^\.\//, ''));
    h.update(rel);
    h.update(existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'MISSING');
  }
  return h.digest('hex').slice(0, 12);
}

/** Render the PRECACHE array as worker source. */
export function renderPrecacheArray(entries) {
  return `var PRECACHE = [\n${entries.map((e) => `  '${e}',`).join('\n')}\n];`;
}

function main() {
  const webroot = process.env.PWA_WEBROOT || path.join(repo, 'build');
  if (!existsSync(webroot)) {
    console.error(`[build-precache-manifest] no webroot at ${webroot} — run the vite build first`);
    process.exit(1);
  }
  const entries = computePrecache(webroot);
  const assets = entries.filter((e) => e.startsWith('./assets/'));
  if (assets.length === 0) {
    console.error(
      '[build-precache-manifest] the built documents reference no /assets/*.js|css. ' +
        'That means the offline shell would serve markup that cannot render — refusing.'
    );
    process.exit(1);
  }
  console.log(`[build-precache-manifest] ${entries.length} entries (${assets.length} assets)`);
  for (const e of entries) console.log(`  ${e}`);
}
