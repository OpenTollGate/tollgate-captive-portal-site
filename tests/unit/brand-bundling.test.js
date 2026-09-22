// Contract test for the RUNTIME brand slot.
//
// The brand slot is only real if the descriptor the build was asked for is
// actually bundled at build time. `admin/src/brand.ts` loads the slot with
// `import.meta.glob(...)`, and an `import.meta.glob` pattern is resolved
// RELATIVE TO THE IMPORTING MODULE — a pattern pointing at the wrong directory
// resolves to an empty module map, `resolveBrand` then falls back to the
// generic default, and a distribution build silently ships the wrong skin
// (its manifest/icon are branded, its UI is not). That failure is invisible in
// the build log, so it needs an explicit test.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { BRAND, DEFAULT_BRAND_ID, bundledBrandIds } from '../../admin/src/brand';

const slotDir = path.resolve(__dirname, '../../admin/brand');
const slotIds = readdirSync(slotDir)
  .filter((f) => f.toLowerCase().endsWith('.json'))
  .map((f) => f.replace(/\.json$/i, '').toLowerCase());

describe('runtime brand slot bundling', () => {
  it('bundles every descriptor in admin/brand/ -- the glob points at the slot', () => {
    // guards the relative-path trap: the glob must resolve to admin/brand/, not
    // to <repo>/brand/ (which does not exist)
    expect(bundledBrandIds().sort()).toEqual(slotIds.sort());
  });

  it('bundles the shipped generic default descriptor', () => {
    expect(bundledBrandIds()).toContain(DEFAULT_BRAND_ID);
  });

  it('resolves an unset VITE_BRAND to the generic default', () => {
    expect(BRAND.id).toBe(DEFAULT_BRAND_ID);
  });
});
