# WSEC delta — the secure-context mechanism, implemented and measured

**Parent:** `docs/architecture/pwa-client-wallet-adr-delta.md` (D3, §3.3-§3.5, §6.1, §6.3).
**Card:** `t_d3ba0b44` (WSEC — spike: secure-context workaround for SW/PWA install).
**Spike of record:** `~/reports/pwa-cashu/SPIKE-secure-context.md` (434 lines, 28 sources,
measured on Chrome for Testing 156.0.8078.4).
**Status:** implemented + measured. Supersedes **one** recommendation in the parent delta.

---

## 1. What this delta changes in the parent, and why

The parent delta's **§3.4 recommends option (b) — "accept an iOS-only /
manual-add-to-home-screen PWA"** — and scopes WS-1 as *"app-like presentation + manual
add-to-home-screen guidance, not installable PWA with offline shell."*

**The operator has since decided otherwise, and the operator's decision is the binding
one.** The chosen mechanism is a **public HTTPS vendor origin** with the portal page as a
*signpost* that deep-links to it. The difference matters, because (b) as written still
contemplates installing *from the captive-portal page*, which is the premise the spike
proves unsound.

| | Parent §3.4 option (b) | Operator decision (implemented here) |
|---|---|---|
| Install surface | the captive-portal page, manually | a **secure origin elsewhere** (vendor HTTPS) |
| Portal page's role | the app, presented app-like | a **signpost** + a no-install fallback |
| Deep-link contract | none | `?gw=&port=&mac=&nonce=` |
| API access | same-origin (the portal) | **cross-origin — the router must emit CORS** |
| Money path | not specified | **signed + single-use nonce + idempotent POST** |
| Service worker | explicitly not built | built, but on the **secure origin only** |

Everything the two agree on is unchanged and is *not* relitigated here: on
`http://<router-lan-ip>:2051` there is no SW, no install prompt, no Cache API and no
`crypto.subtle`; §3.3's table stands as written.

---

## 2. §3.5 is no longer UNMEASURED — it is CONFIRMED, and it was worse than feared

The parent delta §3.5 recorded the CSP concern as a **lead**, with the note *"`[D:portal
§2.5]` did not verify it in a real browser; neither did this delta."* It is now measured by
a real Playwright run (`tests/e2e/installability.spec.mjs`, GREEN at `:222`).

**Confirmed:** `index.html` shipped `connect-src 'self' http: ws:` with **no `https:`**.
CSP scheme-sources are scheme-exact, so every Cashu mint call — all of which are `https:`
in the shipped fixtures (`https://mint.minibits.cash`) — was **blocked**. The parent
delta's predicted consequence therefore also held: `getMintSwapFee` falls back to
`{status: 0}` (`src/helpers/mint-fee.js:56-58`) and the `CU110` "token entirely eaten by
the fee" guard **never fires** — the exact outcome the file's own comment forbids.

**Worse than §3.5 recorded:** the delta noted `balance.html` ships *no CSP at all* almost
in passing. That is not a footnote. `balance.html` is the **second entry point to the same
app**, it **accepts a pasted Cashu token** (a bearer instrument), and it carried **no
policy whatsoever** while `index.html` carried a restrictive one. The entry point with the
weaker posture was the one handling the money.

Also confirmed: the line reference in §3.5 is `index.html:12`, not `:9` as the card's
earlier findings comment said. And the parent's note stands unchanged — `worker-src` is
unset and falls back to `default-src 'self'`, so a same-origin `/sw.js` needs no CSP
change; **the CSP was never the SW blocker.**

---

## 3. §6.3's manifest defects — all confirmed, plus two the delta did not name

Confirmed exactly as recorded:

- `start_url: "."` resolves to `/`, which the **served** webroot 404s. Measured against a
  real `npm run build:portal` output: the built tree contains `splash.html` and **no
  `index.html`**, and `manifest.json` is copied verbatim from `public/` — the `rename-html`
  step rewrites `asset-manifest.json` **only**. The manifest is never rewritten.
- `scope` absent, `id` absent (so fixing `start_url` later would orphan every install).
- No `purpose:"maskable"` icon.
- `background_color: "#ffffff"` against `theme-color: #000000` on a dark UI.

**Two additions:**

1. **The gh-pages host is not a "demo that accidentally works" — it is a third broken
   case.** §6.3 says `start_url: "."` "accidentally works on the demo" because the demo
   ships `index.html`. But the demo is deployed by `.github/workflows/deploy-demo.yml`,
   which runs **`npx vite build`** — and `rename-html` is a *separate* npm script. So
   gh-pages ships `index.html` **and** the manifest's `"."`, and the two agree by luck.
   Any fix must hold on the router (no `index.html`), on gh-pages (has `index.html`), and
   on the source dev server. Pinned `start_url: "splash.html"` holds on all three.
2. **A second-order instance of the same defect in the admin board.** The admin manifest
   is *generated* by `scripts/build-all.mjs`, which emitted `start_url: base` with no
   `id`, no `scope`, and no maskable icon — the identical three defects, in the sibling
   app, unnoticed because that generator is not the manifest §6.3 inspected. Fixed in the
   same change.

---

## 4. The measured constraint, now a regression gate

The reason this defect survived so long is the **test rail**, not the code.
`playwright.config.js` gives every test `baseURL = http://localhost:5173`, and **`localhost`
is Potentially Trustworthy** (Secure Contexts §3.1 step 5). So the entire existing e2e
suite runs on the one address **exempt from the rule under test** — and §6.5's own
requirement ("every router-free test must exercise the **http** path, not just `localhost`")
was therefore not met by the rails it was written for. A green suite there says nothing
about a captive portal.

`tests/e2e/installability.spec.mjs` closes that gap by binding the **same bytes** to both
addresses and running the **same probe**, so the only variable is the hostname:

```
NEGATIVE CONTROL  http://192.168.2.20:<port>/splash.html
  {"isSecureContext":false,"hasServiceWorkerAPI":false,"serviceWorkerType":"undefined",
   "hasCryptoSubtle":false,"hasCaches":false,"hasGetRandomValues":true,
   "hasStoragePersist":false}

WORKING PATH      http://127.0.0.1:<port>/splash.html
  {"isSecureContext":true,"hasServiceWorkerAPI":true,"serviceWorkerType":"object",
   "hasCryptoSubtle":true,"hasCaches":true,"hasGetRandomValues":true,
   "hasStoragePersist":true}
```

This reproduces the spike's rig independently, on a different host, with the same result.

**The trap, pinned as a test** (spike §0 / ADR-delta §3.2):

```
try { await navigator.serviceWorker.register('/sw.js') }
catch (err) -> TypeError: Cannot read properties of undefined (reading 'register')
```

It is a **`TypeError`, not a `SecurityError`**. A `catch (SecurityError)` feature-detect
misses it entirely and the app crashes instead of degrading. Every capability probe in
`src/helpers/pwa-install.js` therefore branches on `window.isSecureContext` **first**, and
`tests/unit/pwa-install.test.js` asserts the probe does not throw when
`navigator.serviceWorker` is absent *and* that it stays fail-closed when the API is present
but the context is not.

---

## 5. What was implemented

**Installability (WS-1, §6.3):** `start_url: "splash.html"`, explicit `scope: "./"`,
explicit `id: "tollgate-captive-portal"`, maskable icons, `background_color: "#000000"`.
The `id` is the load-bearing one — it is what makes this `start_url` change safe, because
without it the installed app's identity *is* `start_url`.

**CSP (§3.5):** `connect-src` gains `https:` and `wss:` on `index.html`, and `balance.html`
gets the **byte-identical** policy. Two policies that drift is how a hole opens in one.

**Capability detection:** `src/helpers/pwa-install.js` — `installPath()` returns `'none'`
on the portal origin, which is what makes the signpost copy honest rather than aspirational.

**The money path (spike §4), as an executable contract:** `src/helpers/money-path.js` +
`public/sw.js`. Spike §4's rules are testable assertions, so they are tests
(`tests/unit/money-path.test.js`, 28 cases) rather than a paragraph:

- The dangerous bug is **not** a stale invoice. It is a fetch handler that **synthesises a
  paid state**. `shouldIntercept()` is the negation of `mustNotBeCached()` so the two can
  never disagree, and the fail-closed branch (`return`, no `respondWith`) is the one that
  requires no thought.
- POST is **mechanically** uncacheable (the Cache API throws a `TypeError` on a non-GET) —
  so the platform already stops a stored purchase. What it does **not** stop is a handler
  *answering* one, which is ours to get right.
- Offline "pay later" therefore **cannot** be a cache trick. It is an IndexedDB outbox with
  idempotency keys; `newIdempotencyKey()` throws if `getRandomValues` is unavailable rather
  than degrading to a sequential key, because a non-random key silently permits a
  double-charge.
- The precache is a **positive allow-list**, never a glob — a glob is how `/v1/melt` ends up
  in a precache manifest.

**Non-vacuity:** the 39 new unit tests were re-run against deliberately broken
implementations (a `shouldIntercept` that returns `true` — the synthesised-paid-state bug —
and a feature-detect without the context check) and **17 of them failed**. The suite has
teeth in both directions; a one-directional assertion would pass against an implementation
that bypasses everything and therefore never works offline.

---

## 6. What this delta does NOT claim

- ✗ That the portal `http` origin is, can be, or will be a secure context. It cannot, and
  no OS/CAPPORT feature changes that (§3.1 step 9). The signpost is permanent, not a
  stopgap.
- ✗ That a LAN hostname, `.local`, or mDNS name fixes anything. Measured false even when
  the name is pinned to `127.0.0.1` in `/etc/hosts` — trust follows the *name/scheme*, not
  the routing.
- ✗ That the service worker committed at `public/sw.js` runs on the portal origin. It
  cannot; it is for the vendor/secure origin, and it is committed and tested here for the
  money-path contract it encodes.
- ✗ That the CORS work is done. **The router-side CORS policy is a separate change in the
  module repo** and its current state is a genuine blocker — see §7.
- ✗ That idempotency is a security boundary for the *amount*. It stops a double-charge. The
  plaintext `http` leg still lets an on-LAN attacker rewrite the invoice, which is why the
  payment intent must be **signed** (spike §5 item 4).

---

## 7. The blocker this delta surfaces: the existing CORS policy excludes the vendor origin

The operator's mechanism requires the router portal to emit `Access-Control-Allow-Origin`
for the PWA's calls (measured in the spike: without it `TypeError: Failed to fetch`; with
it, `200 OK`).

**That policy already exists, and it cannot serve this design as written.** In
`tollgate-module-basic-go`, `main.go:996` echoes the Origin **only** when `isLocalOrigin(origin)
|| isSameHost(origin, r.Host)` — and `cors_policy_test.go:62` pins the negative:

```
TestCorsMiddleware_NoWildcardForCrossHost
  origin "https://evil.example", host "192.168.8.1:2121"  ->  ACAO must be ""
```

A public vendor origin (`https://<vendor>`) is neither RFC1918 nor same-host, so **it is
exactly the case the current policy refuses**. The refusal is deliberate and well-argued —
the file's own comment cites OWASP, because this API is protected by the LAN firewall and
not by credentials, so a wildcard would let any website read responses from a browser on a
TollGate network.

So the vendor-origin architecture is **not implementable by adding a header**. It needs an
explicit, narrow decision — an allow-list of named origins supplied by router config, with
`Vary: Origin` already correct — **and that decision belongs in the module repo and in the
ADR, not in this portal change.** This delta records it as a blocker rather than
implementing a policy change in the wrong repository. Mixed-content / Private Network
Access (parent delta, open question 1) is the companion unknown and is still unclosed.
