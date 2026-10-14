// The money-path rule set: which responses a service worker (or ANY cache
// layer) may hold, and what it must never synthesise. This module is the
// single source of truth for that decision so a future SW can be written
// against a tested predicate instead of a comment.
//
// Why this file exists at all, and why it is not paranoia
// ───────────────────────────────────────────────────────
// The catastrophic bug in a paying client is NOT "the invoice is stale" and NOT
// "the purchase replays". It is a fetch handler that MANUFACTURES a paid state:
//
//     if (POST failed) return cachedOkResponse;      // NEVER
//
// Everything below is shaped to make that impossible to write by accident.
//
// What the platform already guarantees (so we do not re-implement it)
// ──────────────────────────────────────────────────────────────────
// The Cache API mechanically refuses non-GET. Cache `add`/`addAll`/`put` throw
// a TypeError unless the request method is GET, and `match`/`keys` skip non-GET
// unless `ignoreMethod` is set. So a `POST` can never be *cached* — but that
// says nothing about whether a handler can *invent* a response, which is the
// real risk and is entirely ours to get right.
//
// The consequence for offline "pay later": it cannot be an SW trick. It must be
// an explicit, durable, app-level outbox with idempotency keys, because a cache
// can neither hold nor replay the POST.
//
// Spike §4 is the authority; this file is its executable form.

// ── The allow-list of what may be precached ───────────────────────────────────
//
// An ALLOW-list, never a glob of the build output. A glob is how `/pay` or
// `/api/invoice` ends up inside a precache manifest and gets served to a
// differently-scoped page.
export const PRECACHE_ALLOWLIST = Object.freeze([
  '/splash.html',
  '/balance.html',
  '/404.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.png',
  '/logo512.png',
]);

// ── Paths that must NEVER be cached, replayed, or synthesised ────────────────
//
// Each is a per-request authority snapshot: a stale one is worse than none, and
// serving one is how a customer is told they have access they do not have.
//
// Deliberately matched on the trailing segment rather than a full path, because
// the portal is cross-origin to the API (a vendor-origin PWA calling
// `http://<gw>:2121`) and it is the *endpoint*, not the host, that carries
// authority. Match case-insensitively.
const NEVER_CACHE_SUFFIXES = Object.freeze([
  '/balance', // live session remaining/allotment
  '/usage', // consumed metering
  '/whoami', // device identity
  '/ln-invoice', // quote + BOLT11 invoice + amount
  '/pay', // the purchase itself
  '/v1/keysets', // NUT-06 keyset state (rotates)
  '/v1/keys', // NUT-06 mint keys
  '/v1/checkstate', // NUT-07 proof states
  '/v1/melt/quote', // melt quote
  '/v1/mint/quote', // mint quote
  '/v1/melt', // the melt (a payment)
  '/v1/mint', // the mint (a payment)
  '/v1/swap', // proof swap
]);

/**
 * Must this request bypass every cache layer and hit the network?
 *
 * Returns true for: every non-GET/HEAD (a purchase POST, an OPTIONS preflight),
 * every endpoint that carries authority, and every request not on the precache
 * allow-list. In other words the default is BYPASS and caching is the exception.
 */
export function mustNotBeCached(request) {
  if (!request) return true;
  const method = String(request.method || 'GET').toUpperCase();
  // A POST is never cacheable and must never be answered from a cache.
  if (method !== 'GET' && method !== 'HEAD') return true;

  let pathname;
  try {
    pathname = new URL(request.url, 'http://placeholder.invalid').pathname.toLowerCase();
  } catch {
    return true; // unparseable => fail closed
  }

  if (
    NEVER_CACHE_SUFFIXES.some(
      (suffix) => pathname === suffix || pathname.endsWith(suffix) || pathname.includes(`${suffix}/`)
    )
  ) {
    return true;
  }

  // Anything outside the precache allow-list is a bypass by default. NOTE this
  // includes the hashed `/assets/*` bundle: precaching those belongs in the
  // generated allow-list, not in a blanket wildcard here.
  return !PRECACHE_ALLOWLIST.includes(pathname);
}

/**
 * Should a fetch handler call `respondWith` at all?
 *
 * The ONLY correct money-path behaviour is to NOT intercept: let the request go
 * straight to the network. This predicate is the decision point for that, and
 * it is deliberately the negation of the cache predicate so the two can never
 * disagree.
 */
export function shouldIntercept(request) {
  return !mustNotBeCached(request);
}

/**
 * A cacheable response must never be a paid/session state. Assert it before
 * storing anything — a defence in depth against a caller that put an authority
 * response into the allow-list by mistake.
 */
export function isSafeToStore(url, body) {
  try {
    if (mustNotBeCached({ method: 'GET', url })) return false;
    if (body == null) return true;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    // Authority fields that must not be frozen into a cached response.
    return !/"(session_active|remaining|allotment|usage|quote|invoice|state|balance)"\s*:/.test(text);
  } catch {
    return false; // fail closed
  }
}

// ── The idempotency contract for the purchase POST ───────────────────────────
//
// A retry must never double-charge. The cache cannot help (POST is uncacheable),
// so the guarantee has to be carried in the request itself.
//
// The nonce is single-use and bound to the device: the router rejects a nonce it
// has already seen, so replaying a captured POST is a no-op rather than a second
// purchase. This is also what makes the offline outbox safe to drain on
// reconnect.
export const PAYMENT_IDEMPOTENCY_HEADER = 'X-TollGate-Idempotency-Key';

/** A single-use, device-bound idempotency key. Requires getRandomValues. */
export function newIdempotencyKey({ mac = '', nonceBytes = 16 } = {}) {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    // getRandomValues has no [SecureContext] gate, so it IS available on the
    // portal origin. If it is genuinely absent, fail loudly: a sequential or
    // timestamp-derived key would silently permit a double-charge.
    throw new Error('newIdempotencyKey requires crypto.getRandomValues');
  }
  const bytes = new Uint8Array(nonceBytes);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return mac ? `${mac}:${nonce}` : nonce;
}

/**
 * Headers for the purchase POST, carrying the idempotency key. Kept here so
 * every call site produces the same shape and a reviewer can see them in one
 * place.
 */
export function paymentRequestHeaders({ idempotencyKey, contentType = 'application/json' } = {}) {
  if (!idempotencyKey) throw new Error('paymentRequestHeaders requires an idempotency key');
  return {
    'Content-Type': contentType,
    [PAYMENT_IDEMPOTENCY_HEADER]: idempotencyKey,
  };
}

// ── Nothing here is a substitute for signing ────────────────────────────────
//
// Idempotency stops a DOUBLE charge. It does nothing about an on-LAN attacker
// rewriting the invoice or the amount in flight, because the portal's API leg is
// plaintext http. That requires the payment intent to be SIGNED with the wallet
// key and the grant signed router-side — see the ADR delta §3 and the money-path
// section of the operator brief. Do not treat this module as the security
// boundary for the amount; it is the boundary for the RETRY.
