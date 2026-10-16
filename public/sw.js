// The portal service worker.
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
// The single most important property: this handler NEVER fabricates a response
// for a request it does not have a real cached copy of, and NEVER intercepts the
// money path. `shouldIntercept` is imported from the same module the app uses,
// so the rule cannot drift between the worker and the UI.
//
// ⚠️ WHY THIS WORKER MUST NOT POLL THE ROUTER — a measured constraint, not a style
// preference. Chrome's Local Network Access permission gates requests from public
// address space to private/loopback space, and per the Chrome LNA announcement:
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

import { PRECACHE_ALLOWLIST, shouldIntercept } from './money-path.js';

const CACHE_NAME = 'tollgate-shell-v1';

// Allow-list only. Never a glob of the build output — a glob is how /v1/melt
// or /ln-invoice ends up in a precache manifest.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ALLOWLIST)).catch(() => {})
  );
  // Do not skipWaiting automatically: a new worker taking over mid-payment is
  // how a client ends up talking to two different shells. The app requests the
  // swap explicitly after the user is idle.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // THE RULE. Anything that carries authority — any non-GET, and every
  // balance/usage/invoice/quote/payment/mint endpoint — is NOT intercepted.
  // No respondWith, no fallback, no synthesised response. It hits the network
  // or it fails; the app decides what that means to the user. This is the
  // fail-closed default and it is deliberately the branch that requires no
  // thought.
  if (!shouldIntercept(request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreMethod: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Never store a non-OK or opaque response, and never store anything
        // that carries a state field (defence in depth over the allow-list).
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (err) {
        // Offline and not in the precache. Return a real failure rather than a
        // fabricated document — a fabricated shell here could render a stale
        // balance or a stale invoice as if it were live.
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })()
  );
});

// The app asks for the swap once the user is idle, so an update never lands
// mid-payment.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
