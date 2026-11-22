# DOSSIER — TollGate captive portal SPA: PWA / persistence / payment state + build+test harness

**Subject repo:** `https://github.com/OpenTollGate/tollgate-captive-portal-site` (default branch `main`)
**Recon date:** 2026-10-14
**Tip SHA (verified):** `c2ddba1218a653c0ef09d7857495e580d8865aff`
**Tip commit:** `fix(admin): real mock path for admin_credential_setup; ACL test names the one pre-auth write (#72)` — 2026-10-13 13:41:22 +0200
**Clone used:** `~/repos/tollgate-captive-portal-site` (read-only, `git status --porcelain` empty at the end of recon)
**Install/test copy:** `~/repos/tollgate-portal-work` (a second clone at the same SHA, used so the primary clone is never written to)
**Commands run:** `npm ci` / `npx npm@10.9.2 ci`, `npm test`, `npx vitest run`, `npm run build`, `npx playwright test --project=desktop`, `npx playwright test --config admin/playwright.config.mjs admin-credential-guard`

A prior analysis of this repo exists (`docs/pwa-client-wallet-plan.md`, merged as PR #69 at `f52a4c8` /
`b0a8287`) **and** a kanban card pair (`t_4c9e37ed` blocked, `t_75993017` blocked, on board
`tollgate-captive-portal-site`). Their *artifacts* are the only survivor; this dossier re-derives
everything from primary source at the current tip and flags where the in-repo doc has drifted.

---

## 1. Identity

| Field | Value | Evidence |
|---|---|---|
| SHA | `c2ddba1218a653c0ef09d7857495e580d8865aff` | `git rev-parse HEAD` |
| Date | 2026-10-13 13:41:22 +0200 | `git log -1 --format=%ci` |
| Package manager | npm; **lockfileVersion 3**, 250 `packages` entries | `package-lock.json` |
| Pinned engines | `node v22.17.0`, `npm 10.9.2` | `package.json:66-69` |
| Bundler | Vite `^7.0.0` (lockfile resolves **7.3.6**) | `package.json:45`; `node_modules/vite/package.json` |
| Framework | React `^18.2.0` + `react-dom ^18.2.0`; Preact `^10.29.1` and `@preact/preset-vite` are also present (used by the separate admin board) | `package.json:29,32-33,38` |
| Test runners | Vitest `^3.2.7` (resolves 3.2.7), `@playwright/test ^1.52.0` (lockfile resolves **1.61.1**), `jsdom ^29.1.1` | `package.json:37,42,46` |
| i18n | `i18next ^25.2.1` + `react-i18next ^15.5.3` + http-backend + languagedetector | `package.json:25-27,34` |
| Build output dir | `build/` (gitignored — `build/` is `.gitignore:2`) | `vite.config.js:51` |
| Sources of truth for branding | one skin per build via `admin/brand/<id>.json` + `VITE_BRAND` | `scripts/build-all.mjs:22-31,101-130` |

Two SPA entry points exist in this repo, and they must not be conflated:

1. **The captive portal (the subject)** — `index.html` → `src/index.jsx` → `src/App.jsx`. Served by
   nodogsplash's `uhttpd` on **plain HTTP :2051** (`src/helpers/tollgate.js:12-15`).
2. **The router admin board** — Preact, `admin/index.html` → `admin/src/main.tsx`, its own Vite config,
   its own Playwright config, and its own generated `admin/public/manifest.json`.

The admin board **already** has a generated, brand-aware PWA manifest (`scripts/build-all.mjs:101-127`) —
i.e. the repo knows how to emit a manifest, but that machinery is wired only to the admin app, not the portal.
The portal's manifest is a hand-written static file.

---

## 2. PWA readiness — measured, not assumed

### 2.1 There is NO service worker. Zero. Anywhere.

```
$ grep -rniE 'serviceWorker|registerSW|workbox|sw\.js|vite-plugin-pwa|navigator\.serviceWorker' \
    . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build
./docs/pwa-client-wallet-plan.md:29:| Service worker | **none** | no `workbox` / `vite-plugin-pwa` / `navigator.serviceWorker` |
./docs/pwa-client-wallet-plan.md:52:...
./docs/pwa-client-wallet-plan.md:83:...
./docs/pwa-client-wallet-plan.md:106:...
(empty of code hits)
```

The only matches are the plan document describing the absence. Corroborated three further ways:

* `package.json:36-47` devDependencies contain no `vite-plugin-pwa`, no `workbox-*`.
* The production build tree contains no SW artifact:
  `ls build/` → `404.html  admin/  asset-manifest.json  assets/  balance.html  favicon.ico  locales/  logo192.png  logo512.png  manifest.json  splash.html`; `find build -name '*sw*' -o -name '*service*worker*'` → empty.
* No install-prompt plumbing either: `grep -rn 'beforeinstallprompt\|appinstalled\|addToHomeScreen\|getInstalledRelatedApps\|display-mode' src/ *.html public/ tests/` → **0 matches**.

**There is also no offline capability of any kind, and no way for the app to know it was installed.**
A PWA without a SW is not installable in Chrome/Edge (the "Install" affordance requires a SW with a fetch
handler) and has no offline story. iOS Safari will add-to-home-screen, but with no SW there is still no
offline shell.

### 2.2 `public/manifest.json` — present, but structurally broken for its own start_url

The file exists (`public/manifest.json`, 27 lines, copied verbatim into `build/manifest.json`, 528 bytes) and
is linked from **both** HTML entries (`index.html:14`, `balance.html:13`).

| Manifest key | Declared value | Assessment |
|---|---|---|
| `short_name` | `"Tollgate Portal"` | ok (`public/manifest.json:2`) |
| `name` | `"Tollgate Captive Portal"` | ok (`:3`) |
| `icons` | `logo192.png` (192x192, `purpose:"any"`), `logo512.png` (512x512, `purpose:"any"`), `favicon.ico` (declared `"72x72"`, `type:"image/x-icon"`) | 192+512 `any` present. **No `purpose:"maskable"` icon** — Android adaptive-icon rendering will letterbox/pad. The `favicon.ico` declared as 72x72 is a mislabelled entry (the shipped `favicon.ico` is 185,470 bytes, not a 72px icon). Lines `:4-22`. |
| `start_url` | `"."` | **BROKEN.** Resolves relative to the manifest URL (`/manifest.json`) → `/` → the portal root, which on a real router serves **404** (see 2.3). Line `:23`. |
| `display` | `"standalone"` | ok (`:24`) |
| `scope` | **absent** | Not declared. Effective scope by default is the manifest's directory (`/`), which happens to coincide with what you'd want, but it is undocumented and unversioned — and it means *nothing* constrains a future `start_url` mistake. |
| `theme_color` | `"#000000"` | `:25`; also duplicated in `index.html:10` as `<meta name="theme-color">` (consistent) |
| `background_color` | `"#ffffff"` | `:26` — **inconsistent**: `index.html` sets `theme-color: #000000` and the app is a dark UI; a white splash background will flash white before a black app paints. |
| `description`, `id`, `orientation`, `display_override`, `shortcuts`, `screenshots`, `categories` | absent | No `id` → the installed app's identity is keyed off `start_url`, so changing `start_url` later orphans every existing install. |

### 2.3 The built entry is renamed to `splash.html`, and `start_url` no longer resolves

The build renames the entry HTML *after* Vite runs, and rewrites the asset manifest to match:

```json
"rename-html": "node -e \"… fs.renameSync(indexHtml, splashHtml); if (fs.existsSync(manifestPath)) { const manifest = fs.readFileSync(manifestPath,'utf8').replace(/index\\.html/g, 'splash.html'); fs.writeFileSync(manifestPath, manifest); }\""
```
(`package.json:18`)

Verified real build output (`npm run build` → EXIT 0):

```
build/splash.html          (2,959 bytes)   <-- the portal, renamed
build/balance.html         (935 bytes)
build/404.html             (3,268 bytes)
build/manifest.json        (528 bytes)     <-- start_url still "." <-- NOT rewritten
build/asset-manifest.json  {"assets":{"html":["404.html","balance.html","splash.html"], …}}
```

`asset-manifest.json` says `html: [404.html, balance.html, splash.html]` — **no `index.html`**. But the
`rename-html` step rewrites only `*.html` strings inside the asset manifest; it never touches
`manifest.json`, whose `start_url` stays `"."`.

Consequences, concretely:
* The plan doc's own gap row is accurate: *"Built page is renamed to splash.html (package.json rename-html) vs start_url:'.' - reconcile"* (kanban `t_4c9e37ed` body), and the earlier lost analysis flagged the same thing.
* The repo's own navigational links assume `splash.html` is the portal root: `src/BalancePage.jsx:92,102,127` all render `<a href="/splash.html">` labelled `return_to_portal`. So inside the app, `splash.html` is canonically "the portal". The manifest disagrees.
* Pushing to the demo host muddies this further: `.github/workflows/deploy-demo.yml` deploys a **raw `npx vite build`** (NOT `npm run build`, so no `rename-html`) to gh-pages. Verified: `git ls-tree --name-only origin/gh-pages` root contains `index.html`, `balance.html`, `404.html`, `manifest.json` — and **no `splash.html`** (`grep -c splash.html` → `0`). So the demo host and the router build ship *different entry filenames from the same source*, and `start_url:"."` accidentally works on the demo and 404s on the router. Any PWA start_url fix must hold for both.

### 2.4 Secure-context: the portal is NOT HTTPS, and cannot become HTTPS cheaply

The portal is served over **plain HTTP on port 2051** by nodogsplash's uhttpd:

* `src/helpers/tollgate.js:12-15` — `getPortalBaseUrl()` returns `` `http://${currentHost}:2051` ``, with the comment "the captive portal SPA itself is served on port 2051 (nodogsplash htdocs)".
* `packaging/files/etc/uci-defaults/92-tollgate-admin-setup:75` — "the captive portal is uhttpd.portal (:2051)".
* `openwrt/files/etc/config/uhttpd_admin:47` — "The captive portal stays on uhttpd.portal (:2051); it is NOT touched here."
* An exhaustive grep for portal-over-TLS found **nothing**: `grep -rniE 'portal.*https|https.*portal|2051|2050'` returns only the comment above, the admin **TLS** work (which is about the admin board on `/www/<brand>`, explicitly a *different* surface), and an unrelated SCSS number that happens to contain the string "2051".

The app already *feels* this constraint in two places, and handles it by degrading rather than by upgrading the transport:

* `src/helpers/qr-code.js:11-22` — `hasCameraSupport()` feature-detects `navigator.mediaDevices.getUserMedia`, which is **only exposed in a secure context**, and the camera button is hidden when absent (`src/components/Cashu.jsx:414`). The file comment states it outright: *"Captive portals serve over plain HTTP, so on Firefox/Brave/Chrome the property is `undefined`."*
* `src/helpers/clipboard.js` — the paste button is gated on `hasClipboardSupport()` for the same reason (`src/components/Cashu.jsx:403`).
* `README.md:118-119` carries it as an open discussion topic: *"Captive portals often run in restricted network environments, which may prevent browsers from granting camera or clipboard permissions—even if the portal is served over HTTPS."*

**This is the hardest structural blocker in the whole dossier.** Service workers, `beforeinstallprompt`, the
Cache API, `navigator.storage.persist()`, Web Crypto-backed key material, and IndexedDB-with-persistence are
all secure-context-gated. On `http://192.168.…:2051` there is no path to a Chrome/Android install prompt at
all. Making this portal an installable PWA requires either (a) serving the portal over TLS with a certificate
the client will accept, or (b) accepting that the PWA story is iOS-only / manual-add-to-home-screen, or
(c) a non-HTTP install rail. The repo today has **zero** of (a); the *admin* board got TLS
(`/etc/tollgate/ssl/server.{crt,key}`, `openwrt/files/etc/config/uhttpd_admin:52-54`, guarded by the
`tollgate ssl covers` predicate in `packaging/.../92-tollgate-admin-setup`) and the portal was deliberately
left out of that migration.

### 2.5 CSP interaction with any future SW

`index.html:12` ships a restrictive CSP:

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self' http: ws:; font-src 'self' data:; media-src 'self';
```

`balance.html` ships **no CSP at all**. Notes for the PWA work:
* `script-src` is `'self'` with `'unsafe-inline'`/`'unsafe-eval'`. A SW registration script loaded from
  `/sw.js` (same origin) is fine; an inline registration snippet is fine only because of `'unsafe-inline'`.
  `worker-src` and `frame-ancestors` are **unset**, so a worker falls back to `default-src 'self'` →
  a same-origin `sw.js` is allowed. **No CSP change is needed to register a service worker.**
* `connect-src 'self' http: ws:` is what lets the SPA `fetch()` the gateway at `http://<host>:2121`
  (`src/helpers/tollgate.js:7-10`) over plain HTTP from origin `http://<host>:2051`. Cross-origin is
  permitted here only because the scheme-source `http:` allows it.
* ⚠️ **Unverified but material, needs a browser check before the wallet ships:** CSP scheme-sources are
  scheme-exact — `http:` matches `http:` URLs and **not** `https:` URLs. The one existing cross-origin mint
  call is `fetch(`${mint}/v1/keysets`)` at `src/helpers/mint-fee.js:68`, and the mint URLs in the shipped
  fixtures are **`https://`** (`tests/e2e/helpers/mock-backend.mjs:16` → `https://mint.minibits.cash`;
  `src/components/Cashu.jsx:118` in the dev fallback). On that reading, `connect-src` would **block** the fee
  pre-check in a real browser, `getMintSwapFee` would return `{status: 0}` ("no pre-check",
  `src/helpers/mint-fee.js:56-58`), and the `CU110` "token entirely eaten by the fee" guard would silently
  never fire — precisely the failure mode the file's own comment says must never happen
  (*"The only thing status 0 must never be is a stand-in for a fee we could have computed — that is how the
  CU110 'token too small' gate silently disappeared"*, `src/helpers/mint-fee.js:57-58`). The unit tests cannot
  catch this (mocked `fetch`, no CSP enforcement), and the e2e tests stub the whole helper module. **I did not
  verify this in a real browser** — it is a lead, not a finding. It must be checked (and `https:` added to
  `connect-src`) before the wallet adds more cross-origin mint traffic.

---

## 3. Client persistence — measured

### 3.1 Today: nothing is persisted. Nothing.

```
$ grep -rnE 'localStorage|sessionStorage|indexedDB|\bidb\b|cookie|document\.cookie' src/ index.html balance.html public/
(exit 1 — zero matches)
```

Corroborated independently: the only hits repo-wide for those tokens are inside
`node_modules` and inside the plan doc's own "**none**" row. There is **no** `idb`, no `localForage`, no
`dexie`, no `@cashu` proof store, no service-worker cache, no cookie.

### 3.2 What survives a reload: nothing but the URL

Every piece of state that matters lives in React `useState`/`useRef` and dies on reload:

| State | Where | Dies on reload? |
|---|---|---|
| `token` (the pasted Cashu note) | `src/components/Cashu.jsx:31` | yes |
| `tokenValue`, `allocation`, `mintFee` | `src/components/Cashu.jsx:33,42,44` | yes |
| `processing`, `success`, `error`, `bypassing` | `src/components/Cashu.jsx:35-37,40` | yes |
| `accessOptions`, `selectedMint`, `unsupportedMint` | `src/components/Cashu.jsx:41,43,46` | yes |
| `invoiceData`, `unitAmount`, `success` (Lightning) | `src/components/Lightning.jsx:29-36` | yes |
| `liveUsage`, `authCompleted`, `sessionExpired` | `src/App.jsx:215-218` | yes |
| `deviceInfo` (the MAC) | `src/App.jsx:31`, from `fetchTollgateData` | yes — re-fetched each load |
| `method` (cashu vs lightning tab) | `src/App.jsx:27` | yes |

The one piece of durable server-side state the portal reads is the **router's** session (`GET /balance`,
`src/helpers/balance.js:49-60`, consumed by `src/BalancePage.jsx:45,63`), and that is memory-only on the
router (`customerSessions map[string]*CustomerSession`, per kanban `t_4c9e37ed`; documented as
*"restart loses session metering"* in the module's `AGENTS.md`). So a reload of the portal loses the client
state **and** may lose the server's own view of the session.

### 3.3 How the token is handed to the page, and where it is read

There are exactly **two** delivery paths, and one of them is a single hand-off through a window global.

**Path A — `?token=` URL query param (tip-03 "prehydrate").** `index.html:16-42` is an inline, pre-module
script that runs *before* the SPA bundle downloads:

```js
var params = new URLSearchParams(window.location.search);
var token = params.get('token');
if (token) {
  window.__INITIAL_TOKEN__ = token;
  var clean = window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, clean);   // strip bearer token from the address bar
}
```
(`index.html:28-35`; the explanatory comment is `index.html:16-24`.) The token is **deliberately stripped
from the URL immediately** — the comment says why: *"Cashu tokens are bearer instruments and would otherwise
leak via browser history, server logs, and Referer headers on any subsequent navigation."*

Read once, at component init:
```js
const initialToken = (typeof window !== 'undefined' && window.__INITIAL_TOKEN__) || '';
const [token, setToken] = useState(initialToken);
```
(`src/components/Cashu.jsx:30-31`)

…and then it is **never cleared**. `window.__INITIAL_TOKEN__` remains set on the window object for the
lifetime of the document (nothing writes `undefined` back outside tests — `tests/e2e/prehydrate.spec.mjs:46-47`
and `tests/unit/cashu-auto-select-mint.test.jsx:99,104` only reset it *before* use). Any code running later in
the same document (an injected script, a future dependency, a bookmarklet paste, a browser extension) can read
the raw bearer note straight off `window`. The URL leak was closed; the global was not.

**Path B — manual entry.** `src/components/Cashu.jsx:383-433` (`TokenInput`): a text `<input id="cashu-token">`,
a clipboard-paste button gated on `hasClipboardSupport()` (`:403`), and a QR-scan button gated on
`hasCameraSupport()` (`:414`). Nothing is written back to storage after entry.

**Auto-submit on Path A.** If the token arrived from the URL, the component auto-fires the purchase:
`src/components/Cashu.jsx:54-58` sets `processing=true` as soon as `tokenValue && allocation` are both
non-null; manual entry never auto-submits (`_tokenFromUrl` is the gate). That is the whole "zero-friction"
mechanism the portal has today, and it is a one-shot: `useEffect(..., [processing, bypassing])` at `:220-238`
dispatches `submitToken` once.

---

## 4. The payment call path

**There is exactly one outbound paid request in the portal** (the Lightning lane is a separate, invoice-based
rail; see §5). It is `submitToken` in `src/helpers/cashu.js:301-430`, called from
`src/components/Cashu.jsx:225`.

### 4.1 Request

```js
export const submitToken = async (token, _tollgateDetails, allocation, i18n) => {
  try {
    const baseUrl = getTollgateBaseUrl();
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: token,
    });
```
(`src/helpers/cashu.js:301-308`)

| Property | Value |
|---|---|
| URL | `http://<window.location.hostname>:2121/` — built by `getTollgateBaseUrl()`, `src/helpers/tollgate.js:7-10`. Host is taken from the page itself (`const currentHost = window.location.hostname`, `:4`). |
| Method | `POST` |
| Content-Type | `text/plain` |
| Body | the **raw Cashu token string** — nothing else. No JSON envelope, no MAC, no signature. |
| Credentials/auth | **none.** The token *is* the bearer credential. The router derives the device identity from the TCP source address, not the body. |

The `_tollgateDetails` parameter is accepted and **entirely unused** (leading underscore, `:301`) — a leftover
from a superseded design where the portal signed a Nostr event. The function's own comment says so:
*"HTTP-01 raw-token POST: the Cashu token is a bearer instrument, so the backend authorizes the spend from the
token itself — not from a Nostr signature. The backend derives the device identifier (MAC) from the request's
network context. This matches the curl path used by the test framework's `pay_direct()` and the protocol's
`curl -d 'cashuB...'` example."* (`src/helpers/cashu.js:294-300`).

> **Doc drift to flag.** The merged plan doc and the kanban card both describe this as "*a signed Nostr
> **kind-21000** event carrying the whole token is POSTed*" (`docs/pwa-client-wallet-plan.md:34`;
> kanban `t_4c9e37ed` body). **That is no longer the shipped client.** The code posts the *bare* token with
> `Content-Type: text/plain`. `kind-21000` survives only as a *server-side tolerance*: the backend's
> `extractCashuToken` returns the raw body **unless** the body happens to be a kind-21000 event. The stale
> description also matters for the wallet work, because the "pay a full token per event" framing is the
> premise the incremental-payment gap analysis was built on.

> **Dead import to flag.** `src/helpers/cashu.js:3` still does
> `import { getPublicKey, getEventHash, getSignature } from "nostr-tools";` and none of the three symbols is
> referenced anywhere else in the file (only hit for each identifier is line 3). `nostr-tools ^1.17.0` is
> therefore a pure dead dependency of the payment path — it stays in the bundle for nothing. The `CU105`
> i18n string (*"Failed to generate keys to sign the payment event"*, `public/locales/en.json:98-99`) is
> correspondingly unreachable from this module. This is exactly the kind of residue a "raw token" refactor
> leaves behind, and it should be deleted as part of any wallet PR.

### 4.2 Response handling

Success (`response.ok`) → normalized to
```js
{ status: 1, label: i18n("access_granted_title"), message: allocation ? i18n("access_granted_subtitle",{purchased:allocation}) : i18n("submit_anyway_granted_message") }
```
(`src/helpers/cashu.js:410-420`). Note there is **no parsing of a success body at all** — a bare 2xx is the
only success signal the client uses, and the granted allocation echoed to the user is the *client's own
pre-computed estimate*, not anything the router confirmed.

Failure (`!response.ok`) → the client tries to parse the body as a Nostr kind-21023 notice
(`{kind:21023, tags:[["code","payment-error-…"]], content:"…"}`) and maps it to a friendly code
(`src/helpers/cashu.js:310-379`):

```js
const byCode = {
  "payment-error-below-swap-fee":        "CU110",
  "payment-error-mint-unreachable":      "CU111",
  "payment-error-dleq-keyset-rotation":  "CU109",
};
```
plus a substring fallback on the human message (`:350-364`). Then a status-code fallback: `402 → CU106`,
anything else → `CU107` (`:381-407`), and a transport throw → `CU108` (`:421-428`).

**Robustness observation:** the code comment at `:340-342` records a real bug that was fixed —
*"backend kind 21023 notices are sent with 400 (not 402), so keying off 402 alone missed every coded
error."* That fix is present. Note also `response.clone().json()` at `:317` implies the client expects the
*error* body to be JSON while the *success* body is ignored — asymmetric but intentional.

### 4.3 UX states

The Cashu flow's state machine is `src/components/Cashu.jsx`:

| State | Trigger | Rendering | Evidence |
|---|---|---|---|
| idle / input | default | `TokenInput` + `AccessOptions` + disabled purchase CTA | `:286, :335-342, :345-346` |
| token valid, pre-purchase | `validateToken` → `status:1`, and `allocation` non-null | `<Success label="valid_cashu_token">` showing the token's sat amount and the estimated allocation | `:289-293` |
| token too small | `tokenValue.amount < selectedMint.price` | `CU002` error card | `:153-162, :204-213` |
| token eaten by mint swap fee | `tokenValue.amount <= fee` | `CU110` error card; the fee is pre-fetched from the mint's `/v1/keysets` before any purchase | `:184-202`; `src/helpers/mint-fee.js:59-115` |
| token's mint not advertised | `mintUrlFromToken` yields a mint absent from `accessOptions` | selection cleared, `unsupported_mint_notice` hint, user must pick by hand | `:104-135, :304-308` |
| **pending** | `setProcessing(true)` (`:359` for normal, `:261` for bypass) | spinner + `processing_payment` | `:272` |
| **success (normal)** | `submitToken` → `status:1` and `allocation` present | `AccessGranted` card with the estimated allocation, then a 900 ms-delayed `fetch('/')` to finalise captive-portal detection, then a 30 s `/usage` heartbeat | `:229-230, :275`; heartbeat in `src/App.jsx:225-304` |
| **success (bypass)** | merchant accepted a token the client could not decode | plain `Success` card, no allocation shown | `:280-283` |
| **failure** | `submitToken` → `status:0` | `<Error>` card keyed by `CU1xx` | `:232, :311` |
| session expired | 2 consecutive `-1/-1` readings from `GET /usage` | `SessionExpired` view with an in-page "Buy more time" CTA (no reload, no reconnect) | `src/App.jsx:254-321, :405-425` |
| usage unreachable | ≥2 consecutive transport failures on `/usage` | non-fatal `usage_unreachable_notice`; expiry is **never** declared from a transport error | `src/App.jsx:269-278, :379-383` |

There is a "submit anyway" escape hatch, offered **only** for `CU102` (client-side decode refusal — e.g. a v4
`cashuB` note with a v2 short keyset id): `canSubmitAnyway()` = `status!==1 && code==="CU102"`
(`src/helpers/cashu.js:291-292`); the affordance renders at `src/components/Cashu.jsx:320-332` and pushes the
raw token through with `allocation: null`. Hard format failures (`CU100` empty / `CU101` not-a-cashu-token)
deliberately do **not** get the bypass (`src/helpers/cashu.js:285-290`).

### 4.4 What the router does with it (for the wallet design, from the kanban recon)

Per the (uncited here, but in-repo-traceable) card `t_4c9e37ed` body, the server side is:
`HandleRootPost` → `extractCashuToken` (raw body unless a kind-21000 event) → `PurchaseSession(token, macAddress)`;
success = signed `kind:1022` session event + HTTP 200, failure = `kind:21023` + HTTP 400. The billing atom is a
**step**: `steps = amountSats / price_per_step`, floored by `purchase_min_steps`. Critically for the wallet goal:
**the note is swapped at the mint the instant it is paid, so the operator's wallet holds the value and there is
no client-held remainder today** — that is the gap the client wallet is meant to close.

---

## 5. Existing Lightning surface (BOLT11 display + poll loop)

The Lightning lane is a **second, parallel rail** and it already implements invoice-request → display → poll,
which is the closest thing in the repo to a template for the wallet's "auto-pay on the user's behalf" loop.

### 5.1 Endpoints used (all on the gateway, `:2121`)

| Call | Function | Request | Evidence |
|---|---|---|---|
| capability probe | `probeLightningCapability()` | `GET /ln-invoice` (no quote) — side-effect-free; expects a JSON body with a `status` key | `src/helpers/lightning.js:21-41`; called once from `src/App.jsx:38-46` |
| create invoice | `requestInvoice(amount, mintUrl, i18n, deviceInfo)` | `POST /ln-invoice?mac=<mac>` with `Content-Type: application/json`, body `{ "amount": <n>, "mint_url": "<url>" }` | `src/helpers/lightning.js:58-68` |
| invoice status | `getInvoiceStatus(quote, i18n, deviceInfo)` | `GET /ln-invoice?quote=<quote>&mac=<mac>` | `src/helpers/lightning.js:92-98` |

Response shape of a create (`src/helpers/lightning.js:77-85`):
`{ status, quote, invoice, mint_url, amount, expiry, state }`.
Response shape of a status poll (`:106-115`):
`{ status, quote, mint_url, amount, state, access_granted, allotment, metric }`.

The **MAC** is threaded into every call via `macQuery()` (`src/helpers/lightning.js:9-12`), sourced from
`getClientMac(deviceInfo)` (`src/helpers/tollgate.js:21-25`), which itself comes from the `/whoami` response
parsed in `fetchTollgateData` (`src/helpers/tollgate.js:66-87`). The file comment explains why: without it the
invoice is created against whatever IP the request arrives from, *"which is not necessarily the client the
operator is looking at"* (`src/helpers/lightning.js:3-8`).

### 5.2 The poll loop and its interval

```js
pollStatus()
const interval = window.setInterval(pollStatus, 2000)

return () => {
  active = false
  window.clearInterval(interval)
}
```
(`src/components/Lightning.jsx:126-132`)

* **Interval: 2,000 ms**, started as soon as `invoiceData` exists and `success` is false
  (`src/components/Lightning.jsx:103-133`).
* It stops on success (`setSuccess(true)` at `:119`) and via the `active`-flag + `clearInterval` cleanup.
* It is **not** stopped on the `expiry` field — the client never reads `invoiceData.expiry` to give up. If a
  user abandons the invoice tab, `getInvoiceStatus` keeps polling `:2121` forever at 0.5 Hz. There is no
  backoff and no max-attempts cap.
* On `response.status === 0` (poll error) the loop sets an error but **keeps polling** (`:121-123`).

### 5.3 Invoice display

`src/components/Lightning.jsx:179-207`: the BOLT11 string is rendered as an inline **SVG QR** via
`createQr(invoiceData.invoice)` (`src/helpers/qr-code.js:5`, `qrcode-svg ^1.1.0`), wrapped in an anchor whose
href is `lightning:<invoice>` when the string starts with `ln` (`:196, :202`), plus a clipboard copy button
(`:205`).

### 5.4 Where the BOLT11/invoice vocabulary actually lives

```
$ grep -rniE 'invoice|bolt11|lnbc|lnurl|/session|quote' src/ tests/ public/
```
* All `invoice`/`quote` hits are in `src/helpers/lightning.js`, `src/components/Lightning.jsx`, `src/App.jsx:37`
  (probe comment), the unit test `tests/unit/lightning-mac.test.js`, and `tests/e2e/helpers/mock-backend.mjs:111-133`.
* **`bolt11` → 0 hits. `lnurl` → 0 hits. `/session` → 0 hits.** The portal never names BOLT11 or LNURL; it
  treats the invoice as an opaque string it QR-encodes and hands to the OS via the `lightning:` URI scheme.
* `lnbc` appears exactly once, in a unit test asserting a Lightning invoice is *not* mistaken for a Cashu
  token: `tests/unit/cashu-validateToken.test.js:105` — `validateToken('lnbc1notacashutoken', …)`.
* There is **no `/session` endpoint consumer anywhere in the portal.** Any wallet design that assumes a
  session-ticket API on the client side is building on an endpoint the SPA does not speak.

**Relevance to the wallet goal:** the 2 s poll loop is the existing precedent for "the client watches for the
merchant to acknowledge value." But it is a *pull* loop against the gateway with no expiry honouring, no
backoff, and no persistence — so a wallet that "auto-pays many small frequent top-ups" cannot reuse it
verbatim; it needs the same loop with expiry/backoff and, crucially, a durable record of what it already paid
(none exists today, §3).

---

## 6. Test + build harness — exactly what runs, and what is really broken

### 6.1 Commands

| Purpose | Command | Config | Notes |
|---|---|---|---|
| Install | `npm ci` | — | **FAILS on npm ≥ 11** — see 6.2 |
| Install (workaround) | `npx npm@10.9.2 ci` | — | succeeds; matches the pinned engine |
| Dev server | `npm run dev` (`vite`, port 5173) | `vite.config.js` | portal only |
| Dev server (admin) | `npm run dev:admin` | `admin/vite.config.mjs` | `VITE_BRAND=tollgate` |
| Unit/integration | `npm test` = `vitest run` | `vitest.config.js` | jsdom, `globals: true`, setup `src/test/setup.js`; includes `src/**/*.test.{js,jsx}` **and** `tests/unit/**/*.test.{js,jsx}` |
| Unit (watch) | `npm run test:watch` | | |
| Build everything | `npm run build` = `node scripts/build-all.mjs` | | portal → `build/`, then admin → `build/admin/` (order matters: the portal's `emptyOutDir` wipes `build/`) |
| Build portal only | `npm run build:portal` = `vite build && npm run rename-html` | | |
| Portal entry rename | `npm run rename-html` | `package.json:18` | `build/index.html` → `build/splash.html` |
| E2E (portal) | `npm run test:e2e` = `playwright test` | `playwright.config.js` | projects `desktop` (Desktop Chrome) + `mobile` (**Pixel 7**, deliberately Chromium — the config comment at `:28-31` says the iPhone-14/WebKit default needed a second browser download). `workers: 1`, `fullyParallel: false`, `retries: 0`. `webServer` auto-starts `npm run dev` on :5173 with `reuseExistingServer: true`. |
| E2E (admin) | `npm run test:admin` | `admin/playwright.config.mjs` | own dev server on :5199, `VITE_MOCK=true` |
| Visual baselines | `npm run test:visual` = `playwright test --update-snapshots` | | baselines committed for `desktop` only (`tests/e2e/visual.spec.mjs:10-11`), names `*-desktop-linux.png` |

E2E specs (5 files, 287 lines total): `tests/e2e/functional.spec.mjs` (6 tests),
`prehydrate.spec.mjs` (3), `session-expiry.spec.mjs` (1), `usage-display.spec.mjs` (1),
`visual.spec.mjs` (2).

### 6.2 `npm ci` is broken on modern npm — real, at this tip

```
$ npm --version            # 11.19.0
$ npm ci
npm error `npm ci` can only install packages when your package.json and package-lock.json
npm error or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Missing: @parcel/watcher-android-arm64@2.5.6 from lock file
npm error Missing: @parcel/watcher-darwin-arm64@2.5.6 from lock file
npm error Missing: @esbuild/aix-ppc64@0.28.1 from lock file
… (many more platform-specific optional entries)
```

Root cause: the lockfile records `@parcel/watcher` and `@esbuild/*` **only as optionalDependencies of their
parent packages** (`node_modules/@parcel/watcher` carries `optional: true`; only the linux-x64 glibc/musl
siblings are given their own `node_modules/` entries) — `lockfileVersion: 3`, 250 package entries, 14
`@parcel/watcher`-family mentions. npm 11 requires every optional platform sibling to have its own resolved
entry; npm 10 does not. **CI is unaffected** because `.github/workflows/ci.yml:34-36` and
`deploy-demo.yml:25-27` use `actions/setup-node@v4` with `node-version: 22`, which bundles npm 10.x.
**Any contributor on a newer Node hits a wall before they can run a single test**, and the repo's
`README.md:25-26` only says "npm (v10.9.2 or later)" — i.e. it actively points them at the failing version.
This is a genuine onboarding defect worth its own small fix (regenerate the lockfile, or pin
`packageManager`/`.nvmrc` and say "npm 10.x only" in the README).

### 6.3 `npm test` (vitest) — REAL RESULT: **RED**, two independent defects

Full run (`npm test` in `~/repos/tollgate-portal-work`, npm-10 install, verified `REAL_EXIT=1`):

* **Defect A — the suite never finishes: a JS heap OOM.** The run dies with
  `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
  and the worker pool then throws `Unhandled Rejection: Error: Channel closed (ERR_IPC_CHANNEL_CLOSED)`, so
  **no `Test Files N passed` summary is ever printed.**
* **Defect B — 5 genuine assertion failures** in `tests/unit/renew-after-expiry.test.jsx` (5 tests | 5 failed).

**Bisected root cause of Defect A — the OOM is one file, and it is the anti-OOM safety net that causes it.**
Run one file at a time with a bounded heap:

```
$ NODE_OPTIONS=--max-old-space-size=1024 timeout 240 npx vitest run src/components/__tests__/Cashu.race.test.jsx
real    3m18.016s
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
EXIT=1
```

`src/components/__tests__/Cashu.race.test.jsx` **alone** exhausts a 1 GB heap. It does not hang on a timer or
a network call — it allocates until V8 gives up; given a *4 GB* heap it still OOMs (`npm test` run with
`NODE_OPTIONS=--max-old-space-size=4096` → same `FATAL ERROR`, `EXIT=1`). And it explains itself, in its own
sibling test file's header comment:

> `src/test/setup.js` mocks `react-i18next` with `useTranslation: () => ({...})`, handing out a NEW `t`
> function on every render. Cashu's effects list `t` in their dependency arrays, so each render re-runs them,
> they set fresh object state and the component re-renders forever — the infinite render loop behind the
> hanging `src/components/__tests__/Cashu.race.test.jsx` (carded as `t_2098c3cc`).
> — `tests/unit/renew-after-expiry.test.jsx:19-25`

Confirmed against source: `src/test/setup.js:3-13` is exactly the unstable mock (`useTranslation: () => ({ t: (key, opts) => …, i18n, ready: true })` — a **new arrow function per call**), while `src/components/Cashu.jsx`
lists `t` in effect dependency arrays at `:52, :72, :81, :101, :133, :165` and `:238`. `renew-after-expiry.test.jsx:26-35`
works around it by installing its own identity-stable `t`; `Cashu.race.test.jsx` does **not**, so it spins.
`Cashu.race.test.jsx` also uses a top-level `await import('../Cashu')` at `:37` (after its `vi.mock` calls),
which is why the file never even reports a test count.

**Defect B — the 5 real failures, with the exact cause.** `renew-after-expiry.test.jsx` fails on the *mock
surface*, not on the feature:

```
Error: [vitest] No "mintUrlFromToken" export is defined on the "../../src/helpers/cashu.js" mock.
       Did you forget to return it from "vi.mock"?
AssertionError: purchase CTA is available for a valid token: expected null to be truthy  (×5)
```

The test's in-file mock of the helper module (`renew-after-expiry.test.jsx:40-49`) exports only
`validateToken, submitToken, canSubmitAnyway, extractProofsFromToken`. But the real module gained two more
exports and the component now imports them:

* real surface: `extractProofsFromToken, normalizeMintUrl, mintUrlFromToken, findMintOption, validateToken, canSubmitAnyway, submitToken` (`src/helpers/cashu.js`, `grep -oE '^export const [a-zA-Z]+'`).
* component import line: `import { validateToken, submitToken, canSubmitAnyway, mintUrlFromToken, findMintOption } from '../helpers/cashu';` (`src/components/Cashu.jsx:16`).

When `mintUrlFromToken` is missing the mint-auto-select effect throws, so `selectedMint` never settles, no
allocation is ever computed, and the purchase CTA never renders — hence 5 failures with the same assertion.
This is the **auto-select-mint feature (PR #61, `6f599bb`) landing without updating the older
renew-after-expiry test's mock.** Same failure class as the e2e defect in 6.4.

**Suites that DO pass** (from the same run's output): `brand.test.js` 25, `ui-cross-link.test.js` 10,
`cashu-submitToken.test.js` 15, `cashu-mint-url.test.js` 22, `mint-fee.test.js` 5,
`lightning-mac.test.js` 6, `cashu-validateToken.test.js` 6, `cashu-auto-select-mint.test.jsx` 9,
`private-radio.test.js` 4, `locales-ln-keys.test.js` 4, `brand-bundling.test.js` 3,
`access-granted-duration-spacing.test.jsx` 1, `App.test.jsx` 6, `src/helpers/__tests__/cashu.test.js` 4.
(`src/components/__tests__/Cashu.race.test.jsx` never reports.)

### 6.4 Portal e2e — REAL RESULT: **RED**, 3 passed / 10 failed, and the cause is a stale stub

`npx playwright test --project=desktop` (after `npx playwright install chromium`):
**3 passed, 10 failed, 4.4 m.**

| # | Test | Result |
|---|---|---|
| 1 | `functional.spec.mjs:8` page loads with TollGate branding | ✓ 2.9 s |
| 2 | `functional.spec.mjs:15` Cashu tab default; Balance tab removed; Lightning present | ✘ timeout waiting `#tab-cashu` |
| 3 | `functional.spec.mjs:24` footer shows Powered by TollGate | ✓ 981 ms |
| 4 | `functional.spec.mjs:31` AccessGranted shows after manual payment | ✘ |
| 5 | `functional.spec.mjs:55` Lightning tab enabled by capability probe | ✘ |
| 6 | `functional.spec.mjs:66` standalone balance page renders | ✘ |
| 7 | `prehydrate.spec.mjs:13` URL token → AccessGranted | ✘ |
| 8 | `prehydrate.spec.mjs:25` token stripped from URL | ✘ |
| 9 | `prehydrate.spec.mjs:39` `window.__INITIAL_TOKEN__` is set | ✓ 3.7 s |
| 10 | `session-expiry.spec.mjs:15` SessionExpired after 2 × `-1/-1` | ✘ |
| 11 | `usage-display.spec.mjs:15` usage bar + text | ✘ |
| 12 | `visual.spec.mjs:15` portal loaded snapshot | ✘ |
| 13 | `visual.spec.mjs:27` balance page snapshot | ✘ |

**The stale-cashu.js-export claim is REAL at this tip, and the pass/fail pattern proves the mechanism.**
Compare the failures against `tests/e2e/helpers/mock-backend.mjs`'s stub
(`CASHU_HELPER_STUB`, lines 22-31) with the real module's export list:

```
real src/helpers/cashu.js exports : extractProofsFromToken, normalizeMintUrl, mintUrlFromToken,
                                    findMintOption, validateToken, canSubmitAnyway, submitToken
stub exports (mock-backend.mjs)   : validateToken, submitToken, extractProofsFromToken
MISSING FROM STUB                : canSubmitAnyway, mintUrlFromToken, findMintOption, normalizeMintUrl
```

and the component's import line `src/components/Cashu.jsx:16` needs `validateToken, submitToken,
canSubmitAnyway, mintUrlFromToken, findMintOption`.

The pattern is exact: **both** ✓ tests (1 and 3) are the two that call `setupMockBackend` **zero** times
(`functional.spec.mjs:8-13`, `:24-29` — they `page.goto('/')` with no route interception, so the real
`src/helpers/cashu.js` is served by the Vite dev server and the module loads fine). Test 9 passes because
`window.__INITIAL_TOKEN__` is set by the `index.html` inline script, which runs *before* the module graph is
evaluated — the page dies at module load, but the global is already there. **Every single test that installs
the mock backend fails**, which is precisely what a stub missing a named export produces: `page.route` fulfils
`/src/helpers/cashu.js` with a body that cannot satisfy `Cashu.jsx`'s named import, so the app never mounts and
every selector times out (the failure text is `TimeoutError: page.waitForSelector: Timeout 15000ms exceeded`,
not an assertion mismatch). The stale stub also still carries `export const TEST` (`mock-backend.mjs:33` is
`TEST_TOKEN`, matched here by the `TEST` prefix) — i.e. the stub has drifted in both directions.

Note what this stub is: it **replaces the module over HTTP** (`page.route('**/src/helpers/cashu.js', …)`,
`mock-backend.mjs:52-58`) rather than mocking an import. That makes it a *source-level* artifact of the dev
server, and it means the e2e lane's correctness depends on the stub's export list tracking
`src/helpers/cashu.js` exactly. The card `t_89aa8777` (status `triage`, title *"PORTAL-E2E: mock-backend stubs
a stale cashu.js export so the whole e2e suite dies at module load"*) is **confirmed and still open**; the
card's cited missing export was `canSubmitAnyway`, and the drift has since grown to four missing exports.

**Card cross-check (both prior cards are real, and both are still open):**

| Card | Status | This recon's verdict |
|---|---|---|
| `t_2098c3cc` "PORTAL-SUITE-OOM: the portal vitest run OOMs Node on this host" | `triage` | **CONFIRMED and sharper.** Not "on this host" and not a pool issue: the OOM reproduces with default *and* 4 GB heaps, and it is isolated to the single file `src/components/__tests__/Cashu.race.test.jsx`, caused by the unstable-`t` mock in `src/test/setup.js` producing an unbounded render loop. |
| `t_89aa8777` "PORTAL-E2E: mock-backend stubs a stale cashu.js export so the whole e2e suite dies at module load" | `triage` | **CONFIRMED.** 10/13 desktop tests fail; every failing test is one that installs the mock. The stub is now missing `canSubmitAnyway`, `mintUrlFromToken`, `findMintOption`, `normalizeMintUrl`. |
| `t_77c85d4c` "REGRESSION-A: repair the portal browser lane and pin the purchase path" | `triage` | Open; the same repair, framed as pinning the purchase path. |

### 6.5 Admin board e2e — GREEN (the one clean lane)

```
$ npx playwright test --config admin/playwright.config.mjs admin-credential-guard
Running 4 tests using 1 worker
  ✓ admin-credential-guard.spec.mjs:15 refuses to sign in when the router has no root password (579ms)
  ✓ :41 a provisioned router still auto-logs in (unchanged) (260ms)
  ✓ :48 the login form refuses a blank credential (259ms)
  ✓ :67 a LOCKED root account is explained instead of reading as a wrong password (250ms)
  4 passed (4.3s)
```

This lane is self-contained (its own Vite dev server on :5199, `VITE_MOCK=true`, root `base`), so it is
evidence that the *toolchain* is healthy and that the portal's red lanes are portal-specific defects rather
than a broken harness.

### 6.6 Build — GREEN

`npm run build` → exit 0. `vite v7.3.6`, portal `✓ built in 3.13s`, `asset-manifest.json generated`, admin
`✓ 30 modules transformed … ✓ built in 649ms`, final line `[build-all] done: build/ (portal + balance) and build/admin/`.
Artifacts as listed in §2.3. No service-worker plugin runs because none is installed.

### 6.7 CI reality vs. the red lanes

`.github/workflows/ci.yml` runs two jobs:
* `anti-leak` — greps the whole tree for company-branding tokens and fails if present (`ci.yml:13-27`).
* `unit-tests` — `npm ci` → five packaging shell guards → **`npm test`** → `foreign-skins-guard.sh` → `npm run build`
  (`ci.yml:29-95`).
* `e2e-tests` — `npm ci` → `npx playwright install --with-deps chromium` → `npm run build` → starts `npm run dev &` → admin credential guard → admin settings-network → **`npx playwright test tests/e2e/functional.spec.mjs --project=desktop`** (mandatory) → `visual.spec.mjs … || true` (informational) (`ci.yml:97-153`).

So CI's **mandatory** lanes are `npm test` (§6.3, RED: OOM + 5 failures) and `functional.spec.mjs --project=desktop`
(§6.4, 4 of its 6 tests RED). **Both mandatory gates are currently failing on `main` — unless CI is green,
which it cannot be if it runs the same commands.** The workflow file itself acknowledges the unit-suite state
in a comment: *"the vitest run is currently red on main for a heap OOM in the full-suite process"*
(`ci.yml:47-48`) — the packaging guards are deliberately sequenced **before** `npm test` so a red vitest run
cannot mask them. That comment is the repo admitting the defect in-tree; it is accurate and still true.

---

## 7. Cashu client library and which NUTs the client actually calls

**Package:** `@cashu/cashu-ts` **exactly `2.9.0`** — pinned with no caret (`package.json:21`), resolved to
2.9.0 in the lockfile, and confirmed installed at
`node_modules/@cashu/cashu-ts/package.json`.

**Upstream status:** `npm ci` prints, verbatim:

```
npm warn deprecated @cashu/cashu-ts@2.9.0: Unsupported: v2 and earlier are obsolete and are not compatible
with current mints. Upgrade with: npm i @cashu/cashu-ts@^4
```

The repo knows this and has a written policy — `README.md:129-143`, *"cashu-ts dependency policy
(2026-09-05)"* — pinning `^2.2.2`, requiring the upstream migration guide + the in-package
`migration-X.0.0.SKILL.md` before any major bump, and listing v4 break classes that "already cost
Amperstrand sessions" (Amount value objects, ESM-only, `getDecodedToken` keyset-id requirement, melt-change
strictness as a *fund-loss class*). So the version is a deliberate, documented pin — but it is a pin on an
upstream-abandoned major, which is a real risk for a wallet that must talk to live mints.

**Surface actually used — decode only. No mint calls.**

```js
// src/helpers/cashu.js:2
import { getTokenMetadata, getDecodedToken } from "@cashu/cashu-ts";
// src/helpers/mint-fee.js:9
import { getTokenMetadata, getDecodedToken } from "@cashu/cashu-ts";
```

`grep -rn 'CashuWallet\|CashuMint\|@cashu' src/ tests/` → **no `CashuWallet`, no `CashuMint`, anywhere.**
The client does **not** construct a wallet, does not hold proofs, does not swap, does not mint, does not melt,
does not restore. Every use of the library is a pure decode/summarise:

| Symbol | Call site | What it is for |
|---|---|---|
| `getTokenMetadata(token)` | `src/helpers/cashu.js:211` (primary in `validateToken`), `:135` (`mintUrlFromToken`), `src/helpers/mint-fee.js:64` | keyset-agnostic decode that works **without** the mint's keyset list |
| `getDecodedToken(token)` / `getDecodedToken(token, keysets)` | `src/helpers/cashu.js:138, 215` (fallback), `src/helpers/mint-fee.js:34` | structural fallback for multi-entry V3 shapes; the keysets form is used to map v4 short keyset ids |
| `getEncodedToken(...)` | tests only (`tests/unit/cashu-submitToken.test.js:12`, `cashu-validateToken.test.js:2`, `mint-fee.test.js:2`, `cashu-mint-url.test.js:2`, `cashu-auto-select-mint.test.jsx:3`) | build fixtures |

### NUTs actually exercised by the client

* **NUT-00 (token format / CBOR)** and **NUT-02 (keysets & keyset ids)** — *decode only*. The client reads
  token CBOR and resolves short vs full keyset ids, but never fetches keys and never verifies a signature.
* **NUT-12 (DLEQ)** — **not verified client-side.** `extractProofsFromToken` explicitly notes the proofs it
  pulls out of `getTokenMetadata(...).incompleteProofs` are *"real proofs (secret, C, amount, dleq) with their
  keyset id intentionally stripped — sufficient to sum the token value for display; **presence does not imply
  DLEQ validity**"* (`src/helpers/cashu.js:37-43`). DLEQ validation is the merchant's job.
* **NUT-06 (mint info) / keyset fees via `GET /v1/keysets`** — **the one real HTTP call the client makes to a
  mint.** `src/helpers/mint-fee.js:68`:
  ```js
  const response = await fetch(`${mint.replace(/\/+$/, "")}/v1/keysets`);
  ```
  It reads `keyset.id` and `keyset.input_fee_ppk`, sums `input_fee_ppk` across the token's proofs, and
  computes `fee = Math.ceil(ppk / 1000)` to match the backend wallet's `feesForProofs`
  (`src/helpers/mint-fee.js:3-7, 74-110`). The comment at `:168-169` of `src/components/Cashu.jsx` says the
  endpoint is CORS-open. **This is the only mint-facing call in the entire client.**
* NUT-03/04/05/07/08/09/10/11/13/14/15/16/17/18/19/20/21 — **none.** No swap, no melt, no mint, no split, no
  state check (`NUT-07`), no restore (`NUT-09`), no P2PK, no DLEQ proof fetch, no WebSocket subscription.
* The *merchant* side does the redeeming — per the in-repo-derived recon, the router swaps the note at the
  mint via `gonuts-tollgate`/`cdk-go` behind a `WalletPort` seam. The browser is a **display-and-forward**
  client: decode → validate shape → POST raw token → trust the router.

**Consequence for the wallet goal:** the wallet work is not an extension of the existing Cashu usage — it is a
**new** integration. Going from "decode a note" to "hold proofs, top up, auto-pay an invoice" means adding
`CashuWallet`/`CashuMint`, NUT-09 restore, NUT-07 state checks, a proof store, and a persistence layer, none of
which has any precedent in this codebase today.

---

## 8. Gap list for the PWA + wallet goal

Ordered by dependency, not by size. **S** = days, **M** = 1–2 weeks, **L** = multi-week / needs a protocol
decision. "Separate PR?" is my recommendation for keeping each independently revertable.

| # | Gap | Size | Separate PR? | Why / evidence |
|---|---|---|---|---|
| 1 | **Fix the two red test lanes before touching anything else.** (a) Replace the unstable `t` mock in `src/test/setup.js:3-13` with an identity-stable one so `src/components/__tests__/Cashu.race.test.jsx` stops OOM-ing; (b) add the 4 missing exports (`canSubmitAnyway`, `mintUrlFromToken`, `findMintOption`, `normalizeMintUrl`) to `CASHU_HELPER_STUB` in `tests/e2e/helpers/mock-backend.mjs:22-31`; (c) give `renew-after-expiry.test.jsx:40-49` the same missing exports. | **S** | **Yes — its own PR, first.** | §6.3/§6.4. Both mandatory CI gates (`ci.yml:92`, `ci.yml:140`) are red at `c2ddba1`. Every subsequent wallet PR will be unreviewable behind a red baseline, and a contributor cannot tell their breakage from the pre-existing red. Cards `t_2098c3cc`, `t_89aa8777`, `t_77c85d4c` already exist for this; they can be closed by this one PR. |
| 2 | **Regenerate / repair the lockfile so `npm ci` works on npm ≥ 11**, and pin the toolchain (`.nvmrc` or `packageManager`) + fix `README.md:25-26` which currently says "v10.9.2 or later". | **S** | Yes. | §6.2. The install step is the very first thing a new contributor runs and it fails on any current Node. Low risk, high leverage. |
| 3 | **Decide and implement the portal's transport.** This is the gating decision, not an implementation detail: service workers, `beforeinstallprompt`, Cache API, and durable IndexedDB require a **secure context**, and the portal is plain HTTP `:2051` (`src/helpers/tollgate.js:12-15`; `packaging/.../92-tollgate-admin-setup:75`). Options: (a) give the portal the same TLS treatment the admin board got (`/etc/tollgate/ssl/server.{crt,key}`, guarded by `tollgate ssl covers`) — but the certificate must be *client-accepted*, which for a captive portal means a captive-portal-detection-compatible story, not just a self-signed cert; (b) accept an iOS-only / manual-add-to-home-screen PWA; (c) a non-HTTP install rail. | **L** (decision) + **M** (impl) | Decision first (ADR), then impl. | §2.4. This is the item the in-repo `docs/pwa-client-wallet-plan.md` **does not mention at all** — Option A there is "Low — add `vite-plugin-pwa` + manifest icons", which is wrong: without a secure context you get no SW and no install prompt no matter how many icons you add. |
| 4 | **Add the service worker + offline app shell** (`vite-plugin-pwa` with `injectManifest`, or a hand-written `sw.js`), with an explicit precache allow-list. | **M** | Yes — depends on #3. | §2.1/§2.5. The plan doc's own risk row is right: *"Service-worker caching of a captive-portal app can serve a stale shell across releases — version the SW and force an update on `splash.html`"* (`docs/pwa-client-wallet-plan.md:106-107`). The precache allow-list must **exclude** anything on the money path; never cache `POST :2121/`, `GET /ln-invoice?quote=…`, `/balance`, `/usage`, or `/whoami` — a cached `/usage` `-1/-1` or a cached balance would make the portal lie about entitlement, and a cached 2xx on the payment POST would fake a purchase. |
| 5 | **Reconcile `start_url` with `splash.html`, and add `scope` + `id` + a maskable icon.** `public/manifest.json:23` must point at the built entry, and the two deployment shapes (`rename-html` for the router vs raw `vite build` for gh-pages, §2.3) must both resolve. Also drop the fake `72x72` favicon entry (`:18-21`), add `purpose:"maskable"`, and align `background_color` with the dark theme (`:26` vs `index.html:10`). | **S** | Yes — cheap and independently valuable. | §2.2/§2.3. Without an `id`, fixing `start_url` later orphans existing installs. |
| 6 | **Add the "we are an app, save me to your home screen" onboarding UX** — the introduce-itself step. Nothing exists: `grep beforeinstallprompt|appinstalled|addToHomeScreen|display-mode` → 0 matches, and `public/locales/en.json` has **no** install/home-screen/offline key among its 140 keys (the only near-hit, `lightning_open_wallet`, is unrelated). | **M** | Yes — depends on #3/#4. | §2.1. Must be written defensively: no `beforeinstallprompt` exists on iOS Safari at all, so this needs an iOS-specific "Share → Add to Home Screen" instruction path, and it must not be shown inside `display-mode: standalone` (i.e. don't nag an already-installed app). |
| 7 | **Build the persistence layer.** There is none (§3.1). Needed: an IndexedDB-backed store for the held ecash proofs and the wallet's own bookkeeping (mint URL, keysets cache, what was already paid), plus `navigator.storage.persist()` to fight eviction. | **M** | Yes. | §3.1. Constraint to design for, straight from the plan doc's risk row: *"IndexedDB eviction on constrained mobile browsers — design for zero client balance as a valid state"* (`docs/pwa-client-wallet-plan.md:108-109`). |
| 8 | **Build the client wallet itself** — `CashuWallet`/`CashuMint`, NUT-09 restore on load, NUT-07 state checks before spending, a proof store, and a clear separation between "held balance" and "session allowance". Today the client does **decode only** (§7) — this is greenfield, not an extension. | **L** | Yes — the big one. | §7. Also carries the `cashu-ts` version decision: the pinned 2.9.0 is upstream-deprecated and "not compatible with current mints" (§7), so this PR must either absorb the v4/v5 migration (with the documented fund-loss classes from `README.md:129-143`) or justify staying. |
| 9 | **The seed-phrase threshold policy.** Requirement: do **not** harass the user with a seed phrase unless held balance exceeds a meaningful threshold. Design implication: the wallet needs to be usable **unbacked** (zero-friction, generate-and-forget, treat held ecash as disposable), with backup demanded only on crossing a threshold — and that threshold, plus the "you will lose this if you clear your browser" framing, belongs in the i18n set (which has no such keys today, §6/#6). | **M** | Can ride with #8 at first, but the *policy* should be an ADR before the code. | This is the requirement most likely to be implemented wrong by default, because the conventional Cashu client flow (generate mnemonic → force backup → then use) is exactly the friction the goal forbids. Also note the honesty constraint the plan doc already states: *"a bearer wallet in a browser over a captive HTTP network is a theft/durability target (XSS, shared device, storage eviction), so it must not be presented as 'your money is safe here'"* (`docs/pwa-client-wallet-plan.md:66-69`). |
| 10 | **The incremental / repeated top-up rail.** The requirement is "many small frequent top-ups to one session." Today the payment is one-shot: one full token → one swap → one session grant (§4.1), and the only per-amount rail is the Lightning invoice loop (§5). The plan doc's own verdict is that this is the **High**-effort item and that the architecturally correct answer is Spillman/Cashu channels, gated on *"the wallet must run on CDK and a channel-capable client wallet must exist"* — and that a bespoke drip protocol must **not** be bolted on meanwhile (`docs/pwa-client-wallet-plan.md:54, 71-79`). | **L** | Yes — and it is gated on a module-side decision, not just portal work. | §4.1/§5.4. Note the portal has **no `/session` consumer** (§5.4) and the module's session store is memory-only, so the loop's "did my last top-up land?" signal has to be built from what exists (`/balance`, `/usage`, `/ln-invoice?quote=`) or added. |
| 11 | **Close the latent token leak on `window.__INITIAL_TOKEN__`.** It is set at `index.html:31`, read once at `src/components/Cashu.jsx:30`, and never cleared — so the raw bearer note stays readable on the window for the document's lifetime even though the URL was scrubbed (`index.html:33-34`). | **S** | Yes. | §3.3. Small, security-relevant, and it becomes materially worse once a wallet and a service worker are both resident in the same document. |
| 12 | **Delete the dead `nostr-tools` import** at `src/helpers/cashu.js:3` (and the unreachable `CU105` strings at `public/locales/en.json:98-99`) once the raw-token path is confirmed settled. | **S** | Fold into #8. | §4.1. Evidence: three imported symbols, zero references outside the import line; `Content-Type: text/plain` raw POST is the shipped behaviour, so no event is ever signed client-side. |
| 13 | **Correct the drifted documentation**, so the next reader does not build on a false premise: `docs/pwa-client-wallet-plan.md:34` (and kanban `t_4c9e37ed`) describe the payment as a signed kind-21000 Nostr event; the code posts a bare token with `Content-Type: text/plain` (§4.1). | **S** | Yes. | §4.1. This one is not cosmetic — the whole "full token per event" framing that the incremental-billing analysis is built on comes from that inaccurate row. |
| 14 | **Harden the Lightning poll loop** if it is to become the wallet's payment-ack loop: it currently polls every 2 s forever, ignores the `expiry` field it receives, has no backoff, and does not stop on repeated errors (`src/components/Lightning.jsx:103-133`). | **S** | Yes. | §5.2. A wallet doing "many small frequent top-ups" multiplies this loop by N; an un-hardened version is a battery and gateway-load problem. |
| 15 | **Re-check the CSP against real mint traffic.** `index.html:12` sets `connect-src 'self' http: ws:` — the `http:` scheme-source does not cover `https:`, and the wallet will add cross-origin **https** calls to mints. `balance.html` ships no CSP at all. | **S** | Fold into #8. | §2.5. The one existing mint call (`/v1/keysets`, `src/helpers/mint-fee.js:68`) is described as CORS-open, but CSP is enforced client-side, not by CORS. |

### 8.1 The three things most likely to derail the project

1. **Secure context (#3).** If the portal cannot be served over an acceptable HTTPS origin, then "installable
   PWA" is not achievable in Chrome/Android *at all*, and the onboarding story in #6 has to be rewritten for
   iOS-manual-add only. Everything in #4, #6 and #7 is downstream of this. **This should be an ADR before any
   code.** The in-repo plan doc currently mis-sizes it as a Low-effort items-list item.
2. **The red baseline (#1) + the deprecated library (#8).** The repo's two mandatory CI gates fail at the tip,
   and its Cashu library is upstream-deprecated with a documented fund-loss class in the migration path. Doing
   wallet work on either is a compounding risk: you cannot tell your regressions from the pre-existing red, and
   the lowest-risk moment to migrate the library is *before* there is any proof store to migrate.

---

## Appendix A — Recon commands (reproducible)

```bash
mkdir -p ~/repos ~/reports/pwa-cashu
cd ~/repos && git clone https://github.com/OpenTollGate/tollgate-captive-portal-site.git
cd tollgate-captive-portal-site && git rev-parse HEAD     # c2ddba1218a653c0ef09d7857495e580d8865aff

# a second clone so the primary stays pristine for read-only citation
cd ~/repos && git clone tollgate-captive-portal-site tollgate-portal-work
cd ~/repos/tollgate-portal-work
npm ci                                     # FAILS on npm 11 (see §6.2)
npx npm@10.9.2 ci                          # succeeds (pinned engine)
npm run build                              # EXIT 0
npm test                                   # EXIT 1 — OOM + 5 failures (§6.3)
NODE_OPTIONS=--max-old-space-size=4096 npm test        # still EXIT 1 — OOM
NODE_OPTIONS=--max-old-space-size=1024 timeout 240 \
  npx vitest run src/components/__tests__/Cashu.race.test.jsx   # OOM alone in 3m18s
npx playwright install chromium
npx playwright test --project=desktop      # 3 passed / 10 failed (§6.4)
npx playwright test --config admin/playwright.config.mjs admin-credential-guard   # 4 passed (§6.5)
```

## Appendix B — Primary citations index

| Claim | Citation |
|---|---|
| Tip SHA | `git rev-parse HEAD` → `c2ddba1218a653c0ef09d7857495e580d8865aff` |
| Versions | `package.json:20-47`; `node_modules/{vite,vitest,@playwright/test,@cashu/cashu-ts}/package.json` |
| No service worker | repo-wide grep (0 code matches); `find build -name '*sw*'` (empty) |
| Manifest contents | `public/manifest.json:1-27` (esp. `:23` start_url, `:24` display, `:26` background) |
| Entry rename to splash.html | `package.json:18`; verified `build/splash.html` + `build/asset-manifest.json` |
| `start_url` not rewritten | `package.json:18` (rewrites only `asset-manifest.json`); `public/manifest.json:23` |
| Demo host ships `index.html`, router ships `splash.html` | `.github/workflows/deploy-demo.yml:28-30`; `git ls-tree origin/gh-pages \| grep splash.html` → 0 |
| Portal is plain HTTP :2051 | `src/helpers/tollgate.js:12-15`; `packaging/files/etc/uci-defaults/92-tollgate-admin-setup:75`; `openwrt/files/etc/config/uhttpd_admin:47` |
| Secure-context constraints already felt | `src/helpers/qr-code.js:11-22`; `src/components/Cashu.jsx:403,414`; `README.md:118-119` |
| Admin board HAS TLS, portal does not | `openwrt/files/etc/config/uhttpd_admin:52-54`; `packaging/.../92-tollgate-admin-setup:64-76` |
| CSP | `index.html:12`; `balance.html` (none) |
| Zero persistence | `grep -rnE 'localStorage\|sessionStorage\|indexedDB\|idb\|cookie' src/ index.html balance.html public/` → 0 |
| Token delivery + strip | `index.html:25-42` (esp. `:28-35`) |
| Token read + auto-submit | `src/components/Cashu.jsx:30-31`, `:54-58`, `:220-238` |
| The paid request | `src/helpers/cashu.js:301-308` |
| Response handling + error mapping | `src/helpers/cashu.js:310-428` (byCode map `:343-347`) |
| Dead nostr-tools import | `src/helpers/cashu.js:3`; symbol refs only on that line |
| Lightning endpoints | `src/helpers/lightning.js:21-41, 58-68, 92-98` |
| Poll interval 2 s, no expiry honouring | `src/components/Lightning.jsx:103-133` (interval at `:127`) |
| No bolt11/lnurl/`/session` vocabulary | `grep -rniE 'bolt11\|lnurl\|/session'` → 0 |
| build+test commands | `package.json:5-19`; `vitest.config.js:1-13`; `playwright.config.js:1-53`; `admin/playwright.config.mjs` |
| CI lanes + the in-tree admission of the red vitest run | `.github/workflows/ci.yml:13-95` (comment `:47-48`), `:97-153` |
| OOM root cause | `npm test` output; `tests/unit/renew-after-expiry.test.jsx:19-25`; `src/test/setup.js:3-13`; `src/components/Cashu.jsx:52,72,81,101,133,165,238` |
| e2e stale-stub defect | `tests/e2e/helpers/mock-backend.mjs:22-31, 52-58`; `src/components/Cashu.jsx:16`; real export list from `src/helpers/cashu.js` |
| cashu-ts version + deprecation | `package.json:21`; `npm ci` warning; policy `README.md:129-143` |
| Only mint-facing call | `src/helpers/mint-fee.js:68` (`GET /v1/keysets`) |
| Prior artifacts | `docs/pwa-client-wallet-plan.md` (PR #69, `f52a4c8`/`b0a8287`); kanban `t_4c9e37ed`, `t_75993017`, `t_2098c3cc`, `t_89aa8777`, `t_77c85d4c` on board `tollgate-captive-portal-site` |
