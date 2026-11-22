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
//
// The list is GENERATED at build time by scripts/stamp-sw.mjs from what the
// built splash.html/balance.html actually reference (scripts/precache-manifest.mjs),
// then substituted over the block below. The entries between the markers are a
// placeholder standing in for that list; they are not what ships.
//
// Why generated: as a hand-written list this file omitted the JavaScript and CSS
// bundles, so an offline reload returned the HTML and then asked for
// `/assets/<hash>.js` — which this allow-list did not name, so the worker
// bypassed it into a dead network and the page stayed blank. A list that must be
// updated whenever Vite renames a bundle is a list that WILL rot; deriving it
// from the document removes the class of bug rather than the instance.
/*__PRECACHE__*/
var PRECACHE = [
  './splash.html',
  './balance.html',
  './404.html',
  './manifest.json',
  './favicon.ico',
  './logo192.png',
  './logo512.png',
  './logo-maskable-512.png',
];
/*__PRECACHE_END__*/

/**
 * Is this an IMMUTABLE build asset (content-hashed by Vite)?
 *
 * Vite emits `/assets/<name>-<hash>.js|css` and its hash changes with the
 * content, so a cached copy can never be stale: the same URL always means the
 * same bytes. Those are served cache-first.
 *
 * The entry DOCUMENTS (`/splash.html`, `/balance.html`) are the opposite — their
 * URL is stable across releases, so cache-first would pin a returning visitor to
 * an old shell forever. They are network-first, with the cached copy as the
 * offline fallback.
 */
function isImmutableAsset(pathname) {
  return pathname.indexOf('/assets/') === 0 && /\.(js|css)$/i.test(pathname);
}

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
    // NOT lowercased. The authority list below is lowercase and is compared
    // case-insensitively (see the loop), because those are fixed API route
    // names. The precache allow-list is NOT: Vite emits content hashes with
    // UPPERCASE letters (`portal-BJdlAeKP.js`), so lowercasing the pathname
    // before comparing it to the allow-list made every bundle miss.
    //
    // That miss is what produced the blank offline page: the worker decided
    // `/assets/portal-BJdlAeKP.js` was not on the allow-list, bypassed it, and
    // the bundle request died with the network cut. The assets were IN the
    // cache the whole time — measured: `precached` listed 13 entries including
    // that exact path, while the reload still failed with
    // `net::ERR_INTERNET_DISCONNECTED`.
    pathname = new URL(request.url, self.location.origin).pathname;
  } catch (e) {
    return true; // unparseable => fail closed
  }

  var lower = pathname.toLowerCase();

  for (var i = 0; i < NEVER_CACHE.length; i++) {
    var suffix = NEVER_CACHE[i];
    if (
      lower === suffix ||
      lower.slice(-suffix.length) === suffix ||
      lower.indexOf(suffix + '/') !== -1
    ) {
      return true;
    }
  }

  // ── and the ALLOW-LIST half, which this file was missing ────────────────
  //
  // The authority list above is necessary but NOT sufficient. Everything the
  // portal fetches from the router arrives as a GET on a path this list does
  // not name (`/` for the TollGate details, `/api/multi_wan/objectives`, and
  // any future endpoint), so a suffix-only rule intercepts them and re-issues
  // the request FROM THE WORKER — which is exactly what must not happen:
  //
  //   * the worker's cross-origin request is where CORS is judged against the
  //     *document's* origin, so a perfectly good same-page fetch can fail once
  //     the worker takes it over;
  //   * per the Chrome Local Network Access announcement quoted at the top of
  //     this file, a local-network request from a service worker additionally
  //     requires the worker's origin to have been granted LNA — so the request
  //     fails where the page's own fetch succeeded;
  //   * and the failure is a bare network error, which the app renders as
  //     "Failed to fetch TollGate details" — a portal that cannot fetch its
  //     own price sheet, caused by the thing that was supposed to make it
  //     installable.
  //
  // So the default is BYPASS and caching is the exception: only a GET on the
  // precache allow-list may be answered or re-issued here. This is the same
  // rule as mustNotBeCached() in src/helpers/money-path.js, which was already
  // correct — the two had silently diverged, and the e2e suite caught it.
  if (!isPrecachedPath(pathname)) return true;

  return false;
}

/**
 * Is this pathname one of the shell assets this worker may serve?
 *
 * CASE-SENSITIVE on purpose. Vite's content hashes carry uppercase letters, and
 * a case-insensitive comparison here is what silently disqualified every bundle
 * from the allow-list. The NEVER_CACHE authority list above is the opposite
 * (case-insensitive, fixed route names); the two are deliberately different and
 * that difference is the bug this comment exists to prevent from returning.
 */
function isPrecachedPath(pathname) {
  // The hashed build output, admitted by SHAPE. The literal list below is
  // generated at build time (scripts/precache-manifest.mjs) and DOES name these
  // concrete files; the shape test is here so this classic worker stays correct
  // against the same predicate as src/helpers/money-path.js even if the
  // generated list is ever stale. It cannot admit an API path: the NEVER_CACHE
  // authority check and the non-GET check both run before this.
  //
  // The `-<hash>` suffix is required, so a hand-authored `/assets/app.js` (which
  // the build never emits) is still bypassed rather than cached.
  if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(pathname)) return true;
  if (/^\/assets\/TollGate_Logo-[^/]*\.png$/.test(pathname)) return true;
  if (/^\/locales\/[A-Za-z-]+\.json$/.test(pathname)) return true;

  for (var i = 0; i < PRECACHE.length; i++) {
    // PRECACHE entries are written './name'; compare on the leading-slash form.
    var entry = PRECACHE[i].replace(/^\.\//, '/');
    if (pathname === entry) return true;
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
        // ── strategy split, and it is not cosmetic ──────────────────────
        //
        // IMMUTABLE assets (Vite's content-hashed /assets/*.js|css):
        //   cache-first. The URL and the bytes are 1:1, so a hit can never be
        //   stale, and this is what makes an installed app start instantly.
        //
        // Everything else on the allow-list (the entry DOCUMENTS and icons):
        //   network-first with the cached copy as the offline fallback. Their
        //   URLs are stable across releases, so cache-first would pin a
        //   returning visitor to the previous release's shell — the exact
        //   "stale shell" failure this worker is meant to make impossible.
        //
        // One strategy for the whole allow-list is the bug that produced a
        // blank offline page AND, if it had been cache-first, a permanently
        // stale one. Both halves are pinned in
        // tests/unit/sw-fetch-rule.test.js and tests/e2e/offline-shell.spec.mjs.
        var pathname;
        try {
          // Case-PRESERVED: isImmutableAsset() must see the real Vite hash.
          pathname = new URL(request.url, self.location.origin).pathname;
        } catch (e) {
          return fetch(request);
        }

        var network = fetch(request)
          .then(function (response) {
            // Never store a non-OK or opaque response.
            if (response.ok && response.type === 'basic') {
              cache.put(request, response.clone()).catch(function () {});
            }
            return response;
          });

        if (isImmutableAsset(pathname)) {
          return cache.match(request, { ignoreMethod: true }).then(function (cached) {
            if (cached) return cached;
            return network.catch(function () {
              return offlineResponse(cache, request);
            });
          });
        }

        // Document / icon: prefer the network so a release actually lands,
        // fall back to the cached copy when the network is gone.
        return network.catch(function () {
          return cache.match(request, { ignoreMethod: true }).then(function (cached) {
            if (cached) return cached;
            return offlineResponse(cache, request);
          });
        });
      });
    })()
  );
});

/**
 * What to serve when neither the network nor an exact cache entry answered.
 *
 * A navigation gets the entry shell, which is the only page that can explain the
 * situation. It carries NO state; the app re-fetches everything it shows. Any
 * other request gets a real failure rather than a fabricated document — a
 * fabricated response here could render a stale balance or a stale invoice as if
 * it were live.
 */
function offlineResponse(cache, request) {
  if (request.mode === 'navigate') {
    return cache.match('./splash.html').then(function (shell) {
      return shell || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    });
  }
  return Promise.resolve(new Response('', { status: 504, statusText: 'Gateway Timeout' }));
}

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
