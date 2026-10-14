# ADR DELTA — client-side Cashu wallet in the captive-portal PWA

**Status:** Proposed (2026-10-14). Documentation only. **Do not implement** until
(a) the operator signs off on D1–D4 below, (b) the `v0.6.0-rc1` release gate the
prior plan already sets has cleared, and (c) for the channel rail only, the ADR's
own CDK/Spillman migration gate has cleared.

**Governing document:** `OpenTollGate/tollgate-module-basic-go`
`docs/architecture/session-ticket-decision.md` — specifically its
**Amendment R1–R6** (2026-09-24), which the document itself declares governs
where the body conflicts with it. This delta does not amend R1–R6 and does not
reopen the held session-ticket rebind. It records how a client wallet can exist
*under* those rules, and it states the loss-bounding mechanism precisely.

**Related:** this repo's `docs/pwa-client-wallet-plan.md` (Proposed 2026-10-10,
merged as PR #69). That document frames the goal and the option set; **this
delta supersedes its §4 effort sizing and its §5 Option A framing**, both of
which this delta measures as wrong (see §3).

**Baselines read for this delta** (all re-verified at write time):

| Artefact | Revision | How the revision was obtained |
|---|---|---|
| `tollgate-captive-portal-site` | `c2ddba1218a653c0ef09d7857495e580d8865aff` | `git rev-parse HEAD` in a clone of `main` |
| `tollgate-module-basic-go` | `cf7cad34677e87e775e7f16786b1bbf18c4bc8bc` | `git rev-parse HEAD` (`VERSION` = `v0.6.0-rc4`) |
| `cashu.me` | `e21f5fab875b67de0fc5367a79710054d2c1f80f` | `git rev-parse HEAD` |
| `cashu-ts` (dev branch) | `145d2426d5071f2c321a6ec1171a5ce1c1ea0466` | `git rev-parse HEAD`; `package.json` version `5.0.0-rc.11` |
| `@cashu/cashu-ts` 2.9.0 (the portal's pin) | npm tarball | `package.json:21`, `package-lock.json` |
| `@cashu/cashu-ts` 4.9.0 / 4.11.0 (npm) | npm tarballs | `registry.npmjs.org`; unpacked `lib/types/index.d.ts` + `etc/cashu-ts.api.md` |

**Citation rule used throughout:** every claim is followed by a `path:line`, a
grep command, or a doc URL. Where a fact could not be measured it is labelled
`UNMEASURED` with the reason, not asserted. Claims sourced from the four
recon dossiers are marked `[D:module]`, `[D:portal]`, `[D:wallet]`,
`[D:rails]`; those dossiers are reproduced in the pull request body, and each
`path:line` in them was re-derived from primary source in the recon they
document.

---

## 1. Scope and the four decisions

This delta answers the four decisions the prior plan left open (§8 of
`docs/pwa-client-wallet-plan.md`), plus the seed-threshold question — whose
answer was **reversed by operator decision on 2026-10-14** (§5.4) — and it
records one dependency decision that the prior plan did not anticipate. It also
carries the two sections the operator mandated afterwards and which this delta
consolidates to the default branch as part of this PR: **background autonomy**
(§6.6, the requirement that the PWA buy internet for the user instead of making
the user buy internet) and the **secret-storage decision** (§5.6).

| # | Decision | Status |
|---|---|---|
| **D1** | How "roam/rotate without losing significant money" is implemented under R1–R6 | **Answered here (§2).** Rule: no cross-address carry-over; bound the loss with a small granule plus client-held unspent ecash. |
| **D2** | Scope now vs. after the release | **Answered here (§6).** WS-1 and WS-2 in one consolidated portal PR after the release; WS-3 is a separate module PR; WS-4 tracked only. |
| **D3** | The secure-context question | **Answered here (§3).** It is not a spike to run — it is a measured structural constraint with a decided consequence. |
| **D4** | The seed threshold `T` | **Answered here (§5).** **A resting balance is REQUIRED by operator decision (reversed 2026-10-14)** so the user never has to interact with the PWA or the portal when the balance runs out; `T` is the **CAP on that resting balance**, not a threshold at which to prefer zero. `T` remains a policy constant and is operator-tunable. |
| **D5** | The `cashu-ts` version: portal pins `2.9.0`, the wallet needs `4.11.0` | **Answered here (§4).** Buy the migration package alone; put the wallet behind a lazily-imported dynamic chunk; never make the existing portal import path load the new major. |

Out of scope, as set by the card and by the ADR: no production code, no service
worker, no wallet implementation, and no merge to any `OpenTollGate/*` `main`.

---

## 2. D1 — the reconciliation: granularity, not carry-over

### 2.1 The tension, stated exactly

The operator's framing and the governing ADR disagree on the *mechanism* that
keeps a roaming customer from losing money:

- The observed framing is that the client wallet **carries the session or the
  balance forward** across an AP change or a MAC rotation.
- The ADR's **R1** says the opposite: *"Entitlement belongs to one address for
  the lifetime of the purchase that paid for it. Nothing carries across
  addresses: no meter ledger, no `StartTime`, no session record, no credit."*
  (`docs/architecture/session-ticket-decision.md`, Amendment R1.)

Implementing the first literally would reopen the exact design the ADR held
(the session ticket and its rebind flow exist *only* to make a rebind safe —
same document, Amendment preamble: the ticket, the rebind flow and Invariants
1–2 are *"held, not withdrawn"*). It would also contradict **R2**, which forbids
any record naming two customer addresses together, **R3**, which forbids
automatic rotation handling, and **R5**, which requires a client to close before
rotating and forbids presenting an existing channel after a rotation.

### 2.2 The rule this delta adopts

> **No session carry-over across addresses. The loss on a rotation is bounded by
> the granule size plus the unspent ecash the client still holds.**

Concretely, the mechanism has three parts and none of them creates a join:

1. **The granule is small.** A purchase buys a small, fixed amount of access
   (one "step" or a small multiple of it). A rotation mid-purchase therefore
   forfeits at most one granule — never a session's worth of value. This is the
   ADR's own sanctioned answer, verbatim: *"small, granular purchases bound the
   loss from a rotation mid-purchase"* (R1 reasoning, item 1 of the list).
2. **The unspent balance lives at the mint, not on the router.** The client
   holds bearer ecash. What is *not* yet spent into a granule is untouched by
   the rotation, because the router never held it and never recorded it. The
   router custodies nothing: `PurchaseSession` swaps the note at the mint at the
   instant it is paid, so the operator's wallet holds the value and the client
   holds no remainder *today* `[D:portal §4.4]` — the change this delta proposes
   is that the client keeps its change and buys the next granule from it.
3. **After rotation the client simply buys again at the new address.** A fresh
   `POST /` from the new socket-resolved address is a new purchase under R1. No
   ticket is issued, no rebind occurs, no old address is named. R3 is satisfied
   because nothing about the rotation is handled *automatically on the router
   side* — the customer's own device initiated it, and the client wallet's
   decision to buy again is the "explicit customer action" the rule requires,
   disclosed in the panel §7.3 mockup's plain-language line.

### 2.3 What this means for the earlier "carry the balance forward" reading

The two framings are reconcilable, and the reconciliation is the whole design
value: **"the client carries the balance forward" is true of the client and
false of the router.** The client's ecash survives the rotation because it was
never the router's to lose. What does *not* survive is the router-side
entitlement — and it does not need to, because the client's answer to a lost
entitlement is to spend another small granule, not to ask the router to
remember.

This preserves the privacy primitive rather than fighting it. R1's stated reason
is that *"MAC rotation between purchases is the product's privacy primitive"*
(“encourage rotation, never require it, and never link two addresses”). A design
that carries entitlement across addresses turns rotation into a liability and
creates precisely the two-address record R2 forbids. A design that re-buys turns
rotation into a cost of one granule and creates nothing.

### 2.4 The three rules the implementation must obey

These are the acceptance conditions for any code that follows, and they are
directly checkable in review:

1. **No durable per-address entitlement record.** The only durable client-facing
   record today is *money recognition*, never *entitlement*: `quotes.json`,
   `owed-grants.json` and `receive-intents.json` exist and store **no session
   allotment**; there is *no* `allocations.json` or granted-and-consumed ledger
   anywhere in the tree `[D:module §4]`. Any wallet PR that adds one is
   implementing the join R2 forbids and must be rejected. (This is also why
   **refunds stay unadopted**: the ADR rules them out because paying a customer
   back *"requires a durable per-address record of owed value, which is the
   exact join R2 forbids"* — same document, "Refunds considered and not
   adopted".)
2. **The client's progress signal is `/usage`, not a server-side promise.** The
   customer's own remaining counter is their detection surface (R1 reasoning,
   item 2), and `GET /usage` already answers the bare string `used/allotment`
   and `-1/-1` when there is no session (`src/main.go:1189`, `:1212-1213`;
   `[D:module §2.3]`). The client wallet's "did my top-up land?" test must be
   built from `/usage`, `/balance` and `/ln-invoice?quote=`, because **the
   portal has no `/session` consumer at all** — `grep -rniE 'bolt11|lnurl|/session'`
   over `src/ tests/ public/` returns 0 hits `[D:portal §5.4]`.
3. **No auto-rebind, ever, and no channel resumed across an address.** R3 and
   R5, taken literally. A client that finds a channel or a ticket and presents
   it from a new address must get the ADR's answer: the router treats it as
   unrelated.

### 2.5 The known cost, stated plainly

The customer *does* pay for a rotation, and the design does not pretend
otherwise. The loss is bounded by the granule, not eliminated. If the product
later wants to eliminate it, the only mechanism the ADR sanctions is the
**channel close** — *"Closing the channel is the client's own way to end a
session early … the unspent remainder therefore never passes through the router,
and no durable per-address record of owed value is needed"* — and that is gated
on the CDK/Spillman migration gate (D2/WS-4, §6).

---

## 3. D3 — the secure-context finding: what install and offline paths are possible

This is the hardest structural constraint in the project, and the prior plan
mis-sized it as a low-effort, low-risk first step. It is not a spike to run; it
is measured.

### 3.1 The measurement

**The portal is served over plain HTTP on port 2051, not HTTPS.**

- `src/helpers/tollgate.js:12-15` — `getPortalBaseUrl()` returns
  `` `http://${currentHost}:2051` ``, with the comment *"the captive portal SPA
  itself is served on port 2051 (nodogsplash htdocs)"*.
- `packaging/files/etc/uci-defaults/92-tollgate-admin-setup:75` — *"the captive
  portal is uhttpd.portal (:2051)"*.
- `openwrt/files/etc/config/uhttpd_admin:47` — *"The captive portal stays on
  uhttpd.portal (:2051); it is NOT touched here."*
- An exhaustive grep for a portal-over-TLS path returns nothing: the admin board
  got TLS (`/etc/tollgate/ssl/server.{crt,key}`, `uhttpd_admin:52-54`) and the
  portal was **deliberately left out** of that migration `[D:portal §2.4]`.

### 3.2 Why that is decisive, not cosmetic

Service workers, `beforeinstallprompt`, the Cache API,
`navigator.storage.persist()`, Web Crypto-backed key material, and
IndexedDB-with-persistence are **all secure-context-gated**. On
`http://192.168.x.y:2051` there is no path to a Chrome/Android install prompt
*at all*.

The app already feels this constraint in two places and degrades rather than
upgrading the transport, which is the strongest available corroboration:

- `src/helpers/qr-code.js:11-22` — `hasCameraSupport()` feature-detects
  `navigator.mediaDevices.getUserMedia`, *"only exposed in a secure context"*,
  and the camera button is hidden when absent (`src/components/Cashu.jsx:414`).
  The file comment says it outright: *"Captive portals serve over plain HTTP, so
  on Firefox/Brave/Chrome the property is `undefined`."*
- `src/helpers/clipboard.js` — the paste button is gated on
  `hasClipboardSupport()` for the same reason (`src/components/Cashu.jsx:403`).
- `README.md:118-119` carries it as an open discussion topic.

There is currently **zero** install affordance of any kind and no way for the
app to know it was installed: `grep -rn 'beforeinstallprompt\|appinstalled\|addToHomeScreen\|getInstalledRelatedApps\|display-mode' src/ *.html public/ tests/`
→ **0 matches** `[D:portal §2.1]`.

### 3.3 What IS possible, and what is NOT — the table this card requires

| Path | Possible on HTTP-on-IP today? | Why |
|---|---|---|
| **Service worker registration** | ❌ **NO** | `navigator.serviceWorker` is undefined in a non-secure context. Non-negotiable; it is the spec, not a browser quirk. |
| **Chrome/Edge/Android install prompt (`beforeinstallprompt` → WebAPK)** | ❌ **NO** | Chrome requires a registered SW **with a fetch handler**; without a secure context there is no SW, so the install affordance never appears. |
| **Cache API / offline app shell** | ❌ **NO** | Same secure-context gate. |
| **`navigator.storage.persist()` (eviction protection)** | ❌ **NO** | Secure-context-gated. |
| **iOS Safari "Add to Home Screen" (manual)** | ✅ **YES, manually** | iOS's share-sheet Add-to-Home-Screen does not require a SW. It is user-driven, not a prompt the page can raise. It yields a **standalone-launching, online-only** app: there is still no offline shell, because there is no SW. |
| **App-like standalone launch** | ✅ **YES, if added to home screen** | `public/manifest.json:24` declares `display: "standalone"`, and the manifest is linked from both HTML entries (`index.html:14`, `balance.html:13`). |
| **IndexedDB / localStorage as a proof store** | ✅ **YES, but evictable** | Storage itself is not secure-context-gated; *persistence* is (see below). |
| **`getUserMedia` (QR scanning)** | ❌ **NO** | Already degrades — the camera button is hidden (`src/helpers/qr-code.js:11-22`). |
| **Clipboard API (paste button)** | ⚠️ **DEGRADED** | Already handled — the paste button is gated (`src/helpers/clipboard.js`). |

### 3.4 The options, and the dead end this delta must NOT recommend

An earlier pass of this delta named **option (a) "serve the portal over TLS with a
certificate the client will accept"** as the only path to a real service worker and a real
install prompt. **That option is measured to be a DEAD END and is withdrawn as a
recommendation.** It failed for two independent reasons, and the second one does not go
away on any hardware we control `[D:origin §1.2, §1.3]`:

- **A self-signed certificate produces a secure context and NOT a service worker.**
  Measured after a *real* user click-through (headed Chrome for Testing 156.0.8078.4 under
  Xvfb+openbox; `xdotool` moved the real pointer to `Advanced` at (389, 682) and then to
  `Proceed to 192.168.2.20 (unsafe)` at (443, 798)) on `https://192.168.2.20:8444/`:

  ```
  isSecureContext: true
  hasCryptoSubtle: true   hasCaches: true   hasPaymentRequest: true   hasIndexedDB: true
  swRegister: {"ok": false, "error": "SecurityError: Failed to register a ServiceWorker
    for scope ('https://192.168.2.20:8444/') with script ('https://192.168.2.20:8444/sw.js'):
    An SSL certificate error occurred when fetching the script."}
  ```

  **"Is it a secure context" and "can I install a PWA" are different questions.** A
  user-clicked exception satisfies the first and **never** the second. This is also why
  the earlier secure-context spike could not see it: that spike ran with
  `--ignore-certificate-errors`, which suppresses the error at the **network layer** and
  therefore silently skips the service-worker gate. Full chain, per gate, in **§3.6.1**.
- **No public CA will issue a certificate for a LAN IP or an internal name.** CA/Browser
  Forum baseline requirements require control of a *domain* and forbid internal names and
  IP literals for publicly-trusted certificates, and there is no ACME challenge path for
  `192.168.1.1` (Let's Encrypt, *"Certificates for localhost"*). "Just get a real cert for
  the router" is therefore **not available either**. The split-horizon alternative (point a
  real name's A record at a private address) costs more than it buys: it breaks for any
  guest whose resolver or DoH disagrees with ours, and it puts the ACME private key plus a
  **standing renewal liability on an offline/WAN-less box** — which is exactly the TollGate
  deployment shape. See **§3.6.3**.

- **(b) An iOS-only / manual-add-to-home-screen PWA.** Costs nothing to build; delivers no
  offline story, no service worker and no Android install prompt. **Description unchanged**;
  it remains the *fallback*, not the recommendation.
- **(c) A non-HTTP install rail** (e.g. an app-store or side-loaded shell). Out of scope;
  recorded so it is not rediscovered. **Description unchanged.**
- **(d) NEW — the recommendation: the PUBLIC HTTPS VENDOR ORIGIN,
  `https://portal.orangesync.tech`.** The operator has agreed to host the PWA there with a
  publicly-trusted ACME certificate, and the portal splash page on `:2051` **deep-links** to
  it with the gateway identity in the URL (`?gw=<ip>&port=<p>&mac=<mac>&nonce=<n>`). This is
  the only option that is **measured end-to-end today with no new infrastructure**: the
  install prompt, the service worker and the wallet's IndexedDB all become available at
  once, because the origin is trustworthy by scheme *and* the certificate is publicly
  verifiable. Its price is that the router call becomes **cross-origin** — a real,
  non-obvious gate that has its own name and its own permission, documented in full in
  **§3.6**, which is where the crux of this design actually lives.

**Recommendation: build on (d), keep (b) as the degraded fallback, and strike (a) as a path
that must not be re-proposed.** The prior plan's Option A (*"Low — add `vite-plugin-pwa` +
manifest icons"*, `docs/pwa-client-wallet-plan.md:52`) is unachievable **on `:2051`** for
the same reason as before — no secure context, so no SW and no install prompt no matter how
many icons are added — and achievable **only** on the vendor origin. The practical
consequence for WS-1 changes in substance while keeping its shape: WS-1 is still
**"app-like presentation + manual add-to-home-screen guidance"** for the `:2051` splash,
because that page can never itself be a PWA — but it now has a **destination**, so its job
becomes a deep-link hand-off rather than the whole product.

### 3.5 One unverified lead that must be checked before the wallet ships

`index.html:12` ships a restrictive CSP whose `connect-src` is
`'self' http: ws:`. CSP scheme-sources are scheme-exact: `http:` matches `http:`
URLs and **not** `https:` URLs. The one existing cross-origin mint call is
`fetch(`${mint}/v1/keysets`)` at `src/helpers/mint-fee.js:68`, and the shipped
fixture mint URLs are **`https://`** (`tests/e2e/helpers/mock-backend.mjs:16` →
`https://mint.minibits.cash`; `src/components/Cashu.jsx:118`). On that reading
the CSP would **block** the fee pre-check in a real browser, `getMintSwapFee`
would return `{status: 0}` ("no pre-check", `src/helpers/mint-fee.js:56-58`),
and the `CU110` "token entirely eaten by the fee" guard would silently never
fire — which the file's own comment says must never happen. `balance.html`
ships **no CSP at all**.

**Status: `UNMEASURED` — a lead, not a finding. `[D:portal §2.5]` did not verify
it in a real browser; neither did this delta.** It must be checked (and `https:`
added to `connect-src`) before the wallet adds more cross-origin mint traffic.
Note also that `worker-src` is unset and therefore falls back to
`default-src 'self'`, so a same-origin `/sw.js` would be **allowed with no CSP
change** — the CSP is not the SW blocker; the secure context is.

### 3.6 THE VENDOR ORIGIN, MEASURED — the self-signed split, Local Network Access, and the costed options

This subsection closes §3.4's option (a) and the appendix's `ORIGIN` entry. Everything
marked **[measured]** is first-hand output from the rig in
`DOSSIER-vendor-origin-and-selfsigned.md` §0.2 — headed Chrome for Testing **156.0.8078.4**,
real pointer clicks under Xvfb+openbox, and a genuine **public → private** address-space
transition (the initiator is a *global IPv6* address on the same host). Raw tool output is
reproduced in `docs/analysis/EVIDENCE-vendor-origin-and-selfsigned.md` (§E1–§E7) — shipped in
this PR so a reviewer can check the `[measured]` lines directly. Citation form: **[D:origin §N]**.

#### 3.6.1 The self-signed split, with the measured evidence

A PWA needs **four independent gates** to pass. A self-signed credential passes the first
two and fails the third permanently `[D:origin §1, §1.2]`:

| # | Gate | What it actually requires | Self-signed verdict |
|---|---|---|---|
| 1 | **Origin is Potentially Trustworthy** | scheme only — a *scheme/name* test with **no certificate clause** | ✅ **PASSES** with `https://` |
| 2 | **Navigation is not blocked by an interstitial** | a chain the browser accepts, **or a user exception** | ✅ **PASSES**, but only after the user clicks Advanced → Proceed |
| 3 | **Service-worker registration** | a *successfully validated* certificate chain for the SW script fetch | ❌ **FAILS — even after gate 2 passes** **[measured]** |
| 4 | **Install criteria** (`beforeinstallprompt`) | secure transport **+** qualifying manifest | moot while gate 3 fails |

**The measurement that settles it** — after a real, pointer-driven click-through of the
interstitial on `https://192.168.2.20:8444/`, the page reports **gate 1 + 2 passing** and
**gate 3 failing** in the same probe `[D:origin §1.2]`:

```
location: https://192.168.2.20:8444/index.html
isSecureContext: true
hasCryptoSubtle: true        hasPaymentRequest: true
hasCaches: true              hasIndexedDB: true
swRegister: {
  "ok": false,
  "error": "SecurityError: Failed to register a ServiceWorker for scope
            ('https://192.168.2.20:8444/') with script ('https://192.168.2.20:8444/sw.js'):
            An SSL certificate error occurred when fetching the script."
}
```

Read the two lines together: `isSecureContext: true` says the user's exception **does**
produce a secure context (`crypto.subtle`, `caches`, `PaymentRequest`, `indexedDB` are all
genuinely present), and `swRegister.ok: false` says gate 3 **failed** — so there is no
service worker, no offline shell and no `beforeinstallprompt`.

> **A user-clicked certificate exception creates a secure context but never a service
> worker. "Is it a secure context" and "can I install a PWA" are different questions with
> different answers on a self-signed origin.**

Corroborating echo from the same run: the interstitial page itself
(`chrome-error://chromewebdata/`, origin `null`) has `isSecureContext:false` **and** its own
probe fetch is refused with *"The request client is not a secure context and the resource is
in more-private address space `local`"* — sitting on the certificate warning, you have
neither a secure context nor local-network permission.

**Not verified here, and not to be asserted:** the internal Chromium code path that
produces this asymmetry. What **is** citable is the direction of the two specs — Secure
Contexts §3.1 is a pure scheme/name test with no certificate clause and an explicit
*"may allow users to configure specific sets of origins as trustworthy"* development escape
hatch (§7.2), whereas Service Workers §6.1 is unconditional (*"Service workers **must**
execute in secure contexts"*) and `ServiceWorkerContainer.register()` documents
`SecurityError` for a `scriptURL` that is not a potentially trustworthy origin. The two are
specified at different layers; a user-clicked exception satisfies the first without
satisfying the second.

#### 3.6.2 Trust stores, per platform: USABLE for a managed operator fleet, UNSUPPORTED for BYOD

The private-CA route only becomes a *working* HTTPS origin when the client's trust store
contains our root. That is a per-device administrative action, and on the BYOD walk-up path
it is not available at all `[D:origin §1.3]`:

| Platform | The fact | Consequence |
|---|---|---|
| **Android** (Chrome desktop and Android) | **Since Nougat (API 24), apps do not trust user-added CAs by default** — only the standardised AOSP/Android **system** store. `Settings → Security → Install certificate → CA certificate` writes to the **user** store, which current Chrome for Android **ignores**. The `Network Security Config` escape hatch (`trust-anchors src="user"`) is an **app-manifest, build-time** control — not something a captive-portal operator can set on a stranger's phone. | **BYOD: UNSUPPORTED** by documented platform policy, not browser quirk. **MDM/device-owner fleet: supported** — the CA goes into the *system* store and Chrome trusts it like any public root. |
| **iOS / iPadOS** | A manually installed certificate profile is **not automatically trusted for SSL**; the user must **also** go to `Settings → General → About → Certificate Trust Settings` and enable full trust. Certificate payloads are auto-trusted **only** when installed via Apple Configurator or MDM. | **Two-stage, per device, on BYOD** (`[needs user X]`); **one-stage under MDM.** Also awkward for a bare LAN IP, because no publicly-trusted DV certificate can exist for one, so any iOS trust story for the router needs a *name* **and** a private root. |
| **Chromium desktop / managed fleets generally** | Chrome uses the platform root store; a policy/MDM deployment can pre-place a root. | Fine for **operator-owned devices**; irrelevant to walk-up users. |

**Conclusion, stated once: private-CA TLS is USABLE for an MDM-managed operator fleet and
UNSUPPORTED for BYOD on every platform checked.** It is therefore not a path to the
*walk-up* product; it remains a valid path for the router's **own admin UI** at `:8443`
(`/etc/tollgate/ssl/server.{crt,key}`), which only the operator loads.

#### 3.6.3 The dead end: why the router can never be the secure origin for a guest

Two independent blockers, either of which is fatal `[D:origin §1.2, §1.3]`:

1. **No public CA will issue for a LAN IP or an internal name.** CA/Browser Forum baseline
   requirements require control of a **domain** and explicitly forbid internal names and IP
   literals for publicly-trusted certificates; Let's Encrypt documents the same reasoning
   for `localhost` and the logic applies identically to RFC 1918 literals — there is no
   ACME challenge path for `192.168.1.1`.
2. **A self-signed / private-root certificate is refused at the service-worker gate**
   (§3.6.1), so even a client that trusts it (`[needs user X]`, per device, per profile,
   indefinitely) gets a secure context **and no PWA**.

The remaining variant — **split-horizon DNS**, pointing a real domain's A record at a
private address so ACME can issue — is **a net loss**: it fails for any guest whose resolver
or DoH answers with the public address instead of ours, and it requires the router to hold
the **ACME private key** and perform **renewals from an offline/WAN-less box**, a standing
operational liability for exactly the deployment shape TollGate ships. It buys a trusted
origin that still does not change the address-space gate in §3.6.4.

**Corollary that must be stated:** "give the router TLS" is also **not an installability
fix** for the money path — see option **B** in §3.6.6. Local Network Access is an
**address-space** gate, not a scheme gate, so `https://<gw>:2121` is gated exactly like
`http://<gw>:2121` while adding an interstitial back.

#### 3.6.4 THE CRUX — Chrome Local Network Access (the real cost of §3.4 (d))

**The crux is not mixed content. It is Chrome's Local Network Access (LNA) permission.**
Chrome 142+ requires a **user-granted permission** for any request from **public** address
space to **private / RFC 1918 / loopback** space, and — the load-bearing half — **the
permission is grantable only from a secure context.** That pairing is the whole finding: it
explains both why the vendor origin works and why the `:2051` portal origin can never grant
it `[D:origin §3.4]`.

**Measured — a public origin calling the private router is DENIED, and no request leaves the
browser.** Initiator: `https://[2a01:…:33ed]:8444/` (a genuine global IPv6 address)
`[D:origin §3.4]`:

```
Access to fetch at 'http://192.168.2.20:8018/api.json' from origin 'https://[2a01:…:33ed]:8444'
has been blocked by CORS policy: Permission was denied for this request to access the `local`
address space.
```
```
result: { "http_private_192_8018_CORS": { "ok": false, "error": "TypeError: Failed to fetch" },
          "http_loopback_8018":       { "ok": false, "error": "TypeError: Failed to fetch" } }
```

Three things to extract, and all three are traps:

- **The denial is reported as a CORS failure.** `TypeError: Failed to fetch` plus a
  *"blocked by CORS policy"* console line. An implementer will chase
  `Access-Control-Allow-Origin` headers indefinitely while the real cause is a **missing
  permission**. **Record this in the portal's own code comments**, not just here.
- **The denial names the address space** — `` `local` `` for the RFC 1918 target,
  `` `loopback` `` for `127.0.0.1`. These are address spaces, not permission names.
- **Control, in the same run:** the same public origin calling a **public** address is
  blocked by **mixed content** (*"the content must be served over HTTPS"*) — i.e. **the two
  gates are distinct and both are observable**, which is what settles the appendix's
  mixed-content-vs-PNA question in §3.6.4.1.

**The permission is real, nameable and grantable — and the name has a trap.**
`navigator.permissions.query` on the public origin `[D:origin §3.4]`:

```json
{"local-network-access":{"state":"prompt","name":"local-network-access"},
 "local-network":{"state":"prompt","name":"local-network"},
 "loopback-network":{"state":"prompt","name":"loopback-network"},
 "localNetworkAccess":{"error":"TypeError: … 'localNetworkAccess' is not a valid enum value of type PermissionName."}}
```

So the **web-visible PermissionName is KEBAB-CASE `local-network-access`** — the camelCase
`localNetworkAccess` is **rejected as an invalid enum value**. Chrome 156's DevTools
protocol lists `localNetwork`/`localNetworkAccess`/`loopbackNetwork` in
`Browser.PermissionType`, but `Browser.setPermission` with those camelCase names is rejected
(`Invalid PermissionDescriptor name`): **the CDP emulation names are NOT the web
PermissionName.** All three are in state **`prompt`** — a genuine user-grantable permission,
not an unconfigurable block.

**The real prompt, in real headed Chrome** (raised automatically the moment the page fetched
the private target — no user gesture is needed to *raise* it, only to *drive* it):

```
[2a01:…:33ed]:8444 wants to Access other devices on your local network     [ Block ]  [ Allow ]
```

**Measured — after ONE user click on `Allow`, everything works, including the preflighted
POST and the service worker** `[D:origin §3.4]`:

| Probe (public origin, after `Allow`) | Result |
|---|---|
| `GET http://192.168.2.20:8018/api.json` (CORS server) | **200 `cors`** ✅ |
| `GET http://192.168.2.20:8019/api.json` (no CORS) | `TypeError: Failed to fetch` — a **genuine** CORS failure (`No 'Access-Control-Allow-Origin' header`) ✅ expected |
| `POST http://192.168.2.20:8018/ln-invoice?mac=<mac>` (`application/json`) | **200 `cors`**, after an `OPTIONS` preflight ✅ |
| `navigator.serviceWorker.register('/sw.js')` | **ok**, `scope: https://[2a01:…:33ed]:8444/` ✅ |
| grant persistence across a **browser restart** | **GRANTED** — a second run got 200 with **no click** ✅ |

**The grant is STICKY PER ORIGIN, and that is the product sentence.** The user grants
local-network access to **`portal.orangesync.tech` once**, and it then holds for **every
TollGate router they ever visit** — a materially better story than per-router trust, which
is what a LAN-IP origin would force (a different origin per router ⇒ a fresh prompt, a fresh
install, a fresh storage partition at every stop). It also means the wallet's **IndexedDB and
seed live on a stable origin that does not change when the router does**, which **strengthens
D1**: only the **ENTITLEMENT is address-scoped**; the client's ecash and identity persist.
That is the crisp form of the roaming rule in §2 — and it is now a measured property of the
platform, not a hope.

##### 3.6.4.1 The mixed-content vs Private-Network-Access question — SETTLED

The dossier measured **both** gates and showed they are **distinct**: a public → **public**
insecure fetch was blocked by **mixed content**, while public → **private** was blocked by
the **LNA permission** (`Permission was denied … 'local' address space`). Two further facts
close the older framing entirely `[D:origin §3.2, §3.3]`:

- **On the spec/MDN record**, `https://page → fetch('http://192.168.1.1:2121/…')` is
  *"blockable mixed content"* and must be blocked. **It does not fire in Chrome 156, because
  Chrome exempts it**: permission-gated local-network requests are exempt from the
  mixed-content check when Chrome can tell the destination is local — a **private IP
  literal**, a **`.local` domain**, or a `fetch()` annotated `targetAddressSpace:"local"`.
  **The exemption is policy that tightens; we do not rely on it.**
- **The legacy PNA preflight is gone in this path.** Chrome 156 sends **no**
  `Access-Control-Request-Private-Network` (measured `None`), so the router does **not** need
  `Access-Control-Allow-Private-Network: true`; implementing it is dead code from a
  superseded 2022 recipe.
- **Cross-browser, stated without overclaiming:** Safari/WebKit and Firefox/Gecko have **no
  LNA implementation and no such mixed-content exemption** documented, so **option A is
  UNSUPPORTED there pending measurement** — and **not measured here**. Chrome 138–141 sit
  behind `chrome://flags#local-network-access-check`. On top of that, **iOS Safari never
  fires `beforeinstallprompt`** at all (install is manual *Share → Add to Home Screen*), so
  the install UX must be written defensively for both paths.

#### 3.6.5 Three constraints that change the design

1. **Workers CANNOT raise the LNA prompt.** Per the LNA announcement: *"Local network
   requests from Service Workers and Shared Workers require that the worker's origin has
   previously been granted the Local Network Access permission."* ⇒ **a background
   service-worker poll loop against the router SILENTLY FAILS on a fresh install.** The
   **foreground must make one LNA-requiring call before any SW-driven polling is relied
   upon.** This interacts directly with the L0/L1 background design in **§6.6.4** and with
   §6.6.1's "transport is step zero".
2. **`ws://` to the router is NOT an escape hatch.** WebSockets/WebTransport/WebRTC are not
   yet LNA-gated, but **`ws://` from an `https://` page is still mixed-content-blocked**, so
   an MQTT-over-WS keepalive to `192.168.1.1` is **not** an escape hatch. Do not design one.
3. **The LNA enterprise pre-grant policy is announced but NOT shipped.** A Chrome enterprise
   policy to pre-grant or pre-deny local-network access per site has been announced; **no
   policy name/definition was found** in the Chrome Enterprise policy list as fetched. It is
   the fleet-management path (operator-owned devices, no prompt). **Track it; do not depend
   on it, and do not cite a policy name.**

#### 3.6.6 The options, costed — and the recommendation

`[D:origin §3.5]`

| Option | Install/PWA | The router call | Cleartext on the wire? | Verdict |
|---|---|---|---|---|
| **A. Vendor origin + LNA + CORS on `:2121`** | ✅ full PWA | `fetch('http://<gw>:2121/…')` — passes only after the LNA grant; needs `ACAO` + `OPTIONS` in the Go handler | **YES → the money path must be SIGNED** | **SHIP** — measured end-to-end, no new infra |
| **B. Give the router TLS** | ❌ still LNA-gated (an **address-space** gate, not a scheme gate) and the cert still cannot be publicly trusted for a LAN IP | `https://<gw>:2121` | no | **NOT for BYOD** — adds the interstitial back for zero install gain |
| **C. Vendor relay** (router holds an outbound channel; the PWA talks only to the vendor) | ✅ full PWA | **NO LAN call at all** | no | **The architectural target** where the router has WAN. Removes the LNA prompt, the mixed-content notice **and** the cleartext-money problem. Substrate **already exists** (Nostr relays, `kind:10021` gateway advertisement) |
| **D. `--unsafely-treat-insecure-origin-as-secure` on a managed fleet** | ✅ device-owned browsers only | direct `http://<gw>:2121` | yes | Fleet only, **never BYOD**. **IP wildcards are REJECTED** — only HOSTNAME patterns wildcard, so the fleet must standardise on a hostname (e.g. `*.tollgate.box`), not per-router IPs |
| **E. Native WebView + `WebViewAssetLoader`** | ✅ as an app | app-controlled | n/a | The app-store path, not the walk-up path |

**RECOMMENDATION: ship A now, with C as the architectural target.** Both are the operator's
call and have been surfaced to them; A is **measured end-to-end today** and keeps W1/W2
unblocked, while C is where this design must land once routers have WAN.

#### 3.6.7 The binding constraints this adds, and where each one lands

- **The router's `:2121` Go handler MUST emit `Access-Control-Allow-Origin` and answer
  `OPTIONS` with 204.** Expose the exact origin (`https://portal.orangesync.tech`) rather
  than `*` now, so credentials can be added later without a break. **This is a MODULE-side
  change and therefore lands in W3's PR — not in the portal PR.** Note also that `:2121` is
  the Go module's **own** `net/http` listener (`src/main.go:424` — `apiListenAddr = ":2121"`, read
  at the pinned module SHA `cf7cad34677e87e775e7f16786b1bbf18c4bc8bc`), so CORS belongs in a Go
  middleware: putting it in uhttpd or nodogsplash is a guaranteed no-op. CORS is
  **non-negotiable and orthogonal to the permission** — both were measured failing
  independently (permission granted with no `ACAO` ⇒ still fails; `ACAO` present with no
  permission ⇒ still fails).
- **Because option A leaves the money path in CLEARTEXT on the LAN, the payment intent MUST
  be SIGNED with the wallet key**, the grant bound to **MAC + a single-use nonce**, and the
  `POST` made **idempotent** so a retry cannot double-charge. **Treat the LAN leg as
  hostile** — a user-clicked certificate exception is not a security boundary, and with a
  stable vendor origin *any* gateway can answer as "TollGate", so the signature is also what
  makes *"which gateway am I paying?"* answerable.
- **Do not add TLS to `:2121` as an installability measure** — it changes nothing about the
  LNA gate (§3.6.3) and no publicly-trusted certificate can exist for a LAN IP.
- **Do not cache the money path in the service worker.** A cached `2xx` on the payment
  `POST` would *fake a purchase*; a cached `/usage` or `/balance` would make the portal lie
  about the one thing that is address-scoped.

---

## 4. D5 — the NUT and dependency decision: `cashu-ts` 2.9.0 vs 4.11.0

### 4.1 The conflict, measured

| Side | Fact | Evidence |
|---|---|---|
| Portal | `@cashu/cashu-ts` pinned **exactly `2.9.0`**, no caret | `package.json:21`; `package-lock.json` |
| Upstream | `npm ci` warns: *"Unsupported: v2 and earlier are obsolete and are not compatible with current mints. Upgrade with: `npm i @cashu/cashu-ts@^4`"* | `npm ci` output `[D:portal §7]` |
| Portal policy | A written dependency policy pins `^2.2.2` and requires the upstream migration guide plus the in-package `migration-X.0.0.SKILL.md` before any major bump, listing v4 break classes that *"already cost Amperstrand sessions"* (Amount value objects, ESM-only, `getDecodedToken` keyset-id requirement, melt-change strictness as a **fund-loss class**) | `README.md:129-143` |
| Wallet need | The wallet path needs a version whose shipped types carry the melt **preimage-vs-payment-hash** check, and the current published `latest` is **`4.11.0`** | npm dist-tags `{latest: 4.11.0, next: 5.0.0-rc.11, v3-lts: 3.7.2}`; `[D:wallet §2, §3.3]` |
| Re-verified here | 4.11.0's shipped `lib/types/index.d.ts` contains the preimage/payment-hash surface; 4.9.0's does not | `grep -c` for `payment_hash` or `preimage` over `lib/types/index.d.ts` → 16 in 4.11.0 |

The portal's actual use of the library is **decode-only**: `getTokenMetadata` /
`getDecodedToken`, no `CashuWallet`, no `CashuMint`, no mint calls, no proof
store — `grep -rn 'CashuWallet\|CashuMint\|@cashu' src/ tests/` finds no wallet
construction anywhere `[D:portal §7]`. So the portal needs 2.9.0's *decode*
behaviour to keep working, and the wallet needs 4.11.0's *spend* behaviour.

### 4.2 The decision

1. **Migrate the portal's decode path to `4.11.0` — as its own PR, first, with
   nothing else in it.** The lowest-risk moment to absorb a major-version
   migration is *before* there is any proof store to migrate. The surface to
   migrate is tiny (three call sites: `src/helpers/cashu.js:211`, `:135`,
   `src/helpers/mint-fee.js:64` for `getTokenMetadata`, plus the
   `getDecodedToken` fallbacks at `src/helpers/cashu.js:138`, `:215`,
   `src/helpers/mint-fee.js:34`). This PR must carry the policy's required
   artefacts (upstream migration guide reference, `migration-4.0.0.SKILL.md`)
   per `README.md:129-143`, and it must be green on the decode test set before
   anything imports a wallet.
2. **Do not publish a second, parallel copy of the library.** One version of
   `@cashu/cashu-ts` in the tree. Two majors side by side would put two
   different `Amount` semantics and two different `getDecodedToken` contracts in
   one bundle, which is the documented fund-loss class this project cannot
   afford.
3. **Load the wallet lazily, in a dynamic chunk.** Even after the migration, the
   wallet core (`CashuWallet`/`CashuMint`, NUT-09 restore, proof store) should
   not be in the portal's initial chunk: the portal's first paint is on a
   captive-portal network, and the wallet is only reachable from the wallet
   panel. This also keeps the "no wallet loaded ⇒ nothing to lose" property
   true for a visitor who never opens the wallet.
4. **`4.11.0`, not `5.0.0-rc.11`.** The dev branch is a release candidate; a
   release-candidate dependency in a money path over a captive network is not a
   risk the project should take. Record the pin as exact, matching the existing
   portal convention.

### 4.3 NUT coverage: what the wallet needs, and where each NUT comes from

Measured from the shipped npm tarball's `lib/types/index.d.ts` and
`etc/cashu-ts.api.md`, not from the dev branch and not from blog posts
`[D:wallet §3]`. "Supported" means a public symbol implementing the NUT's client
half exists in the shipped types.

| NUT | Role in this design | Verdict in 4.9.0 / 4.11.0 | Key symbols |
|---|---|---|---|
| **NUT-04** | get ecash in (mint from BOLT11) | Supported | `createMintQuoteBolt11`, `mintProofsBolt11`, `prepareMint`/`completeMint` |
| **NUT-05** | **pay the BOLT11 — the whole point** | Supported | `createMeltQuoteBolt11`, `prepareMelt`, `completeMelt`, `meltProofsBolt11` |
| **NUT-07** | know whether a proof is still live (idempotency authority) | Supported | `checkProofsStates`, `groupProofsByState` |
| **NUT-08** | return the unused routing fee on **many small** melts | Supported; `nut08Change` **defaults `true`** | `MeltProofsConfig.nut08Change`, `MeltProofsResponse.change` |
| **NUT-13 + NUT-09** | deterministic restore — the enabler of the thresholded-mnemonic design | Supported | `deriveSecretAndBlindingFactor`, `batchRestore`, `WalletOptions.bip39seed`, `counterSource` |
| **NUT-02** | keyset fees — material at small granule sizes | Supported | `getFeesForKeyset`, `getFeesToInclude`, `maxSpendableAfterFees`, `input_fee_ppk` |
| NUT-03, 06, 10–12, 14–21, 23, 25, 28, 29 | not required by this design | Supported (NUT-30 `@experimental`) | see `[D:wallet §3.1]` |

**One NUT the design must NOT use: NUT-20.** The ADR-relevant lying-in-wait is
that quote-lock keys *are not seed-recoverable* — *"Quote lock keys live on a
per-mint cursor the mint has no record of, so a seed-only restore cannot rebuild
it"* (`docs-src/usage/restore_proofs.md`, quoted in `[D:wallet §4.2]`). An
in-flight locked quote whose locked proofs are stranded is exactly the failure
this design cannot afford, so **the auto-top-up loop must not use NUT-20 locked
quotes.**

**Two shipped-code discrepancies to code against, both measured:**

- **Code against `batchRestore`, not `restoreAll`.** cashu-ts's own docs
  (`docs-src/usage/restore_proofs.md`, `docs-src/deterministic_counters.md`)
  document `wallet.restoreAll()`, but `grep -c 'restoreAll'` over the shipped
  `.d.ts` returns **0 in both 4.9.0 and 4.11.0** — re-verified in this delta.
  The shipped API is `batchRestore(gapLimit?, batchSize?, counter?, keysetId?)`.
- **On 2.9.0/4.9.0 the only trustworthy melt-success signal is the mint's
  `MeltQuoteState.PAID`, and you cannot independently verify it.** Every
  `preimage` occurrence in 4.9.0 is NUT-14 HTLC or onchain normalisation; the
  preimage-vs-payment-hash check arrived later (`CHANGELOG` →
  `fix(mint): check a bolt11 melt preimage against the invoice payment hash
  (#1161)`) `[D:wallet §3.3]`. This is the second reason the wallet needs 4.11.0.

### 4.4 Licensing

`@cashu/cashu-ts` is **`MIT OR Apache-2.0`** in npm metadata for both 4.9.0 and
4.11.0 (re-verified in this delta against the 4.11.0 tarball's `package.json`),
with repo `LICENSE.md` = *"Apache 2.0 or MIT, at your option"*. Both branches
are GPL-3.0-compatible; pick MIT. Preserve upstream notices — the repo adds
*"Some files retain their own copyright notice"* `[D:wallet §2, §8]`.

If `@cashu/coco-core` + `@cashu/coco-indexeddb` are adopted later as the
counter-lifecycle layer (the recommended place to buy correctness rather than
build it — counter persistence is the part that is easy to get subtly wrong and
expensive to get wrong: proof loss), resolve their licence **from the repo
`LICENSE` file, not the registry field**: coco's *repo* is MIT but its *npm*
metadata carries no licence field `[D:wallet §7.1, §8]`.

---

## 5. D4 — the seed threshold `T`, and the honest trade-off

### 5.1 The requirement

The operator's requirement is **no seed-phrase nagging unless the held balance
exceeds a meaningful threshold**. cashu.me's design is the exact inverse: it
blocks the whole app behind a mandatory mnemonic confirmation *before* any
balance exists. The flow is a full-screen carousel — Intro → PWA →
New/Recover → seed display → mint setup — and **there is no skip**:
`canProceed` returns `state.seedPhraseValidated` on the "new" path, so the only
way forward is to tick *"I have written this down"*, and the E2E helper encodes
it as an unavoidable step `[D:wallet §1.6]`.

That inversion is the design we must build, and it is a UX inversion, not a flag
to flip.

### 5.2 The mechanism is already there and is not a hack

- cashu.me generates the mnemonic **silently on demand** and never requires it
  to exist first: `if (this.mnemonic == "") { this.mnemonic = generateMnemonic(wordlist); }`
  (`src/stores/wallet.ts:416-418`, `:1748-1753`).
- It spends by handing the BIP-39 seed to cashu-ts (`bip39seed`,
  `:419-423`). Nothing in the spend path requires a human to have read the
  phrase.
- cashu.me surfaces the phrase only in a UI step it *chooses* to make mandatory.

So **device-generated random seed → persisted locally → mnemonic surfaced later
on a threshold** is feasible with this library, and NUT-13 deterministic
derivation is what makes "later" mean anything `[D:wallet §4.1]`.

### 5.3 The value at risk is real and must not be papered over

> **If the seed has never left the device and the device is gone, the ecash is
> gone.** Not "hard to recover" — gone. Ecash is a bearer instrument; the mint
> holds no account and no identity for the holder, and NUT-09 will only replay
> signatures to someone who can present the same deterministic derivation, which
> means the same seed. There is no support path.

Second-order losses that are easy to miss, and which a captive portal makes
*more* likely, not less:

- cashu.me stores the seed as the raw BIP-39 phrase in **plaintext
  `localStorage["cashu.mnemonic"]`** (`src/stores/wallet.ts:224`) with **no
  encryption** — a grep for `aes`, `crypto.subtle`, `pbkdf2`, `password` across
  `src/stores/`, `src/js/`, `src/boot/` finds nothing protecting it `[D:wallet §1.2]`.
- Proofs are plaintext rows in IndexedDB `db.proofs` (`secret`, `C`, `amount`,
  `id`) — no encryption `[D:wallet §1.4]`.
- Clearing site data / "clear browsing data" / a profile reset / a private window
  that closes **destroys** the wallet — and a captive-portal PWA is exactly the
  context where a user is most likely to be in a throwaway browsing mode.
- iOS Safari deletes script-writable storage — WebKit's own list names **IndexedDB** first, then
  LocalStorage, media keys, sessionStorage, and service-worker registrations and cache — for origins
  unused for ~7 days of Safari use (ITP). The cap is published as a **cookie** cap with
  script-writable storage *aligned* to it; WebKit's Tracking Prevention policy separately states that
  the **first-party domain of home screen web applications is exempt** from that cap over *all*
  script-writeable storage — the class IndexedDB is enumerated in — so installing takes the origin
  out of the eviction path **as documented policy** (WebKit-only; whether a given iOS build behaves
  accordingly is a field check, §5.6.5). A captive-portal session wallet the user only revisits and
  never installs will be silently wiped. This is arguably a **bigger practical risk than device
  theft** [D:wallet §4.3].
- A second device is a separate wallet with zero balance. There is no "sign in".

### 5.4 The decision on `T` — a resting balance is REQUIRED; `T` is its cap

**Operator decision (2026-10-14, verbatim):** *"Lets keep some resting balance for
UX. The user shouldnt have to manually interact with the PWA or a captive portal
every time they have used up their balance. The PWA should automate the process
of making small, frequent granular purchases in the background so that the user
can focus on consuming internet rather than buying internet."*

**A resting balance is therefore REQUIRED by operator decision, not optional, and
`T` is the CAP on that resting balance — not a threshold at which to prefer
zero.** The requirement it serves is concrete and user-facing: the user must never
have to open the PWA, and never have to interact with a captive portal, *because
their balance ran out*. The earlier `T = 0` recommendation (exactly-on-demand
melt, zero resting balance) is **reversed** by this decision; it survives below
only as the named fallback in item 3, and as the configuration that would make
the background-autonomy requirement (§6.6) meaningless.

1. **Keep a resting balance, capped at `T`.** The wallet mints a quote for the
   invoice amount `+ fee_reserve + input fees` **plus a resting buffer**, pays,
   and *retains* the unspent buffer as bearer ecash so the next granule can be
   bought without the user doing anything. The resting balance is what makes the
   "small, frequent, granular purchases" the operator asks for possible at all:
   with **zero** resting balance every granule needs a fresh mint quote against a
   fresh deposit, i.e. a user-visible funding act each time, which is exactly the
   interaction the requirement removes. cashu.me's own melt path is the
   *exactly-on-demand* shape — `meltGeneric` sizes the swap to
   `quote.amount + quote.fee_reserve` (`src/stores/walletMelt.ts:161`)
   `[D:wallet §4.4]` — so this is a deliberate divergence from that reference,
   not a port of it.
2. **`T` is the cap, and it must be a small multiple of the granule.** `T` is a
   **policy constant, operator-tunable**. The prior plan's sizing guidance is
   *"~1 day of typical usage, i.e. tens of sats"*
   (`docs/pwa-client-wallet-plan.md:178`), and that reasoning is adopted. Because
   the granule is the loss unit under D1 (§2), `T` must *also* be expressed as
   **a small multiple of the granule**, so the two knobs move together — per D1
   §2 granularity *is* the loss-bounding mechanism, and `T` is that same
   mechanism applied to the resting balance rather than the in-flight granule.
   This is now the **primary** path, not a fallback: the two knobs are load-bearing
   together.
   **Proposed default: `T = 8 × granule`, which is ~1 day of typical usage, i.e.
   tens of sats.** Justification, three parts: **(i)** it is the granule multiple
   that survives the design's own worst case — a rotation mid-flight forfeits at
   most the in-flight granule (D1 §2.2), so 8 granules still leaves the user
   roughly a day of access after one abandoned attempt; **(ii)** it matches the
   prior plan's own "~1 day of typical usage, i.e. tens of sats" figure, so it
   introduces no new number the operator has to re-reason about; **(iii)** it is
   small enough that the cap, not the storage mechanism, is what makes the
   disclosure truthful (§5.4(3)). **`T` is operator-tunable, and the specific
   number is a policy choice rather than a technical constant — but the
   load-bearing user-facing promise does not depend on its value: "the most you
   can lose is T".** Whatever the operator sets, that sentence must stay true.
3. **The cap is what makes the seed-phrase-less design safe — not the
   encryption.** Before the first reveal, funds are **unrecoverable by
   construction** (the seed never left the device and was never shown). That is
   acceptable *only* because the balance is capped below `T`. If the business
   cannot accept writing off `T` sats per lost device, the design must fall back
   to exactly-on-demand (`T = 0`) or prompt earlier. There is no third option; the
   protocol has no account layer to recover against `[D:wallet §4.4]`. With a
   resting balance now **required**, this constraint binds the *value of `T`*, not
   the existence of the balance: the operator must choose a `T` they are genuinely
   prepared to absorb per lost device, and the disclosure must state the cap
   plainly, in the user's own words.
4. **Crossing `T` escalates once, non-blockingly, and never mid-payment.** Offer
   (a) reveal + write down the mnemonic (the cashu.me pattern: hidden-by-default
   plus an explicit confirmation checkbox, `data-testid="onboarding-seed-confirmed"`),
   (b) export an encrypted backup, or (c) "keep it small" (auto-cap the balance
   by paying down to the gate). Record completion in `localStorage`.
5. **Persist the recovery triple from proof #1** — `{seed, countersByKeyset,
   mintUrls}`. This is not optional:
   - NUT-13 needs a **separate counter per keyset**, and only `deterministic`
     outputs are recoverable at all, so a single random-secret output path
     silently produces unrecoverable value. `secretsPolicy: 'deterministic'` is
     therefore a **build-time invariant, not a runtime option**.
   - Counters must be written **before** the exposing network call — the module's
     own hard rule: once `[counter, counter+n)` has been exposed to a mint it
     must never be derived again (error 10002 "Duplicate outputs"; incidents
     #257, #266, #480) `[D:module §9]`.
   - Without the **mint URL**, a seed is only half a backup, because NUT-09 must
     ask the mint to replay signatures `[D:wallet §4.2]`.
6. **Own the eviction risk explicitly.** Treat "site data was cleared" as a
   *normal* event, not an edge case, and test it. Surface a "this device is the
   wallet" warning before the first sat is ever acquired. The existing plan doc
   already states the honesty constraint this must satisfy: *"a bearer wallet in
   a browser over a captive HTTP network is a theft/durability target (XSS,
   shared device, storage eviction), so it must not be presented as 'your money
   is safe here'"* (`docs/pwa-client-wallet-plan.md:66-69`).

### 5.5 Onset story and the panel

Panel 3 (§7.3) is the threshold-seed moment. Under the **required** resting
balance (§5.4) Panel 3 is **reachable, and it is a designed-for moment** — it is
the moment the user is offered a durable copy of a real balance, and it is the
mechanism that makes the "§5.4(3) cap" disclosure honest rather than a
concealment. The earlier draft called it "unreachable by construction, that is the
intended design"; that depended on `T = 0` and it is **no longer true**.

Two invariants still govern it, and they are the two failure modes that turn a
threshold into the nag the requirement forbids:

1. It must **never appear before a balance exists** (nothing to recover yet →
   pure friction), and
2. it must **never interrupt a payment**.

In addition, because the balance is now a standing object rather than a transient,
it must never *recur*: completing it once (write-down, export, or "keep it small")
records completion and the panel does not re-open on every subsequent top-up.

### 5.6 The secret-storage decision (mandated section)

The operator asked directly: *"How about we offer to store the secret on the
user's device / file system so that the user doesn't need to write anything down
and to reduce the interactivity for the user? Would this help?"* The spike is
`~/reports/pwa-cashu/SPIKE-secret-storage.md`; its verdict is recorded here.

**The verdict in one line: device-local storage DOES remove the write-down for the
common case but does NOT make the secret durable — eviction destroys ALL origin
storage including any device-local key, so durability requires the secret, or a
wrapping key, to live OUTSIDE origin storage.**

Two separable goals, with opposite difficulty, and they must not be conflated:

| Goal | Achievable without a write-down? | Why |
|---|---|---|
| **Reduce interactivity** (no phrase ceremony; wallet works immediately) | **YES, today, on every browser** | Generate entropy on-device and persist it. Pure client-side choice. cashu.me already does exactly this and *chooses* to show the reveal step. |
| **A secret that survives eviction with nothing written down** | **NO — not on all browsers, and not with a single mechanism** | `Clear-Site-Data: "storage"`, "clear browsing data", a profile reset and OS storage pressure all destroy every origin-scoped bucket *at once*, including any key stored alongside the seed. This is the single most important fact in the spike. |

**Therefore the design is: device-local by default, cheap export on demand, passkey
as an opportunistic wrapper — and the loss bounded by a policy cap (`T`, §5.4),
not by the storage mechanism.**

#### 5.6.1 The recommended composition (BYOD population), in rank order

1. **Device-local seed in IndexedDB + `navigator.storage.persist()` + value capped
   below `T`.** Works on **100%** of the target browsers. No phrase, no user action,
   wallet live immediately. Accepts eviction by construction: the pre-reveal wallet
   is a **petty-cash purse**. `persist()` is necessary and cheap — it is granted by
   heuristics in Chrome and silently in Safari, prompts in Firefox — and it defends
   *only* against storage-pressure eviction, never against clear-site-data, a
   profile reset or private browsing. **Call it; never rely on it alone.**
2. **One-tap encrypted export via the Web Share API, offered (never forced) once
   balance ≥ `T`.** Available on Chrome Android ≥ 76 and iOS Safari ≥ 14;
   **Firefox cannot share files at all**, so an `<a download>` fallback is required.
   This is the highest-value friction reduction in the spike: it reaches the
   *outcome* of "write it down" (a non-evictable, user-visible, off-device copy) with
   one tap to Files/Drive/e-mail, and it is the natural payload of the §5.5/§7.3
   Panel 3 moment.
3. **Passkey PRF as an opportunistic, RUNTIME-DETECTED wrapper.** Where it works it
   upgrades the design to *"nothing written down **and** recoverable on a new
   device"* — the only combination in the spike that satisfies both operator goals.
   **Chrome desktop + Chrome Android 116+: works at both `create()` and `get()`.**
   **Safari 18+ is `create()`-ONLY**, i.e. the PRF output is available only at the
   single instant the passkey is created and cannot be re-derived on a later unlock,
   *and* it carries open WebKit correctness bugs (311099 wrong bytes on CTAP2
   security keys; 314934 `null` on YubiKey C Bio; 284166 absent in the cross-device
   QR/hybrid flow — the exact flow a walk-up BYOD user hits). **Firefox Android:
   `get()` UNSUPPORTED.** So: feature-detect via
   `getClientExtensionResults().prf`, and **never block on it** — on iOS silently
   fall through to ranks 1+2.
4. **File System Access API secret file, for the operator-controlled-fleet
   population.** Chrome desktop 86+, **Chrome Android 132+**; **iOS and Firefox
   UNSUPPORTED**. This is *the only mechanism in the spike that produces a
   non-evictable, user-visible secret*, because a `FileSystemFileHandle` from
   `showSaveFilePicker()` points at a file in the **user-visible file system**, which
   is **not origin storage** — clear-site-data and ITP destroy the handle record,
   they do not delete the user's file. Two costs to record: it **re-prompts once per
   session** (the grant survives in IndexedDB, the permission does not, and
   `queryPermission()` on a re-opened handle resolves `prompt`), and it is absent on
   the population's likeliest platform. For the fleet — a *known* platform — the
   support limits stop being a blocker and become a configuration requirement, which
   is why it ranks 1st there and 4th for BYOD.

#### 5.6.2 Traps that must be recorded, because each is a plausible design error

- **PRF-wrapping is bound to the PASKEY, not to the user.** A new passkey is a new
  PRF value, so **the old ciphertext becomes unreadable**. Passkeys do not sync
  across ecosystems (iCloud ↔ Google Password Manager), so a browser or platform
  change silently orphans a PRF-wrapped backup. The export (rank 2) is the only rail
  that is genuinely browser-independent.
- **"Encrypted at rest, so it is protected" is FALSE when the wrapping key is also in
  device storage.** If both the ciphertext and the key are origin storage they die
  together on eviction *and* the page can read both under XSS. Encryption here buys
  **portability and opacity** — the blob is safe to publish, share or hand to a
  storage provider — and it buys nothing against eviction or XSS. Say *that*, not
  "protected".
- **`PasswordCredential` is not a rail.** Chrome-only (51+), and it is for *offering*
  an autofilled credential, not for reading a secret back; the Android autofill
  password store is **not script-readable**. Do not design around it.
- **NUT-20 locked quotes are NOT seed-recoverable and must be EXCLUDED from the
  auto-top-up loop.** This is the same constraint §4.3 already records; it is
  repeated here because the auto-top-up loop (§6.6) is where it would be violated.
- **No web API reaches the platform keychain / secure enclave.** WebAuthn is the only
  bridge to a platform-held key, and only as sign/assert-plus-PRF.
- **Storage diversity is NOT a mitigation.** localStorage + IndexedDB + OPFS +
  cookie all die together on clear-site-data. Redundancy must be **across the origin
  boundary** (an exported file, an FSA file, a synced passkey) — never within it. Any
  review that proposes "belt and braces, store it in three places" has misread the
  spike.
- **OPFS is not more durable than IndexedDB.** Same eviction class, and MDN states
  that clearing site data deletes the OPFS. Faster, not safer — and invisible to the
  user, so it cannot serve as an export.

#### 5.6.3 Failure semantics of the recommended composition — precise

| Event | Seed in IndexedDB | Encrypted export (off-device) | PRF-wrapped key | FSA secret file | Net outcome |
|---|---|---|---|---|---|
| **`Clear-Site-Data: "storage"` / "clear site data"** | **DESTROYED** (total, by definition) | survives | **passkey survives** — platform keychain, re-derivable | handle record destroyed, **the file on disk SURVIVES** | Recoverable if *any* of export / FSA file / working PRF passkey exists. Otherwise **the balance ≤ `T` is lost — by design, and disclosed.** |
| **iOS ITP 7-day cap** | **At risk in a Safari tab, and *out of the eviction path* once installed to the Home Screen — as documented policy, WebKit-only, with the in-practice behaviour a field check (§5.6.5).** | survives | n/a on iOS today (PRF `create()`-only) | n/a on iOS | The cap is published by WebKit as a **cookie** cap with script-writable storage *aligned* to it, **and** the policy page exempts the home-screen first-party domain from that cap on *all* script-writeable storage — the class IndexedDB is enumerated in. **Do not depend on the install for this row** — the exemption does not reach `Clear-Site-Data`/profile reset/device loss, so recoverability is still the export, and the loss is still capped at `T`. |
| **OS storage-pressure eviction** | survives if `persist()` granted; else evictable *without interrupting the user* | survives | survives | survives | Lowest-risk mode. Request `persist()` early, at a moment of user intent. |
| **Device loss / theft** | gone | **survives — this is the export's purpose** | **survives** — passkey syncs; key re-derives | gone unless the user copied the file off | Recoverable via export or synced passkey. **Not recoverable from device-local storage alone — and this ADR must not pretend otherwise.** |
| **Browser change / reset** | gone | survives | platform-dependent; a new passkey = **new PRF = old ciphertext unreadable** | survives if re-granted | The export is the only browser-independent rail. |
| **Private browsing / one-shot captive-portal context** | lost at session end | survives only if the export was completed in that session | n/a | survives (written to the user's FS) | **Assume this happens.** Never create funds-bearing state the user has not exported without disclosing it. |

#### 5.6.4 Install-to-home-screen is RECOMMENDED and materially better — and on iOS it is *documented* to take the wallet's storage out of the 7-day eviction path

> **REVISED 2026-10-14 (second correction — this one in the *strengthening* direction).** An earlier
> revision of this subsection overstated the claim as *"Apple has stated it will not evict this
> app's data"*; the first correction (below, kept for the record) removed that and then
> **over-corrected**, labelling the home-screen carve-out's reach into IndexedDB as `UNVERIFIED`.
> **That was itself wrong**: WebKit publishes the exemption *normatively* — the Tracking Prevention
> policy page's section *"Home Screen Web Application Domain Exempt From ITP"* says the home-screen
> web application's first-party domain *"is exempt from ITP's 7-day cap on all script-writeable
> storage"*, and ITP's 7-day section enumerates IndexedDB as a script-writeable storage form. The
> settled/unsettled split is spelled out in **§5.6.5**, which is the authoritative subsection and
> which this one now follows. **Read §5.6.5 before quoting this subsection.**
>
> What remains true from the first correction: the install is **not** a *data-durability guarantee*
> for the wallet — the policy is documented, its in-practice behaviour on a current iOS is not
> measured here, it covers WebKit engines only, and it says nothing about `Clear-Site-Data`, a
> profile reset, or device loss. The durability story is still the `T` cap plus the export (§5.6.1–§5.6.3).

What the install buys the wallet, and the list is now longer than the capability set:

- a **stable app identity** and standalone launch (§3.3; the manifest `id` defect is §6.3);
- an **install-gated** capability set — Periodic Background Sync is `CONTENT_SETTING_BLOCK` without
  it, and on iOS there is **no service worker at all** without it ([SB §3.2]);
- a **longer-lived service-worker registration**, which is what makes L1 (§6.6.4) reachable at all
  rather than moot;
- **on iOS, exemption from ITP's 7-day eviction of script-writeable storage** — WebKit's documented
  policy, quoted and scoped in **§5.6.5(a)–(b)**: the exemption is granted to the home-screen web
  application's first-party domain over the whole class of script-writeable storage, and IndexedDB
  is in that class. This is a **policy** statement, not a field measurement, and it is WebKit-only.

**What it must still not be claimed to buy — unchanged by the above:** protection against
`Clear-Site-Data: "storage"`, a profile reset, private browsing, device loss, or any non-WebKit
engine; and it is **not** the reason the ecash survives. The exemption is expressed with
*"all script-writeable storage"* as the class and does not contain the literal string "IndexedDB",
and whether a given install on a given iOS build behaves accordingly is a **field check (§11(10),
labelled `must-verify-on-device`)**. So label its status precisely: the **policy** claim is
`VERIFIED` as documented (§5.6.5(e)); the **in-practice** claim is not.

**The durability story that does not depend on the install is the one in §5.6.1–§5.6.3:** keep the
device-local balance below `T`, offer the one-tap encrypted export once balance ≥ `T`, and accept
that before the reveal the wallet is a **petty-cash purse** whose loss is capped and disclosed. The
install is **recommended**, is a first-order *capability* requirement — it is the *gate* for
background work and for a real service worker — and on iOS is additionally **documented** to remove
the storage from ITP's eviction path; but the ecash's survival is still a function of the **export**
and the **cap**, because none of the install's protections reach `Clear-Site-Data`, a profile reset
or device loss.

#### 5.6.5 The iOS 7-day eviction claim — precise scope, pinned evidence, and the wording that is permitted

This subsection exists because the riskiest sentence in this document is the one about iOS storage
eviction. It is the kind of claim that is *remembered* more strongly than it was ever *published*,
so the evidence is quoted here verbatim and the permitted wording is pinned to it. **No other part
of this ADR may state a stronger version than what follows.**

**(a) What WebKit actually published, quoted — the blog post, and then the normative policy page
this ADR previously failed to cite.**
`https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/` (2020-03-24), section
*"7-Day Cap on All Script-Writeable Storage"*, says: *"we announced that ITP would cap the expiry of
client-side cookies to seven days… Now ITP has aligned the remaining script-writable storage forms
with the existing client-side cookie restriction, deleting all of a website's script-writable
storage after seven days of Safari use without user interaction on the site."* The affected list it
gives is **Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and
cache**, and the same post's home-screen paragraph reads: *"Web applications added to the home
screen are not part of Safari and thus have their own counter of days of use… We do not expect the
first-party in such a web application to have its website data deleted."*

**That post is a 2020 announcement. The rule it announces is published normatively at
`https://webkit.org/tracking-prevention/` (fetched 2026-10-14), and that page carries a section the
blog post does not — the one this ADR previously missed** — titled **"Home Screen Web Application
Domain Exempt From ITP"**:

> The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all
> script-writeable storage, i.e. ITP always skips that domain in its website data removal
> algorithm. In addition, the website data of home screen web applications is kept isolated from
> Safari and thus will not be affected by ITP's classification of tracking behavior in Safari.

Under **Cookies** on the same page, the cap's own definition: *"ITP deletes all cookies created in
JavaScript and all other script-writeable storage after 7 days of no user interaction with the
website."*

**(b) Which of those is load-bearing for a bearer-value wallet, and what it does and does not
settle.** Three statements, in increasing strength, must not be collapsed:

1. **The install takes the origin out of ITP's eviction path — normative, settled.** The policy
   page's exemption is granted to **"the first-party domain of home screen web applications"**, and
   the cap it is exempted from is over **"all script-writeable storage"**. The adjacent 7-day
   section enumerates the class it means, and **IndexedDB is in it**. So on WebKit's own wording the
   exemption reaches the wallet's proof store. That is the strongest claim this ADR makes about the
   install, and it is **`VERIFIED` as documented policy** — not as a measurement.
2. **The 2020 blog post's home-screen sentence is the weaker half, and it is no longer the
   load-bearing citation.** It is (i) a sentence of **expectation** (*"we do not expect"*), (ii)
   about a **generic** unit — *"the first-party"*, *"its website data"* — and (iii) in a post whose
   declared subject is cookies. It supports *"Apple states it does not expect an installed
   home-screen web app's website data to be evicted on the Safari counter"* and nothing stronger.
   The policy page's exemption sentence is what carries the point; the post is corroboration.
3. **What neither settles: that a given install on a current iOS build behaves accordingly.**
   Everything above is **WebKit's documented policy**, not an independent field measurement, and it
   covers **WebKit engines only** — nothing here speaks to a non-WebKit engine, and nothing here is
   a measurement of a real installed wallet reading its IndexedDB bucket back after seven days.
   Whether a specific install on a specific iOS version is in fact exempt remains a **field check
   (§11(10))**, and the correct label for that half is **`must-verify-on-device`** — *not*
   `UNVERIFIED` for the policy claim, which is settled. Do **not** overclaim the other way either:
   the exemption paragraph does not contain the literal string "IndexedDB"; the claim rests on the
   *class* being named ("all script-writeable storage") and IndexedDB being enumerated in it.

**(c) The correction to the widespread "script-writable storage cap ⇒ IndexedDB is capped" reading.**
Two independent observations weaken it, and both are primary:

- **WebKit's own *normative* documentation is narrower than the blog post's headline.** The
  WebKit Tracking Prevention policy page — *"7-Day Cap on All Script-Writeable Storage"* under
  **Cookies** — says *"ITP deletes all cookies created in JavaScript and all other script-writeable
  storage after 7 days of no user interaction with the website"*
  (`https://webkit.org/tracking-prevention/`, fetched 2026-10-14). The heading is on the **cookie**
  family, and the enumerated *"latter storage forms"* are the ones the blog post already listed.
  There is no independent statement anywhere in the policy that gives **IndexedDB** a seven-day
  lifetime of its own. **Note carefully what this bullet does and does not say: it says the cap has
  no *IndexedDB-specific* clause of its own. It is NOT a statement that the home-screen exemption
  fails to reach IndexedDB — that exemption names the whole class ("all script-writeable storage"),
  and bullet (b)1 settles it. The two readings were conflated in an earlier revision of this
  subsection and that conflation is the error this revision corrects.**
- **Other user agents classify IndexedDB as *non-cookie* storage.** Mozilla, in its own words, ships
  a policy "designed as an alternative to the **older cookie policies**"
  (`https://developer.mozilla.org/en-US/docs/Web/Privacy/Storage_access_policy`), whose blocked sets
  are enumerated per-API — *"Cookies and storage"*, *"localStorage"*, *"IndexedDB"*, *"Cache"*,
  *"Messaging and Workers"* — i.e. IndexedDB is a **storage** category, not a cookie. MDN's eviction
  page says the same from the other direction: Safari's proactive eviction *"deletes all cookies set
  by server… Cookies set by server are exempt from this eviction"*, while the eviction **unit** is
  whole-origin data (*"all of its data, not parts of it, is deleted at the same time"*) — cookies and
  IndexedDB evict on **different triggers**, which is exactly why "the cap is on cookies" is a
  meaningful distinction rather than a technicality
  (`https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria`).

**So the correction to the *cookie* reading stands — the 7-day cap is a COOKIE cap, with
script-writable storage *aligned to* it (localStorage being the documented implementation
side-effect — WebKit's own justification is that third-party scripts *"moved to other means of
first-party storage such as LocalStorage"*). What the earlier revision of this subsection then did
with that correction was wrong, because it collapsed two *different* directions into a single label:**

- **"In 7 days iOS deletes the wallet's IndexedDB" — still not settled, and still must not be
  asserted.** There is no IndexedDB-specific seven-day clause anywhere in WebKit's policy, so a flat
  statement of this kind remains **`UNVERIFIED`**. (It is also the converse of the prohibition in
  §5.6.6 item 10, and equally forbidden in user-facing text.)
- **"The install exempts the wallet's IndexedDB from the 7-day cap" — settled as *documented
  policy*.** The policy page's exemption names the class ("all script-writeable storage") that
  IndexedDB is enumerated in, so this direction is **`VERIFIED` as WebKit's documented rule**
  (bullets (a)–(b) above). Only its *in-practice* half — that a real install on a current iOS
  behaves this way — remains `must-verify-on-device` (§11(10)).

The design consequences are unchanged in either direction, and that is why this is a correction and
not a design change: the mitigations in §5.6.1–§5.6.3 bound the loss at `T` and rely on the
**export** for durability, so they never rested on the eviction question. What *does* change is that
the install is now a **documented** protective factor rather than a hoped-for one — which strengthens
§5.6.4's recommendation without licensing the sentence §5.6.6 forbids.

**(d) The permitted wording.** Use exactly this:

> On iOS, adding the portal to the Home Screen is **recommended** and is a **capability**
> requirement — it is what makes a service-worker registration and any background wake possible at
> all ([SB §3.2]) — **and it is also documented to take the wallet's storage out of ITP's 7-day
> eviction path**: WebKit's Tracking Prevention policy states that *"the first-party domain of home
> screen web applications is exempt from ITP's 7-day cap on all script-writeable storage"*, and
> IndexedDB is one of the script-writeable storage forms ITP's 7-day section enumerates, so on
> WebKit's own wording the exemption reaches the wallet's proof store
> (`https://webkit.org/tracking-prevention/`, section *"Home Screen Web Application Domain Exempt
> From ITP"*, fetched 2026-10-14). That is WebKit's **documented policy**, not an independent field
> measurement, and it says nothing about non-WebKit engines; that a specific install on a current
> iOS actually behaves this way is still a field check (§11(10)). Apple's 2020 announcement adds a
> weaker sentence of *expectation* about *"website data"* generically
> (`https://webkit.org/blog/10218/`, 2020-03-24). The wallet's durability promise nonetheless rests
> on the **balance cap `T`** and the **one-tap encrypted export**, not on the install — and the
> seven-day cap remains a real risk to **cookie-backed** state either way.

**(e) `VERIFIED` vs `UNVERIFIED`, so a reader can tell them apart.**

| Statement | Status |
|---|---|
| WebKit deletes index-closed script-writable storage after 7 days of Safari use without interaction | **VERIFIED** — named in the post and the policy page, IndexedDB first in the list |
| The cap is described by WebKit in cookie terms, with script-writable storage *aligned* to it | **VERIFIED** — policy page heading + quoted justification |
| Firefox/MDN classify IndexedDB as *storage*, not *cookies* | **VERIFIED** — MDN Storage Access Policy, per-API block enumeration |
| Home-screen web apps are on their own day-counter | **VERIFIED** — same post, quoted above |
| **WebKit's policy exempts the home-screen web application's first-party domain from the 7-day cap on *all script-writeable storage* — the class IndexedDB is enumerated in** | **`VERIFIED` as WebKit's documented policy** — `https://webkit.org/tracking-prevention/`, section *"Home Screen Web Application Domain Exempt From ITP"*, quoted verbatim in (a). **The exemption paragraph does not contain the literal string "IndexedDB"**; the claim rests on the class being named and IndexedDB being in it. No longer `UNVERIFIED`. |
| **That a *specific* install on a *current* iOS build actually behaves this way** | **`must-verify-on-device`** — the policy is settled; the in-practice behaviour is not measured here, and it is a field check (§11(10)). A layer below (b)1, not a contradiction of it. |
| **WebKit's documented exemption is the *only* thing this settles: non-WebKit engines are not covered** | **`VERIFIED` as a scoping statement** — the policy is WebKit's; nothing here speaks for another engine, and no broader claim may be derived. |
| **Install-to-home-screen is required because otherwise the ecash is deleted in 7 days** | **`UNVERIFIED` as stated** — the correct statement is that the install is a *capability* requirement (§5.6.4), it is *documented* to remove the storage from ITP's eviction path ((b)1), and the export is the durability rail |

The WebKit source *files* were also checked, so the reader knows the limit of the check: the
`monitoredDataTypes()` set that ITP acts on — read from
`https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/NetworkProcess/Classifier/WebResourceLoadStatisticsStore.cpp`
— is `Cookies, DOMCache, IndexedDBDatabases, LocalStorage, MediaKeys, SearchFieldRecentSearches,
SessionStorage, ServiceWorkerRegistrations, FileSystem, ScreenTime, EnhancedSecurityRecord`, i.e. the
post's list is confirmed in code; but the *algorithm that selects which of them to delete for a given
origin* lives in the classifier's own task buckets, which is where the home-screen carve-out would be
implemented and which this ADR did **not** audit. **Stated so the claim's boundary is visible, and it
is now the *only* boundary left on this point: the list is verified in code, and the exemption is
verified as *documented policy* (the policy page's own section, quoted in (a)) — but the ADR has not
read the classifier's per-type selection logic, so what the implementation does for a given type on
a given build is a device field check (§11(10), `must-verify-on-device`), not something this
document asserts.**

#### 5.6.6 What this ADR must NOT claim about secret storage

Each is FALSE, and each is the kind of sentence that gets written by accident:

| Forbidden claim | Why it is false |
|---|---|
| "Your money is safe here." | A bearer wallet in a browser on a captive HTTP network is an XSS/shared-device/eviction target. Carried over from `docs/pwa-client-wallet-plan.md:66-69`. |
| "We store your seed in the device's secure enclave / OS keychain." | **No web API reaches the platform keychain.** WebAuthn is the only bridge, and only as sign/PRF (§5.6.1 rank 3). |
| "The secret is encrypted at rest, so it is protected." | If the wrapping key is also in device storage, encryption buys nothing against eviction (both die together) or XSS (the page reads both). It buys portability and opacity. |
| "The File System Access API works on mobile." | It works on **Chrome Android 132+**. **iOS and Firefox: UNSUPPORTED.** |
| "A passkey protects the wallet." | Passkeys authenticate; PRF *derives*. On Safari PRF is `create()`-only with three open correctness bugs. |
| "OPFS is more durable than IndexedDB." | Same eviction class; clear-site-data deletes it. |
| "We can read the seed back out of the password manager." | `PasswordCredential` is Chrome-only and not read-back. |
| "Restore from the seed alone." | **NUT-09 needs three things: seed + per-keyset counter + mint URL(s)** — and only `secretsPolicy: 'deterministic'` outputs are recoverable at all. Any backup blob must carry all three with the counter at a defined height. |
| "Top up via a locked quote and restore later." | **NUT-20 locked quotes are NOT seed-recoverable.** Exclude them from the auto-top-up loop. |
| "Add to Home Screen on iOS and your money is safe — the install exempts the wallet from the 7-day deletion." | **Still forbidden, but the reason is now narrower than an earlier revision said.** The exemption *is* documented (WebKit's policy names the home-screen first-party domain as exempt from the 7-day cap on all script-writeable storage, the class IndexedDB is in — §5.6.5). What makes the sentence false is everything the exemption does **not** cover: `Clear-Site-Data: "storage"`, a profile reset, private browsing, device loss, and any non-WebKit engine — plus the fact that it is documented **policy** whose in-practice behaviour on a current iOS is a field check (§11(10)). The install is a *capability* requirement and a documented ITP-exemption; durability is the `T` cap plus the export. |
| "In 7 days iOS deletes the wallet's IndexedDB." | **`UNVERIFIED` as a flat statement** (§5.6.5(c)) — there is no IndexedDB-specific seven-day clause in WebKit's policy, so the converse claim is not settled either. Label it, do not assert it. |

---

## 6. D2 — scope, sequencing and the workstreams

### 6.1 Workstreams

| WS | Content | Repo | Gate |
|---|---|---|---|
| **WS-1** | App-like shell: manifest reconciliation (`start_url`/`scope`/`id`/maskable icon, §6.3), manual add-to-home-screen guidance, i18n keys. **No service worker on this origin** (D3 §3.4: not achievable on HTTP-on-IP — the service worker lives on the vendor origin instead, §3.4 (d) / §3.6.4). | portal | after release |
| **WS-2** | Client wallet: `CashuWallet`/`CashuMint`, IndexedDB proof store, NUT-09 restore, threshold-gated seed reveal, automatic BOLT11 melt, policy engine. **Framed as convenience, never custody.** | portal | after release; depends on the 4.11.0 PR (§4.2 item 1) |
| **WS-3** | Module-side incremental rail: metered claim endpoint + paid-through watermark + restart-durable ledger, replacing all-or-nothing `PurchaseSession`. | module (**upstream — reviewers merge; this project never merges upstream `main`**) | needs operator sign-off + ADR question E/D |
| **WS-4** | Spillman channel rail (`cdk-spilman`). | module | **the ADR's own migration gate: the wallet must run on CDK AND a channel-capable client wallet must exist.** Track only. Do **not** bolt a bespoke drip protocol on in the meantime (ADR, verbatim). |

### 6.2 The red baseline must be fixed first — it is a precondition, not a nicety

Both of the repo's **mandatory** CI gates are red at `c2ddba1`, and this delta
re-states it because every wallet PR will be unreviewable behind a red baseline
`[D:portal §6.7, §8]`:

- `npm test` (vitest) is red for two independent defects: a JS heap OOM caused by
  an unstable `t` mock in `src/test/setup.js:3-13` driving an unbounded render
  loop in `src/components/__tests__/Cashu.race.test.jsx`, and 5 genuine assertion
  failures in `tests/unit/renew-after-expiry.test.jsx` caused by a mock missing
  newer exports. The workflow file itself admits the state in a comment
  (`ci.yml:47-48`).
- `npx playwright test --project=desktop` is **3 passed / 10 failed**, and every
  failing test is one that installs the mock backend: `tests/e2e/helpers/mock-backend.mjs:22-31`
  stubs a stale export list, so `src/components/Cashu.jsx:16`'s named imports
  cannot be satisfied and the app never mounts.

Also: `npm ci` **fails on npm ≥ 11** (`lockfileVersion: 3` optional
platform-sibling entries), and `README.md:25-26` currently points contributors at
the failing version `[D:portal §6.2]`.

**Sequencing rule: fix the baseline as its own PR, first.** Otherwise no
reviewer — human or agent — can distinguish a wallet regression from the
pre-existing red.

### 6.3 WS-1's concrete manifest defect list

The manifest exists but is structurally broken for its own `start_url`
`[D:portal §2.2, §2.3]`:

- `public/manifest.json:23` `start_url: "."` resolves relative to
  `/manifest.json` → `/`, which on a real router serves **404**.
- The build renames the entry HTML to `splash.html` (`package.json:18`) and
  rewrites only `asset-manifest.json` — **`manifest.json`'s `start_url` is never
  rewritten**. Meanwhile `src/BalancePage.jsx:92,102,127` render
  `<a href="/splash.html">`, so the app treats `splash.html` as canonically "the
  portal" while the manifest disagrees.
- The demo host deploys a raw `npx vite build` (no `rename-html`), so
  `gh-pages` ships `index.html` and the router ships `splash.html` from the same
  source — `start_url: "."` accidentally works on the demo and 404s on the
  router. Any fix must hold for both.
- `scope` is absent, and `id` is absent: without an `id`, the installed app's
  identity is keyed off `start_url`, so fixing `start_url` later orphans every
  existing install.
- `favicon.ico` is declared as a `72x72` icon (`:18-21`) and the shipped file is
  185,470 bytes; there is **no `purpose:"maskable"` icon**; `background_color`
  is `#ffffff` while `index.html:10` sets `theme-color: #000000` on a dark UI,
  so a white splash flashes before a black app paints.

### 6.4 Evidence-gated promotion

Per the standing operator directive: build from the **unmerged** branch →
publish a hand-deploy `curl | bash` artifact (fail-closed size + sha256) →
**the operator runs the manual pass** → only then merge → only then the feed
repin (`packaging/build-inputs.json` `portal.commit`). Worktrees live under
`~/worktrees/`, never `/tmp`; commits are pushed and PRs opened with evidence
attached to the cards.

### 6.5 Test rails — what exists and what the first test should be

`[D:rails]` measured the rails; the guidance survives unchanged:

- **Available today, no hardware:** the portal's own Vitest + Playwright suites
  (once §6.2 is fixed), and a local QEMU OpenWrt lab
  (`physical-router-test-automation/scripts/virtual-lab.py start-poc` +
  `run-local-tests.sh`) with the CDK fakewallet mint at
  `/opt/cdk-mintd/cdk-mintd`. `qemu-system-x86_64` and `/dev/kvm` are openable.
- **Blocked today:** the physical router rail — `192.168.1.0/24` is
  **unreachable from either host** (route goes via the home gateway
  `192.168.2.1`, which has no such network), so every router fact is
  `UNMEASURED`, not "broken" `[D:rails §4]`. And the Android emulator rail on
  DQ05 is live but at **load 11–13 on 4 cores**, above the skill's precondition
  (1-min load < ~4) `[D:rails §1]`.
- **Design constraint:** a captive-portal PWA must work over **plain HTTP on a
  non-secure origin**, so every router-free test must exercise the **http** path,
  not just `localhost`.
- **The single most valuable first test** is a hermetic, router-free
  "portal PWA over captive-portal HTTP" e2e: serve the portal on a plain-HTTP
  origin plus a stub TollGate API on `:2121` and a stub mint, then assert the
  document loads over `http://`, the manifest is linked and valid, the
  balance/venue render from the stub, a token paste/spend yields a payment
  request with a rendered QR and flips session state, and a **negative control**
  (stub detached ⇒ the *degraded* surface, never a fabricated invoice). The same
  assertions re-point at the emulator and at `http://192.168.1.1:8080` by
  changing only the base URL `[D:rails §6]`.

**Note for this test's SW assertion:** asserting "a service worker registers and
reaches `activated` on that non-secure origin" (as `[D:rails §6]` proposes)
**cannot pass on a non-secure origin** — this is the §3 finding. The test must
assert the inverse property, that `navigator.serviceWorker` is **undefined** on
the plain-HTTP origin and the app degrades predictably, until the vendor-origin path of
§3.4 (d) / §3.6 lands.

### 6.6 Background autonomy — the requirement, the honest limits, and the three-layer ship decision (mandated section)

This is the ADR the operator explicitly asked for. The spike behind it is
`~/reports/pwa-cashu/SPIKE-background-execution.md` — 375 lines, 45 numbered primary
sources, primary-source-only method (WHATWG/W3C/WICG specs, MDN browser-compat-data,
`chromium/src` on `main` read from gitiles, WebKit Bugzilla and
`WebKit/standards-positions`, `webkit.org`, Chrome Status, Apple developer docs, IETF
RFCs, the Cashu NUTs). Citations to it in this section are [SB §N] for a section and
[SB N] for one of its 45 sources; where a constant is quoted it is quoted **verbatim
from the source, not re-derived** — the spike was read, not re-run.

**The honesty rule for this whole section, stated once:** every capability below is
described at the strength the platforms' own sources support, and anything that could
not be pinned to one of those sources is labelled **`UNVERIFIED`** rather than softened
into vague language. That applies in both directions — a claim is not made *stronger*
to look better, and it is not made *weaker* to look cautious (§5.6.5 is the worked
example, and it was made to work in **both** directions on the same point: an early
revision strengthened it beyond the sources, a later one weakened it beyond them, and
the cited normative wording is what settled it).

#### 6.6.1 The requirement, in the operator's own words

> *"Lets keep some resting balance for UX. The user shouldnt have to manually
> interact with the PWA or a captive portal every time they have used up their
> balance. The PWA should automate the process of making small, frequent granular
> purchases in the background so that the user can focus on consuming internet
> rather than buying internet. … This also means that the PWA needs to be able to
> stay active in the background without getting paused / silenced by the operating
> system. How can we achieve this?"*

Stated as an engineering requirement: **the PWA automates small, frequent granular
purchases in the background so that the user focuses on consuming internet, not
buying it.** The resting balance of §5.4 is the *substrate* for this; this section
is the *schedule*, and it is where the honesty burden is highest.

**Step zero is a transport decision, not a scheduling decision.** Today the portal
is served over plain HTTP on `http://<router-lan-ip>:2051`, and service workers,
the Cache API, durable IndexedDB, Periodic Background Sync, one-shot Background
Sync and Web Push are **all secure-context-gated**, with Chrome's *installability*
criteria requiring HTTPS or loopback. On a LAN IP over `http`, **there is no service
worker to wake**, so the question of keeping one alive is moot. Nothing in §6.6 is
reachable before the vendor-origin transport path (§3.4 (d), §3.6) lands — and note
§3.6.5 item 1, a new constraint: a service worker **cannot raise the LNA prompt**, so the
foreground must make one LNA-requiring call before any SW-driven polling can be relied on.

#### 6.6.2 The honest verdict, platform by platform

| Platform | Background autonomy achievable | Mechanism |
|---|---|---|
| **Android Chrome** (installed PWA, engaged, secure origin) | **Best effort only, with hard caps.** An opportunistic attempt within minutes of connectivity returning, inside a 3-attempt / 5-min-then-15-min backoff budget and a 3-minute per-event execution ceiling. Periodic wakes: at most ≈ 2/day, and **frequently never**. | one-shot Background Sync (registered while the app was OPEN) + Periodic Background Sync as a best-effort backstop + Web Push only if a server exists |
| **iOS Safari** (Home Screen web app) | **Exactly ZERO without a push server. UNSUPPORTED.** | push event only — Periodic Background Sync and one-shot Background Sync are both absent from Safari |
| **Either platform, origin left on plain HTTP** | **Zero. UNSUPPORTED.** | nothing loads |

The Android numbers are not folklore; they are Chromium's own constants, read from
`main`: `kMaxSyncAttempts = 3`; `kInitialRetryDelay = 5 min` with a ×3 retry factor,
i.e. **5 min then 15 min and out**; `kMaxSyncEventDuration = 3 min`, enforced with
`CONTINUE_ON_TIMEOUT` (the browser stops waiting and lets the worker be torn down —
it does not kill the promise); `kMinPeriodicSyncEventsInterval = 12 h`. Both are
field-trial-overridable, so they are **Chrome's numbers, not a contract with this
app**.

Three gates matter specifically for a *venue portal*:

- **Periodic Background Sync requires an installed, separately-launched web app** —
  Chromium's permission context returns `CONTENT_SETTING_BLOCK` when the origin has
  no installed PWA, and it never prompts.
- **The engagement multiplier can make it "never".** The first-attempt delay is
  `site_engagement_factor × 12 h`; a zero engagement penalty returns
  `base::TimeDelta::Max()`, i.e. the event **does not fire late, it does not fire.**
  The multiplier has four tiers, so a well-used app gets ≈ 2/day, an occasional one
  every 24 h, a drifted-away one every 36 h, and a stopped-using-it one **none,
  ever**. The score is not purchasable; it decays with inactivity and one of its
  documented purposes is allocating background-sync resources.
- **Previously-connected networks only.** Periodic Background Sync activity occurs
  only on a network the device has **previously connected to** — which is precisely
  not the first visit to a venue, i.e. the roaming case the granularity design
  exists to handle is the case where the backstop is least likely to fire. Data
  Saver also suppresses it.

**And Doze is the outer envelope no API fixes:** in Doze Android blocks network
access and defers syncs, jobs and alarms to maintenance windows that
**get further apart over time**. A "frequent" background top-up on a sleeping phone
is a power-policy decision the OS owns, not a scheduling problem that can be
engineered around.

**iOS, stated as negatives with sources:** Periodic Background Sync is
`version_added: false` in BCD; `SyncManager` (one-shot) is likewise `false` with a
WebKit bug open since 2018; and WebKit's own standards-position issue (#14) remains
open carrying *power* and *privacy* objections — *"we generally have power and
security concerns about invisible background script execution by a site that the user
isn't currently visiting"* and *"this would allow a website to monitor you switching
IP addresses."* So iOS Background Sync is **unimplemented and unwanted, not merely
unfinished.** The only iOS wake source is a **push event**, which requires the Home
Screen install, a user gesture to subscribe, and — by Apple's policy — a
**user-visible notification on every single wake**, with **the push subscription
permanently revoked if the app ever fails to display one**. Declarative Web Push
(2025-03-27) makes notifications more robust; it is **not** a gain in background
autonomy, because its whole purpose is to *avoid* running your code.

> **Therefore, on iOS today, a background Cashu top-up driven by push is technically
> constructible and architecturally unacceptable**, because it converts "buy internet
> silently" into "buzz the user's phone every time you buy internet".

**Notification Triggers is UNSUPPORTED.** Chrome Status lists `showTrigger` as
*"In developer trial (Behind a flag)"* with **no milestone**, and Firefox/Safari are
`None`. **There is therefore no web API to schedule a local notification for a future
time** — the web platform has no "remind me in 20 minutes" primitive.

**The honest user-facing promise — the sentence the product is allowed to make, per platform.**
This is the operator's requirement stated honestly rather than as a hidden degradation, and it is
what Panel 1 (§7.1) must convey in the user's own language:

- **Android:** *the wallet may top up on its own* — best-effort, when the app was last open, only on
  a network the device has connected to before, and only while the platform permits it. It can
  happen without you. It is **not guaranteed to**.
- **iOS:** *the wallet tops up when you next open the app.* That is the whole promise. There is no
  background top-up on iOS without a push server, so the product says so up front instead of
  implying one.

**Why this is the right way to state it:** a promise of "it may top up by itself on Android, and on
iOS it will do it the moment you open the app" is a promise we can keep on both platforms, and it
degrades only in *latency*, never in *correctness* (§6.6.4's L0). The failure mode to avoid is the
hidden one — the user believing the phone is buying internet while asleep and discovering otherwise
only when the portal denies them. **Do not write, or let a panel imply, a uniform behaviour across
platforms, because there isn't one.**

#### 6.6.3 The router CANNOT be the waker

Three structural facts, all of which the portal's own design produces:

1. A service worker registration is **per-origin**, and the origin is
   `http://<router-lan-ip>:2051` taken from `window.location.hostname`. Roaming to a
   different router is a different registration, a different Cache, a different
   IndexedDB, a different home-screen identity. "Buy again at the new address" (D1) is
   therefore **what the platform forces**, not merely a policy choice.
2. A LAN IP cannot be a stable push endpoint, because the push subscription is bound
   to the origin.
3. **Waking a PWA requires the client device's browser to be scheduled.** The router
   cannot reach into the browser's scheduler. **The router can originate a
   "balance low" event but cannot deliver a wake.** It can serve the invoice and the
   balance; that is all.

So push means an **always-online third party in the money path** (FCM/APNs via a
server). For a sovereign product that is a **downgradeable optional dependency, never
a hard one**: full value must be delivered with **zero** push infrastructure,
degrading only in *latency*, never in *correctness*.

#### 6.6.4 The three-layer ship decision

**L0 — MANDATORY, platform-neutral: resumable journal + `last-spend` + top-up on
next open.** This is the correctness floor. It guarantees that any top-up that was
started is either completed or abandoned with a bounded, honest loss, and that
opening the app once always repairs the balance. **The product must be fully useful
with ONLY this layer.** No permission, no install, no push, no scheduler.

**L1 — MANDATORY, best-effort: opportunistic one-shot Background Sync on Android +
Screen Wake Lock foreground loop.** Register the one-shot sync **while the app is
open and before the balance runs low** (registration requires an open client — you
get durability of the attempt, not freedom to schedule it), and treat Periodic
Background Sync purely as a backstop. Design the handler for a 3-minute budget,
`prefer_async: true`, and a 3-attempt / 5-15-minute envelope. Keep the foreground
loop alive with a Screen Wake Lock while the UI is open. **Expose `lastChance`**:
when the platform says the attempt budget is gone, the app must be able to say so
visibly ("top-up incomplete; tap to retry") rather than fail silently.

**L2 — OPTIONAL and REMOVABLE: self-hosted Web Push.** Additive only, switchable off
without changing L0 or L1, and **never the sole rail**. On iOS the product must be
explicitly honest that enabling it means a notification per top-up.

**Explicitly NOT shipped:** anything relying on Notification Triggers, on iOS
background sync, on a router-side waker, or on a native app (a native app is the only
path to real *Android* autonomy, but it abandons the single-codebase PWA premise and
**does not solve iOS either** — `BGTaskScheduler` still decides when, if ever).

##### 6.6.4.1 L2's decision-ready inventory — the six documented workarounds, ranked, NOT to be built now

**Operator decision (2026-10-14): do not build a push service and do not build a native app now.**
The purpose of this table is that a **future ralph loop can pick one up without re-deriving it** —
each row carries its cost and its sovereignty implication. **None of these is being built, and none
should start without an operator decision that supersedes this one.** Ranking axes are the spike's
[SB §6]: reliability, autonomy, user friction, and sovereignty (does it add a third party).

| # | Workaround | What it actually buys | Cost | Sovereignty | Verdict for a future loop |
|---|---|---|---|---|---|
| **1** | **Self-hosted Web Push** | The **only** wake source for a *closed* app on **both** platforms; on Android it wakes a closed app, and on iOS it is push-or-nothing [SB §5.3][SB 9][SB 44] | On iOS it **mandates a visible notification per wake**, with the subscription **permanently revoked** if the app ever fails to display one [SB §3.2][SB 10][SB 11]; plus an always-online server to run | **Breaks it** — introduces an always-online third party in the money path (§6.6.3) | **This is exactly L2** (§6.6.4) — optional, additive, removable, never the sole rail |
| **2** | **Native Android app** | **Real Android autonomy**: WorkManager periodic + FCM, Doze-aware [SB §6][SB 38] | Two codebases, Play Store, signing, updates | Mixed | Only if **Android background autonomy becomes a stated product requirement**; it abandons the single-codebase premise |
| **3** | **Native iOS app** | **It does not solve the problem.** `BGTaskScheduler` is discretionary — the system decides *when*, and the task may simply not run [SB §6][SB 38] | Two codebases, App Store, signing | Mixed | **Do NOT plan an iOS native path around `NEHotspotHelper`**: verified 2026-10-14 against Apple's own documentation JSON, its platforms are *"iOS: introduced 9.0, deprecated at 26.0"* (message: *"Use NEHotspotManager API"*), i.e. **removed in iOS 26** [SB §6][SB 39] |
| **4** | **Android TWA (Play Store shell)** | Nothing for scheduling — a PWA in a Play Store shell **changes distribution, not scheduling**; the same browser scheduler runs underneath [SB §6][SB 41] | Play Store listing overhead | Neutral | **Distribution-only.** Never cite it as an autonomy fix |
| **5** | **App Store webview wrapper** | Nothing; it cannot schedule and it must survive review | Review risk | Neutral | Runs into App Store Review Guideline **4.2 Minimum Functionality** — *"include features, content, and UI that elevate it beyond a repackaged website"* [SB §6][SB 40] |
| **6** | **The L0/L1 architecture already shipping** | **Everything the product actually promises today** — correctness on next open, plus best-effort Android acceleration | None beyond L0/L1 itself | **Clean** — no third party at all | **This is the current answer** and the one this ADR ships |

**A cross-cutting precondition for rows 1–5:** every one of them is **unreachable until the
vendor-origin transport path (§3.4 (d), §3.6) lands**. Push needs a **secure-context, installable origin**; a native app needs
the same portal to authenticate against; a TWA needs an installable web app to wrap
[SB §0][SB 26][SB 27][SB 28]. **Transport is step zero for all six rows — including the one we are
shipping.**

#### 6.6.4.2 The decision on this section, recorded (2026-10-14)

**Decided:** the limits above are **accepted and documented, not worked around**, in this
phase. **Ship L0 + L1 only** — L0 (resumable journal + `last-spend` + top-up-on-next-open) is
the mandatory correctness floor and is platform-neutral; L1 (opportunistic one-shot Background
Sync on Android + Screen Wake Lock foreground loop) is additive and best-effort. **L2
(self-hosted Web Push) and any native app are NOT built now** — §6.6.4.1 is a decision-ready
inventory for a **future ralph loop**, not a backlog. The product is therefore **correct
everywhere and autonomous only on Android**, and that asymmetry is **stated to the user, not
hidden** (§6.6.2). Workarounds are deferred, not rejected.

#### 6.6.5 The persistence contract that makes a background melt safe

A `mint quote → swap → melt → verify` sequence cannot be made atomic inside a
3-minute, arbitrarily-terminable, sometimes-never-restarted context. The only correct
shape is **a durable intent journal plus a per-step idempotent resume check**, using
Cashu's own state primitives:

1. **Write intent before acting.** Journal `{granule_id, router_origin, invoice,
   mint_url, melt_quote_id}` to durable storage **before** the melt POST. Without the
   quote id an interrupted melt is unrecoverable client-side.
2. **One granule, one journal entry, one address**, and the entry stores the origin so
   a later wake can **abandon** rather than **mis-apply** it.
3. **Phase order: quote → persist → async melt → poll → persist outcome.** Never a
   single blocking call. NUT-05 warns in bold that a synchronous external-payment melt
   **blocks until success or failure** and can take a long time; with
   `prefer_async: true` the mint answers `200 OK` with state `PENDING` and the wallet
   polls. **This is the single most important architectural fit in the whole
   assessment: async melt converts a blocking, un-resumable operation into a
   two-phase one that survives an arbitrary kill between the phases.**
4. **Resume is poll-only.** NUT-07: a `PENDING` proof cannot be used in another
   transaction until it is live again, so a blind retry after a crash can lose the
   proofs *and* the quote. On any wake, first `GET` the melt quote and reconcile.
5. **Every write is idempotent and keyed on the quote id.** Multiple wakes,
   overlapping sync/PBS/push events and a foreground tab can all race; a Web Lock
   serialises them and a duplicate attempt must be a no-op rather than a second spend.
6. **Storage must be durable and origin-scoped** — IndexedDB, not memory (Chrome's own
   warning: *"Any global variables you set will be lost if the service worker shuts
   down. Instead of using global variables, save values to storage."*). **Do not
   justify this by the iOS ITP exemption alone** — that exemption is documented policy and WebKit-only
   (§5.6.5), its in-practice behaviour is a field check, and it does not reach `Clear-Site-Data`, a
   profile reset or device loss. Durability here comes from the journal being
   origin-scoped and from the balance being capped at `T` (§5.4, §5.6.4).
7. **Bounded abandonment.** If the address/entitlement changed, mark the intent
   `abandoned_rotated` and **stop**. Retrying a melt whose invoice belonged to a dead
   address burns value for entitlement that no longer exists. The loss is capped at
   one granule — D1's promise, preserved only if the code refuses to retry across a
   rotation.

**What this buys:** the background top-up is interruptible at any step without loss
beyond one granule, and resumable at the next wake. **What it does not buy:** it does
not create wakes. Recovery and autonomy are separate problems, and only the platform
creates wakes.

#### 6.6.6 What this ADR MUST promise

- **Crash-safety and resumability**: a top-up interrupted at any step — including by
  service-worker termination — is recoverable, and the client **never double-spends
  and never re-uses a `PENDING` proof**.
- **Bounded loss**: if the client rotates address or origin mid-flight, the in-flight
  granule is **ABANDONED, not retried**; per-rotation loss is at most one granule.
- **Async two-phase melt**: melt requests use `prefer_async: true` and are reconciled
  by polling the melt quote; **no blocking synchronous melt is issued from a
  background context**.
- **Degradation, not failure**: *"with background execution and push both
  unavailable, all value is still delivered on the next foreground open."*
- **On iOS the Home Screen install is REQUIRED for CAPABILITY — a real service worker and any
   background wake — RECOMMENDED for identity and registration lifetime, and *documented* to take
   the wallet's storage out of ITP's 7-day eviction path; it is still NOT a promise of proof-store
   data durability.** WebKit's Tracking Prevention policy states the exemption normatively
   (§5.6.5(a)–(b)): the home-screen web application's first-party domain is exempt from the 7-day
   cap on *all* script-writeable storage, and IndexedDB is enumerated in that class. That is
   documented policy, WebKit-only, and its in-practice behaviour on a current iOS is a field check
   (§11(10)); the exemption also does not reach `Clear-Site-Data`, a profile reset or device loss —
   which is why the wallet's durability promise remains the `T` cap plus the one-tap encrypted
   export (§5.6.4).
- **The pre-auth reachability assumption is declared** (§6.6.7), because the design's
  honesty depends on which way the module answers.

#### 6.6.7 What this ADR must NOT claim

Each prohibition carries the citation that **falsifies** it, so a future contributor cannot
re-derive the claim from the same sources and believe it was never checked. Spike citations are to
`~/reports/pwa-cashu/SPIKE-background-execution.md` by section ([SB §N]), which carries the
[1]–[45] source list.

1. ❌ **"The PWA tops up in the background while the phone is asleep."** Android Doze *"prevents apps
   from accessing the network and defers their jobs, syncs, and standard alarms"* [SB §2.2][SB 36];
   iOS has no non-push wake at all [SB §3.2][SB 42][SB 43][SB 8].
2. ❌ **"iOS supports this."** With no push server, iOS background autonomy is **exactly zero**:
   `PeriodicSyncManager` is `safari.version_added: false` [SB §3.2][SB 42] and `SyncManager`
   likewise with WebKit bug 182565 open since 2018 [SB §3.2][SB 7][SB 43].
3. ❌ **"Top-ups happen every N minutes/hours."** The developer's `minInterval` is a *request* rounded
   **up** to `site_engagement_factor × 12 h`; the shipped floor is `kMinPeriodicSyncEventsInterval =
   Hours(12)` and a zero engagement penalty returns `base::TimeDelta::Max()` — the event does not fire
   late, it **never fires** [SB §2.3][SB 13][SB 15][SB 17].
4. ❌ **"We schedule a local reminder notification."** Notification Triggers (`showTrigger`) is
   *"In developer trial (Behind a flag)"* with **no milestone** and Firefox/Safari `None` — there is
   **no web API to schedule a notification for a future time** [SB §2.1][SB 21].
5. ❌ **"The app stays alive in the background."** *"A user agent may terminate service workers at any
   time it: Has no event to handle"* [SB §4.1][SB 25]; only `waitUntil()` and a bounded budget
   exist.
6. ❌ **"Background sync guarantees delivery."** One-shot retries are UA-heuristic — *"the user agent
   may decide to retry it at a time of its choosing"* — and capped at `kMaxSyncAttempts = 3` with a
   5/15-minute backoff; the spec's own example falls back to telling the user [SB §2.4][SB 5][SB 13].
7. ❌ **"The purchase survives a roam."** Entitlement is address-scoped under R1 (§2.2); the promise
   is a **bound on the loss** (one granule, abandoned not retried), not continuity [SB §5.2].
8. ❌ **"It works today."** It does not, until the portal is a **secure context and installable** —
   Chrome's installability criteria require HTTPS or loopback and every background API is
   secure-context-gated, and the portal is served on `http://<router-lan-ip>:2051` [SB §0][SB 26][SB 27][SB 28].
9. ❌ **"Add to Home Screen on iOS and your money is safe — the install stops the 7-day deletion."**
   Still forbidden, for a narrower reason than an earlier revision gave. WebKit's policy **does**
   document the exemption: the home-screen web application's first-party domain *"is exempt from
   ITP's 7-day cap on all script-writeable storage"*, the class IndexedDB is enumerated in (§5.6.5(a)–(b)).
   The sentence is false because the exemption does not cover `Clear-Site-Data: "storage"`, a
   profile reset, private browsing, device loss, or any non-WebKit engine, and because it is
   documented **policy** whose in-practice behaviour on a current iOS remains a field check
   (§11(10)). The install is a **capability** requirement and a documented ITP-exemption (§5.6.4);
   durability is the `T` cap plus the export.
10. ❌ **"In 7 days iOS deletes the wallet's IndexedDB."** `UNVERIFIED` as a flat statement — there is
    no IndexedDB-specific seven-day clause in WebKit's policy, so this converse is not settled
    either §5.6.5(c). **Label it, do not assert it in either direction.**
11. ❌ **"Background sync registration is free and always available."** Registration *"may only be
    made while the main app is open"*, i.e. the platform grants durability of the attempt, **not**
    freedom to schedule it [SB §2.4][SB 29] — and Periodic Background Sync is
    `CONTENT_SETTING_BLOCK` without an installed PWA and never prompts [SB §2.3][SB 16].

#### 6.6.8 ANSWERED AND VERIFIED — can an unauthenticated client reach the Cashu mint through the walled garden?

**No. The answer is NO, and it is verified, not assumed.**

The payment leg (client → mint) is an internet service; the venue leg
(client → router → WAN) is what the granule buys and what is *gone* when
entitlement lapses. The deadlock is that the payment leg normally **rides through** the
venue leg — if the client has no entitlement it typically has no path to the
mint, so it cannot pay.

**Verified on the live router `tollgate-A04E` (rc4) from the running nodogsplash ruleset.** The
pre-auth allow-list is a **closed port list** — nodogsplash renders it as the gate's
`users-to-router` `FirewallRule` set, **11 entries verbatim from the running config**. The ruleset
as captured also contains an **empty `preauthenticated-users` block**, which is a real and
load-bearing detail, not a rendering artifact: the port list that actually governs a pre-auth
client is `users-to-router`, so anyone reading only the `preauthenticated-users` block would find
it empty and conclude nothing was allowed:

```
FirewallRuleSet preauthenticated-users {
}
FirewallRuleSet users-to-router {
  FirewallRule allow tcp port 22
  FirewallRule allow tcp port 23
  FirewallRule allow tcp port 53
  FirewallRule allow udp port 53
  FirewallRule allow udp port 67
  FirewallRule allow tcp port 80
  FirewallRule allow tcp port 2121
  FirewallRule allow tcp port 2050
  FirewallRule allow tcp port 2051
  FirewallRule allow udp port 123
  FirewallRule allow tcp port 443
}
```

Which is tcp `22 | 23 | 53 | 80 | 2121 | 2050 | 2051 | 443` plus udp `53 | 67 | 123`, and nothing
else. Everything else is `REJECT` (icmp-port-unreachable). The only permitted `443` destination is the
router's own uhttpd — **no general internet, therefore no mint.** (TollGate already advertised
`kind:21023 no-reachable-mints` when there is no uplink, i.e. mint reachability was already
treated as a payment precondition; the ruleset is what makes that concrete for the walled garden.)

**One maintenance note that must not be read off this capture as the intended end-state:** the
module's own writer (`packaging/files/etc/uci-defaults/99-tollgate-setup`,
`assert_nodogsplash_allow_entries()`) **deliberately removes** `allow tcp port 443` and
`allow tcp port 8080` from this list — LuCI is an admin surface and must not answer a guest
(the removal is re-asserted on both setup paths because an older build and `tollgate-cli ssl enable`
still write `:443`). The captured router is running **rc4 as shipped**, so its `:443` entry is the
pre-convergence state. **The captured list is what the rc4 gate is; the module writer's target list
drops `:443` — and this does not change the conclusion below, because the router's own uhttpd is
still the only `443` listener either way and no general internet is reachable.**

The scheduler consequence, stated plainly:

- **A background top-up can only ever PRE-EMPT a lapse, never restore one.** Every top-up
  must fire while entitlement is **still live** — which is exactly what the L1 one-shot
  Background Sync design already does (register while the app is open and the balance is
  healthy). The scheduler's job is therefore **runway-based**: know the runway and act before
  exhaustion, not after failure.

**Corollary worth recording:** the no-install fallback works *because* of this. The router can
reach a mint on its **own authenticated uplink**, so a **router-verified token paste is the only
mint path inside the walled garden**.

**Also recorded, as a privacy consequence of D1:** the Background Sync spec itself
notes that fetch requests within the sync event while backgrounded *"may reveal
something about the client's navigation history to passive eavesdroppers"* — for a
top-up that fires after the user leaves, the **mint's hostname is visible to the new
network**. Not a blocker; worth writing down.

#### 6.6.9 Field-verification obligations (before any claim reaches user-facing docs)

- Instrument the field reality with `chrome://site-engagement/` and DevTools'
  Background Services panel before writing any wake-frequency claim anywhere.
- Verify the iOS `notificationclick` absence on-device (BCD gives `safari_ios: false`;
  if taps *do* reach the worker, the push option is stronger than ranked here).
- Verify whether Periodic Background Sync ever fires for a venue-portal origin at all,
  given the previously-connected-network gate and the first-visit case.
- **Instrument the cross-platform asymmetry on both device families.** The launch-critical
  observation is the one §6.6.2's promise rests on: that the Android path really can top up with the
  app closed, and that the iOS path really does top up on next open. If the iOS observation
  contradicts the promise, the **promise** changes — not the observation.
- **The item that *was* `UNVERIFIED` and load-bearing in two places — does the iOS Home Screen install
  actually protect the wallet's IndexedDB bucket from the 7-day cap? — is now settled at the policy
  layer and open only at the device layer.** WebKit's Tracking Prevention policy states normatively
  that the home-screen web application's first-party domain *"is exempt from ITP's 7-day cap on all
  script-writeable storage"*, and IndexedDB is enumerated in that class (§5.6.5(a)–(b)), so the
  **documented** answer is YES and that half is `VERIFIED` (§5.6.5(e)). What is still open is the
  **in-practice** half, labelled `must-verify-on-device`: install the web app, leave it unopened for
  >7 days of Safari use, and read the IndexedDB bucket back — on a current iOS build, and with the
  policy's own WebKit-only scope kept in mind. Until that is done, the in-practice claim may not
  appear in user-facing text as fact; the documented-policy claim may, with its scope stated.
- **Confirm on-device what Apple's documentation states about `NEHotspotHelper` for the current
  release train**, since it is `deprecated at 26.0` per Apple's own docs JSON (verified 2026-10-14,
  §6.6.4.1 row 3). It governs whether any iOS native path is even technically available to a future
  loop, so the deprecation is a planning input, not trivia.

### 6.7 Scope — what the operator has decided is in and out, and when

**Framing (operator, 2026-10-14):** *"Please document this requirement as an ADR that
gets consolidated to the default branch as part of the PR. … Please think it
through with the consultants and please do a spike around this as well. Please
document your findings."*

Decisions this section records:

- **In scope, in this PR:** the documentation itself — this delta (§5.4 reversal,
  §5.6 secret storage, §6.6 background autonomy), plus the panels. Consolidation to
  the default branch happens **as part of this PR**, which is the operator's own
  framing and the reason the delta rides the existing `docs/pwa-wallet-adr-delta`
  branch rather than a second one.
- **Out of scope, per the card and §1:** no production code, no service worker, no
  wallet implementation, no merge to any `OpenTollGate/*` `main`. The three
  workstreams and their gates are §6.1 and are unchanged by this PR.
- **Mint reachability — resolved, not deferred:** §6.6.8's module policy question was the one
  **blocking** item, and it is now **ANSWERED NO and VERIFIED** against the live router
  `tollgate-A04E` ruleset (§6.6.8, §11(6) closed). Implementation is no longer gated on it.
  It changed the scheduler's shape rather than the ship scope: because there is no pre-auth
  mint path, a background top-up can only **pre-empt** a lapse, so it must fire while
  entitlement is still live.
- **Sequencing unchanged:** the red baseline is fixed first (§6.2), the transport
  question settles before any background-autonomy work (§3.4 / §6.6.1 — and it has now
  **settled**: §3.6 measures the vendor-origin path end to end, including a service worker
  registering), and L0 ships and is proven crash-safe before L1 or L2 are attempted (§6.6.4).
- **`if`/`elif`, stated precisely so a future loop cannot over-build:** **`if`** the origin becomes
  secure-context and installable (§3.4 (d) / §3.6 — the vendor origin, now measured to satisfy
  this) **`then`** L0+L1 ship; **`elif`** the vendor origin does **not** ship **`then`** L0 alone is
  the entire product, and the "until the transport settles" caveats come out of the
  user-facing copy (§6.6.7 item 8) but nothing else changes; **L2 stays out either way until the
  operator says otherwise.** Note the extra L1 obligation §3.6.5 item 1: a service worker cannot
  raise the LNA prompt, so the foreground must make one LNA-requiring call before any SW-driven
  polling is relied on. §6.6.4.1 is an inventory, **not a backlog** — it exists so the option
  does not have to be re-derived, not so it can be started.

---

## 7. Panels 1–3 — mockups

The three panels are delivered as a self-contained SVG set (see the PR
attachments `docs/mockups/pwa-wallet-*.svg`). They are **mockups, not
production assets**: no wallet code, no service worker, no real token, no real
mint URL.

Every panel is a *design statement* about one of the rules above, and each
carries the disclosure the ADR and the honesty constraint require.

### 7.1 Panel 1 — install/intro ("this is an app; here is which kind")

States, in the user's own language and before any money moves:

- what the portal is and that it can be added to the home screen;
- **which install path they are on** (§3.3): on Android/Chrome over HTTP there
  will be **no** install prompt, so the panel offers the platform-correct route
  or says plainly that none is available; on iOS it shows the Share → Add to
  Home Screen instruction;
- the honest offline statement: **there is no offline mode** on HTTP-on-IP,
  because there is no service worker;
- nothing about seed phrases, nothing about balances.

### 7.2 Panel 2 — wallet + "buy more time"

The wallet is framed as **convenience, never custody** (ADR: client-held ecash
is *"a UX convenience, explicitly not custody"*). The panel shows:

- held balance, visually separated from **session allowance** (the two numbers
  the user must not confuse — `docs/pwa-client-wallet-plan.md:80`);
- a "buy more time" action that buys **one small granule**, with the price and
  the granule size shown;
- a plain-language line for the §2.2 mechanism: *if you change network or your
  device changes address, your remaining access for this purchase ends; your
  unspent balance is still yours at the mint, and you can buy again* — this is
  the "explicit customer action and plain disclosure" R3 requires, and it is the
  panel's load-bearing sentence;
- **no seed prompt**, regardless of balance.

### 7.3 Panel 3 — the threshold seed moment

- Appears **only** when held balance would cross `T` (§5.4), never before a
  balance exists, and **never during a payment**.
- Shows the phrase **hidden by default** behind a visibility toggle, with an
  explicit confirmation checkbox and a copy button — the cashu.me pattern
  (`src/pages/welcome/WelcomeSlide3.vue`, `data-testid="onboarding-seed-confirmed"`).
- Offers the three responses of §5.4(4): write it down, export an encrypted
  backup, or "keep it small".
- Carries the one-line disclosure that before this moment the funds are
  **unrecoverable by construction** — stated plainly in one line, not as a modal
  wall, and stating the cap as the reason it is acceptable.
- Under the **operator's decision (§5.4) a resting balance is required, so this
  panel IS reachable and IS a designed-for moment** — it is the point at which the
  user is offered a durable copy of value they actually hold. It must still
  **never appear before a balance exists** and **never interrupt a payment**
  (§5.5), and it must not recur once completed. Under a `T = 0` configuration it
  would be unreachable by construction, because there would never be a resting
  balance — but that configuration is no longer the recommendation, and the panel
  is no longer justified as dead code.

---

## 8. Acceptance mapping

| Requirement | Where satisfied |
|---|---|
| ADR delta vs. `session-ticket-decision.md` R1–R6, covering D1 and loss bounding via granule size + client-held unspent ecash | §2 (esp. §2.2, §2.4) |
| Secure-context section stating exactly which install/offline paths are possible on an HTTP-on-IP portal | §3 (esp. the §3.3 table) |
| Both false premises corrected with evidence | §9 |
| Panels 1–3 mockups delivered | §7 + `docs/mockups/pwa-wallet-*.svg` |
| NUT/dependency decision documented | §4 |
| D4 reflects the operator's REVERSED decision: resting balance REQUIRED, `T` is the cap, with a justified default | §5.4 (esp. items 1–3), §1 D4 row |
| Panel 3 reachability corrected — reachable and designed-for, still never before a balance and never mid-payment | §5.5, §7.3 |
| Secret-storage decision documented (device-local + persisted + cap; one-tap encrypted export; opportunistic PRF; FSA for the fleet) with traps and prohibitions | §5.6 |
| Background-autonomy requirement documented with the honest per-platform limits, the three-layer ship decision (L0 mandatory / L1 mandatory best-effort / L2 optional-removable), the promises, the prohibitions, and the **formerly-open module question now answered and verified** | §6.6 |
| Background-execution **limits + documented workarounds** recorded as a decision-ready inventory (L2 included) with cost and sovereignty per option, explicitly marked NOT-to-build-now so a future loop need not re-derive it | §6.6.4.1 |
| The **decision on the background limits recorded**: accepted and documented, not worked around; **L0 + L1 ship**, L2/native deferred to a future ralph loop; asymmetry (**correct everywhere, autonomous only on Android**) stated to the user | §6.6.4.2, §6.6.2 |
| Mint reachability resolved from **OPEN to VERIFIED NO**, with the live-router ruleset quoted and the pre-empt-only scheduler consequence stated | §6.6.8, §11(6) |
| Every prohibition carries the citation that **falsifies** it, not just an assertion that it is false | §6.6.7 items 1–11 |
| iOS install-durability claim scope-corrected **in the strengthening direction**: the install is a **capability** requirement *and*, per WebKit's Tracking Prevention policy, the home-screen first-party domain is **exempt from ITP's 7-day cap on all script-writeable storage** — the class IndexedDB is in — so install = capability + **documented** ITP-exemption (WebKit-only; in-practice behaviour still a device field check), while durability remains the `T` cap + the export | §5.6.4, §5.6.5, §6.6.6 |
| Operator's scope framing recorded (ADR consolidated to the default branch as part of this PR) | §6.7, §6.6.8 |
| Every claim cited `file:line` or doc URL | inline throughout; unmeasured items labelled `UNMEASURED` |
| The **dead end withdrawn**: §3.4's former option (a) (portal TLS with a client-accepted cert) marked **not available**, with the measured self-signed split (secure context YES / service worker NO) and the no-public-CA-for-a-LAN-IP blocker | §3.4, §3.6.1, §3.6.3 |
| The **vendor-origin architecture and the Local Network Access finding** recorded with the measured denial text, the kebab-case `PermissionName` trap, the post-`Allow` results and the grant's stickiness across a browser restart | §3.6, §3.6.4 |
| The **costed options A–E** recorded with the recommendation (**ship A now, C as the architectural target**) and the two binding constraints (`:2121` CORS in the Go handler → W3's PR; signed money path, MAC-bound grant, single-use nonce, idempotent POST) | §3.6.6, §3.6.7 |
| The **mixed-content-vs-PNA question RESOLVED** (the gate is Local Network Access, measured distinctly from mixed content), with the deployment item left OPEN | §3.6.4.1, §11(1) closed, appendix `ORIGIN` / open-questions |
| The **vendor-origin dossier published** so its citations resolve for a reader of the PR | `docs/analysis/DOSSIER-vendor-origin-and-selfsigned.md`, `docs/analysis/README.md` |
| Docs lint/render passes | §10 |
| No secrets committed; no live drift | §10 |

---

## 9. Corrections to the brief's premises

Two premises in the brief for this workstream are false. Both were re-verified
independently while writing this delta, not relayed from the recon.

### 9.1 "`walle.cashu.me` is an internal reference to imitate" — the origin is unreachable

- It resolves: `getent hosts walle.cashu.me` → `64:ff9b::a45a:f366` (and IPv4
  `164.90.243.102`).
- TLS **fails verification**: `curl https://walle.cashu.me/` aborts with
  `SSL certificate problem: self-signed certificate` —
  `ssl_verify_result=18`, `http_code=000`.
- With verification disabled, the origin answers **HTTP 404**, header
  `content-type: text/plain`, body `404 page not found` (20 bytes). **No SPA is
  served at `/`.**
- Therefore: what `walle.cashu.me` renders is **`UNMEASURED`**, and the
  requirement "imitate walle.cashu.me internally" is **unvalidated**. This delta
  did **not** assume it is "cashu.me with a different skin".
- For contrast, `https://cashu.me` returns **HTTP 200** (reachable).

### 9.2 "cashu.me is React (the porting source)" — it is Vue 3 + Quasar

- `~/repos/cashu.me` @ `e21f5fab875b67de0fc5367a79710054d2c1f80f` declares
  `"vue": "^3.4.27"` and `"quasar": "^2.18.2"` in `package.json`.
- `grep -c '"react"' package.json` → **0**. There is no React anywhere in
  cashu.me's dependency set.
- The stack is **Vue 3 + Quasar v2 (Vite)**, with Pinia for state and Dexie for
  IndexedDB `[D:wallet §1.1]`.

**Consequence:** any plan that starts from "port the React wallet" starts from a
false premise — and this matters beyond naming, because the two things worth
copying from cashu.me are *patterns*, not code: the hidden-then-confirmed seed
slide (§5.4) and the `meltGeneric` sizing discipline (§4.3). Copying them into a
React portal means re-implementing patterns, not transplanting components.

### 9.3 A third premise worth correcting while we are here

The prior plan's payment row describes the shipped client as POSTing *"a signed
Nostr **kind-21000** event carrying the whole token"*
(`docs/pwa-client-wallet-plan.md:34`). **That is no longer the shipped client.**
`src/helpers/cashu.js:301-308` posts the **bare token** with
`Content-Type: text/plain`, and the function's own comment
(`src/helpers/cashu.js:294-300`) explains that the backend authorises the spend
from the token itself, deriving the device identity from the socket, not from a
Nostr signature. `kind-21000` survives only as a **server-side tolerance**
(`src/main.go:1045-1057`: `extractCashuToken` returns the raw body unless it is a
kind-21000 event) `[D:portal §4.1]`.

This is not cosmetic: the whole *"pay a full token per event"* framing that the
incremental-billing gap analysis was built on comes from that inaccurate row.
The correction changes the size of WS-3's problem — the module already accepts a
bare token, so what is missing is a *metered additive* endpoint, not a
de-Nostrification.

Also worth deleting while touching this path: `src/helpers/cashu.js:3` imports
`getPublicKey, getEventHash, getSignature` from `nostr-tools` and **none of the
three is referenced anywhere else in the file**, so `nostr-tools ^1.17.0` is a
pure dead dependency of the payment path, and the `CU105` i18n strings
(*"Failed to generate keys to sign the payment event"*,
`public/locales/en.json:98-99`) are unreachable `[D:portal §4.1]`.

---

## 10. Verification of this document itself

- **Markdown renders:** the file is CommonMark-only — ATX headings, pipe tables,
  fenced code blocks, no raw HTML, no reference-style links, no embedded images.
  Tables are single-line-per-row so they render in GitHub's flavour.
- **Citation completeness:** every factual claim carries an inline `path:line`,
  a grep command, or a URL. Items that could not be measured are labelled
  `UNMEASURED` with the reason rather than asserted (§3.5, §9.1). Dossier-sourced
  claims carry `[D:*]` markers.
- **SHAs recorded:** see the baseline table at the top of this document. All five
  were re-derived from `git rev-parse HEAD` or the npm tarball while writing this
  delta; none is carried over from memory.
- **No secrets, no live drift:** this delta adds documentation and SVG mockups
  only. It contains no token, key, or credential; the mockups use placeholder
  values. It changes no production file, no manifest, no package,
  no CI config. `git status --porcelain` over the branch shows only added files
  under `docs/`.
- **Amendment discipline (2026-10-14):** the three mandated amendments — the D4
  reversal (§5.4, §1, §5.5, §7.3), the background-autonomy section
  (§6.6), and the secret-storage subsection (§5.6) — were pushed as additional
  commits onto the **existing** `docs/pwa-wallet-adr-delta` branch so that a single
  open PR carries the whole delta. No new branch, no second PR. This paragraph is
  the record that the amendment was an *amendment*, not a rewrite of the earlier
  reasoning: the honesty content of the original §5.4 (the cap-not-encryption
  argument, "unrecoverable by construction before first reveal", the recovery
  triple, `secretsPolicy: 'deterministic'` as a build-time invariant,
  counters-before-network-call, and the "not custody" constraint) was preserved
  verbatim and re-scoped, not deleted.
- **Cross-reference hygiene:** section numbering was re-checked after the two
  mandated sections were inserted. `§7.3` (not `§7.4`) is Panel 3; `§6.6` is
  background autonomy; `§6.7` is scope; the new open question is `§11(6)`.
- **Amendment discipline (second pass, 2026-10-14) — limitations, workarounds, and the iOS correction:**
  a follow-up pass added **no new section on background autonomy** (the concurrent pass had already
  landed §6.6, so this pass **extended it in place**). What it added and changed: the decision-ready
  workaround inventory **§6.6.4.1**; the honest per-platform user-facing promise in **§6.6.2**; the
  falsifying citation on each of **§6.6.7 items 1–11** (items 9 and 10 are new and about install
  durability); the [SB §N] citation convention, the spike's 375-line/45-source provenance, and the
  global honesty rule in **§6.6**'s preamble; extra field-verification obligations in **§6.6.9**; the
  `if`/`elif` scope note in **§6.7**; the §8 acceptance rows above; and open question **§11(10)**.
  **The correction:** §5.6.4 was **restated** (install = capability requirement, not a data-durability
  guarantee), the new §5.6.5 (the eviction-scope audit) was **added** to pin the published wording, and the strong version of the claim was
  softened to match the evidence in **five more places** — §5.3's bullet, §5.6.3's table row,
  the pre-existing prohibition subsection (renumbered §5.6.6 from §5.6.5), §6.6.5 item 6, and §6.6.6.
  **That pass over-corrected in one respect, corrected in the fourth pass below:** it labelled the
  home-screen carve-out's reach into IndexedDB `UNVERIFIED`, which is wrong — WebKit publishes the
  exemption normatively. It did correctly label the flat converse ("iOS deletes IndexedDB in 7 days")
  `UNVERIFIED`, which stands. **No claim was deleted**; the one direction that could not be verified
  from a primary source (that iOS deletes IndexedDB in 7 days) remains `UNVERIFIED` rather than
  asserted or silently dropped.
- **Amendment discipline (third pass, 2026-10-14) — the background decision and the mint answer:**
  the branch was **rebased onto the live `pr/pwa-wallet-adr-delta` tip `09ecc7d`** (PR #75) and two
  required edits were made. **(a)** A new **§6.6.4.2** records the operator's decision on the
  background-execution limits: they are **accepted and documented, not worked around**; **L0 + L1
  ship**, **L2 and any native app are not built now**, and the resulting asymmetry (**correct
  everywhere, autonomous only on Android**) is stated to the user rather than hidden. **(b)**
  **§6.6.8 was converted from an OPEN BLOCKING QUESTION to a VERIFIED ANSWER — NO** — with the live
  router `tollgate-A04E` (rc4) nodogsplash pre-auth `preauthenticated-users` allow-list quoted in
  full, the `REJECT` default stated, and the consequence recorded: a background top-up can only ever
  **pre-empt** a lapse, never restore one; a router-verified token paste is the only mint path inside
  the walled garden. **§11(6)** is struck through and marked **CLOSED — ANSWERED NO, VERIFIED**; the
  §8 acceptance mapping gained a row for each. **No claim was deleted.** The appendix (operator
  decision log) is unchanged by this pass and remains the last section of the document.
- **Amendment discipline (fourth pass, 2026-10-14) — §3.4's dead end, the vendor origin, and the
  Local Network Access crux:** a second measurement pass on the *same* rig family (headed Chrome
  for Testing 156.0.8078.4 under Xvfb+openbox, real pointer clicks, and — unlike the first spike,
  which used `--ignore-certificate-errors` and therefore silently skipped the gate — a **real**
  certificate interstitial and a genuine **public → private** address-space transition) **withdrew
  §3.4's former recommendation** and replaced it with a measured one. What changed: **(a)** §3.4's
  option (a) is marked **not available** (a self-signed cert gives a secure context and **no**
  service worker; no public CA issues for a LAN IP or an internal name) and a new option (d), the
  **public HTTPS vendor origin `https://portal.orangesync.tech`**, is the recommendation, with the
  `:2051` splash page deep-linking to it; options (b) and (c) are kept verbatim. **(b)** A new
  **§3.6** records the whole measured architecture: the four-gate self-signed split with the exact
  probe output, the per-platform trust stores (**usable for an MDM fleet, unsupported for BYOD**),
  the dead end and the cost of split-horizon, the **Local Network Access** crux with its measured
  denial text, its **kebab-case `PermissionName`** trap, its post-`Allow` results and its
  **stickiness per origin across a browser restart** (which is what strengthens D1 — only the
  *entitlement* is address-scoped), the three design constraints (workers cannot raise the prompt;
  `ws://` is not an escape hatch; the enterprise pre-grant policy is announced but not shipped),
  the **costed options A–E**, and the binding constraints (`:2121` CORS + `OPTIONS` 204 in the Go
  handler → **W3's PR, not this one**; signed money path, MAC-bound grant, single-use nonce,
  idempotent POST). **(c)** §11's unverified-lead item and the appendix's crux item are
  **RESOLVED with the measured answer** — the gate is **Local Network Access, not mixed content**,
  the two having been measured distinctly in one run — while the **deployment path to
  `orangesync.tech` stays OPEN**. **(d)** `docs/analysis/DOSSIER-vendor-origin-and-selfsigned.md`
  was added and listed in `docs/analysis/README.md`, so every `[D:origin §N]` citation above
  resolves for a reader of the PR. **§3.3's table was not touched (still correct), no claim was
  deleted, and the appendix remains the last section of the document.**
- **Amendment discipline (fifth pass, 2026-10-14) — two material findings from a cross-family review
  of PR #75, both re-verified by the operator before being applied.** **(a) §5.6.5 corrected in the
  *strengthening* direction, and this is the document's own best example of the honesty rule working
  in both directions.** The reviewer found a WebKit policy section this delta had never cited:
  `https://webkit.org/tracking-prevention/`, *"Home Screen Web Application Domain Exempt From ITP"*,
  which states normatively that the home-screen web application's first-party domain *"is exempt from
  ITP's 7-day cap on all script-writeable storage"* — the class whose adjacent 7-day section
  enumerates **IndexedDB**. The second pass had cited only the 2020 blog post's weaker sentence of
  *expectation* about *"website data"*, and on that basis labelled the exemption's reach into
  IndexedDB `UNVERIFIED`. **That label was wrong and is removed:** the policy claim is now
  `VERIFIED` as WebKit's documented policy, and the only residual open item is the *in-practice*
  half, relabelled `must-verify-on-device` (§11(10)). The honest scoping is kept explicitly — it is
  documented policy, not a field measurement, and it is **WebKit-only** — and nothing else was
  weakened: export is still the recoverability story, the loss is still capped at `T`, and "not
  custody" still applies. Propagated to §5.3's bullet, §5.6.3's table row, §5.6.4, §5.6.6's
  prohibition rows, §6.6.5 item 6, §6.6.6, §6.6.9, the §8 summary row, §10's honesty-rule note, and
  §11(10). **(b) A phantom citation resolved by *shipping* the file.** `EVIDENCE-vendor-origin-and-selfsigned.md`
  was cited in three places as the raw evidence behind every `[measured]` claim and the appendix said
  it was "in `docs/analysis/`" — but it was not in the PR, while `docs/analysis/README.md` admitted it
  was not reproduced. The two contradicted. Rather than reword the citations down, the file was
  **added to `docs/analysis/`** (14 KB, secrets-scanned: no key, token, seed, mnemonic or password;
  it carries the same bench/LAN/global-IPv6 addresses the dossier already publishes) and the README
  was updated to list it, so **every `[measured]` citation now resolves for a reviewer**. **(c)** Two
  reviewer-flagged leads were checked rather than assumed: `src/main.go:424` as the module's `:2121`
  listener was **confirmed** against the pinned SHA `cf7cad3` (`apiListenAddr = ":2121"`), and §6.6.8's
  nodogsplash port list was **corrected to the verbatim live ruleset** (it is the `users-to-router`
  ruleset's 11 entries, tcp `22|23|53|80|2121|2050|2051|443` + udp `53|67|123`, which the compact
  quoted form had compressed into a `preauthenticated-users` block). **No claim was deleted, the
  appendix remains the last section of the document, and the trailing newline is preserved.**

---

## 11. Open questions this delta does not close

1. ~~Whether the portal can be served over an **accepted** TLS certificate
   pre-authorisation — the only route to a real SW/install prompt (§3.4 (a)).~~
   **CLOSED — ANSWERED, MEASURED 2026-10-14.** §3.4's option (a) is a **dead end** and is
   withdrawn: a self-signed certificate yields a secure context (`isSecureContext:true`,
   `crypto.subtle`/`caches`/`PaymentRequest`/`indexedDB` all present) but **not** a service
   worker — measured `SecurityError: … An SSL certificate error occurred when fetching the
   script` **after a real user click-through** — and no public CA will issue for a LAN IP or
   an internal name. The route to a real SW/install prompt is instead the **public HTTPS
   vendor origin** (§3.4 (d)): **`https://portal.orangesync.tech`**, with the `:2051` splash
   page deep-linking to it. See **§3.6** for the full measured record, including the
   self-signed split, the per-platform trust stores, and the **Local Network Access** crux.
   Evidence: `DOSSIER-vendor-origin-and-selfsigned.md` (§0.1, §1.2, §1.3, §3.4) +
   `EVIDENCE-vendor-origin-and-selfsigned.md` — **both shipped in `docs/analysis/` in this PR**,
   so every `[measured]` line below is checkable against the raw transcript.
2. The operator's concrete value for `T` **below the cap the reverse decision
   requires** — see the dedicated item §11(7); the earlier "this delta recommends
   `T = 0`" reading is superseded by §5.4.
3. ADR question **E/D** on the module side (per-step invoice vs. metered claim),
   which WS-3 is blocked on.
4. The CSP `connect-src` `http:` vs `https:` lead in §3.5 — unverified in a real
   browser and material to the wallet. **Still open** — §3.5 is unaffected by §3.6, which is
   about the *transport* to the portal, not the portal's own `connect-src` to a mint.
5. Where service-worker updates get versioned relative to the feed's portal pin.
   **This is no longer moot** — §11(1) is closed and the vendor origin **does** ship a service
   worker (§3.6.4, measured `register()` **ok**), so a live SW update channel now exists and
   must be versioned deliberately: the SW precache must **exclude the entire money path**
   (§3.6.7), and the wallet must be able to tell a stale money-path bundle from a current one.
6. ~~**BLOCKING, module-owner answer required BEFORE implementation (§6.6.8): can an
   UNAUTHENTICATED client reach the Cashu mint through the walled garden?**~~ **CLOSED —
   ANSWERED NO, VERIFIED 2026-10-14.** Operator answer: **no**. Verified on the live router
   `tollgate-A04E` (rc4) from the running nodogsplash ruleset: the gate's **`users-to-router`**
   ruleset carries the pre-auth allow-list verbatim as **11 entries** (tcp
   `22|23|53|80|2121|2050|2051|443`, udp `53|67|123`) — note the captured
   `preauthenticated-users`
   block is **empty**, so the `users-to-router` set is the one that governs — and everything else is
   `REJECT`
   (icmp-port-unreachable); the only permitted `443` destination is the router's own uhttpd,
   so there is **no general internet and therefore no mint**. Consequence: a background top-up
   can only ever **PRE-EMPT** a lapse, never restore one, so every top-up must fire while
   entitlement is **still live** — which the L1 one-shot Background Sync design already does.
   Corollary: a **router-verified token paste is the only mint path inside the walled garden**.
   See §6.6.8.
7. **The operator's concrete value for `T`** under the reversed §5.4 decision. This
   delta proposes `T = 8 × granule` (~1 day of typical usage, i.e. tens of sats) and
   states that `T` is operator-tunable; the constraint is not the number but that the
   operator is genuinely prepared to write off `T` sats per lost device and that the
   promise "the most you can lose is `T`" stays truthful.
8. **Field verification of the background-autonomy claims (§6.6.9):** whether
   Periodic Background Sync ever fires for a venue-portal origin at all; the real
   web-service-worker idle timer on Chrome Android; the per-origin engagement
   penalty observed on a real device; and the iOS `notificationclick` BCD absence,
   which is load-bearing for the push option and is flagged `must-verify-on-device`
   rather than treated as settled.
9. **`NEHotspotHelper`'s deprecation in iOS 26** (Apple's docs JSON: `introduced 9.0`,
   `deprecated at 26.0`, message *"Use NEHotspotManager API"* — verified 2026-10-14,
   §6.6.4.1 row 3). Recorded as a **planning input** for any future iOS native path: the one
   genuinely native iOS Wi-Fi wake primitive is being withdrawn, and its named replacement
   (`NEHotspotManager`) has not been examined by this delta.
10. **Settled at the policy layer, open at the device layer — does the iOS Home Screen install
    protect the wallet's IndexedDB bucket from the 7-day cap?** **The documented answer is YES and
    that half is `VERIFIED`:** WebKit's Tracking Prevention policy page, section *"Home Screen Web
    Application Domain Exempt From ITP"*, states that the home-screen web application's first-party
    domain *"is exempt from ITP's 7-day cap on all script-writeable storage"*, and IndexedDB is one
    of the script-writeable storage forms the adjacent 7-day section enumerates — so on WebKit's own
    wording the exemption reaches the proof store (§5.6.5(a)–(b), §5.6.5(e)). Earlier revisions of
    this delta labelled this `UNVERIFIED`; **that label was wrong and has been removed.** What
    remains open is the **in-practice** half, labelled `must-verify-on-device`: whether a *specific*
    install on a *current* iOS build behaves accordingly — install the web app, leave it unopened
    for >7 days of Safari use, and read the IndexedDB bucket back. Two scoping limits are part of
    the closing statement, not caveats to it: the policy is **WebKit-only** (it says nothing about
    any other engine, so the Android/other-engine position is unchanged), and it says nothing about
    `Clear-Site-Data`, a profile reset or device loss. The flat converse — "iOS deletes the wallet's
    IndexedDB in 7 days" — remains **`UNVERIFIED`** (there is no IndexedDB-specific seven-day clause
    in the policy) and may not reach user-facing text either.

---

# APPENDIX — Operator decision log (the discoverability artifact)

This appendix is the **append-only decision log** for the PWA client-wallet workstream.
It exists so the reasoning survives context loss and can be found from the repository
rather than only from a local state file.

Each entry records the operator's decision **verbatim where possible**, what it settles,
and what remains open. The ADR sections cited are in this document.

---

## How to use this

- New decisions are **appended**. Existing entries are never rewritten — if a decision is
  reversed, a new entry records the reversal and says which entry it supersedes.
- This appendix is the durable record. A working copy also lives at
  `~/.hermes/profiles/manager/state/pwa-wallet-decisions.md` (local-only, not in any repo),
  so the repository copy here is the one that can be found.

---

## D1 — Reconciliation: granularity, not carry-over · CONFIRMED

**Operator, verbatim:** *"yes indeed we want to make it easy for users to rotate at any point
in time. Ideally they would rotate between every payment, but that has UX downsides because
it interrupts their session and creates a new session. They would need to leave the network
and reconnect etc. which takes time and interrupts their internet connection. However,
bounding the loss with granularity doesn't hurt UX and it makes it easy for users to rotate
their MAC address without sunk cost when they anyway leave the network and come back."*

Later confirmed: **"Yes exactly."**

**Settles:** no session carry-over across addresses. The client keeps unspent ecash
client-side as a bearer instrument and buys again at the new address. **Granule size is the
loss knob** — sized so the sunk cost at the natural leave/rejoin rotation point is
negligible.

**Why this is the only option:** the module's `RebindSession` reads only *that router's*
session map (`src/merchant/session_ticket.go:425`), and a ticket is signature-invalid after a
restart. Nothing federates a customer grant to a peer router. Independently, a service-worker
registration is **per-origin**, and the portal origin is the router's LAN IP — so roaming
changes the origin, and therefore the registration, Cache, IndexedDB and home-screen identity.
**The platform forces this design as much as the ADR does.** See §2.

---

## D2 — Scope: ralph loop for the portal, separate PRs for the rest · DECIDED

**Operator, verbatim:** *"PWA shell + wallet in one ralph loop. How many PRs you make is up to
you. Module side incremental billing and spillmann channels get their own PRs. Lets track
spillmann channels as a future task, but lets not build that now."*

**Settles:** PWA shell + client wallet are developed as **one ralph loop**; PR granularity is
the implementer's call. Module-side incremental billing is its **own PR**. Spillman channels
are **tracked only — do not build.**

See §6 and §6.7.

---

## D3 — Secure-context spike: do it FIRST · CONFIRMED, AND IT DISPROVED THE PREMISE

**Operator, verbatim:** *"Yes please do that first."*

Later, on the finding: *"Yes please put this on the todo list and investigate it. Figure out
how we can work around this constraint and document all your findings in the PR."*

**Settles:** the spike runs before any service-worker work.

**Outcome — this is the most consequential finding in the workstream.** The premise
*"install the PWA from the captive-portal page"* is **unsupported by spec**. Measured on a
live rig (Chrome for Testing 156) against `http://<lan-ip>:8099`:

```
isSecureContext: false, hasNavigatorServiceWorker: false,
hasCryptoSubtle: false, hasPaymentRequest: false, hasCaches: false
```

There is **no install prompt, no service worker, no Cache API, no `crypto.subtle`** on that
origin. W3C Secure Contexts §3.1 step 9, and the spec note: *"Neither origin's domain nor
port has any effect on whether or not it is considered to be a secure context."*

**Trap recorded:** `navigator.serviceWorker` is **`undefined`**, not a catchable
`SecurityError`. A `try/catch`-based feature detect **crashes** with `TypeError` instead of
degrading.

**Measured negatives** (each kills a plausible workaround): mDNS / `.local` / LAN hostname
all `isSecureContext:false`; CAPPORT (RFC 8908) is irrelevant to PWAs and unimplemented in
Chromium; a service worker registered on one origin cannot serve another.

See §3 and §9.

---

## D4 — Seed threshold `T`: REVERSED to a required resting balance · DECIDED

**Operator, verbatim:** *"Lets keep some resting balance for UX. The user shouldnt have to
manually interact with the PWA or a captive portal every time they have used up their
balance. The PWA should automate the process of making small, frequent granular purchases in
the background so that the user can focus on consuming internet rather than buying internet.
Please document this requirement as an ADR that gets consolidated to the default branch as
part of the PR. This also means that the PWA needs to be able to stay active in the
background without getting paused / silenced by the operating system. How can we achieve
this? Please think it through with the consultants and please do a spike around this as well.
Please document your findings."*

On the value: **"Yes please do that."** (the implementer selects `T` and documents it).

**⚠️ This SUPERSEDES an earlier recommendation in this document's own history.** An earlier
draft recommended `T = 0` (exactly-on-demand melt, zero resting balance). That is **wrong**
and has been corrected: a resting balance is **REQUIRED**, and `T` is the **cap on it**, not a
threshold at which to prefer zero. The document history should be read with this in mind.

**Settles:** resting balance required; `T` is operator-tunable and chosen by the implementer;
the load-bearing user-facing promise is *"the most you can lose is `T`"*. **The cap — not any
storage or encryption mechanism — is what makes the design safe.**

**Consequence:** because there is now a resting balance, there IS something to lose, so the
secret must be recoverable — which is why the secret-storage question became load-bearing
rather than nearly moot. See §5.

---

## D5 — Client identity fork (module-side, papered for W3) · OPEN

The module keys everything on the **socket-resolved MAC** (`src/main.go:850`) and
**explicitly ignores client-supplied identifiers** (`src/main.go:866-897`). A metered PWA
therefore needs either (a) a signed mint-independent **client key** accepted as a session key
— a `clientIdentity` security-surface change — or (b) a **session ticket per top-up**, which
revives the *held* rebind design and contradicts R3.

**Recommendation carried forward:** (b) is disqualified by R3. If the module-side incremental
rail is worth building at all it is (a), and it needs its own security review before code.
**Alternative:** skip module-side incremental billing entirely and bound loss via granule size
plus client-held ecash, which is fully R1-compatible and needs no module change. This is
**not** blocking the portal work. See §4 and §6.7.

---

## SEC — Device / file-system secret storage · ANSWERED

**Operator, verbatim:** *"How about we offer to store the secret on the users device / file
system so that the user doesn't need to write anything down and to reduce the interactivity
for the user? Would this help?"*

**Settles:** yes, it helps — but the two goals separate and have opposite difficulty.

- **Reduce interactivity: yes, today, on every browser.** Generating entropy on-device and
  persisting it is a pure client-side choice.
- **Survive eviction without a write-down: no, not with one mechanism.** `clear site data`
  destroys *all* origin storage at once, including any device-local key. Durability requires
  the secret to live **outside** origin storage.

Recommended composition and the full trap list are in §5.6.

---

## BG — Background autonomy · LIMITS ACCEPTED AND DOCUMENTED, NOT WORKED AROUND

**Operator, verbatim:** *"thats fine for now. Just document the limitations and the potential
workarounds for the time being. We will address these problems in a dedicated ralph loop in
future."*

**Settles:** ship **L0 + L1 only.** L2 (self-hosted Web Push) and any native app are **not
built now**; they are documented as a decision-ready inventory for a future ralph loop.

The limitation is stated plainly and the workarounds are ranked with cost and sovereignty
implications. See §6.6.

---

## MINT — Can an unauthenticated client reach the mint? · **NO** (operator), VERIFIED

**Operator, verbatim:** *"no, please see my earlier response for clarification."*

**Verified on the live router `tollgate-A04E` (rc4) from the running nodogsplash ruleset.**
The pre-auth allow-list is a **closed port list** — carried by the gate's `users-to-router`
ruleset, **11 entries verbatim** (tcp `22 | 23 | 53 | 80 | 2121 | 2050 | 2051 | 443`, udp
`53 | 67 | 123`). The captured ruleset's `preauthenticated-users` block is **empty**; the list that
governs a pre-auth client is `users-to-router`. Full quote and the module writer's `:443` removal
note: **§6.6.8**.

```
FirewallRuleSet preauthenticated-users {
}
FirewallRuleSet users-to-router {
  FirewallRule allow tcp port 22
  FirewallRule allow tcp port 23
  FirewallRule allow tcp port 53
  FirewallRule allow udp port 53
  FirewallRule allow udp port 67
  FirewallRule allow tcp port 80
  FirewallRule allow tcp port 2121
  FirewallRule allow tcp port 2050
  FirewallRule allow tcp port 2051
  FirewallRule allow udp port 123
  FirewallRule allow tcp port 443
}
```

Everything else: `REJECT` (icmp-port-unreachable). The only permitted `443` destination is the
router's own uhttpd — **no general internet, therefore no mint.**

**Consequence for the scheduler:** a background top-up can only ever **pre-empt** a lapse,
never restore one. Every top-up must fire while entitlement is **still live** — which is
exactly what the L1 one-shot Background Sync design already does (register while the app is
open and the balance is healthy).

**Corollary:** the no-install fallback works *because* of this. The router can reach a mint on
its own authenticated uplink, so a router-verified token paste is the only mint path inside
the walled garden.

---

## ORIGIN — Vendor HTTPS origin · DECIDED, with a question outstanding
### ↳ the outstanding question is now CLOSED BY MEASUREMENT — see the appended **ORIGIN-2** entry

**Operator, verbatim:** *"thats unfortunate. Lets host one on orangesync.tech for the time
being, but lets also look for workarounds. Can a self seigned credentials be useful here?"*

**Settles:** host the PWA on `orangesync.tech`. Investigate self-signed credentials as a
workaround.

**Working answer on self-signed:** useful for an **operator-controlled fleet** where the
operator controls the trust store; **not** viable for BYOD walk-up users, because Chrome on
Android does not trust user-installed CAs. Full analysis and the ordered decision list are in
`DOSSIER-vendor-origin-and-selfsigned.md`.

**Outstanding:** the crux question is whether an **https PWA calling `http://<router-ip>:2121`
is blocked as mixed content or by a Private Network Access preflight** — if so, the router
itself needs TLS or the call must be proxied. This is under investigation and is not yet
resolved.

---

## ORIGIN-2 — Vendor origin + Local Network Access · RESOLVED BY MEASUREMENT (2026-10-14)

**Does not reverse or rewrite `ORIGIN`; it closes the question that entry left outstanding.**

**The crux question — "is an https PWA calling `http://<router-ip>:2121` blocked as mixed
content or by a Private Network Access preflight?" — is ANSWERED: it is neither. It is blocked
by Chrome's Local Network Access permission.** Measured, in one run, on a rig with a *genuine*
public → private address-space transition (headed Chrome for Testing 156.0.8078.4 under
Xvfb+openbox, real pointer clicks):

- Public → **private** (`http://192.168.2.20:8018`): `blocked by CORS policy: Permission was
  denied for this request to access the \`local\` address space` — **the LNA permission.**
- Public → **public** (insecure): `This request has been blocked; the content must be served
  over HTTPS` — **mixed content.** The two gates are distinct and both observable.
- Chrome 156 sends **no** `Access-Control-Request-Private-Network` (measured `None`), so the
  legacy PNA preflight is **superseded** — `Access-Control-Allow-Private-Network: true` is dead
  code on this path.
- After **one** user click on *"…wants to Access other devices on your local network [Block]
  [Allow]"*: `GET` **200 cors**; preflighted `POST /ln-invoice?mac=…` **200 cors**;
  `serviceWorker.register('/sw.js')` **ok**; and the **grant survived a browser restart**.
  **The grant is sticky per origin** — one grant on `portal.orangesync.tech` holds for every
  TollGate router the user visits, which is what lets the wallet's ecash and identity persist
  on a stable origin (only the *entitlement* is address-scoped — this **strengthens D1**).

**Self-signed credentials — answered NO as a path to a PWA.** With the user's real click-through,
`isSecureContext:true` and `crypto.subtle`/`caches`/`PaymentRequest`/`indexedDB` all present, but
`register()` fails with `SecurityError: … An SSL certificate error occurred when fetching the
script`. **A secure context and a service worker are different gates.** And no public CA will
issue for a LAN IP or an internal name. Private-CA TLS stays **usable for an MDM-managed
operator fleet** and **unsupported for BYOD on every platform checked**.

**Decision status: not reversed, executed.** The `ORIGIN` decision (host the PWA at
`https://portal.orangesync.tech`, and investigate self-signed) **stands and is now the
recommendation with the mechanism named**: §3.4 (d) + §3.6 of this delta. The costed options,
the binding constraints (`:2121` CORS and `OPTIONS` 204 in the Go handler → **W3's PR**; signed
money path, MAC-bound grant, single-use nonce, idempotent POST), and the three design
constraints (workers cannot raise the LNA prompt; `ws://` is not an escape hatch; the
enterprise pre-grant policy is announced but not shipped) are in **§3.6**.

**Still open, deliberately:** the **deployment path** to `orangesync.tech` (see the last list in
this log) — and note the apex is **broken today** (`tlsv1 alert internal error` on `:443`).

**Evidence:** `DOSSIER-vendor-origin-and-selfsigned.md` and
`EVIDENCE-vendor-origin-and-selfsigned.md`, both in `docs/analysis/` in this PR (the raw
transcript was added in this pass so the `[measured]` claims are checkable; `docs/analysis/README.md`
lists it in the same table).

---

## HW — Hardware validation rail · RESOLVED (and an earlier report was WRONG)

**Operator, verbatim:** *"Please use the routers that are connected to the hermes fleet via
serial. Those are for you to test against."*

**Settles:** the serial-attached routers are the hardware test rail.

**CORRECTION recorded:** an earlier recon concluded *"physical router unreachable — no route
to 192.168.1.0/24, needs an operator-provided segment."* **That was wrong.** The rail existed
the whole time; the probe only checked the network and never the serial devices. **Rule for
the future: when a hardware rail is declared unreachable, probe the serial ports before
believing it.**

**The device, measured read-only:**

- Host `tollgate-A04E` (uci `tollgate.device.nym='c08r4d0r'`), on
  `/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_BG02QAPG-if00-port0`, 115200 8N1
- OpenWrt **24.10.2**, mediatek/filogic, aarch64, kernel 6.6.93
- **`tollgate-wrt 0.6.0_rc4-r1`** — the release candidate this workstream gates on
- `:2121` tollgate-wrt · `:2050` nodogsplash · **`:2051` the portal** (the PWA target) ·
  `:80` router-home · `:443` · `:8080`
- `br-lan 192.168.1.1/24` (guest LAN) · `lan1 192.168.2.16/24` (uplink) ·
  `br-private 10.63.101.1/24`
- Network path is blocked by **firewall policy, not routing**: the router has
  `default via 192.168.2.1 dev lan1`, but fw4 classifies `lan1` as WAN with input policy
  `drop`.

**Note:** the bench router is **single-owner**. Any harness must take a lock and re-verify
router identity before handover.

---

## RELEASE — Integration gate · CONFIRMED

**Operator, verbatim:** *"Yes this is the upcoming release. You can work on the plan now, but
it wont get merged till after v0.6.0"* — and *"yes we still need to wait for this before we
integrate any new features. You can open your PRs as draft PRs in the meantime though"*.

**Settles:** work on branches freely; **merge only after `v0.6.0`** (non-prerelease) ships.
Open **draft PRs** in the meantime.

---

## CASHU-TS — version bump · IN SCOPE

**Operator, verbatim:** *"Lets bump the version as part of the PR."*

**Settles:** `@cashu/cashu-ts` 2.9.0 → **4.11.0** is part of the portal PR, not a separate
change. Recorded constraints: v4 is ESM-only; `Proof.amount` is `bigint`/`Amount`;
**`wallet.restoreAll()` does not exist** in the shipped types — use **`batchRestore`**; do not
jump to `5.0.0-rc.11`; and **NUT-20 locked quotes must be excluded from the auto-top-up loop**
because quote-lock keys are not seed-recoverable. See §4.

---

## VALIDATION — software AND hardware · REQUIREMENT

**Operator, verbatim:** *"Please make sure all your work is tested & validated in software,
and hardware."*

**Settles:** software (unit + host-mode + the serial-driven router harness) **and** hardware
(the live `tollgate-A04E`).

---

## WALLE — validation becomes a ralph objective · DECIDED

**Operator, verbatim:** *"lets make it part of the ralph loops objectives to validate that this
is possible."*

**Settles:** `walle.cashu.me` validation becomes a **standing, re-runnable ralph objective**
rather than a one-shot check — because the URL may come up or change, and the design must not
rest on an unvalidated premise. Current status: **unreachable** (self-signed cert, `HTTP/2
404`, no SPA at `/`).

---

## STACK — Vue/Quasar port and coco · ANSWERED

**Operator, verbatim:** *"Would it make sense to port the captive portal to vue/quasar
instead? Would it help if we use coco instead of wallet.cashu.me?
https://github.com/cashubtc/coco/ Whats your recommendation and why?"*

**Settles:** **stay React + `@cashu/cashu-ts`; hand-roll the wallet layer.** Do not port; do not
adopt coco at this phase.

- **Do not port to Vue/Quasar:** ≈7,000 LOC of first-party rewrite (`src/` 2,860 + `admin/`
  2,506 — and `admin/` is **Preact, not React**, so a port is a *second* rewrite — plus
  `tests/` 1,706) to buy ≈300 framework-neutral lines. ≈**1:23 against.** And cashu.me's own
  counter persistence is hand-rolled **localStorage**, i.e. a port hands us a *worse* counter,
  not a solved one.
- **Do not adopt coco now:** it would remove ≈250–350 of our ≈400–700 lines, but forces
  `cashu-ts` to **5.0.0-rc.4**, dragging an RC across the `getDecodedToken` path our `CU1xx`
  decode precedence sits on. **Revisit at the channel phase.**
- **Framing correction:** `walle.cashu.me` is **not a library and cannot be embedded** —
  cashu.me is a standalone app (~30,448 LOC, 113 files). Copy patterns (MIT), do not embed.

See `DOSSIER-portal-stack-decision.md`.

---

## Open questions this log does not close

1. ~~**Mixed content / Private Network Access** for an https PWA calling the router's http
   `:2121` — the crux of the vendor-origin design. Under investigation.~~
   **CLOSED — ANSWERED, MEASURED — see the `ORIGIN` entry above and §3.6.4 / §3.6.4.1.**
   The gate is **Local Network Access**, not mixed content: the two were measured separately
   in the same run (public → *public* insecure fetch blocked by **mixed content**;
   public → *private* blocked by the **LNA permission**, `Permission was denied for this
   request to access the \`local\` address space`). After **one** user `Allow`, the `GET`,
   a preflighted `POST /ln-invoice?mac=…` and `serviceWorker.register()` all succeed, and
   the grant **survives a browser restart** — sticky per origin.
2. **D5** — the module-side client-identity fork (only matters if the module rail is built).
3. **Deployment path to `orangesync.tech`** — VPS1 (`66.92.204.38`) was unreachable at the
   time of writing and VPS2's SSH was closed, so the deploy needs an operator-provided path.
   **STILL OPEN** (deliberately not closed by this pass). Note also that the **apex is
   broken today**: `http://orangesync.tech/` 308-redirects on `:80` into a `:443` listener
   whose handshake fails (`tlsv1 alert internal error`, `no peer certificate available`), so
   any operator-facing link to the apex is dead until the Caddy site block is repaired.
4. Whether the **R1–R6 amendment** is ratified upstream or remains one operator's proposal.
   Any incremental design must cite an accepted amendment or rest on the ADR's own sanctioned
   answer ("small, granular purchases bound the loss from a rotation mid-purchase").
