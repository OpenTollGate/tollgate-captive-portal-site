// What the portal can and cannot do, decided from the ORIGIN rather than from
// a probe that can crash. Read this before writing any feature detection that
// touches service workers, the Cache API, crypto.subtle, or navigator.storage.
//
// ── The constraint ────────────────────────────────────────────────────────────
// A captive portal is served as plain `http://` on a bare IP (this one is
// uhttpd on `http://<router-lan-ip>:2051`). That origin is **Not Trustworthy**
// per W3C Secure Contexts §3.1: trust comes from the SCHEME plus a narrow
// loopback/localhost exemption, and — in the spec's own words — "neither
// origin's domain nor port has any effect". RFC1918 addresses are absent by
// omission, so no LAN IP, no `.lan`/`.local` name and no mDNS name is ever
// trustworthy. Measured, not deduced: see
// `~/reports/pwa-cashu/SPIKE-secure-context.md` and the executable gate at
// `tests/e2e/installability.spec.mjs`.
//
// Consequence: on the portal origin there is no service worker, no install
// prompt, no Cache API, no `crypto.subtle` and no `navigator.storage.persist`.
//
// ── The trap this module exists to avoid ──────────────────────────────────────
// `navigator.serviceWorker` is **[SecureContext]-gated at the IDL layer, so on
// an insecure origin the property does not exist at all. It is NOT a rejected
// promise and NOT a catchable `SecurityError`:
//
//     navigator.serviceWorker.register('/sw.js')
//     // TypeError: Cannot read properties of undefined (reading 'register')
//
// So `try { await navigator.serviceWorker.register(...) } catch (SecurityError)`
// CRASHES instead of degrading, and so does the seemingly careful
// `if (!navigator.serviceWorker) { fallback() }` written as
// `navigator.serviceWorker.register` anywhere outside a context check.
// Always branch on `window.isSecureContext` FIRST.
//
// ── What this means for the wallet (do not relitigate) ────────────────────────
// The PWA cannot install itself from the portal page. The portal page is a
// SIGNPOST: it explains, offers a no-install fallback, and deep-links to a
// secure origin. See docs/architecture/pwa-client-wallet-adr-delta.md §3.

/** True only when the page is a secure context. Never throws. */
export function isSecureContext() {
  try {
    return typeof window !== 'undefined' && window.isSecureContext === true;
  } catch {
    return false;
  }
}

/**
 * Can this origin register a service worker at all?
 *
 * Both halves are required: the secure context AND the API. Checking only the
 * API would be a latent crash on any browser that exposes it without the gate;
 * checking only the secure context would claim a capability this build of the
 * browser may not have. Fail-closed on any error.
 */
export function hasServiceWorkerSupport() {
  try {
    return isSecureContext() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? typeof navigator.serviceWorker.register === 'function'
      : false;
  } catch {
    return false;
  }
}

/** Cache API availability (offline app shell). Secure-context-gated. */
export function hasCacheSupport() {
  try {
    return isSecureContext() && typeof caches !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * WebCrypto `subtle`. Secure-context-gated, and the reason a SEED must never
 * be held on the portal origin: without `subtle` there is no HKDF/AES-GCM to
 * protect it, and the transport is plaintext.
 *
 * `crypto.getRandomValues` is NOT gated and IS available on the portal origin —
 * enough for a nonce in the no-install fallback, never enough for custody.
 */
export function hasCryptoSubtle() {
  try {
    return isSecureContext() && typeof crypto !== 'undefined' && !!crypto.subtle;
  } catch {
    return false;
  }
}

/** Storage that survives eviction (`navigator.storage.persist`). Gated. */
export function hasPersistentStorageSupport() {
  try {
    return (
      isSecureContext() &&
      typeof navigator !== 'undefined' &&
      !!navigator.storage &&
      typeof navigator.storage.persist === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * A single descriptor of the page's capabilities, for the install/signpost UI.
 * Every field is a boolean; nothing here can throw.
 */
export function detectCapabilities() {
  return {
    secureContext: isSecureContext(),
    serviceWorker: hasServiceWorkerSupport(),
    cache: hasCacheSupport(),
    cryptoSubtle: hasCryptoSubtle(),
    persistentStorage: hasPersistentStorageSupport(),
  };
}

/**
 * Which install path the user is actually on. This drives the signpost copy,
 * and it must never promise an install affordance the origin cannot raise.
 *
 *  - 'none'     — this origin can never offer an install prompt. Android/Chrome
 *                 over `http://<ip>` lands here. Offer manual
 *                 "Add to Home Screen" guidance only.
 *  - 'manual'   — a secure context with no SW registered yet: iOS-style manual
 *                 add-to-home-screen works, and a prompt may become available.
 *  - 'promptable' — secure context + a controlling SW: `beforeinstallprompt`
 *                 may fire and the app can offer a real install button.
 *
 * NOTE the app deliberately does NOT listen for `beforeinstallprompt` on the
 * portal origin: it cannot fire there, and a listener that can never run is
 * dead code that reads like a feature.
 */
export function installPath() {
  const caps = detectCapabilities();
  if (!caps.secureContext) return 'none';
  return caps.serviceWorker ? 'promptable' : 'manual';
}

/**
 * Is the app running as an installed/standalone window?
 * `display-mode` is a media query, not a secure-context-gated API, so this is
 * safe to call anywhere — but it can only ever be true if the app was launched
 * from a home-screen icon, which on the portal origin is only reachable via
 * the manual path above.
 */
export function isStandalone() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.navigator && window.navigator.standalone === true) return true; // iOS Safari
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    );
  } catch {
    return false;
  }
}
