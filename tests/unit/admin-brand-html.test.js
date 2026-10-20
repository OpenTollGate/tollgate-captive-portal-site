import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminHTMLFrom } from '../../scripts/guest-brand.mjs';

const read = (p) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('admin app index.html branding', () => {
  it('(A) the default descriptor leaves the shipped page untouched', () => {
    const html = read('admin/index.html');
    const desc = JSON.parse(read('admin/brand/tollgate.json'));
    const out = adminHTMLFrom(html, desc);
    // The generic default must reproduce the page byte for byte.
    expect(out).toBe(html);
  });

  it('(B) a brand rewrites the title and theme-color, and keeps the rest', () => {
    const html = read('admin/index.html');
    // Inline descriptor: the brand slot ships ONLY the generic default (the anti-leak
    // test pins that), so a vendor descriptor must never be read from disk here.
    const desc = {
      id: 'net4sats', name: 'net4sats', domain: 'net4sats.lan',
      tagline: 'Router Admin Dashboard', poweredBy: 'Powered by net4sats',
      website: 'https://net4sats.com/', version: 'net4sats v0.6.0',
      themeColor: '#f7931a',
    };
    const out = adminHTMLFrom(html, desc);
    expect(out).toContain('<title>net4sats</title>');
    expect(out).toContain('content="#f7931a"');
    expect(out).not.toContain('TollGate Admin');
    expect(out).not.toContain('content="#111"');
    // structural bits survive
    expect(out).toContain('<div id="app"></div>');
    expect(out).toContain('rel="manifest"');
  });

  it('(C) a descriptor missing fields is a no-op, never a half-applied page', () => {
    const html = read('admin/index.html');
    expect(adminHTMLFrom(html, {})).toBe(html);
    expect(adminHTMLFrom(html, null)).toBe(html);
  });
});
