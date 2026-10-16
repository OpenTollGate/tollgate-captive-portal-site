# SPIKE — Captive-Portal Secure-Context Problem for Service Workers / PWA Install

**Project:** TollGate captive portal as an installable PWA holding a Cashu wallet client-side, auto-paying BOLT11 invoices.
**Date:** 2026-10-14
**Author:** Hermes (delegated spike)
**Status:** Facts confirmed by spec text, browser source, and **first-hand measurement on this host** (Chrome for Testing 156.0.8078.4, Linux x86_64).
**Method:** spec/source reading + a live rig: a plain-HTTP server on the LAN IP `192.168.2.20:8099`, a self-signed-TLS server on `192.168.2.20:9443`, a CORS-enabled HTTP server on `:8098`, a Chromium profile, `/etc/hosts` entries, and headless probes that report `window.isSecureContext`, `'serviceWorker' in navigator`, `crypto.subtle`, `caches`, and actual `register()` outcomes. All numbers below marked **[measured]** are real output from that rig, not recall.

---

## 0. Executive answer (read this first)

**The premise of "install the PWA from the captive-portal page" is UNSOUND and must be dropped.**

A captive portal is served as plain `http://` on a bare IP (e.g. `http://192.168.1.1:8080`, or the intercepted/gateway page). That origin is **Not Trustworthy** per the W3C spec, and in Chrome `navigator.serviceWorker` is **not merely rejected — it does not exist**. **[measured]** On `http://192.168.2.20:8099`:

```json
{"isSecureContext":false,"hasNavigatorServiceWorker":false,
 "hasCryptoSubtle":false,"hasPaymentRequest":false,"hasCaches":false}
```

Consequence: on the portal origin there is **no install prompt, no SW, no Cache API, no `crypto.subtle`, and no `PaymentRequest`** — i.e. no PWA shell and no place to run a Cashu wallet safely. The in-page install path is **UNSUPPORTED**, and no CAPPORT/OS feature changes that.

There is exactly **one** mechanism that genuinely gives an operator-controlled device a secure context on a LAN IP: the Chromium **secure-origin allowlist** (`--unsafely-treat-insecure-origin-as-secure` / the `OverrideSecurityRestrictionsOnInsecureOrigin` enterprise policy). It is **[measured working]**, it is *narrow but decisive*, and it is **only viable for a device-owned fleet, never for BYOD walk-up users**. For BYOD, the honest answer is the one in §5: **installation happens on a secure origin elsewhere; the portal page only deep-links to it.**

---

## 1. The spec facts, precisely

### 1.1 The normative algorithm

W3C **Secure Contexts** (Editor's Draft / FPWD), §3.1 *Is origin potentially trustworthy?*
<https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy>

Verbatim steps and outcomes:

> 1. If origin is an opaque origin, return "Not Trustworthy".
> 2. Assert: origin is a tuple origin.
> 3. If origin's scheme is either "https" or "wss", return "Potentially Trustworthy".
> 4. If origin's host matches one of the CIDR notations `127.0.0.0/8` or `::1/128` [RFC4632], return "Potentially Trustworthy".
> 5. If the user agent conforms to the name resolution rules in [let-localhost-be-localhost] and one of the following is true — origin's host is "localhost" or "localhost."; origin's host ends with ".localhost" or ".localhost." — then return "Potentially Trustworthy".
> 6. If origin's scheme is "file", return "Potentially Trustworthy".
> 7. If origin's scheme component is one which the user agent considers to be authenticated, return "Potentially Trustworthy". *(Note: See §7.1 Packaged Applications.)*
> 8. If origin has been configured as a trustworthy origin, return "Potentially Trustworthy". *(Note: See §7.2 Development Environments.)*
> 9. Return "Not Trustworthy".
>
> **Note: Neither origin's domain nor port has any effect on whether or not it is considered to be a secure context.**

§3.2 *Is url potentially trustworthy?* adds: `about:blank`, `about:srcdoc`, and `data:` URLs are Potentially Trustworthy (they inherit context).

### 1.2 The enumerated list (and the LAN-IP verdict)

| Origin | Potentially Trustworthy? | Authority |
|---|---|---|
| `https://…` | **Yes** | spec §3.1 step 3 |
| `wss://…` | **Yes** | spec §3.1 step 3 |
| `http://127.0.0.1`, `127.0.0.0/8` (incl. `127.0.0.2`) | **Yes** | spec §3.1 step 4 |
| `http://[::1]` (`::1/128`) | **Yes** | spec §3.1 step 4 |
| `http://localhost`, `http://localhost.` | **Yes** | spec §3.1 step 5 + [RFC6761] §6.3 |
| `http://foo.localhost[.]` | **Yes** | spec §3.1 step 5 |
| `file://…` | **Yes** (UA SHOULD; may opt out) | spec §3.1 step 6, §5.2 |
| `data:`, `about:blank`, `about:srcdoc` | **Yes** | spec §3.2 |
| `app:` / `chrome-extension:` — "schemes the UA considers authenticated" | **Yes, UA-dependent** | spec §3.1 step 7, §7.1 |
| Origin explicitly configured as trustworthy | **Yes, UA-dependent** | spec §3.1 step 8, §7.2 |
| **`http://192.168.1.1:8080` (bare LAN IP)** | **NO — Not Trustworthy** | spec §3.1 step 9; "neither origin's domain nor port has any effect" |
| **`http://some-router.lan` / `http://portal.local` (private IP via DNS/mDNS)** | **NO — Not Trustworthy** | ditto; trust follows the *scheme*, not the network topology |
| **`http://0.0.0.0`** | **NO — Not Trustworthy** | not loopback-range; **[measured]** `isSecureContext:false` |
| `http://` on any public hostname | **NO** | spec §3.1 step 9 |

**A LAN IP over http is never trustworthy.** Citing the spec directly: step 4 grants trust only to `127.0.0.0/8` and `::1/128` — RFC 1918 ranges (`10/8`, `172.16/12`, `192.168/16`) are absent by omission, and the closing note deletes any "but it's a local network" reasoning by stating that domain and port are irrelevant. MDN states the same in plain language and even uses the exact mirror-image example: `http://localhost` ✅ Secure, `http://example.com` ❌ Not secure, with "delivered from a loopback (local) address" as the only local exemption.
MDN: <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>

### 1.3 Chrome's implementation matches the spec, in order

`net/base/is_potentially_trustworthy.cc` — `IsOriginPotentiallyTrustworthy()` carries the spec steps as numbered comments (including the literal spec URL) and returns `false` at the end.
<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/is_potentially_trustworthy.cc>

The local-host predicate is deliberately narrow — `net/base/url_util.cc`, `IsLocalHostname()`:

> `return base::EqualsCaseInsensitiveASCII(host, "localhost") || IsNormalizedLocalhostTLD(host);`
> `// IsNormalizedLocalhostTLD: return base::EndsWith(host, ".localhost", INSENSITIVE_ASCII);`

and the IP half is only `AddressIsLoopback()`. The header is explicit that this is not a "is it on my network" test:

> `// Note that this function does not check for IP addresses other than the above, although other IP addresses may point to the local machine.`

**[measured] Confirmed end-to-end** on Chrome 156 — loopback and `.localhost` are secure; everything else on the LAN is not:

| URL probed | `isSecureContext` | `'serviceWorker' in navigator` |
|---|---|---|
| `http://127.0.0.1:8099/` | `true` | `true` |
| `http://127.0.0.2:8099/` | `true` | `true` |
| `http://tgspike.localhost:8099/` | `true` | `true` |
| `file:///tmp/spike/filetest.html` | `true` | `true` |
| `https://192.168.2.20:9443/` (self-signed accepted) | `true` | `true` |
| **`http://192.168.2.20:8099/`** | **`false`** | **`false`** |
| **`http://tgspike.example:8099/`** (resolves to 127.0.0.1!) | **`false`** | **`false`** |
| **`http://tg.local:8099/`** (mDNS-style name) | **`false`** | **`false`** |
| **`http://portal.lan:8099/`** | **`false`** | **`false`** |
| **`http://0.0.0.0:8099/`** | **`false`** | **`false`** |

Note the decisive row: `tgspike.example` was pinned to `127.0.0.1` in `/etc/hosts`, yet was still **Not Trustworthy**. Trust is a *name/scheme* property, not a *routing* property. **mDNS/`.local` or a LAN DNS name buys you nothing for secure contexts** — this kills a common "just give the router a hostname" proposal outright.

### 1.4 Why it matters for service workers specifically

Service Workers spec §6.1 *Secure Context*:
<https://w3c.github.io/ServiceWorker/#secure-context>

> "Service workers **must** execute in secure contexts. Service worker clients must also be secure contexts to register a service worker registration, to get access to the service worker registrations and the service workers, to do messaging with the service workers, and to be manipulated by the service workers."
> "Note: This effectively means that service workers and their service worker clients need to be hosted over HTTPS. A user agent can allow localhost …, 127.0.0.0/8, and ::1/128 **for development purposes**."

In Chromium the failure is *earlier* than a rejection: the JS interface is `[SecureContext]`-gated and the renderer only exposes `navigator.serviceWorker` in a secure context. Blink's `ServiceWorkerContainer::register()` even asserts the precondition:

> `// The IDL definition is expected to restrict service worker to secure contexts.`
> `CHECK(execution_context->IsSecureContext());`

If it *is* reachable but the scheme is wrong, you get a `TypeError`, not a `SecurityError` (that is real, and it matters for how the portal detects "no SW support"). MDN documents both outcomes on `ServiceWorkerContainer.register()`:

> **`SecurityError` DOMException** — The `scriptURL` is not a potentially trustworthy origin, such as localhost or an https URL. The `scriptURL` and scope are not same-origin with the registering page.
> **`TypeError`** — The `scriptURL` or scope URL is a failure. This can happen if the URL can't be resolved to a valid URL or **uses a scheme that is not `http:` or `https`**.

<https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register>

**[measured]** on the LAN http page, `navigator.serviceWorker` was `undefined`; a naive `navigator.serviceWorker.register('/sw.js')` threw `TypeError: Cannot read properties of undefined (reading 'register')` — **not** a `SecurityError`. Any portal-side feature detection must therefore be `window.isSecureContext && 'serviceWorker' in navigator`, and never `try { register() } catch (SecurityError)`.

### 1.5 Installability is a separate gate on top

Even with a secure context, Chrome's install criteria (which gate `beforeinstallprompt`) require: not already installed; user engagement (a click ever, ≥30 s viewing); **"Be served over HTTPS"**; and a manifest with `short_name`/`name`, 192 px + 512 px `icons`, `start_url`, and a qualifying `display`.
<https://web.dev/articles/install-criteria>

So there are **two** gates, not one — secure transport *and* manifest. The captive portal fails the first, so the second is moot.

---

## 2. Chrome / Android specifics, CAPPORT, and captive-portal detection

### 2.1 What Chrome does with an intercepted page: nothing special

Chromium has a captive-portal component, but it is **detection + UI**, not a privilege grant:
`components/captive_portal/` contains `captive_portal_detector`, `captive_portal_service`, `captive_portal_tab_helper`, `captive_portal_tab_reloader`, `captive_portal_url_loader_throttle`.
<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/captive_portal/>

Read the file list: there is **no** secure-context, trust, or allowlist integration anywhere in that component. It compares a probe response against a known-good body and re-loads tabs when login is detected. Chromium's own design doc describes the mechanism as fetching `http://clients3.google.com/generate_204` and treating any non-204 as "in portal":
<https://www.chromium.org/chromium-os/chromiumos-design-docs/network-portal-detection/>

**The tab that shows the portal is an ordinary tab on an ordinary `http://` origin.** It gets no elevated status, no PWA install affordance, no SW. There is no "captive portal context" in the web platform.

### 2.2 CAPPORT / RFC 8908 / RFC 8910 — implemented, and irrelevant to PWAs

- **RFC 8908** (Captive Portal API) defines an HTTP API returning `application/captive+json` with a required `captive` boolean and optional `user-portal-url`, `venue-info-url`, `can-extend-session`, `seconds-remaining`, `bytes-remaining`.
  <https://www.rfc-editor.org/rfc/rfc8908.html>
  §4.1 **requires TLS**: "The purpose of accessing the Captive Portal API over an HTTPS connection is twofold… authentication allows the client to ensure that the entity providing the Captive Portal API has a valid certificate for the hostname provisioned by the network using the mechanisms defined in [RFC 8910]…" and "**If the client is unable to validate the certificate presented by the API server, it MUST NOT proceed with any of the behaviour…**". The `user-portal-url` is *required to be TLS*: "Provides the URL of a web portal that **MUST be accessed over TLS**".
- **RFC 8910** conveys the API URL via DHCP/RA options.
  <https://datatracker.ietf.org/doc/html/rfc8910>
- **RFC 8952** is the architecture; the IETF capport WG is **concluded**.
  <https://datatracker.ietf.org/wg/capport/about/>

**Does CAPPORT give the portal http origin a secure context? No.** RFC 8908 is an OS/network-stack API consumed by the *platform's* connectivity code. It carries no web-platform privilege, defines no origin trust, and is not an API the portal page can call. It is not a workaround; if anything it *reaffirms* the HTTPS requirement. Android 11 added "Captive portal API support", but that is `android.net.CaptivePortal` for **apps** (sign-in request/`CAPTIVE_PORTAL_SIGN_IN`, `getCaptivePortalApiUrl`), not a browser context change:
<https://developer.android.com/about/versions/11/features> · <https://developer.android.com/reference/android/net/CaptivePortal>

**Chrome and CAPPORT:** there is no shipped Chromium feature entry for CAPPORT (the chromestatus query for "CAPPORT"/"captive" returns `total_count: 0`), and no `capport` references in the Chromium docs index. **Treat "Chrome implements RFC 8908 CAPPORT and it unlocks X" as UNSUPPORTED.** Chromium's captive-portal code path in the tree is still the generate_204 detection service.

### 2.3 Can the OS be leveraged? Partially — but not as a documented contract

- **Detection is leverageable as a *beacon*, not as a capability.** You can make the OS show "Sign in to network" reliably by intercepting the platform's probe (Chrome/AndroidOS use `generate_204`); that opens the portal page for the user. It does not create a secure origin.
- **Android's `CaptivePortalLogin` app is a system app with its own WebView**, and its WebView traffic is subject to the same secure-context rules as any other WebView. This is worth stating as **not a workaround** — I could not fetch the AOSP source (`platform/packages/apps/CaptivePortalLogin` is not mirrored at the public gitiles path I tried; the fetch 404'd), so **I am not asserting anything about its internals from memory**. What is safely assertable is that it is a *native client with a native sign-in flow*, i.e. an instance of workaround (e) in §3, not an instance of a secure-context grant for `http://<ip>`.
- **iOS behaves differently from Android** and this matters operationally, but the accessible evidence is anecdote-level (a TP-Link Omada field report: the same self-signed-IP portal page loads on iOS after "Continue" and **fails to load on Android**). Cite it as a *field report*, not as spec, and note the Android failure there is a platform/browser interaction bug, not a secure-context rule.
  <https://community.tp-link.com/en/business/forum/topic/846700>

**Bottom line for §2:** the OS/CAPPORT channels can get the user *to* your page. None of them can make that page installable.

---

## 3. The workaround space, with verdicts and measured costs

### (a) Serve the portal over HTTPS on the router

**Verdict: WORKS as a secure context, but only after the user accepts the certificate — and self-signed acceptance alone does NOT make the origin trustworthy.** This is the subtle part, and I measured it explicitly.

| Variant | `isSecureContext` **[measured]** | Notes |
|---|---|---|
| `https://192.168.2.20:9443/` with self-signed cert, **no** override | interstitial; page never loads | cert error blocks the navigation |
| same, after accepting the warning (`--ignore-certificate-errors` as a stand-in for "user clicked Continue/Advanced") | **`true`**, `serviceWorker` **`true`**, `crypto.subtle` **`true`** | ✔ secure context |
| `https://tgspike.example:9443/` (name resolves to a private IP), same acceptance | **`true`** | ✔ the *name* is irrelevant once TLS is valid-to-the-user |
| `https://…` with no acceptance | page blocked | — |

So: **a self-signed HTTPS portal *is* a secure context once the user proceeds through the interstitial**, and it gets SW + `crypto.subtle` + `caches`. Cost, however, is real:

1. **The interstitial is a hard UX tax** and a phishing-shaped prompt on a captive portal. Chrome shows the full "Not secure / Your connection is not private" page and the user must click through *Advanced → Proceed*. This is the known failure mode in the field, and on Android it can fail outright (see the Omada field report in §2.3).
2. **It is per-origin, per-profile, sticky-and-fragile.** The exception is remembered in the profile; a new device, a new profile, an incognito window, or a cleared session repeats it.
3. **TLS on the router needs a cert the user's browser will trust**, i.e. a public CA. That requires a **real domain** whose A record is public DNS (you cannot get a publicly-trusted DV cert for a private IP — no CA will issue one, and there is no ACME validation path for `192.168.x.x`). You then publish a public A record pointing at `192.168.1.1` (hairpin/split-horizon DNS) and serve the same region on the router. Cost: a domain, DNS control, an ACME client on the router, and you have now created a **public DNS record that resolves to a private address** — and any guest whose resolver/DoH disagrees with your split-horizon answer gets a hard failure.
4. **You must also serve the whole portal over one origin** if you want same-origin API calls, so the SW scope covers the money path.
5. Cert renewal on an offline/WAN-less portal is a standing operational liability (offline TollGate boxes exist in this project).

**Acceptance-then-`crypto.subtle` is not enough for a wallet, by the way** — see §3(f) and §4. Even where `crypto.subtle` exists **[measured `true` on HTTPS, `false` on LAN http]**, a *security exception the user clicked through* is not a security boundary, so a Cashu seed stored there is not actually protected. Use it for the shell, not for custody.

### (b) Host the PWA shell on a public HTTPS origin; the portal http page only deep-links to it

**Verdict: WORKS — and it is the only BYOD-viable answer.** Costs are specific and manageable, but the PWA is then *cross-origin to the router*, which is the real design constraint.

What works **[measured]**:

- The PWA shell is served from a vendor origin (say `https://portal.example/`). It is a secure context by construction, installable, SW-capable, persistent.
- From that secure origin, **cross-origin `fetch()` to the portal's `http://<ip>` API succeeds *if the portal sets CORS headers***. Measured on `https://192.168.2.20:9443/` → `fetch('http://192.168.2.20:8098/api.json')` returned **`OK 200 {"hello":"portal"}`** with `Access-Control-Allow-Origin: *` on the response. No mixed-content block. No secure-context requirement on the *target*.
- `mode:'no-cors'` to the http target also resolved (`type=opaque`) — usable as a "ping the gateway" liveness probe even without CORS.
- **Without CORS the fetch dies** — measured `THREW TypeError: Failed to fetch` against the same `http://192.168.2.20:8099/` server that sends no `Access-Control-Allow-Origin`. **This is the single hard requirement of option (b): the portal's API must emit CORS headers.** (I did *not* test whether Private Network Access preflights to a private-network target add further requirements — flag as an open item, because PNA is exactly the feature that governs `https://public → http://private` and I could not confirm its current shipped state from a primary source in this session.)
- The shell's own relative-URL assumptions break: it cannot use `fetch('/api/...')`, SW-cached relative assets, or relative `start_url` semantics against the router. Everything portal-specific becomes an absolute URL to `http://<gateway-ip>` (or better, everything goes through a *vendor-relay* API).

Costs / honest limitations:

- **You must discover the gateway IP.** From the portal page (http origin) you can read it; from the PWA you need it handed over — a deep-link parameter (`?gw=192.168.1.1&mac=…&nonce=…`) or a vendor-controlled rendezvous. This is a design task, not a workaround.
- **The SW cannot intercept the portal's own navigation.** The portal tab stays a plain http page. The "app shell" experience exists only inside the PWA's own origin.
- **`http://<ip>` API calls from the PWA are unencrypted** — an on-LAN attacker can read/alter the invoice and the payment POST. For a *money path* that is unacceptable as-is: it must be signature-protected (see §4).
- **The security boundary is now the vendor origin** — you have centralised trust on your own domain, which is arguably better than 10 000 routers with self-signed certs.
- Mixed content nuance: modern Chrome treats http *subresource* requests from https pages as blockable; top-level-ish `fetch()` to http is currently permitted (measured), but this is a policy that has tightened repeatedly. Do not build a business model on "mixed content is fine forever". Prefer **HTTPS to the vendor domain for everything, with the router API mediated by the vendor** wherever the WAN is available.

### (c) Install the PWA from a secure origin once, then let it work against the captive portal later

**Verdict: the SW survives and re-registers fine — but the captured origin is a *different origin*, so nothing about the portal is inherited.** Two measured facts settle it:

**[measured] SW persistence works.** With one persistent Chrome profile: register on `https://192.168.2.20:9443/`, then in a *later, separate browser run* query it:

```json
{"href":"https://192.168.2.20:9443/checkctl.html","isSecureContext":true,"hasSW":true,
 "registrations":["https://192.168.2.20:9443/"],"controller":"https://192.168.2.20:9443/sw.js"}
```

So the "already registered, already secure" premise holds.

**[measured] But a registration is keyed to its origin, and origin means scheme+host+port.** A registration under `https://192.168.2.20:9443/` is invisible from `http://192.168.2.20:8099/` — and on that page there is no SW API at all:

```json
{"href":"http://192.168.2.20:8099/checkctl.html","isSecureContext":false,
 "hasSW":false,"registrations":"NO_SW_API"}
```

When reached by a *different secure* origin it is simply a different registration list:

```json
{"href":"http://127.0.0.1:8099/checkctl.html","isSecureContext":true,"hasSW":true,"registrations":[]}
```

Caveat on that last one: **a navigation is not controlled by a SW unless a client for that origin exists** — `controller` is `null` on a fresh client and is populated after the registration activates in that client's factory. So the honest statement is: *registrations are per-origin, and a registration cannot be adopted by an origin it was not made under.* What breaks when the portal origin differs from the PWA origin:

- **No SW control of the portal page.** No offline caching, no fetch interception, no push, no share-target for the portal URL.
- **No shared storage**: separate origin ⇒ separate IndexedDB / Cache API / localStorage / OPFS. The loaded ecash balance and the wallet seed cannot be read from the portal page and vice versa.
- **No shared cookies/permissions**; you must re-do any per-origin permission and storage grants.
- **You cannot "point" a SW at another origin.** `register()` requires `scriptURL` to be **same-origin with the registering page** (MDN: "The `scriptURL` and scope are not same-origin with the registering page" ⇒ `SecurityError`; Blink: `document_origin->CanRequest(script_url)` → `kSecurity`). A cross-origin SW script is **UNSUPPORTED**; the only sanctioned relaxations are the `Service-Worker-Allowed` header for a **longer scope within one origin**, and the *imports* being cross-origin — not the registration.

**So (c) reduces to (b):** the thing you install once must *be* the thing that talks to the router. Since it can't be on the router's origin, it must extend to the router via CORS fetch (`(b)`). `(c)` is not an independent workaround; it is a description of the delivery model for `(b)`.

### (d) `--unsafely-treat-insecure-origin-as-secure` / enterprise policy / kiosk — for a device-owned fleet

**Verdict: WORKS, and it is the *only* way a LAN http origin becomes a true secure context. Viable for an operator-controlled fleet. Not viable for BYOD — at all.**

The Chromium source names it as the spec's §3.1-step-8 hook:
`net/base/is_potentially_trustworthy.cc` → `SecureOriginAllowlist::GetInstance().IsOriginAllowlisted(origin)`.

**[measured] It works, and it is surgical:**

| Invocation | Result |
|---|---|
| `--unsafely-treat-insecure-origin-as-secure=http://192.168.2.20:8099` | `isSecureContext:true`, `hasSW:true`, `hasCrypto:true`, `hasCaches:true` ✔ |
| same with a trailing `/` (`http://192.168.2.20:8099/`) | also `true` ✔ |
| `--unsafely-treat-insecure-origin-as-secure=192.168.2.20` (hostname pattern) | **ignored** — `Allowlisted secure origin pattern 192.168.2.20 is not valid; ignoring.` |
| `--unsafely-treat-insecure-origin-as-secure=192.168.2.*` (IPv4 wildcard) | **ignored** — `Allowlisted secure origin pattern 192.168.2.* is not valid; ignoring.` |
| `--unsafely-treat-insecure-origin-as-secure=*://192.168.2.*` (URL wildcard) | **ignored** — same log line |

The flag is documented as: "Treat given (insecure) origins as secure origins. Multiple origins can be supplied as a comma-separated list."
<https://peter.sh/experiments/chromium-command-line-switches/>

The corresponding **enterprise policy** is `OverrideSecurityRestrictionsOnInsecureOrigin` (Chrome 69+, `chrome.*`/`chrome_os`/`android`, per-profile: **no** — `per_profile: false`, `dynamic_refresh: false`, i.e. machine-wide, set-at-launch), from the policy definition itself:

> `caption: Origins or hostname patterns for which restrictions on insecure origins should not apply`
> "…**Patterns are only accepted for hostnames; URLs/origins with schemes must be exact strings.**"
> "Setting a list of URLs in this policy amounts to setting the command-line flag `--unsafely-treat-insecure-origin-as-secure` to a comma-separated list of the same URLs. The policy overrides the command-line flag…"
> `supported_on: chrome.*:69-, chrome_os:69-, android:69-` · `owners: estark@chromium.org`

<https://chromeenterprise.google/policies/#OverrideSecurityRestrictionsOnInsecureOrigin> · definition: <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/policy/resources/templates/policy_definitions/Miscellaneous/OverrideSecurityRestrictionsOnInsecureOrigin.yaml>

**Consequences for an operator-controlled fleet (kiosks / Billboards / TURN-UP-and-pay devices):**

- You must enumerate **every IP:port** you will ever use, because **IP wildcards are rejected** (measured) and only *hostname* patterns like `*.example.org` work. If your fleet uses `192.168.1.1`, `192.168.4.1`, `10.0.0.1`, … you enumerate them all, or you **standardise the gateway IP** and use a **hostname pattern** (e.g. serve the portal on a name resolved by the router's own DHCP/DNS, and allowlist `*.tollgate.box`). This is a **fleet-configuration requirement**, not an afterthought.
- You must control the browser (managed Chrome via policy, or your own Chromium build, or `chrome --kiosk --unsafely-treat-insecure-origin-as-secure=…` in an appliance). BYOD cannot be configured.
- `per_profile: false` + `dynamic_refresh: false` matches kiosk reality: set at provisioning; reboot to change.
- Marked `tags: system-security`, which is the Chromium project telling you it deliberately weakens a security control. It is a **device-trust** decision: if the OS/browser image is yours, the origin is trustworthy *because you said so*.
- **What it does not do**: it does not make the connection confidential (no TLS) and it does not protect against an on-LAN attacker on the *wire*. For a money path you still need request/response signing (§4).

**Firefox analogue (for completeness, same shape, different switch names):** Gecko gates the same class of APIs behind prefs that are insecure-context-only-by-default and explicitly test-scoped — e.g. `dom.caches.testing.enabled` ("Exposes window.caches and skips SecureContext check"), `dom.serviceWorkers.testing.enabled`, `dom.securecontext.allowlist_onions`, and `network.proxy.testing_localhost_is_secure_when_hijacked`.
<https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml>
These are `about:config`/`user.js`-level, i.e. same device-owned-only constraint, worse ergonomics, and explicitly labelled testing. **Do not plan around them for BYOD.**

### (e) A native wrapper (TWA / Capacitor / real app)

**Verdict: WORKS without qualification — it bypasses the SW/secure-context question entirely.** This is the correct answer where you own the device or can ship an app.

Three sub-options, ranked by fit to "auto-pay a BOLT11 invoice on a captive portal":

1. **WebView in a native app with a local asset server.**
   Android's `WebViewAssetLoader` is the canonical mechanism: it serves app assets to the WebView over an **`https://appassets.androidplatform.net/`** origin, so the WebView gets a *normal secure https origin* for first-party assets — SW-eligible — while `WebViewClient`/`shouldInterceptRequest` handles app↔web bridges. Reference:
   <https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader> · guide: <https://developer.android.com/develop/ui/views/layout/webapps/load-local-content>
   **Honest caveat:** this needs a native shell and (for anything beyond a demo) a Play/target-platform distribution channel. It's a *product* decision, not a web trick, and it re-introduces app-store policy overhead.
2. **Capacitor** — a web app packaged into native shells, with the same "serve local content on a real origin" trick available. Capacitor exposes native HTTP via its `Http` plugin, which sidesteps browser CORS/mixed-content entirely (native networking, not `fetch`). Refs: <https://capacitorjs.com/docs> · <https://capacitorjs.com/docs/apis/http>
   **Honest caveat:** I could not open the specific "live reload" / origin-config page this session (`capacitorjs.com/docs/guide/live-reload`), so treat the exact `server.hostname`/local-origin strings as **to-verify** and confirm from the installed plugin version before relying on them. The *architecture* (native shell ⇒ OS-owned origin ⇒ no secure-context problem) is not in doubt.
3. **TWA (Trusted Web Activity)** — install a Chrome-rendered PWA and verify ownership via Digital Asset Links. Relevant only *after* you have a public-HTTPS origin, i.e. it is a packaging layer over option (b), not a fix for the captive portal.
   Ref: <https://developer.chrome.com/docs/android/trusted-web-activity/>

Native is the only path that gives you, on **any** device, without user education: a secure origin, SW, `crypto.subtle`, persistent storage, and out-of-band control of the network stack. Its cost is the one every native path has: distribution.

### (f) The one thing *every* workaround has in common

**`crypto.subtle` is unavailable on the LAN http origin [measured `hasCryptoSubtle:false`], and the Cache API does not exist there either [measured `hasCaches:false`].** Only `window.crypto.getRandomValues` survives (it has no `[SecureContext]` gate) — the LAN http page still returned real random bytes. So a *pure* LAN-http portal cannot run a Cashu wallet that needs SHA-256/HMAC/secp256k1-subtle ops or a cached offline shell. This alone rules out "just build the whole thing in the portal page".

Of the workarounds, exactly **three** yield a genuine secure context: (a) HTTPS-with-a-trusted-or-accepted-cert, (b) a public HTTPS vendor origin, (d) the Chromium allowlist. (e) also yields one, by definition. (c) is not independent.

---

## 4. What the SW must NEVER cache — the money path

This is the part most likely to produce a catastrophic bug, because the failure mode is *silently serving a stale invoice* or *replaying a paid purchase*.

**Absolute rule: an HTTP `POST` is never cacheable, and must never be intercepted-and-served.**

- The HTTP spec's cacheability is about `GET`; MDN's POST reference is unambiguous that POST is a non-cacheable-by-default method, and `Cache`/`CacheStorage` cannot store it at all. **In the Cache API this is mechanically enforced, not a convention** — the spec rejects non-GET with a `TypeError`: *"If r's url's scheme is not one of 'http' and 'https', or r's method is not `GET`, throw a TypeError."* (Cache `add`/`addAll`/`put`, and the `keys`/`match` query paths return empty/false when `r`'s method is not `GET` and `ignoreMethod` is false.) Refs: <https://w3c.github.io/ServiceWorker/#cache-put> · <https://developer.mozilla.org/en-US/docs/Web/API/Cache/put> · <https://developer.mozilla.org/en-US/docs/Web/API/Cache/add>
- **Consequences for the design**:
  1. **The purchase POST can never be cached by a buggy SW — good — but it also cannot be replayed from cache on reconnect.** Offline "pay later" must be an explicit, durable, app-level outbox (IndexedDB) with idempotency keys, never an SW cache trick. Confusing the two is how you double-charge.
  2. **The SW must not fabricate a paid state.** The dangerous pattern is "POST failed → SW returns a cached 'success' response". Never do it. Any SW `fetch` handler that touches the money path must **fail closed**: unrecognised non-GET ⇒ `fetch(event.request)` straight through, no fallback, no synthesized response.
  3. **Never cache anything that carries a balance, an invoice, a quote id, or a session token.** That means: `/balance`, `/usage`, `kind:10021`-derived mint lists, NUT-07 state responses, LN invoice payloads, and the `/pay` (or equivalent) responses. They are per-request authority snapshots; a stale one is worse than none.
  4. **Never cache the Cashu token or the seed.** They belong in IndexedDB/OPFS under the wallet layer's own encryption, with explicit lifetime — not in a `Cache` keyed by URL where a stray `caches.match('/')` could serve them to a differently-scoped page.
  5. **Never cache the portal-authenticated assets by path collision.** If the SW scope overlaps `/`, a naive `caches.match(request)` can satisfy `/pay` or `/api/invoice` from the precache if the URL ever matches. **Rule: precache only a positive allowlist (`/`, `/index.html`, `/app.js`, icons, fonts); everything else is bypass.** The precache manifest must be generated with an explicit allowlist, not a glob of the build output.
  6. **Cache-Control/`no-store` on the API is a defence-in-depth, not your control.** The SW sits *in front of* the HTTP cache, so a mistaken `event.respondWith` can defeat any header. The control is in the SW handler, and the *only* SW behaviour that is correct for the money path is "do not call `respondWith`, let it hit the network".
  7. **Version the precache; never "cache-first" the app shell without a kill-switch.** A stale shell that speaks an old API to a new router is exactly the "balance restored but no internet" class of gate bug this project has already been burned by. Ship an update path (skipWaiting + a visible reload affordance) and a hard-kill (`unregister` + `caches.delete`) reachable from the portal page.

Also: the **manifest** must not be treated as a security boundary. It is a hint. `start_url` pointing at the router (`http://192.168.1.1/`) is a broken install on every device whose gateway differs — `start_url` must be the **vendor secure origin**, with gateway identity supplied at runtime by deep-link/query.

---

## 5. VERDICT

### (i) BYOD walk-up users

**The PWA cannot install from the captive-portal http page. Installation must happen on a secure origin elsewhere — this is not a limitation to engineer around, it is the spec.**

Ship this architecture:

1. **Portal page stays plain http on the router IP.** It is a *signpost*, not an app. It cannot host a wallet and must not pretend to. Its only jobs: explain, take a Cashu token by paste/QR *if* you want a no-install path, and deep-link/QR to the vendor origin.
   - If you want a *no-install* fallback on that page: accept a pasted Cashu token / Lightning address and have the **router server** verify it. `getRandomValues` (measured available) is enough for a nonce; `fetch()` to same-origin works. **Do not** store a seed there — no `crypto.subtle` (measured), and http is MITM-able.
2. **The PWA lives on a public HTTPS vendor origin** (`https://<vendor>`), installable, SW-capable, updated centrally. The portal http page **deep-links to it with the gateway identity in the URL** (`?gw=<ip>&port=<p>&mac=<mac>&nonce=<n>`), and the user installs from the secure origin.
3. **All portal API traffic from the PWA is CORS-explicit** — the router portal must send `Access-Control-Allow-Origin` (measured: without it, `TypeError: Failed to fetch`; with it, `200 OK`). Prefer the vendor relays/brokers the API over WAN when available, and only talks to the router directly when it must.
4. **The money path is signed, not trusted to transport.** Assume the LAN leg is plaintext and hostile: sign the payment intent with the wallet key, sign the access grant on the router side, bind it to MAC + a single-use nonce, and make the POST idempotent so a retry can never double-charge. (This is required for option (b) and *also* for option (a) — a user-clicked cert exception is not a security boundary.)

**What the ADR must promise:**

- The PWA is installable **from a secure origin** (the vendor origin), and the captive portal page is the *discovery* mechanism, not the install surface.
- Cross-origin (`https`→`http://<gw>`) API access is supported **because the portal emits CORS headers**, and the request set is enumerated.
- The SW never caches, replays, or synthesises any money-path response; the precache is an explicit allowlist; `POST` is always passthrough. (Encode as a test — §4 items are testable assertions.)
- Offline "pay later" is an IndexedDB outbox with idempotency, not a cache.

**What the ADR must NOT claim:**

- ✗ That the portal http origin is, can be, or will be a secure context. It cannot (spec §3.1 step 9) and no OS/CAPPORT feature changes it.
- ✗ That `https://<lan-ip>` with a self-signed cert is safe to hold a wallet. It becomes a secure context only after a user-clicked exception, which is not a boundary, and it needs a public DNS name + trusted cert to avoid the interstitial at scale.
- ✗ That a LAN hostname or mDNS name fixes it. **[measured]** `http://tg.local`, `http://portal.lan`, and `http://tgspike.example` (pinned to 127.0.0.1!) were all `isSecureContext:false`. Domain and port are explicitly irrelevant.
- ✗ That CAPPORT/RFC 8908 unlocks anything web-side. It is an OS-level API that *requires* HTTPS, and there is no shipped Chromium CAPPORT feature.
- ✗ That a service worker registered on one origin can serve the portal on another. Registrations are origin-keyed and `scriptURL` must be same-origin (measured + MDN `SecurityError` + Blink `CanRequest`).

### (ii) Operator-controlled fleet of devices (Billboards / kiosks)

**Ship the secure-origin allowlist.** It is the only mechanism that makes the router's LAN http origin a genuine secure context, and it is the correct trade for a device you own.

- **Mechanism:** `OverrideSecurityRestrictionsOnInsecureOrigin` enterprise policy, or `chrome --kiosk --unsafely-treat-insecure-origin-as-secure=<origins>` (measured working, exact origins only — **IP wildcards rejected**).
- **Provisioning requirement:** standardise the gateway identity so you can use **hostname patterns** (the only wildcard that works) — e.g. serve the portal under a router-provided DNS name and allowlist `*.tollgate.invalid`. Otherwise you must enumerate every `<ip>:<port>` in the fleet.
- **Also do (b)-style hardening anyway:** the allowlist fixes *trust*, not *confidentiality*. Sign the money path; keep the vendor origin as the update/telemetry channel.
- **Do not** rely on: Firefox prefs (test-scoped), a self-signed cert exception (per-profile, fragile), or `file://` (no network).

If the fleet device can run a native app, prefer **(e) WebView with `WebViewAssetLoader`** and skip the browser-trust machinery entirely: you get a real https origin for your assets, a native network stack, no CORS, no mixed content, and no policy surface. That is the more durable answer for hardware you control; the allowlist is the answer when the fleet must run *browser* Chrome.

### What to kill outright

- ❌ **"Install the PWA from the captive portal page."** UNSUPPORTED by spec. Delete from the plan.
- ❌ Any design that expects `navigator.serviceWorker` to exist on `http://<lan-ip>`. It is `undefined` **[measured]**, and the failure is a `TypeError` on property access, not a catchable `SecurityError` — so a `try/catch`-based feature detect will *crash*, not degrade.
- ❌ Any design that assumes a cached `POST` response, or an SW that can replay a purchase.

---

## 6. Reproduction (this host)

All `[measured]` claims are reproducible from these artifacts (they still exist under `/tmp/spike/` at time of writing):

- Plain HTTP server: `python3 -m http.server 8099 --bind 0.0.0.0` serving `/tmp/spike/www/` (`sync.html`, `async.html`, `checkctl.html`, `rng.html`, `mixed2.html`, `sw.js`, `manifest.webmanifest`).
- CORS server: `python3 /tmp/spike/cors_srv.py` on `:8098` (`Access-Control-Allow-Origin: *`).
- TLS server: `python3 /tmp/spike/https_srv.py` on `:9443` with a self-signed cert (`openssl req -x509 … -subj "/CN=tgspike.example"`).
- `/etc/hosts` additions used: `127.0.0.1 tgspike.example`, `127.0.0.1 tg.local`, `127.0.0.1 portal.lan`.
- Probe pattern:
  `chrome --headless --no-sandbox --disable-gpu --virtual-time-budget=4000 --dump-dom '<URL>'`
  reading `RESULT {...}` from the DOM title. `--user-data-dir=/tmp/spike/profile2` for the SW-persistence test. `--ignore-certificate-errors` used **as a stand-in for a user accepting the interstitial**, not as a claim about the interstitial itself.
- Browser: **Chrome for Testing 156.0.8078.4**.

Open items I could **not** close from primary sources this session (do not treat as resolved):
1. **Private Network Access** interaction with `https://public → http://private` fetches (shipped state, and whether a preflight would be required). Not tested; do not assume either way before designing the portal API's CORS story.
2. **Exact Capacitor local-origin configuration** (`server.hostname` / `server.androidScheme`) — page unfetchable; verify against the installed plugin version.
3. **AOSP `CaptivePortalLogin` internals** — not mirrored at the public path I tried (404); only assert it is a native sign-in client, nothing about its WebView config.
4. **Whether Chrome currently *also* honours the allowlist for a *subresource* created from a non-allowlisted parent** — untested; the allowance is origin-scoped by construction, but do not build on the untested variant.

## Sources

1. W3C, *Secure Contexts* (Editor's Draft) — <https://w3c.github.io/webappsec-secure-contexts/> (esp. §3.1, §3.2, §5.2, §7.1, §7.2)
2. MDN, *Secure contexts* — <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>
3. W3C, *Service Workers* (Nightly) — <https://w3c.github.io/ServiceWorker/> (esp. §6.1 Secure Context; Cache API `add`/`addAll`/`put`/`keys`/`match` GET-only rules)
4. MDN, `ServiceWorkerContainer.register()` — <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register>
5. Chromium, `net/base/is_potentially_trustworthy.cc` / `.h` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/is_potentially_trustworthy.cc>
6. Chromium, `net/base/url_util.cc` (`IsLocalHostname`, `IsNormalizedLocalhostTLD`) / `.h` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/url_util.cc>
7. Chromium, `third_party/blink/renderer/modules/service_worker/service_worker_container.cc` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/service_worker/service_worker_container.cc>
8. Chromium, `components/captive_portal/` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/captive_portal/>
9. Chromium, `components/policy/resources/templates/policy_definitions/Miscellaneous/OverrideSecurityRestrictionsOnInsecureOrigin.yaml` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/policy/resources/templates/policy_definitions/Miscellaneous/OverrideSecurityRestrictionsOnInsecureOrigin.yaml>
10. Chrome Enterprise policy list — <https://chromeenterprise.google/policies/#OverrideSecurityRestrictionsOnInsecureOrigin>
11. peter.sh, *Chromium command line switches* (`--unsafely-treat-insecure-origin-as-secure`, `--ignore-certificate-errors`, `--allow-insecure-localhost`) — <https://peter.sh/experiments/chromium-command-line-switches/>
12. web.dev, *What does it take to be installable?* — <https://web.dev/articles/install-criteria>
13. Chromium, *Network Portal Detection* design doc — <https://www.chromium.org/chromium-os/chromiumos-design-docs/network-portal-detection/>
14. RFC 8908, *Captive Portal API* — <https://www.rfc-editor.org/rfc/rfc8908.html>
15. RFC 8910, *Captive-Portal Identification in DHCP / RA* — <https://datatracker.ietf.org/doc/html/rfc8910>
16. IETF datatracker, capport WG (concluded) — <https://datatracker.ietf.org/wg/capport/about/>
17. Android Developers, *Android 11 features* (Captive portal API support) — <https://developer.android.com/about/versions/11/features>
18. Android Developers, `android.net.CaptivePortal` — <https://developer.android.com/reference/android/net/CaptivePortal>
19. Android Developers, `WebViewAssetLoader` — <https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader>
20. Android Developers, *Load local content in a WebView* — <https://developer.android.com/develop/ui/views/layout/webapps/load-local-content>
21. Capacitor docs — <https://capacitorjs.com/docs> · `Http` plugin — <https://capacitorjs.com/docs/apis/http>
22. Chrome for Developers, *Trusted Web Activity* — <https://developer.chrome.com/docs/android/trusted-web-activity/>
23. Mozilla, `modules/libpref/init/StaticPrefList.yaml` (`dom.caches.testing.enabled`, `dom.serviceWorkers.testing.enabled`, `dom.securecontext.allowlist_onions`, `network.proxy.testing_localhost_is_secure_when_hijacked`) — <https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml>
24. WebKit, `Source/WebCore/page/SecurityOrigin.cpp` (`shouldTreatAsPotentiallyTrustworthy`) — <https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/SecurityOrigin.cpp>
25. TP-Link community field report: Omada captive portal fails to load on Android after the "not secure" warning — <https://community.tp-link.com/en/business/forum/topic/846700>
26. RFC 6761, *Special-Use Domain Names* §6.3 (`localhost`) — <https://www.rfc-editor.org/rfc/rfc6761.html>
27. Chromium, `docs/login/restrictive_networks.md` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/login/restrictive_networks.md>
28. Media type / JSON shape of the Captive Portal API — RFC 8908 §4.1, §5 (see 14)
