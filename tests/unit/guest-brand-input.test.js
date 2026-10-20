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
import { guestBrandingFrom, applyGuestBranding, guestHTMLFrom, guestLogoPath, copyGuestBrandAssets } from '../../scripts/guest-brand.mjs';

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
      id: 'net4sats', name: 'net4sats',
    });
    expect(out).toContain('<title>net4sats Captive Portal</title>');
    expect(out).not.toContain('Tollgate');
  });

  it('(C) guestName overrides the composed title', () => {
    const out = guestHTMLFrom(sample('Tollgate Captive Portal'), {
      id: 'acme', name: 'Acme', guestName: 'Acme WiFi',
    });
    expect(out).toContain('<title>Acme WiFi</title>');
  });

  it('(C) a <title> missing entirely returns the input unchanged', () => {
    const html = '<!doctype html>\n<html><head></head><body></body></html>\n';
    expect(guestHTMLFrom(html, { id: 'a', name: 'A' })).toBe(html);
  });
});


describe('guest logo slot', () => {
  it('(D) no descriptor -> no logo override', () => {
    expect(guestLogoPath(null)).toBe(null);
    expect(guestLogoPath({})).toBe(null);
  });

  it('(D) a descriptor maps to the conventional guest asset path', () => {
    expect(guestLogoPath({ id: 'net4sats', name: 'net4sats' }))
      .toBe('assets/brand/net4sats/logo-white.png');
  });

  it('(D) copyGuestBrandAssets copies the white logo into the guest public dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guest-brand-'));
    const brandAssets = join(tmp, 'brand-assets', 'net4sats');
    const publicDir = join(tmp, 'public');
    mkdirSync(brandAssets, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(brandAssets, 'logo-white.png'), 'PNGDATA');
    const copied = copyGuestBrandAssets(brandAssets, publicDir, 'net4sats');
    expect(copied).toBe(true);
    expect(readFileSync(join(publicDir, 'assets/brand/net4sats/logo-white.png'), 'utf8')).toBe('PNGDATA');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('(D) copyGuestBrandAssets with a missing asset changes nothing and reports false', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guest-brand-'));
    const brandAssets = join(tmp, 'brand-assets', 'net4sats');
    const publicDir = join(tmp, 'public');
    mkdirSync(brandAssets, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    const copied = copyGuestBrandAssets(brandAssets, publicDir, 'net4sats');
    expect(copied).toBe(false);
    expect(existsSync(join(publicDir, 'assets'))).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });
});
