import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const src = readFileSync(resolve(root, 'scripts/build-all.mjs'), 'utf8');

// The contract, from admin/vite.config.mjs: both apps are served from a docroot ROOT —
// the guest portal at /, the admin board at the root of its OWN uhttpd (:8090,
// home=/www/<brand>). So both bases are '/'. What must never happen is one
// caller-supplied base reaching BOTH builds: an /admin/ value on the portal makes its
// asset URLs 404 and the customer's page renders blank.
describe('build-all base paths', () => {
  it('(A) the admin build does not read a caller-supplied base', () => {
    const adminCall = src.split('\n').find((l) => l.includes("run('build:admin'")) || '';
    expect(adminCall).not.toMatch(/VITE_BASE_PATH:\s*base\b/);
  });

  it('(B) the admin build uses a RELATIVE base so it works under :8090 AND /admin/', () => {
    const adminCall = src.split('\n').find((l) => l.includes("run('build:admin'")) || '';
    expect(adminCall).toContain("VITE_BASE_PATH: './'");
  });

  it('(C) an /admin base for the PORTAL is refused loudly, not silently applied', () => {
    expect(src).toMatch(/startsWith\('\/admin'\)/);
  });
});

describe('shipped HTML follows the docroot-root contract', () => {
  const splash = resolve(root, 'build/splash.html');
  it.runIf(existsSync(splash))('(D) splash.html has no /admin/ asset refs', () => {
    const html = readFileSync(splash, 'utf8');
    expect(html).not.toContain('/admin/assets/');
    expect(html).not.toContain('/admin/manifest.json');
  });

  const adminIdx = resolve(root, 'build/admin/index.html');
  it.runIf(existsSync(adminIdx))('(E) admin/index.html uses RELATIVE asset refs', () => {
    const html = readFileSync(adminIdx, 'utf8');
    // Relative: works at :8090 root and beneath :2051/admin/. Absolute forms cannot.
    expect(html).not.toContain('/admin/assets/');
    expect(html).toMatch(/(src|href)="\.\/assets\//);
  });
});
