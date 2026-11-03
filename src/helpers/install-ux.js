// The install / first-run panel's DECISIONS, separated from its rendering.
//
// ── Why the product story changed ────────────────────────────────────────────
//
// The brief said "the PWA introduces itself and instructs the user to save it
// to the home screen". Measured on the captive-portal origin (SPIKE-secure-
// context.md, WSEC), that instruction CANNOT be honoured there: the origin has
// no service worker, so Chromium never fires `beforeinstallprompt`, so there is
// no install prompt to raise. A button that promises one is a dead control.
//
// So the install panel is authored for the VENDOR HTTPS origin, and the portal
// page becomes a SIGNPOST: it explains the situation honestly and deep-links to
// the vendor origin, carrying the gateway context (`?gw=&port=&mac=&nonce=`) so
// the vendor app knows which router (and which purchase nonce) the customer
// arrived with.
//
// This module holds the three decisions worth testing independently of React:
// which variant to render, whether first-run should show at all, and what the
// deep-link looks like.

import { detectCapabilities, installPath, isStandalone } from './pwa-install.js';

/** localStorage key holding "the user dismissed the first-run panel". */
export const INSTALL_DISMISS_KEY = 'tollgate.install.dismissed';

/**
 * Which install panel this page should render.
 *
 *   'installed' — already running from a home-screen icon; show nothing.
 *   'prompt'    — secure origin + worker: a real `beforeinstallprompt` exists.
 *   'manual'    — secure origin, no worker (iOS Safari): Add-to-Home-Screen.
 *   'signpost'  — insecure origin: no install is possible; explain + deep-link.
 *
 * `signpost` is the DEFAULT for missing input. An instalment prompt the origin
 * cannot honour is worse than an honest explanation.
 */
export function chooseInstallVariant(input) {
  const { secureContext, serviceWorker, standalone } = input || {};
  if (standalone === true) return 'installed';

  // Context before API — the same ordering as pwa-install.js, for the same
  // reason: the API can be present on an origin that cannot honour it.
  if (secureContext !== true) return 'signpost';
  return serviceWorker === true ? 'prompt' : 'manual';
}

/** The variant for the CURRENT page, using the measured capabilities. */
export function currentInstallVariant() {
  try {
    const caps = detectCapabilities();
    return chooseInstallVariant({
      secureContext: caps.secureContext,
      serviceWorker: caps.serviceWorker,
      standalone: isStandalone(),
    });
  } catch {
    return 'signpost';
  }
}

// ── dismissal ────────────────────────────────────────────────────────────────

/**
 * Has the user already dismissed the first-run panel?
 *
 * Storage access THROWS in some privacy modes (Safari private browsing, a
 * partitioned iframe, a `SecurityError` from a sandboxed context). A first-run
 * panel is cosmetic; it must never take the payment page down with it, so every
 * access here is guarded and a failure reads as "not dismissed" only where that
 * is harmless — see `firstRunShouldShow`.
 */
export function readInstallDismissed() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the dismissal. Silent on failure — see readInstallDismissed. */
export function markInstallDismissed() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
  } catch {
    /* storage unavailable: the panel will simply show again next visit */
  }
}

/**
 * Should the first-run intro show?
 *
 * Not when already installed (there is nothing to introduce that the icon does
 * not already do), not when dismissed, and not when storage is unavailable —
 * in that last case showing it on every visit would be the worst outcome, so an
 * unreadable store suppresses it rather than repeating it.
 */
export function firstRunShouldShow({ standalone } = {}) {
  try {
    if (standalone === true) return false;
    if (isStandalone()) return false;
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    return localStorage.getItem(INSTALL_DISMISS_KEY) !== '1';
  } catch {
    // A throwing store cannot tell us whether it was dismissed. Showing a
    // once-only panel on every page load is worse than not showing it.
    return false;
  }
}

// ── the portal's own context ─────────────────────────────────────────────────

const CONTEXT_KEYS = Object.freeze(['gw', 'port', 'mac', 'nonce']);

/**
 * The gateway context, read off the portal's query string.
 *
 * Only keys that are actually present are returned — a `{ gw: undefined }`
 * entry would stringify into the vendor URL as the literal "undefined".
 */
export function readPortalContext(search) {
  const out = {};
  try {
    const qs = typeof search === 'string' ? search : '';
    if (!qs) return out;
    const params = new URLSearchParams(qs);
    for (const key of CONTEXT_KEYS) {
      const value = params.get(key);
      if (value !== null && value !== '') out[key] = value;
    }
  } catch {
    // Unparseable query string: no context. The signpost still renders.
  }
  return out;
}

/**
 * The deep-link into the vendor HTTPS app.
 *
 * Throws on a non-https or non-absolute base. That is not defensive noise: the
 * entire premise of this link is that it points at a SECURE origin, because
 * that is the only place an app can install. Emitting an `http:` or relative
 * link would send the customer to a page that cannot do the thing they were
 * invited to do.
 */
export function buildVendorDeepLink(base, context = {}) {
  if (typeof base !== 'string' || !base) {
    throw new Error('buildVendorDeepLink requires an absolute vendor URL');
  }

  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`buildVendorDeepLink requires an absolute URL, got ${JSON.stringify(base)}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      `the vendor origin must be https — got ${url.protocol}//, which cannot install an app`
    );
  }

  for (const key of CONTEXT_KEYS) {
    const value = context && context[key];
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}
