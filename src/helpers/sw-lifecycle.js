// The service worker's LIFECYCLE logic, as a testable module.
//
// `public/sw.js` is a classic worker script — it has no module exports on
// purpose, because registering a module worker requires the SW registration to
// pass `{ type: 'module' }`, which is not available everywhere a captive-portal
// client might be. So the rules live here, the worker imports nothing and
// repeats them in a form the browser can run, and `tests/unit` pins this module
// while `tests/e2e/offline-shell.spec.mjs` proves the two agree in a real
// browser against the BUILT worker.
//
// ── Why VERSIONING is the load-bearing part ──────────────────────────────────
//
// A service worker is the only artifact in a web app that can outlive its own
// deployment. The browser keeps the OLD worker — and therefore the OLD cache —
// until a NEW one installs AND activates. If the cache name is a literal
// (`'tollgate-shell-v1'`), then:
//
//   release N   → cache 'tollgate-shell-v1'
//   release N+1 → same worker body, same cache name, so the browser sees no
//                 update at all; the customer keeps serving release N forever
//
// Even when the worker body DOES change, a fixed cache name means the new
// worker finds the old release's responses already in "its" cache and serves
// them. So the cache name is derived from a build-stamped version; a new build
// is a new cache, and activation retires every older cache of ours.
//
// ── Why the swap is NOT automatic ────────────────────────────────────────────
//
// `self.skipWaiting()` in `install` is the common copy-paste, and it activates
// the new worker while the old one may still be servicing requests — including
// a payment in flight. A customer between "quote" and "paid" would get the
// shell swapped underneath them. The worker installs, WAITS, and takes over
// only when the app asks (`requestShellUpdate`).

/** Every cache this app owns starts with this. Anything else is not ours. */
export const SW_CACHE_PREFIX = 'tollgate-shell-';

/**
 * The sentinel cache name used when a build carried no version.
 *
 * It is deliberately NOT `${PREFIX}undefined` — a missing version must be a
 * distinct, stable identity of its own, and it must not be able to collide with
 * a real version string that happens to be the word "undefined".
 */
export const UNVERSIONED_CACHE = `${SW_CACHE_PREFIX}unversioned`;

/** The message the app posts to ask a waiting worker to take over. */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

/**
 * The reasons that may skip waiting. This is an allow-list, not a deny-list:
 * an unrecognised reason must NOT swap the shell, because "some other code
 * called it" is not a reason to interrupt a payment.
 */
export const SKIP_WAITING_REASONS = Object.freeze(['user-idle']);

/**
 * Normalise a build version into a legal cache-name fragment.
 *
 * The version is injected at build time. If it is ever derived from a git tag,
 * a branch name, or a CI run id it can contain `/`, whitespace, or a `+` from a
 * semver build-metadata suffix. A cache name is an opaque string key, so a
 * stray separator is exactly how two different builds end up looking like the
 * same cache — which is the bug this whole module exists to prevent.
 */
export function sanitizeVersion(version) {
  if (version === null || version === undefined) return '';
  const trimmed = String(version).trim();
  if (!trimmed) return '';
  // Anything that is not [A-Za-z0-9._-] becomes '-'. Collapse runs, trim edges.
  return trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The cache name for a given build version.
 *
 * Two *different* versions must not yield the same name (or the previous
 * release's responses get served), and a *missing* version must not yield a
 * name containing "undefined".
 */
export function cacheNameForVersion(version) {
  const safe = sanitizeVersion(version);
  return safe ? `${SW_CACHE_PREFIX}${safe}` : UNVERSIONED_CACHE;
}

/** Is this cache one of ours? Never true for `undefined`/`null`/foreign caches. */
export function isOurCache(name) {
  if (typeof name !== 'string' || !name) return false;
  return name.startsWith(SW_CACHE_PREFIX);
}

/**
 * What activation should do with the caches that already exist.
 *
 * Returns the cache to keep and the exact list to delete. A cache we do not own
 * is never in `delete` — a worker sharing an origin with another app must not
 * collect that app's caches.
 */
export function planActivation({ current, existing } = {}) {
  const keep = current || UNVERSIONED_CACHE;
  const names = Array.isArray(existing) ? existing : [];
  const toDelete = names.filter((name) => isOurCache(name) && name !== keep);
  return { keep, delete: toDelete };
}

/**
 * May a worker skip waiting, given why it is being asked?
 *
 * The allow-list is `SKIP_WAITING_REASONS`; everything else — including a
 * missing or malformed reason — is false. Fail closed: keeping the old shell a
 * little longer is always recoverable, swapping mid-payment is not.
 */
export function shouldSkipWaiting(input) {
  const reason = input && input.reason;
  if (!reason || typeof reason !== 'string') return false;
  return SKIP_WAITING_REASONS.includes(reason);
}

/**
 * Does the version a page was built with match the version a worker reports?
 *
 * A missing version on either side is NOT a match. Two unstamped builds are not
 * evidence of being the same build; treating "both undefined" as equal would
 * suppress exactly the update prompt that an unstamped build needs.
 */
export function isSameAppVersion(pageVersion, workerVersion) {
  const a = sanitizeVersion(pageVersion);
  const b = sanitizeVersion(workerVersion);
  if (!a || !b) return false;
  return a === b;
}
