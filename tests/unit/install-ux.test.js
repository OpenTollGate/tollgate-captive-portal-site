// GATE (card t_98145b7d, W1) — the FIRST-RUN / INSTALL UX contract.
//
// The product story changed once the secure-context constraint was measured
// (SPIKE-secure-context.md, WSEC): the captive-portal page has NO install
// prompt at all, so an "install this app" instruction CANNOT be honoured there.
// The install/intro panel therefore belongs to the VENDOR HTTPS origin, and the
// portal page is a SIGNPOST that deep-links to it.
//
// What these tests protect:
//
//   * The panel never promises an affordance the current origin cannot raise.
//     A "Add to home screen" button that does nothing is worse than no button.
//   * The portal origin gets the signpost variant, not the install variant.
//   * The dismissal is remembered, but only AFTER it is shown — and a
//     first-run panel that is dismissed stays dismissed on the next visit
//     WITHOUT suppressing the manual instructions entirely.
//   * The deep-link carries the gateway context so the vendor origin knows
//     which router the customer came from — and carries the NONCE, so the
//     purchase can be bound to the device.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  INSTALL_DISMISS_KEY,
  buildVendorDeepLink,
  chooseInstallVariant,
  firstRunShouldShow,
  markInstallDismissed,
  readInstallDismissed,
  readPortalContext,
} from '../../src/helpers/install-ux.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── which panel ──────────────────────────────────────────────────────────────

describe('install-ux: the variant is decided by what the origin can actually do', () => {
  it('on the captive-portal origin (no secure context) it is a SIGNPOST, never an install', () => {
    expect(chooseInstallVariant({ secureContext: false, serviceWorker: false })).toBe('signpost');
  });

  it('on a secure origin with a worker it offers a real PROMPT', () => {
    expect(chooseInstallVariant({ secureContext: true, serviceWorker: true })).toBe('prompt');
  });

  it('on a secure origin WITHOUT a worker it falls back to MANUAL instructions', () => {
    // iOS Safari: no beforeinstallprompt at all, but Add to Home Screen works.
    expect(chooseInstallVariant({ secureContext: true, serviceWorker: false })).toBe('manual');
  });

  it('an insecure origin is a signpost even if a worker API is somehow exposed', () => {
    // The inverse mistake: trusting the API over the context would raise a
    // prompt the origin cannot honour.
    expect(chooseInstallVariant({ secureContext: false, serviceWorker: true })).toBe('signpost');
  });

  it('missing/partial capability input fails closed to the signpost', () => {
    expect(chooseInstallVariant({})).toBe('signpost');
    expect(chooseInstallVariant(null)).toBe('signpost');
    expect(chooseInstallVariant(undefined)).toBe('signpost');
  });

  it('never claims "prompt" when running as an already-installed app', () => {
    expect(
      chooseInstallVariant({ secureContext: true, serviceWorker: true, standalone: true })
    ).toBe('installed');
  });
});

// ── first run ────────────────────────────────────────────────────────────────

describe('install-ux: the first-run panel appears once', () => {
  function fakeStorage(initial = {}) {
    const store = { ...initial };
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
      _store: store,
    };
  }

  it('shows on a genuine first visit', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(firstRunShouldShow()).toBe(true);
  });

  it('does NOT show once dismissed', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [INSTALL_DISMISS_KEY]: '1' }));
    expect(firstRunShouldShow()).toBe(false);
  });

  it('a THROWING localStorage (Safari private mode) does not break the page', () => {
    // localStorage access throws in some privacy modes. A first-run panel is
    // cosmetic; it must never take the payment page down with it.
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('SecurityError: denied');
      },
      setItem() {
        throw new Error('SecurityError: denied');
      },
    });
    expect(() => firstRunShouldShow()).not.toThrow();
    expect(() => markInstallDismissed()).not.toThrow();
  });

  it('with no storage at all it still decides something rather than throwing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => firstRunShouldShow()).not.toThrow();
    expect(typeof firstRunShouldShow()).toBe('boolean');
  });

  it('dismissal is remembered, and reading it back agrees', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);

    expect(readInstallDismissed()).toBe(false);
    markInstallDismissed();
    expect(readInstallDismissed()).toBe(true);
    expect(firstRunShouldShow()).toBe(false);
  });

  it('is not shown when the app is already running installed', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(firstRunShouldShow({ standalone: true })).toBe(false);
  });
});

// ── the signpost deep-link ───────────────────────────────────────────────────

describe('install-ux: the signpost deep-links to the vendor origin with the gateway context', () => {
  const CTX = { gw: '192.168.1.1', port: '2121', mac: 'aa:bb:cc:dd:ee:ff', nonce: 'deadbeef' };

  it('carries gw, port, mac and the nonce', () => {
    const url = new URL(buildVendorDeepLink('https://wallet.example.org/', CTX));
    expect(url.origin).toBe('https://wallet.example.org');
    expect(url.searchParams.get('gw')).toBe('192.168.1.1');
    expect(url.searchParams.get('port')).toBe('2121');
    expect(url.searchParams.get('mac')).toBe('aa:bb:cc:dd:ee:ff');
    expect(url.searchParams.get('nonce')).toBe('deadbeef');
  });

  it('preserves an existing path on the vendor origin rather than dropping it', () => {
    const url = new URL(buildVendorDeepLink('https://wallet.example.org/app/', CTX));
    expect(url.pathname).toBe('/app/');
  });

  it('omits absent context keys instead of writing "undefined" into the URL', () => {
    const url = new URL(buildVendorDeepLink('https://wallet.example.org/', { gw: '10.0.0.1' }));
    expect(url.searchParams.get('gw')).toBe('10.0.0.1');
    expect(url.search).not.toContain('undefined');
    expect(url.searchParams.has('nonce')).toBe(false);
  });

  it('refuses a non-https vendor base — the whole point is a SECURE origin', () => {
    expect(() => buildVendorDeepLink('http://wallet.example.org/', CTX)).toThrow();
  });

  it('refuses a relative or missing base rather than emitting a broken link', () => {
    expect(() => buildVendorDeepLink('', CTX)).toThrow();
    expect(() => buildVendorDeepLink(undefined, CTX)).toThrow();
    expect(() => buildVendorDeepLink('/app/', CTX)).toThrow();
  });
});

// ── reading the portal's own context ─────────────────────────────────────────

describe('install-ux: the portal context is read defensively', () => {
  it('reads gw/port/mac/nonce off the query string', () => {
    const ctx = readPortalContext('?gw=10.1.2.3&port=2121&mac=aa%3Abb&nonce=abcd');
    expect(ctx).toEqual({ gw: '10.1.2.3', port: '2121', mac: 'aa:bb', nonce: 'abcd' });
  });

  it('returns only the keys present — never undefined-valued entries', () => {
    expect(readPortalContext('?gw=10.1.2.3')).toEqual({ gw: '10.1.2.3' });
    expect(readPortalContext('')).toEqual({});
    expect(readPortalContext(null)).toEqual({});
  });

  it('does not throw on garbage input', () => {
    expect(() => readPortalContext('%%%')).not.toThrow();
    expect(() => readPortalContext(undefined)).not.toThrow();
  });
});
