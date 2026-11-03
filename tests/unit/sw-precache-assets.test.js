import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GATE (card t_98145b7d, W1) — the shell precache must contain the CODE.
//
// `tests/unit/sw-lifecycle.test.js` pins the versioning; `sw-fetch-rule.test.js`
// pins which requests the worker may answer. Neither of them could catch the
// defect this file exists for, because both read `public/sw.js` as TEXT and the
// text looked entirely correct.
//
// THE DEFECT, measured rather than assumed:
//
//   the precache allow-list named splash.html, balance.html, the manifest and
//   the icons — and NOT the JavaScript or CSS. The offline reload therefore
//   returned an HTML document that then requested `/assets/portal-<hash>.js`;
//   that path is not on the (exact-path) allow-list, so the worker bypassed it
//   into a dead network, the bundle never loaded, and the page rendered as an
//   empty white rectangle.
//
// The e2e gate at the time asserted status 200 + body length > 200 + the URL.
// ALL of that passes for an HTML shell whose scripts 404 — which is why the only
// visible symptom was a blank screenshot nobody looked at closely.
//
// So this file pins the property that was actually missing: the built worker's
// precache must name the script and stylesheet the entry document references.
// It runs against the BUILD output because that is the artifact that ships —
// `public/sw.js` carries a placeholder block that the build replaces.

const BUILD = resolve(process.cwd(), 'build');
const ENTRY_DOC = resolve(BUILD, 'splash.html');
const BUILT_SW = resolve(BUILD, 'sw.js');

function has(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

const HAVE_BUILD = has(ENTRY_DOC) && has(BUILT_SW);
const d = HAVE_BUILD ? describe : describe.skip;

d('the BUILT shell precaches the code it needs to render', () => {
  const html = readFileSync(ENTRY_DOC, 'utf8');
  const sw = readFileSync(BUILT_SW, 'utf8');

  /** Pull the worker's PRECACHE array out of the built source. */
  function precacheEntries() {
    const m = sw.match(/var PRECACHE = \[([\s\S]*?)\];/);
    if (!m) throw new Error('the built worker has no PRECACHE array');
    // eslint-disable-next-line no-new-func
    return new Function(`return [${m[1]}];`)();
  }

  /** Same-origin JS/CSS the entry document actually asks for. */
  function documentAssets() {
    const out = [];
    const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[1].startsWith('/assets/') && /\.(?:js|css)$/i.test(m[1])) out.push(m[1]);
    }
    return out;
  }

  it('names every script and stylesheet in the entry document', () => {
    const assets = documentAssets();
    // Guard the guard: if the document references nothing, this test would be
    // vacuously green and would certify a shell that cannot render.
    expect(assets.length, 'splash.html must reference JS/CSS').toBeGreaterThan(0);

    const entries = precacheEntries().map((e) => e.replace(/^\./, ''));
    for (const asset of assets) {
      expect(entries, `${asset} must be precached or the offline shell is blank`).toContain(asset);
    }
  });

  it('still refuses to precache any authority or API path', () => {
    const entries = precacheEntries();
    for (const banned of ['/balance', '/usage', '/pay', '/ln-invoice', '/v1/mint', '/v1/melt']) {
      // `/balance` is a legitimate DOCUMENT (balance.html) but never this path.
      expect(
        entries.some((e) => e === `./${banned}` || e === `.${banned}`),
        `${banned} must never be precached`
      ).toBe(false);
    }
  });

  it('splits cache-first (immutable assets) from network-first (documents)', () => {
    // The strategy split is what makes an offline reload work AND lets a release
    // actually reach a returning visitor. A single strategy gets one of them
    // wrong, so pin that both branches exist.
    expect(sw).toMatch(/function isImmutableAsset\(/);
    expect(sw).toMatch(/if \(isImmutableAsset\(pathname\)\)/);
    // Documents must be fetched from the network FIRST, not served from cache
    // ahead of it: `var network = fetch(` is built before the cache is consulted
    // on the document branch.
    expect(sw).toMatch(/var network = fetch\(request\)/);
    const docBranch = sw.slice(sw.indexOf('// Document / icon'));
    expect(docBranch.indexOf('network.catch(')).toBeLessThan(docBranch.indexOf('cache.match('));
  });

  it('has no surviving build placeholder', () => {
    expect(sw).not.toContain('__SW_VERSION__');
    expect(sw).not.toContain('__PRECACHE__');
  });
});
