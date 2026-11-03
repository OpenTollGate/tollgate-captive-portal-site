// Unit gate for src/helpers/pwa-install.js.
//
// The behaviour under test is the TRAP the spike measured: on an insecure
// origin `navigator.serviceWorker` is absent, so a feature-detect written as
// `try { register() } catch (SecurityError)` or as a bare property access
// CRASHES instead of degrading. These tests pin the correct discrimination —
// branch on `window.isSecureContext` first — and pin the "none" install path
// that the portal origin must always resolve to.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectCapabilities,
  hasCacheSupport,
  hasCryptoSubtle,
  hasPersistentStorageSupport,
  hasServiceWorkerSupport,
  installPath,
  isSecureContext,
  isStandalone,
} from '../../src/helpers/pwa-install.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pwa-install: the insecure (captive portal) origin', () => {
  /**
   * Reproduce the measured portal origin: isSecureContext false, and
   * `navigator.serviceWorker` ABSENT rather than a throwing object.
   */
  function makePortalOrigin() {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('crypto', { getRandomValues: (a) => a });
    const navigatorStub = {
      userAgent: 'portal',
      // NB: no `serviceWorker` key at all — this is the whole point.
      storage: { persist: undefined },
    };
    vi.stubGlobal('navigator', navigatorStub);
    vi.stubGlobal('caches', undefined);
    return navigatorStub;
  }

  it('reports every gated capability as unavailable', () => {
    makePortalOrigin();
    expect(isSecureContext()).toBe(false);
    expect(hasServiceWorkerSupport()).toBe(false);
    expect(hasCacheSupport()).toBe(false);
    expect(hasCryptoSubtle()).toBe(false);
    expect(hasPersistentStorageSupport()).toBe(false);
    expect(detectCapabilities()).toEqual({
      secureContext: false,
      serviceWorker: false,
      cache: false,
      cryptoSubtle: false,
      persistentStorage: false,
    });
  });

  it('does NOT crash when navigator.serviceWorker is undefined', () => {
    makePortalOrigin();
    // The trap: any implementation that touches the property before checking
    // the context throws here. This must be false, not a TypeError.
    expect(() => hasServiceWorkerSupport()).not.toThrow();
    expect(() => detectCapabilities()).not.toThrow();
  });

  it('resolves to the "none" install path — no prompt may be promised', () => {
    makePortalOrigin();
    expect(installPath()).toBe('none');
  });
});

describe('pwa-install: a secure origin without a service worker', () => {
  it('reports "manual" (iOS add-to-home-screen), not "none"', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { serviceWorker: undefined, storage: {} });
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('crypto', { subtle: {} });

    expect(isSecureContext()).toBe(true);
    expect(hasServiceWorkerSupport()).toBe(false);
    expect(installPath()).toBe('manual');
  });
});

describe('pwa-install: a secure origin with a service worker', () => {
  it('reports "promptable" only when register() is actually callable', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      serviceWorker: { register: () => Promise.resolve({}) },
      storage: { persist: () => Promise.resolve(true) },
    });
    vi.stubGlobal('caches', { open: () => Promise.resolve({}) });
    vi.stubGlobal('crypto', { subtle: {} });

    expect(hasServiceWorkerSupport()).toBe(true);
    expect(hasCacheSupport()).toBe(true);
    expect(hasCryptoSubtle()).toBe(true);
    expect(hasPersistentStorageSupport()).toBe(true);
    expect(installPath()).toBe('promptable');
  });

  it('a serviceWorker object without register() is NOT support (fail closed)', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { serviceWorker: {}, storage: {} });
    expect(hasServiceWorkerSupport()).toBe(false);
    expect(installPath()).toBe('manual');
  });
});

describe('pwa-install: a secure context must never be assumed from the API alone', () => {
  it('an API-present but insecure origin still reports no support', () => {
    // Guards the inverse mistake: checking `'serviceWorker' in navigator`
    // without the context check would claim support on the portal origin if a
    // future browser exposed the object without the gate.
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', {
      serviceWorker: { register: () => Promise.resolve({}) },
      storage: { persist: () => Promise.resolve(true) },
    });
    vi.stubGlobal('caches', { open: () => Promise.resolve({}) });
    vi.stubGlobal('crypto', { subtle: {} });

    expect(hasServiceWorkerSupport()).toBe(false);
    expect(hasCacheSupport()).toBe(false);
    expect(hasCryptoSubtle()).toBe(false);
    expect(hasPersistentStorageSupport()).toBe(false);
    expect(installPath()).toBe('none');
  });
});

describe('pwa-install: no probe may throw, whatever the environment', () => {
  it('survives a missing window entirely', () => {
    vi.stubGlobal('window', undefined);
    expect(() => detectCapabilities()).not.toThrow();
    expect(isSecureContext()).toBe(false);
    expect(installPath()).toBe('none');
  });

  it('survives a window.matchMedia that throws', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      matchMedia: () => {
        throw new Error('nope');
      },
      navigator: {},
    });
    expect(isStandalone()).toBe(false);
  });

  it('detects iOS standalone via navigator.standalone', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      navigator: { standalone: true },
    });
    expect(isStandalone()).toBe(true);
  });

  it('detects the display-mode media query', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }),
      navigator: {},
    });
    expect(isStandalone()).toBe(true);
  });
});
