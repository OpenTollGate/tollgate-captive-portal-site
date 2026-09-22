// Brand slot contract.
//
// One build ships exactly ONE skin, and this repository ships exactly ONE
// descriptor: the generic default. A distribution overlay adds its own
// `admin/brand/<id>.json` + `admin/public/assets/brand/<id>/` at build time —
// env/assets/config only, never a fork of this repo (see issue #33).
//
// These tests are deliberately descriptor-driven: they never mention any
// company name, so they cannot themselves become a branding leak.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRAND_ID,
  descriptorIdFromPath,
  indexDescriptors,
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
