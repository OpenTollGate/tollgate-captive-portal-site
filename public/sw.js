// The portal service worker — the APP SHELL only.
//
// READ THIS FIRST: on the origin this portal is actually served from
// (`http://<router-lan-ip>:2051`) this file CANNOT RUN. Service worker clients
// must be secure contexts, so `navigator.serviceWorker` does not even exist
// there (see src/helpers/pwa-install.js). This worker is therefore for a
// SECURE origin — the vendor-hosted PWA the signpost deep-links to, or a
// fleet device that legitimately has the Chromium secure-origin allowlist.
//
// It is committed here, and tested, for two reasons:
//   1. the money-path rules below are the contract ANY future fetch handler must
//      obey, and they are cheap to get wrong in a way no test would otherwise
//      catch;
//   2. it is the one place a stale/synthesised response could cause a
//      double-charge or a false "you have internet" — so the rules are
//      executable rather than a paragraph in a design doc.
//
// ── WHY THIS FILE DOES NOT `import` ─────────────────────────────────────────
//
// It previously pulled `PRECACHE_ALLOWLIST`/`shouldIntercept` from
// `./money-path.js` with a top-level ESM import. That quietly made it a MODULE
// worker, and a module worker only registers if the caller passes
// `{ type: 'module' }` — support for which is not universal, and a registration
// that silently fails is the worst possible failure for the thing that makes
// the app installable. The rules are therefore restated here in a form a
// CLASSIC worker can run, and the tested source of truth stays in
// `src/helpers/money-path.js` with `tests/unit/money-path.test.js` pinning it;
// the e2e gate proves this file and that module agree in a real browser.
//
// ── VERSIONING (the reason this file changed) ───────────────────────────────
//
// A service worker is the only artifact in a web app that can outlive its own
// deployment. The browser keeps the OLD worker until a NEW one installs AND
// activates, so a fixed cache name is served forward forever:
//
//   release N   -> cache 'tollgate-shell-v1'
//   release N+1 -> the worker body may differ, but the cache name does not, so
//                  the new worker finds release N's responses already in "its"
//                  cache and serves them
//
// `__SW_VERSION__` is substituted by `scripts/stamp-sw.mjs` at build time with
// the build's version. A new build is a new cache, and activation retires every
// older cache of ours. Both halves are pinned: `tests/unit/sw-lifecycle.test.js`
// checks this source, and `tests/e2e/offline-shell.spec.mjs` asserts the SHIPPED
// file has no surviving placeholder.
//
// ── WHY THIS WORKER MUST NOT POLL THE ROUTER ────────────────────────────────
//
// A measured constraint, not a style preference. Chrome's Local Network Access
// permission gates requests from public address space to private/loopback
// space, and per the Chrome LNA announcement:
//
//   "Local network requests from Service Workers and Shared Workers require that
//    the worker's origin has previously been granted the Local Network Access
//    permission. If your application makes local network requests from a service
//    worker, you will need to separately trigger a local network request from
//    your application in order to trigger the permission prompt."
//
// So a background SW poll loop against `http://<gw>:2121` SILENTLY FAILS on a
// fresh install — and it fails reported as a CORS error ("Permission was denied
// for this request to access the `local` address space"), which sends an
// implementer chasing Access-Control-Allow-Origin headers forever. The
// FOREGROUND must make one LNA-requiring call before any SW-driven polling is
// relied upon. See src/helpers/local-network-access.js.

// Replaced at build time by scripts/stamp-sw.mjs. The placeholder MUST NOT
// survive into the shipped file — the e2e gate fails if it does.
var SW_VERSION = '__SW_VERSION__';

var CACHE_PREFIX = 'tollgate-shell-';
var CACHE_NAME = CACHE_PREFIX + SW_VERSION;

// ── the precache allow-list ─────────────────────────────────────────────────
//
// An ALLOW-list, never a glob of the build output. A glob is how `/v1/melt` or
// `/ln-invoice` ends up in a precache manifest and then gets served to a
// differently-scoped page. Mirrors PRECACHE_ALLOWLIST in
// src/helpers/money-path.js, which is the tested form of the same rule.
var PRECACHE = [
  './splash.html',
  './balance.html',
  './manifest.json',
  './favicon.ico',
  './logo192.png',
  './logo512.png',
  './logo-maskable-512.png',
];

// Authority endpoints: a stale copy is worse than none, and serving one is how
// a customer is told they have access they do not have. Matched on the trailing
// segment because the worker may be cross-origin to the API host.
var NEVER_CACHE = [
  '/balance',
  '/usage',
  '/whoami',
  '/ln-invoice',
  '/pay',
  '/v1/keysets',
  '/v1/keys',
  '/v1/checkstate',
  '/v1/melt/quote',
  '/v1/mint/quote',
  '/v1/melt',
  '/v1/mint',
  '/v1/swap',
];

/**
 * Must this request bypass every cache layer? The default is BYPASS: caching is
 * the exception, and only a GET on an allow-listed path may be answered from
 * this worker. Mirrors mustNotBeCached() in src/helpers/money-path.js.
 */
function mustNotBeCached(request) {
  if (!request) return true;
  var method = String(request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return true;

  var pathname;
  try {
    pathname = new URL(request.url, self.location.origin).pathname.toLowerCase();
  } catch (e) {
    return true; // unparseable => fail closed
  }

  for (var i = 0; i < NEVER_CACHE.length; i++) {
    var suffix = NEVER_CACHE[i];
    if (
      pathname === suffix ||
      pathname.slice(-suffix.length) === suffix ||
      pathname.indexOf(suffix + '/') !== -1
    ) {
      return true;
    }
  }
  return false;
}

/** Retire every cache under our prefix that is not the current one. */
function reclaimOldCaches() {
  return caches.keys().then(function (names) {
    var stale = names.filter(function (name) {
      // Only names under OUR prefix. A worker on a shared origin must not
      // collect another app's caches.
      return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME;
    });
    return Promise.all(
      stale.map(function (name) {
        return caches.delete(name);
      })
    );
  });
}

// ── install: populate the versioned cache, then WAIT ────────────────────────
//
// NO skipWaiting() here. A new worker taking over mid-payment is how a client
// ends up talking to two different shells; the app asks for the swap through
// `requestShellUpdate()` once the user is idle. `tests/unit/sw-lifecycle.test.js`
// pins that this block contains no skipWaiting.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        // NOT addAll: addAll rejects the WHOLE batch on one 404, which would
        // leave the worker permanently un-installed on a webroot missing a
        // single icon. Add each entry independently; let a miss be a miss.
        return Promise.all(
          PRECACHE.map(function (url) {
            return cache.add(url).catch(function () {
              /* a missing optional asset must not fail the install */
            });
          })
        );
      })
      .catch(function () {
        /* an install that cannot populate still installs; the fetch handler
           falls through to the network, which is the correct degradation */
      })
  );
});

// ── activate: retire every OLDER cache of ours ──────────────────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    reclaimOldCaches().then(function () {
      return self.clients.claim();
    })
  );
});

// ── fetch: the money-path rule ──────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // THE RULE. Anything that carries authority — any non-GET, and every
  // balance/usage/invoice/quote/payment/mint endpoint — is NOT intercepted.
  // No respondWith, no fallback, no synthesised response. It hits the network
  // or it fails; the app decides what that means to the user. This is the
  // fail-closed default and it is deliberately the branch that requires no
  // thought.
  if (mustNotBeCached(request)) return;

  event.respondWith(
    (function () {
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(request, { ignoreMethod: true }).then(function (cached) {
          if (cached) return cached;

          return fetch(request)
            .then(function (response) {
              // Never store a non-OK or opaque response.
              if (response.ok && response.type === 'basic') {
                cache.put(request, response.clone()).catch(function () {});
              }
              return response;
            })
            .catch(function () {
              // Offline and not in the precache. Return a real failure rather
              // than a fabricated document — a fabricated shell here could
              // render a stale balance or a stale invoice as if it were live.
              if (request.mode === 'navigate') {
                // A navigation with no cached document gets the entry shell,
                // which is the only page that can explain the situation. It
                // carries NO state; the app re-fetches everything it shows.
                return cache.match('./splash.html').then(function (shell) {
                  return shell || new Response('', { status: 504, statusText: 'Gateway Timeout' });
                });
              }
              return new Response('', { status: 504, statusText: 'Gateway Timeout' });
            });
        });
      });
    })()
  );
});

// ── messages ────────────────────────────────────────────────────────────────
self.addEventListener('message', function (event) {
  var data = event.data;

  // The app asks for the swap once the user is idle, so an update never lands
  // mid-payment. This is the ONLY path that calls skipWaiting.
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // The version handshake: the page compares this against the version it was
  // built with, so a stale shell cannot be served silently across releases.
  if (data === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: SW_VERSION, cache: CACHE_NAME });
    return;
  }

  // Recycle: re-run the activation sweep. Used by the e2e gate to prove that a
  // previous release's cache is retired rather than accumulated.
  if (data === 'RECLAIM') {
    event.waitUntil(reclaimOldCaches());
  }
});
