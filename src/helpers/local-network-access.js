// Local Network Access (LNA) — the gate a vendor-origin PWA hits when it calls
// the router, and the reason the three helpers below exist.
//
// ── The situation ────────────────────────────────────────────────────────────
// The shipping architecture is: the PWA lives on a **public** HTTPS origin
// (`https://portal.orangesync.tech`) and calls the router's API on a **private**
// address (`http://<router-lan-ip>:2121`). Chrome 142+ gates exactly that
// topology behind a user-grantable **Local Network Access** permission, because
// the request initiator is in public address space and the destination is in
// private (RFC1918) or loopback space.
//
// ── THE TRAP: it is reported as a CORS failure ───────────────────────────────
// Measured on Chrome 156, public origin -> private router:
//
//   Access to fetch at 'http://192.168.2.20:8018/api.json' from origin
//   'https://[2a01:...]' has been blocked by CORS policy: Permission was denied
//   for this request to access the `local` address space.
//   -> TypeError: Failed to fetch
//
// An implementer who reads that will add Access-Control-Allow-Origin headers
// forever and never fix it, because the real cause is a **missing permission**.
// CORS and LNA are orthogonal and BOTH are required:
//   - permission granted, no ACAO  -> still fails ("No 'Access-Control-Allow-Origin'")
//   - ACAO present, no permission  -> still fails (the message above)
// Both were measured independently. Never diagnose one from the other.
//
// ── The naming traps ────────────────────────────────────────────────────────
// The web-visible `PermissionName` is **kebab-case**: `local-network-access`.
// The closely-related descriptors `local-network` and `loopback-network` also
// exist. The camelCase spelling is REJECTED:
//   navigator.permissions.query({ name: 'localNetworkAccess' })
//   -> TypeError: 'localNetworkAccess' is not a valid enum value of type PermissionName
// Separately, the Chrome DevTools Protocol's `Browser.PermissionType` uses its
// OWN names (`localNetwork`, `localNetworkAccess`, `loopbackNetwork`) that are
// NOT the web names — a second trap when writing test tooling.
//
// ── The constraint that shapes the whole background design ──────────────────
// Per the Chrome LNA announcement: "Local network requests from Service Workers
// and Shared Workers require that the worker's origin has previously been
// granted the Local Network Access permission." So a fresh install's background
// service worker CANNOT raise the prompt and its router calls silently fail.
// **The foreground must make one LNA-requiring call before any SW-driven polling
// is relied upon.** For a *fresh* install this is unavoidable; after the first
// grant the permission is sticky per origin (measured: it survived a browser
// restart and did not re-prompt).

/** The web-visible permission name. Kebab-case — see the naming traps above. */
export const LNA_PERMISSION_NAME = 'local-network-access';

/** The two sibling descriptors, queried together when diagnosing. */
export const LNA_RELATED_PERMISSION_NAMES = Object.freeze([
  'local-network-access',
  'local-network',
  'loopback-network',
]);

/**
 * Does this build of the browser gate local-network requests behind a
 * permission at all? False on older Chrome, and on Safari/Firefox — where the
 * address-space gate does not exist (they may block by mixed content instead,
 * which is a DIFFERENT gate with a different fix).
 */
export function hasLocalNetworkAccessGate() {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.permissions &&
      typeof navigator.permissions.query === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Current LNA permission state: 'granted' | 'prompt' | 'denied' | 'unknown'.
 *
 * 'unknown' means the descriptor is unsupported (older Chrome) or the query
 * threw — in which case the caller must NOT assume denial. A browser without the
 * gate needs no grant; treating 'unknown' as 'denied' would disable working
 * router calls on every browser that predates LNA.
 */
export async function queryLocalNetworkAccessState() {
  if (!hasLocalNetworkAccessGate()) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: LNA_PERMISSION_NAME });
    return status.state;
  } catch {
    // An invalid enum value throws (see the naming traps) — but so does an
    // unsupported descriptor. Both mean "no gate we can query".
    return 'unknown';
  }
}

/** Query every related descriptor. Diagnostic only; used by the gate tests. */
export async function queryAllLocalNetworkStates() {
  const out = {};
  if (!hasLocalNetworkAccessGate()) return out;
  for (const name of LNA_RELATED_PERMISSION_NAMES) {
    try {
      const status = await navigator.permissions.query({ name });
      out[name] = status.state;
    } catch (err) {
      out[name] = `error: ${String(err && err.message)}`;
    }
  }
  return out;
}

/**
 * Is a router call expected to succeed right now?
 *
 * `true` when there is no queried gate (older browser / no Permissions API) or
 * the permission is 'granted'. `false` when it is 'denied'.
 *
 * For 'prompt' this returns `true` — deliberately. The prompt is raised by the
 * FETCH ITSELF, not by the Permissions API, so a 'prompt' state is not a failure:
 * the call is what triggers the user-visible grant dialog. Reporting 'prompt' as
 * "cannot call the router" would make the UI hide the very affordance that asks
 * for permission.
 */
export async function canReachRouter() {
  const state = await queryLocalNetworkAccessState();
  return state !== 'denied';
}

/**
 * Does this error look like an LNA denial rather than a genuine CORS failure?
 *
 * Honest limitation, stated rather than papered over: **the browser does not give
 * us a distinguishable error.** Both produce `TypeError: Failed to fetch`, and
 * the address-space reason is only visible in the CONSOLE, which script cannot
 * read. So this function cannot be certain — it is a heuristic that requires the
 * caller to supply whatever console evidence it has.
 *
 * What it CAN do reliably is refuse to guess in the common case: if the target
 * is a private/loopback literal, the initiator is public, and the permission
 * state is not 'granted', then the overwhelmingly likely cause is LNA — and the
 * right user-facing message is "allow this site to reach your local network",
 * NOT "CORS is broken".
 */
export function looksLikeLocalNetworkDenial({ targetUrl, permissionState, error } = {}) {
  if (!isPrivateOrLoopbackTarget(targetUrl)) return false;
  if (permissionState === 'granted') return false;
  const message = String((error && error.message) || error || '');
  // TypeError: Failed to fetch is what BOTH gates produce; the network error is
  // the only thing script can observe.
  return message === '' || /Failed to fetch|NetworkError|ERR_FAILED/.test(message);
}

/** RFC1918 private IPv4, loopback (v4 and v6), and link-local literals. */
export function isPrivateOrLoopbackTarget(url) {
  let host;
  try {
    host = new URL(url, 'http://placeholder.invalid').hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  try {
    // Node/global URL lowercases and brackets IPv6; use a simple literal check.
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      if (a === 127) return true; // loopback
      if (a === 10) return true; // 10/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
      if (a === 192 && b === 168) return true; // 192.168/16
      if (a === 169 && b === 254) return true; // link-local
      return false;
    }
    if (host === '::1') return true; // IPv6 loopback
    if (/^fe80:/i.test(host)) return true; // IPv6 link-local
    if (/^f[cd]/i.test(host)) return true; // IPv6 unique-local fc00::/7
    // A private-looking name is NOT reliably local: `.local` is mDNS and IS
    // treated as local by the mixed-content exemption, but a public hostname
    // that merely RESOLVES to a private address is explicitly NOT exempt.
    return /\.local$/i.test(host);
  } catch {
    return false;
  }
}

/**
 * One foreground call that MUST be made before any service-worker-driven router
 * polling is relied upon — see the SW constraint in the header. Returns the
 * permission state afterwards so the UI can decide what to say.
 *
 * Deliberately a plain GET of the capability endpoint: a *simple* request, so it
 * raises the prompt without needing a preflight, and the router's existing
 * `/ln-invoice` capability probe already has exactly this shape.
 */
export async function ensureRouterReachable({ probeUrl, fetchImpl = fetch } = {}) {
  const before = await queryLocalNetworkAccessState();
  if (!probeUrl) return { state: before, probed: false };
  try {
    await fetchImpl(probeUrl, { method: 'GET', mode: 'cors', cache: 'no-store' });
  } catch {
    // Swallow: the point of this call is to trigger the permission prompt, and
    // a denial is reported to the user by the caller using `state` below.
  }
  const after = await queryLocalNetworkAccessState();
  return { state: after, before, probed: true };
}
