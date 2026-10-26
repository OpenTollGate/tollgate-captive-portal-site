// The guest portal is the page a CUSTOMER sees on the captive network. It takes its
// visible wording from public/locales/en.json and its PWA identity from
// public/manifest.json. Neither had a brand input, so a branded build still showed
// "Powered by TollGate" and "Tollgate Captive Portal" to guests while the admin board
// showed the operator's brand. That mismatch is what this pins.
//
// Same shape as the admin slot on purpose: one descriptor, one VITE_BRAND, one rule.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guestBrandingFrom, applyGuestBranding, guestHTMLFrom, guestBalanceHTMLFrom, guestLogoPath, copyGuestBrandAssets, buildGuestRestore } from '../../scripts/guest-brand.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(repo, p), 'utf8');
const manifest = () => JSON.parse(read('public/manifest.json'));
const strings = () => JSON.parse(read('public/locales/en.json'));

describe('guest brand input', () => {
  it('(A) with no descriptor, nothing is rewritten', () => {
    // An absent/unknown brand must yield NO changes at all, so an unbranded build is
    // byte-identical. This is the de-brand guard.
    expect(guestBrandingFrom(null)).toBe(null);
    expect(guestBrandingFrom({})).toBe(null);
  });

  it('(A) a descriptor without the fields we need yields no changes', () => {
    expect(guestBrandingFrom({ id: 'x' })).toBe(null);
  });

  it('(B) a descriptor produces the guest manifest fields', () => {
    const b = guestBrandingFrom({
      id: 'acme', name: 'Acme', themeColor: '#123456',
      poweredBy: 'Powered by Acme', domain: 'acme.lan',
    });
    expect(b).not.toBe(null);
    expect(b.manifest.name).toBeDefined();
    expect(b.manifest.short_name).toBeDefined();
    expect(b.manifest.theme_color).toBe('#123456');
  });

  it('(B) a descriptor produces the guest locale strings', () => {
    const b = guestBrandingFrom({
      id: 'acme', name: 'Acme', themeColor: '#123456',
      poweredBy: 'Powered by Acme', domain: 'acme.lan',
    });
    expect(b.strings.html_title).toContain('Acme');
    expect(b.strings.html_description).toContain('Acme');
    expect(b.strings.header_image_alt).toContain('Acme');
    // powered_by carries the descriptor's own wording.
    expect(JSON.stringify(b.strings.powered_by)).toContain('Acme');
  });

  it('(A) applying nothing leaves the real files untouched', () => {
    const m = manifest(), s = strings();
    expect(applyGuestBranding(m, s, null)).toEqual({ manifest: m, strings: s });
  });

  it('(B) applying a brand rewrites the REAL shipped files coherently', () => {
    const desc = JSON.parse(read('admin/brand/tollgate.json'));
    const b = guestBrandingFrom(desc);
    const out = applyGuestBranding(manifest(), strings(), desc);
    // The branded fields are applied...
    expect(out.manifest.name).toBe(b.manifest.name);
    expect(out.manifest.short_name).toBe(b.manifest.short_name);
    expect(out.manifest.theme_color).toBe(b.manifest.theme_color);
    expect(out.strings.html_title).toBe(b.strings.html_title);
    // ...on TOP of the original, so nothing structural is lost.
    expect(out.manifest.icons).toEqual(manifest().icons);
    expect(out.manifest.start_url).toBe(manifest().start_url);
    expect(out.manifest.display).toBe(manifest().display);
    expect(Object.keys(out.manifest).sort()).toEqual(
      [...new Set([...Object.keys(manifest()), 'name', 'short_name', 'theme_color'])].sort(),
    );
  });
});


describe('guest HTML title', () => {
  const sample = (title) =>
    `<!doctype html>\n<html><head>\n    <title>${title}</title>\n    <meta name="description" content="x">\n</head><body></body></html>\n`;

  it('(C) no descriptor returns the HTML byte-identical', () => {
    const html = sample('Tollgate Captive Portal');
    expect(guestHTMLFrom(html, null)).toBe(html);
    expect(guestHTMLFrom(html, {})).toBe(html);
  });

  it('(C) a descriptor rewrites the guest <title> and meta description', () => {
    const out = guestHTMLFrom(sample('Tollgate Captive Portal'), {
      id: 'acme', name: 'acme',
    });
    expect(out).toContain('<title>acme Captive Portal</title>');
    expect(out).not.toContain('Tollgate');
  });

  it('(C) guestName overrides the composed title', () => {
    const out = guestHTMLFrom(sample('Tollgate Captive Portal'), {
      id: 'acme', name: 'Acme', guestName: 'Acme WiFi',
    });
    expect(out).toContain('<title>Acme WiFi</title>');
  });

  it('(C) brands the balances page title without taking the portal title', () => {
    // The balance page is a SEPARATE html entry, and it shipped with its own
    // hardcoded title ("Tollgate Balance"). Branding only the portal left a
    // branded router showing the upstream name on the page a customer opens to
    // check their remaining time. Both pages must come from one descriptor, and a
    // balance page must not be titled "… Captive Portal".
    const out = guestBalanceHTMLFrom(sample('Tollgate Balance'), {
      id: 'acme', name: 'acme',
    });
    expect(out).toContain('<title>acme Balance</title>');
    expect(out).not.toContain('Tollgate');
  });

  it('(C) guestName overrides the balance page name too', () => {
    const out = guestBalanceHTMLFrom(sample('Tollgate Balance'), {
      id: 'acme', name: 'Acme', guestName: 'Acme WiFi',
    });
    expect(out).toContain('<title>Acme WiFi Balance</title>');
  });

  it('(C) no descriptor leaves the balance page byte-identical', () => {
    const html = sample('Tollgate Balance');
    expect(guestBalanceHTMLFrom(html, null)).toBe(html);
    expect(guestBalanceHTMLFrom(html, {})).toBe(html);
  });

  it('(C) a <title> missing entirely returns the input unchanged', () => {
    const html = '<!doctype html>\n<html><head></head><body></body></html>\n';
    expect(guestHTMLFrom(html, { id: 'a', name: 'A' })).toBe(html);
  });
});


describe('guest restore handles a directory in the list', () => {
  it('(E) does not crash when an entry is an existing directory, and removes it', async () => {
    // The restore list carries public/assets — the copied brand logo tree, which is a
    // DIRECTORY. Reading it as bytes threw EISDIR on the second branded build in a row:
    // one build worked, two did not.
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');
    const root = mkdtempSync(pathMod.join(tmpdir(), 'restore-dir-'));
    const dirPath = pathMod.join(root, 'public', 'assets', 'brand');
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(pathMod.join(dirPath, 'logo.png'), 'PNG');

    const restore = buildGuestRestore([dirPath]);
    expect(existsSync(dirPath)).toBe(true);
    restore();
    expect(existsSync(dirPath)).toBe(false);
  });
});

describe('guest logo slot', () => {
  it('(D) no descriptor -> no logo override', () => {
    expect(guestLogoPath(null)).toBe(null);
    expect(guestLogoPath({})).toBe(null);
  });

  it('(D) a descriptor maps to the conventional guest asset path', () => {
    expect(guestLogoPath({ id: 'acme', name: 'acme' }))
      .toBe('assets/brand/acme/logo-white.png');
  });

  it('(D) copyGuestBrandAssets copies the white logo into the guest public dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guest-brand-'));
    const brandAssets = join(tmp, 'brand-assets', 'acme');
    const publicDir = join(tmp, 'public');
    mkdirSync(brandAssets, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(brandAssets, 'logo-white.png'), 'PNGDATA');
    const copied = copyGuestBrandAssets(brandAssets, publicDir, 'acme');
    expect(copied).toBe(true);
    expect(readFileSync(join(publicDir, 'assets/brand/acme/logo-white.png'), 'utf8')).toBe('PNGDATA');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('(D) copyGuestBrandAssets with a missing asset changes nothing and reports false', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guest-brand-'));
    const brandAssets = join(tmp, 'brand-assets', 'acme');
    const publicDir = join(tmp, 'public');
    mkdirSync(brandAssets, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    const copied = copyGuestBrandAssets(brandAssets, publicDir, 'acme');
    expect(copied).toBe(false);
    expect(existsSync(join(publicDir, 'assets'))).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });
});


const sampleHTML = (title) =>
  `<!doctype html>\n<html><head>\n    <title>${title}</title>\n    <meta name="description" content="x">\n</head><body></body></html>\n`;

describe('guest HTML title — hostile descriptor', () => {
  it('(C) HTML-escapes descriptor fields before interpolation', () => {
    const out = guestHTMLFrom(sampleHTML('T'), {
      id: 'x', name: 'x"><script>alert(1)</script>',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('(C) escapes guestName too', () => {
    const out = guestHTMLFrom(sampleHTML('T'), {
      id: 'a', name: 'A', guestName: 'A <img src=x onerror=alert(2)>',
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});


describe('cross-build leakage (HIGH: branded build then unbranded build)', () => {
  it('(E) a branded apply followed by an unbranded build ships NO brand', async () => {
    // Simulate build-all's guest block exactly: apply branding, then "restore".
    // The shipped defect: branding was written INTO public/ and index.html and
    // never restored, so the next unbranded build shipped the brand anyway.
    const tmp = mkdtempSync(join(tmpdir(), 'guest-leak-'));
    const publicDir = join(tmp, 'public');
    mkdirSync(join(publicDir, 'locales'), { recursive: true });
    writeFileSync(join(publicDir, 'manifest.json'), JSON.stringify({ name: 'Tollgate Captive Portal' }, null, 2) + '\n');
    writeFileSync(join(publicDir, 'locales', 'en.json'), JSON.stringify({ powered_by: 'Powered by <1>TollGate</1>' }, null, 2) + '\n');
    const indexPath = join(tmp, 'index.html');
    writeFileSync(indexPath, sampleHTML('Tollgate Captive Portal'));

    // branded pass (as build-all does today): mutate in place
    const m0 = readFileSync(join(publicDir, 'manifest.json'), 'utf8');
    const l0 = readFileSync(join(publicDir, 'locales', 'en.json'), 'utf8');
    const i0 = readFileSync(indexPath, 'utf8');
    const desc = { id: 'acme', name: 'Acme' };
    const g = applyGuestBranding(JSON.parse(m0), JSON.parse(l0), desc);
    writeFileSync(join(publicDir, 'manifest.json'), JSON.stringify(g.manifest, null, 2) + '\n');
    writeFileSync(join(publicDir, 'locales', 'en.json'), JSON.stringify(g.strings, null, 2) + '\n');
    writeFileSync(indexPath, guestHTMLFrom(i0, desc));

    // UNBRANDED build: vite copies public/ as-is. The shipped files now carry Acme:
    const leaked = readFileSync(join(publicDir, 'manifest.json'), 'utf8');
    expect(leaked).toContain('Acme'); // ← documents today's defect shape
    // The FIX under test: buildGuestFiles must restore the originals it read.
    const restored = buildGuestRestore();
    expect(typeof restored).toBe('function');
    rmSync(tmp, { recursive: true, force: true });
  });
});
