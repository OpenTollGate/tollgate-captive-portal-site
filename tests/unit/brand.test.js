// Brand slot contract.
//
// One build ships exactly ONE skin, and this repository ships exactly ONE
// descriptor: the generic default. A distribution overlay adds its own
// `admin/brand/<id>.json` + `admin/public/assets/brand/<id>/` at build time —
// env/assets/config only, never a fork of this repo (see issue #33).
//
// These tests are deliberately descriptor-driven: they never mention any
// company name, so they cannot themselves become a branding leak.
//
// An id is an *identifier*, not a path: the slot is addressed by
// `admin/brand/<id>.json` and `public/assets/brand/<id>/`, so the accepted
// alphabet is deliberately narrow and matching is case-insensitive (the
// documented contract). Both halves are pinned here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRAND_ID,
  DESCRIPTOR_REQUIRED_FIELDS,
  descriptorIdFromPath,
  indexDescriptors,
  loadBrandDescriptors,
  normalizeBrandId,
  resolveBrand,
} from '../../admin/src/brand-core';

const GENERIC = {
  id: 'tollgate',
  name: 'TollGate',
  domain: 'tollgate.lan',
  tagline: 'Router Admin Dashboard',
  poweredBy: 'Powered by TollGate',
  website: 'https://tollgate.me/',
  version: 'TollGate v0.6.0-alpha2',
  themeColor: '#FF6961',
  sessionKey: 'tollgate_session',
  sessionUser: 'tollgate_user',
};

// A descriptor an overlay build would drop into the slot.
const OVERLAY = {
  ...GENERIC,
  id: 'acme',
  name: 'Acme',
  domain: 'acme.lan',
  tagline: 'Acme Router Admin Dashboard',
  poweredBy: 'Powered by Acme',
  website: 'https://acme.example/',
  themeColor: '#123456',
  sessionKey: 'acme_session',
  sessionUser: 'acme_user',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('descriptor slot discovery', () => {
  it('derives the brand id from the descriptor file name', () => {
    expect(descriptorIdFromPath('../../admin/brand/acme.json')).toBe('acme');
    expect(descriptorIdFromPath('C:\\repo\\admin\\brand\\acme.json')).toBe('acme');
    expect(descriptorIdFromPath('acme.json')).toBe('acme');
  });

  it('indexes descriptors by id so VITE_BRAND can select one', () => {
    const indexed = indexDescriptors({
      '../brand/tollgate.json': GENERIC,
      '../brand/acme.json': OVERLAY,
    });
    expect(Object.keys(indexed).sort()).toEqual(['acme', 'tollgate']);
    expect(indexed.acme.name).toBe('Acme');
  });

  it('rejects a descriptor whose declared id contradicts its file name', () => {
    expect(() =>
      indexDescriptors({ '../brand/acme.json': { ...OVERLAY, name: 'Acme' } }),
    ).not.toThrow();
    expect(() =>
      indexDescriptors({ '../brand/renamed.json': OVERLAY }),
    ).toThrow(/declares id "acme"/);
  });

  it('normalizes a descriptor file name to a lowercase id key', () => {
    expect(descriptorIdFromPath('../../admin/brand/Acme.json')).toBe('acme');
    expect(descriptorIdFromPath('../../admin/brand/ACME.JSON')).toBe('acme');
  });

  it('treats a filename/id mismatch as consistent when it differs only in case', () => {
    expect(() =>
      indexDescriptors({ '../brand/ACME.json': { ...OVERLAY, id: 'Acme' } }),
    ).not.toThrow();
  });

  it('indexes descriptors under lowercase keys via loadBrandDescriptors', () => {
    const loaded = loadBrandDescriptors({
      '../brand/Acme.json': { default: { ...OVERLAY, id: 'Acme' } },
    });
    expect(Object.keys(loaded)).toEqual(['acme']);
    expect(loaded.acme.name).toBe('Acme');
  });

  it('stores the normalized id on the indexed descriptor', () => {
    // The resolved id is what addresses the asset slot
    // (`public/assets/brand/<id>/`), so it must be the lowercase one even when
    // the descriptor file/declared id is not.
    const indexed = indexDescriptors({ '../brand/Acme.json': { ...OVERLAY, id: 'Acme' } });
    expect(indexed.acme.id).toBe('acme');
    const loaded = loadBrandDescriptors({
      '../brand/Acme.json': { default: { ...OVERLAY, id: 'Acme' } },
    });
    expect(loaded.acme.id).toBe('acme');
  });

  it('rejects two descriptor files that normalize to the same id', () => {
    expect(() =>
      indexDescriptors({
        '../brand/acme.json': OVERLAY,
        '../brand/ACME.json': { ...OVERLAY, id: 'Acme' },
      }),
    ).toThrow(/duplicate/);
    // The runtime path goes glob -> loadBrandDescriptors -> resolveBrand, so
    // the check has to fire there too (indexDescriptors then sees one entry).
    expect(() =>
      loadBrandDescriptors({
        '../brand/acme.json': { default: OVERLAY },
        '../brand/ACME.json': { default: { ...OVERLAY, id: 'Acme' } },
      }),
    ).toThrow(/duplicate/);
  });

  it('treats only lowercase *.json names as slot descriptors', async () => {
    // The runtime glob is `brand/*.json`; the build tooling must agree, or a
    // README/uppercase-extension file becomes a phantom id the app can never
    // resolve (favicon/skin drift).
    const buildSide = await import('../../scripts/brand-id.mjs');
    expect(buildSide.isDescriptorFile('tollgate.json')).toBe(true);
    expect(buildSide.isDescriptorFile('Acme.json')).toBe(true);
    for (const name of ['README.md', 'ACME.JSON', 'brand.json.bak', 'acme.json5', '']) {
      expect(buildSide.isDescriptorFile(name)).toBe(false);
    }
    expect(buildSide.findDescriptor({ '../brand/README.md': OVERLAY }, 'readme')).toBeNull();
    expect(
      buildSide.findDescriptor({ '../brand/Acme.json': { default: OVERLAY } }, 'ACME'),
    ).toBe(OVERLAY);
  });
});

describe('resolveBrand', () => {
  const bundled = { tollgate: GENERIC };

  it('defaults to the generic brand when VITE_BRAND is unset', () => {
    expect(resolveBrand(undefined, bundled).id).toBe(DEFAULT_BRAND_ID);
    expect(resolveBrand('', bundled).name).toBe('TollGate');
    expect(resolveBrand('   ', bundled).id).toBe(DEFAULT_BRAND_ID);
    expect(resolveBrand(null, bundled).id).toBe(DEFAULT_BRAND_ID);
  });

  it('selects an overlay descriptor supplied by a distribution build', () => {
    const brand = resolveBrand('acme', { ...bundled, acme: OVERLAY });
    expect(brand.name).toBe('Acme');
    expect(brand.themeColor).toBe('#123456');
    expect(brand.sessionKey).toBe('acme_session');
  });

  it('derives the logo asset slot from the resolved brand id', () => {
    const brand = resolveBrand('acme', { ...bundled, acme: OVERLAY });
    // The logo slot is a convention, not per-descriptor data: an overlay only
    // has to drop its files into public/assets/brand/<id>/.
    expect(brand.logo).toBe('assets/brand/acme/logo-colour.png');
    expect(brand.logoWhite).toBe('assets/brand/acme/logo-white.png');
    expect(brand.icon).toBe('assets/brand/acme/icon-colour.png');
    expect(brand.iconWhite).toBe('assets/brand/acme/icon-white.png');
  });

  it('matches the requested id case-insensitively and trims it', () => {
    expect(resolveBrand('  ACME ', { ...bundled, acme: OVERLAY }).id).toBe('acme');
  });

  it('selects a descriptor whose file name is not lowercase', () => {
    // Regression: `VITE_BRAND=ACME` with an `Acme.json` descriptor used to fall
    // back to the default, because only the request was lowercased.
    const brand = resolveBrand('ACME', {
      tollgate: GENERIC,
      'Acme.json': { ...OVERLAY, id: 'Acme' },
    });
    expect(brand.id).toBe('acme');
    expect(brand.name).toBe('Acme');
    expect(brand.logo).toBe('assets/brand/acme/logo-colour.png');
  });

  it('falls back to the default brand, loudly, when the id is not bundled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brand = resolveBrand('not-bundled', bundled);
    expect(brand.id).toBe(DEFAULT_BRAND_ID);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/not-bundled/);
  });

  it('never warns on a clean default build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveBrand(undefined, bundled);
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails loudly on a descriptor missing a required field', () => {
    const { website, ...missingWebsite } = OVERLAY;
    expect(() => resolveBrand('acme', { ...bundled, acme: missingWebsite })).toThrow(
      /missing required field "website"/,
    );
  });

  it('fails loudly on an empty required field', () => {
    expect(() =>
      resolveBrand('acme', { ...bundled, acme: { ...OVERLAY, themeColor: '' } }),
    ).toThrow(/missing required field "themeColor"/);
  });

  it('fails loudly when the default descriptor itself is absent', () => {
    expect(() => resolveBrand('acme', {})).toThrow(/no descriptor for the default brand/);
  });
});

describe('the accepted brand-id alphabet', () => {
  it('trims and lowercases a usable id', () => {
    expect(normalizeBrandId('  AcMe ')).toBe('acme');
    expect(normalizeBrandId('tollgate')).toBe('tollgate');
    expect(normalizeBrandId('a1._-b')).toBe('a1._-b');
  });

  it('rejects anything that is not a plain identifier', () => {
    // A brand id addresses `admin/brand/<id>.json` and
    // `public/assets/brand/<id>/`, so a path-ish value must never survive.
    for (const bad of [
      undefined,
      null,
      '',
      '   ',
      '../../etc/passwd',
      '/etc/passwd',
      'a/b',
      '..',
      '.',
      '.acme',
      '-acme',
      '_acme',
      'acme/',
      'acme\\x',
      'acme json',
      'acme;rm -rf /',
      'acme\u0000',
    ]) {
      expect(normalizeBrandId(bad)).toBe('');
    }
  });

  it('never hands a path-ish id to the asset slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const brand = resolveBrand('../../etc/passwd', { tollgate: GENERIC });
    expect(brand.id).toBe(DEFAULT_BRAND_ID);
    expect(brand.logo).toBe('assets/brand/tollgate/logo-colour.png');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/not a valid brand id/);
  });
});

describe('build-side and runtime id normalisation agree', () => {
  it('normalizes identically in scripts/brand-id.mjs and brand-core.ts', async () => {
    // Two implementations exist (one for node/vite config, one for the app)
    // because vite.config.mjs cannot import TypeScript. Pin them together.
    const buildSide = await import('../../scripts/brand-id.mjs');
    const samples = [
      undefined,
      null,
      '',
      '  ',
      'TollGate',
      ' ACME ',
      'acme',
      'Acme.json',
      '../../etc/passwd',
      'a/b',
      '.',
      '-acme',
      'a1._-b',
    ];
    for (const sample of samples) {
      expect(buildSide.normalizeBrandId(sample)).toBe(normalizeBrandId(sample));
    }
    expect(buildSide.DEFAULT_BRAND_ID).toBe(DEFAULT_BRAND_ID);
    for (const sample of ['../../admin/brand/Acme.json', 'C:\\repo\\brand\\ACME.JSON', 'acme.json']) {
      expect(buildSide.descriptorIdFromPath(sample)).toBe(descriptorIdFromPath(sample));
    }
  });

  it('requires the same descriptor fields as the runtime validator', async () => {
    const buildSide = await import('../../scripts/brand-id.mjs');
    expect([...buildSide.REQUIRED_DESCRIPTOR_FIELDS].sort()).toEqual(
      [...DESCRIPTOR_REQUIRED_FIELDS].sort(),
    );
    // And the build-side validator rejects what the runtime rejects.
    const { themeColor, ...missing } = OVERLAY;
    expect(() => buildSide.validateDescriptor(missing)).toThrow(/missing required field "themeColor"/);
    expect(() => buildSide.validateDescriptor({ ...OVERLAY, name: '  ' })).toThrow(
      /missing required field "name"/,
    );
    expect(() => buildSide.validateDescriptor(OVERLAY)).not.toThrow();
  });
});

describe('the shipped brand slot', () => {
  it('bundles exactly the generic default descriptor and no distribution skin', () => {
    // Anti-leak regression test: this repo is the protocol side. The slot may
    // only ever contain the generic default; an operator onboards by shipping
    // its own descriptor from its own distribution repo (issue #33).
    const slot = import.meta.glob('../../admin/brand/*.json');
    expect(Object.keys(slot).map(descriptorIdFromPath).sort()).toEqual([
      DEFAULT_BRAND_ID,
    ]);
  });
});
