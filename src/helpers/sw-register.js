// Registering the service worker, from a context that may not be able to.
//
// ── The trap, restated because it is the whole reason this file is separate ──
//
// `navigator.serviceWorker` is [SecureContext]-gated at the IDL layer. On the
// portal's real origin (`http://<router-lan-ip>:2051`) the property does not
// exist AT ALL — it is not a rejected promise and not a catchable SecurityError:
//
//     navigator.serviceWorker.register('/sw.js')
//     // TypeError: Cannot read properties of undefined (reading 'register')
//
// So every entry point here branches on `window.isSecureContext` FIRST. A
// `try { ... } catch (SecurityError)` around the call would crash instead of
// degrading, which is precisely the defect `tests/unit/pwa-install.test.js`
// and `tests/e2e/installability.spec.mjs` pin for the detection helpers; this
// module is where the same rule governs the actual registration.
//
// ── What this module deliberately does NOT do ────────────────────────────────
//
// It does not `skipWaiting` for the user. The new worker installs and waits; the
// app calls `requestShellUpdate` when the user is idle. See sw-lifecycle.js.
import {
  SKIP_WAITING_MESSAGE,
} from './sw-lifecycle.js';
import { isSecureContext, hasServiceWorkerSupport } from './pwa-install.js';

/**
 * The URL the worker is served from.
 *
 * Relative to the app base so a `VITE_BASE_PATH` deployment (a sub-path install)
 * registers its own worker rather than the origin root's. Note this is
 * deliberately NOT protocol-relative and NOT absolute: an absolute URL here
 * would be a cross-origin registration attempt, which the browser rejects.
 */
export const SERVICE_WORKER_URL = 'sw.js';

/** Scope: the app root, so ONE worker answers for /splash.html and /balance.html. */
export const SERVICE_WORKER_SCOPE = './';

// `'unsupported'` is a first-class state, not an error: it is the CORRECT and
// permanent answer on the captive-portal origin, and the UI must render the
// signpost for it rather than an error.
let lastState = 'idle';

/** The last observed registration state. Never throws. */
export function registrationState() {
  try {
    if (!isSecureContext() || !hasServiceWorkerSupport()) return 'unsupported';
    return lastState;
  } catch {
    return 'unsupported';
  }
}

/**
 * Register the app-shell worker, if this origin can.
 *
 * Resolves to `{ state, registration?, error? }` and NEVER rejects:
 *   'unsupported' — no secure context, or no service worker API
 *   'registered'  — the browser accepted the registration
 *   'error'       — the browser rejected it, or threw synchronously
 */
export async function registerServiceWorker({ url = SERVICE_WORKER_URL, scope = SERVICE_WORKER_SCOPE } = {}) {
  // Context check FIRST. Not a try/catch: on the portal origin the property is
  // absent, so touching it is a TypeError, not a SecurityError.
  if (!isSecureContext() || !hasServiceWorkerSupport()) {
    lastState = 'unsupported';
    return { state: 'unsupported' };
  }

  try {
    const registration = await navigator.serviceWorker.register(url, { scope });
    lastState = 'registered';
    return { state: 'registered', registration };
  } catch (error) {
    // register() rejects for a bad script, a bad scope, or a network failure —
    // and it can also THROW SYNCHRONOUSLY for a malformed scope. Both land
    // here because the call is inside the try.
    lastState = 'error';
    return { state: 'error', error };
  }
}

/**
 * Ask a WAITING worker to take over, then reload when it does.
 *
 * Returns true when the swap was requested, false when there was nothing to
 * swap to. It never reloads for no reason: a reload that changes nothing is
 * how a page loses an in-progress payment for free.
 */
export async function requestShellUpdate(registration) {
  try {
    const waiting = registration && registration.waiting;
    if (!waiting || typeof waiting.postMessage !== 'function') return false;

    waiting.postMessage(SKIP_WAITING_MESSAGE);

    // Reload once the new worker is the controller. `controllerchange` fires on
    // the page when the activation completes; reloading on the event (rather
    // than on a timer) is what makes the new shell actually appear.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const container = navigator.serviceWorker;
      if (typeof container.addEventListener === 'function') {
        container.addEventListener(
          'controllerchange',
          () => {
            try {
              if (typeof window !== 'undefined' && window.location) window.location.reload();
            } catch {
              /* a reload we cannot perform is not worth throwing over */
            }
          },
          { once: true }
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper for the app: is there an update waiting right now?
 * Fail-closed to false, because "no update" is the harmless answer.
 */
export async function hasPendingUpdate() {
  try {
    if (!isSecureContext() || !hasServiceWorkerSupport()) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return !!(registration && registration.waiting);
  } catch {
    return false;
  }
}

/** Test seam: reset the remembered state. */
export function __resetRegistrationState() {
  lastState = 'idle';
}
