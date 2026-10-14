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

### 2.1 CORRECTION — a self-signed cert gives a secure context but still NO PWA

The parent delta §3.4(a) treats "serve the portal over TLS" as the path to a real SW, and
the spike's §3(a) measured `isSecureContext:true` after a certificate exception — but the
spike ran with `--ignore-certificate-errors`, which suppresses the error **at the network
layer** and therefore **silently skips the service-worker gate**. That stand-in was wrong
for the question it was being used to answer.

Re-measured with a **real** click-through (headed Chrome under Xvfb, real pointer via
`xdotool`, interstitial clicked by hand): see
`~/reports/pwa-cashu/DOSSIER-vendor-origin-and-selfsigned.md` §1.2.

```
isSecureContext:true  hasSW:true  hasCryptoSubtle:true  hasCaches:true  hasIndexedDB:true
swRegister: {"ok": false,
  "error": "SecurityError: Failed to register a ServiceWorker for scope
            ('https://192.168.2.20:8444/') with script ('.../sw.js'):
            An SSL certificate error occurred when fetching the script."}
```

**"Is it a secure context" and "can I install a PWA" are different questions.** A
user-clicked exception satisfies the first and never the second. There are **four**
independent gates, and self-signed fails gate 3 permanently:

| # | Gate | Self-signed verdict |
|---|---|---|
| 1 | origin is Potentially Trustworthy (scheme/name only) | **passes** with `https://` |
| 2 | navigation not blocked by the interstitial | **passes** only with a user click-through |
| 3 | **service-worker registration** (needs a *validated* chain) | **FAILS**, permanently |
| 4 | install criteria (`beforeinstallprompt`) | moot while 3 fails |

Consequences, which replace §3.4(a) and (b) as written:

- **BYOD is UNSUPPORTED** on every platform checked. Android since Nougat does **not** trust
  user-added CAs (system store only), so we cannot make a stranger's phone trust a private
  CA; iOS needs a second manual `Certificate Trust Settings` step or MDM.
- **An operator-owned fleet is usable** if an MDM deploys the private root CA into the
  **system** store.
- **"Just get a real cert for the router" is a dead end.** No public CA will issue for an
  RFC1918 literal or an internal name (CA/Browser Forum baseline requirements; no ACME path
  for `192.168.1.1`), and split-horizon DNS fails for any guest whose resolver disagrees.

### 2.2 CORRECTION — the cross-origin router call is NOT a mixed-content problem

Recorded in the parent delta as open question 1 and in the spike as an untested item. It is
now measured, and **the framing in both was inverted.**

On the spec/MDN record, `https://page → fetch('http://192.168.1.1:2121/…')` *is* blockable
mixed content. **Chrome 156 exempts it**, by an explicit published exemption: the
permission-gated local-network request is exempted from mixed-content checks when the target
is a private IP literal or a `.local` domain (measured: `200 cors`, with only a console
*notice*).

What actually blocks it is a third gate neither document named:

> **Chrome Local Network Access** (Chrome 142+) — a user-grantable permission for any request
> from **public** address space to **private/loopback** space.

Measured, public origin (global IPv6) → private router:

```
Access to fetch at 'http://192.168.2.20:8018/api.json' from origin 'https://[2a01:...]'
has been blocked by CORS policy: Permission was denied for this request to access the
`local` address space.
→ TypeError: Failed to fetch
```

**It is reported as a CORS failure.** That is the trap, and it is now documented in the
portal's own code (`src/helpers/local-network-access.js`): an implementer will chase
`Access-Control-Allow-Origin` forever while the real cause is a missing permission. CORS and
LNA are orthogonal and **both** are required — measured independently:

| permission | ACAO | result |
|---|---|---|
| granted | present | `200 cors` (after an `OPTIONS` preflight) |
| granted | absent | **fails** — `No 'Access-Control-Allow-Origin' header` |
| not granted | present | **fails** — the address-space message above |

Naming traps, both measured: the web `PermissionName` is **kebab-case**
(`local-network-access`); camelCase is rejected as an invalid enum value. The CDP
`Browser.PermissionType` names are **not** the web names.

Measured after the user grants it once: the grant is **sticky per origin across a browser
restart**, and SW registration then succeeds. That stickiness is exactly why a **stable
vendor origin** matters — the user grants `portal.orangesync.tech` local-network access once
and it holds for **every** TollGate router they ever visit.

**Two constraints that shape the wallet design:**

1. **Workers cannot raise the LNA prompt.** Per the Chrome announcement, local-network
   requests from a Service Worker require the origin to have been granted **already**. So a
   fresh install's background SW poll loop against the router **silently fails**. The
   foreground must make one LNA-requiring call before any SW-driven polling is relied upon.
   This interacts directly with the parent delta's §6.6 background-autonomy design.
2. **`ws://` to the router is not an escape hatch.** WebSockets are not yet LNA-gated, but
   `ws://` from an `https://` page is still mixed-content-blocked. Do not design a `ws://`
   keepalive to the router.

---

## 3. §6.3's manifest defects — all confirmed, plus two the delta did not name


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

## 7. The router-side requirement, answered: an exact-origin allow-list, not a wildcard

The operator's mechanism requires the router portal to emit `Access-Control-Allow-Origin`
for the PWA's calls. That policy **already exists** in `tollgate-module-basic-go`
(`main.go:996`) and **cannot serve this design as written**: it echoes the Origin only when
`isLocalOrigin(origin) || isSameHost(origin, r.Host)`, and `cors_policy_test.go` pins the
negative (`TestCorsMiddleware_NoWildcardForCrossHost`: `https://evil.example` → no ACAO).
A public vendor origin is neither RFC1918 nor same-host, so it is **exactly** the case the
current policy refuses.

The refusal is deliberate and well-argued — the file's comment cites OWASP, because this API
is protected by the LAN firewall and not by credentials, so a wildcard would let any website
read responses from a browser on a TollGate network. **So this is not "add a header"; it is a
narrow, explicit decision**, and it belongs in the module repo and the ADR, not in this
portal change. The shape the dossier measured as sufficient:

```
# :2121 Go listener — net/http middleware, BEFORE routing.
# NOT uhttpd config, NOT nodogsplash: putting it in the wrong layer is a no-op.
Access-Control-Allow-Origin: https://portal.orangesync.tech   # exact origin, not "*"
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 600
Vary: Origin                                                  # already correct today
# OPTIONS <path> -> 204, no body
```

Two notes that are easy to get wrong:

- **`Access-Control-Allow-Private-Network` is dead code.** Measured:
  `Access-Control-Request-Private-Network` is **absent** in Chrome 156 — the legacy PNA
  preflight was replaced by LNA. Implementing it is a 2022-era recipe.
- **Prefer the exact origin over `*` now**, even though nothing is credentialled yet, so
  credentials can be added later without a breaking change. (`*` is incompatible with
  credentials.)

This delta records the requirement and the measured-enough shape. **The module-side change is
not made here.** §2.2 is the companion constraint, and it is what makes the LNA grant (not
the header) the first thing a fresh install must obtain.
