# DOSSIER — Vendor Origin (`orangesync.tech`) and the Self-Signed Credential Question

**Project:** TollGate captive portal (OpenWrt router, GPL-3.0) delivered as an installable PWA carrying a client-side Cashu ecash wallet that auto-pays BOLT11 invoices.
**Date:** 2026-10-14
**Author:** Hermes (delegated dossier)
**Status:** Decision-grade. Every claim is labelled **[measured]** (first-hand output from the rig described in §0.2), **[spec]** (normative text), **[ships]** (implemented in a shipping browser, evidenced), or **[needs user X]**.
**Raw evidence:** `EVIDENCE-vendor-origin-and-selfsigned.md` (verbatim tool output for every `[measured]` claim).

**Supersedes:** nothing. **Extends:** `SPIKE-secure-context.md` — closes its two explicit open items (§6 "Private Network Access … Not tested; do not assume either way" and the `--ignore-certificate-errors`-as-a-stand-in caveat in its §3(a)).

---

## 0. Verdict up front

### 0.1 The two answers, in one sentence each

1. **Can a self-signed credential ever produce a secure context for a PWA?** It can produce a **secure context** (`isSecureContext:true`) — but **it cannot produce a PWA**, because service-worker registration on a self-signed origin fails **even after the user clicks through the interstitial**: `SecurityError: … An SSL certificate error occurred when fetching the script` **[measured]**. Self-signed/private-CA HTTPS is therefore **USABLE for an operator-owned device fleet that is MDM-configured to a private root CA**, and **UNSUPPORTED for BYOD walk-up users** on every platform we checked.
2. **What should ship?** Host the PWA on a real public HTTPS origin — **`https://portal.orangesync.tech`** with a publicly-trusted ACME certificate — and have the portal splash page on `:2051` deep-link to it. The **crux** is that the PWA (public) calling the router API (private LAN) is **gated by Chrome's Local Network Access permission**, not by mixed content: **[measured]** public → private is **denied** with *"Permission was denied for this request to access the `local` address space"*, and **after the user grants the permission once it works, including a preflighted `POST` with CORS** **[measured]**.

### 0.2 The rig (so every [measured] number is reproducible)

| Item | Value |
|---|---|
| Browser | **Google Chrome for Testing 156.0.8078.4**, Linux x86_64 (`~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`) |
| Driver | Headless `--remote-debugging-port` + CDP over WebSocket (`Runtime.evaluate`, `Log.entryAdded`, `Input.dispatchMouseEvent`); **headed** runs under `Xvfb :99` + `openbox` |
| HTTPS server | Self-signed `openssl req -x509 … -subj "/CN=portal.vendor.test"` with `subjectAltName=DNS:portal.vendor.test,IP:127.0.0.1,IP:192.168.2.20,IP:::1`; Python `http.server` dual-stack-bound (`IPV6_V6ONLY=0`) on `:8444` |
| "Router" API server | Python `http.server` on **`http://192.168.2.20:8018`** (`Access-Control-Allow-Origin: *` + `OPTIONS` handling) and **`:8019`** (no CORS at all); every request logged with method, path and all request headers |
| Private initiator | `https://192.168.2.20:8444/` (host LAN address, `192.168.2.20/24` on `wlp59s0`) |
| **Public initiator** | **`https://[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444/`** — a *global* IPv6 address on the same host (from `ip -6 addr`; this is what makes a genuine **public → private** test possible on one box) |
| Host-loopback control | `http://127.0.0.1:8018` |

Reproduce in one line each: `node cdp.mjs` (headless state probe), `bash final_flow.sh` (interstitial click-through), `bash auto_allow.sh` (headed LNA prompt + Allow), `bash post_allow.sh` (preflighted POST + router-side request log). Scripts under `/tmp/rig/`.

---

## 1. Answer 1 — can a self-signed credential help? (the chain, in order)

A PWA needs **four** independent gates to pass. A self-signed credential fails at gate 3, permanently. The common error is to assume gates 2 and 3 are the same thing. They are not.

| # | Gate | What it actually requires | Self-signed verdict |
|---|---|---|---|
| 1 | **Origin is Potentially Trustworthy** (the *origin* test) | scheme/scheme-class only | **PASSES** with `https://` — trivially |
| 2 | **The navigation is not blocked by an interstitial** | a chain the browser accepts, or a user exception | **PASSES only [needs user X]** — user must click Advanced → Proceed |
| 3 | **Service-worker registration** | a *successfully validated* certificate chain for the SW script fetch | **FAILS** — even after gate 2 passes **[measured]** |
| 4 | **Install criteria** (`beforeinstallprompt`) | secure transport **+** qualifying manifest | moot while 3 fails |

### 1.1 Gate 1 — the origin is trustworthy: `https` is the only thing that matters

W3C **Secure Contexts §3.1** *Is origin potentially trustworthy?* **[spec]**
<https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy>

> 3. If origin's scheme is either `"https"` or `"wss"`, return `"Potentially Trustworthy"`.
> 4. If origin's host matches one of the CIDR notations `127.0.0.0/8` or `::1/128`, return `"Potentially Trustworthy"`.
> …
> 9. Return `"Not Trustworthy"`.
>
> **Note: Neither origin's domain nor port has any effect on whether or not it is considered to be a secure context.**

Note what step 3 does **not** say: it does not say "…and the certificate validates". Origin trust is a **scheme/name** function. §3.1 remains non-normative about certificate *validity* for a reason — the trust decision for a certificate is made by the **network stack**, not by this algorithm. **This is the whole reason a self-signed cert gets you gate 1 for free and gate 3 not at all.**

The only way the spec lets an `http://` LAN origin become trustworthy is §3.1 step 8, which §7.2 *Development Environments* explains **[spec]**:

> In order to support developers who run staging servers on non-loopback hosts, the user agent **MAY** allow users to configure specific sets of origins as trustworthy, even though §3.1 … would normally return "Not Trustworthy".

That is the `--unsafely-treat-insecure-origin-as-secure` flag / `OverrideSecurityRestrictionsOnInsecureOrigin` policy already established as working elsewhere in this project. It is a **device-owned** mechanism (`per_profile: false`), not a BYOD one.

### 1.2 Gates 2 + 3 — **the measurement that settles the question**

This is the test the earlier spike could not run (it used `--ignore-certificate-errors`, which suppresses the error *at the network layer* and therefore silently skips gate 3). Here the click-through is **real**: headed Chrome under Xvfb+openbox, `xdotool` moves the real pointer to

* `Advanced` at **(389, 682)** → panel expands, revealing `NET::ERR_CERT_AUTHORITY_INVALID`
* scroll → `Proceed to 192.168.2.20 (unsafe)` at **(443, 798)** → click

Then query the page over CDP **[measured]**:

```json
{
 "location": "https://192.168.2.20:8444/index.html",
 "title": "vendor-pwa-rig",
 "isSecureContext": true,
 "hasSW": true,
 "hasCryptoSubtle": true,
 "hasCaches": true,
 "hasPaymentRequest": true,
 "hasIndexedDB": true,
 "rigLoaded": "string",
 "swRegister": {
  "ok": false,
  "error": "SecurityError: Failed to register a ServiceWorker for scope ('https://192.168.2.20:8444/') with script ('https://192.168.2.20:8444/sw.js'): An SSL certificate error occurred when fetching the script."
 },
 "fetch_http_private_8018_CORS": { "ok": true, "status": 200, "type": "cors" },
 "console": [
  "RIG app.js executed, isSecureContext=true",
  "An SSL certificate error occurred when fetching the script.",
  "Mixed Content: The page at 'https://192.168.2.20:8444/index.html' was loaded over HTTPS, but requested an insecure resource 'http://192.168.2.20:8018/api.json'. This content should also be served over HTTPS."
 ]
}
```

Read the two lines that matter together:

* **`isSecureContext: true`** — gate 1 + 2 passed. The user's exception *does* produce a secure context. The earlier spike's careful hedge was right, and the actual interstitial behaves as the `--ignore-certificate-errors` stand-in suggested. `crypto.subtle`, `caches`, `PaymentRequest`, `indexedDB` are all **genuinely present**.
* **`swRegister.ok: false` / `SecurityError: … An SSL certificate error occurred when fetching the script.`** — gate 3 **failed**. There is no service worker, so there is no PWA, no offline shell, no `beforeinstallprompt`.

**Why the asymmetry exists — and what I did and did not verify.** **Measured:** the click-through yields a secure context but the SW script fetch is refused with an SSL certificate error. **Not verified here:** the internal Chromium code path that produces that asymmetry (I did not read Blink's `ServiceWorkerContainer` / loader source for this dossier, so I am not naming a function). What *is* citable is the direction of the two specs: Secure Contexts §3.1 is a pure scheme/name test with no certificate clause and explicitly a *"may allow users to configure specific sets of origins as trustworthy"* development escape hatch (§7.2), whereas the Service Worker spec's §6.1 requirement is unconditional ("Service workers **must** execute in secure contexts") and the registration API documents `SecurityError` for a `scriptURL` "not a potentially trustworthy origin" — i.e. the two are specified at different layers, and a user-clicked exception satisfies the first without satisfying the second. The practical consequence is the entire point of this section:

> **User-clicked certificate exceptions create a secure context but never a service worker. "Is it a secure context" and "can I install a PWA" are different questions with different answers on a self-signed origin.**

Corroborating echo from the very next line of the same run: the interstitial page itself (`chrome-error://chromewebdata/`, origin `null`) has `isSecureContext:false`, and its own probe fetch is refused with **"The request client is not a secure context and the resource is in more-private address space `local`."** — i.e. while sitting *on* the cert warning you have neither a secure context nor the local-network permission.

### 1.3 Certificate trust stores — can our cert become trusted without a public CA?

Yes — on a **managed device**, and this is exactly the niche where a self-signed/private-descendant certificate *is* the right tool. The cost is that it requires administrative control of every client. Enumerated per platform:

**Chromium / Chrome (desktop and Android).**
* Chrome uses the **platform root store** for TLS; on Android that is the Android system store. There is a single, decisive, frequently-mis-stated fact here:

  > **Android (since Nougat / API 24): apps **do not** trust user-added CAs by default.**
  > *Android Developers Blog, "Changes to Trusted Certificate Authorities in Android Nougat"* — "By default, apps that target API level 24 will—by design—not [trust user- and admin-supplied CAs]" and "beginning with Android Nougat, compatible devices trust only the standardized system CAs maintained in AOSP". <https://android-developers.googleblog.com/2016/07/changes-to-trusted-certificate.html> **[ships]**

  So installing "a CA certificate" via `Settings → Security → Install certificate → CA certificate` puts it in the **user** store, which a current Chrome for Android **ignores**. The escape hatch is the app's `Network Security Config`, and it is an **app-manifest** control — an app developer's build-time choice, not something a captive-portal operator can set on a stranger's phone:

  > `<base-config><trust-anchors><certificates src="user"/></trust-anchors></base-config>` — "To allow your app to trust user-added CAs for all secure connections". Also `debug-overrides` for debug builds only.
  > <https://developer.android.com/privacy-and-security/security-config> **[spec/docs]**

  Therefore, for Android BYOD the private-CA route is **UNSUPPORTED** — verified as a matter of documented platform policy, not browser quirk. For an **enterprise/MDM-managed fleet** it is supported: an MDM can deploy the CA into the **system** store (device-owner / DO-managed), and Chrome then trusts it like any public root.

**iOS / iPadOS.** A manually installed certificate profile is **not** automatically trusted:

  > "If you manually install a profile that contains a certificate payload in iOS, iPadOS, and visionOS, that certificate isn't automatically trusted for SSL… go to **Settings → General → About → Certificate Trust Settings** … turn on trust… Apple recommends deploying certificates via Apple Configurator or Mobile Device Management (MDM). Certificate payloads are **automatically trusted for SSL when installed with Configurator, MDM**, or as part of an MDM enrollment profile."
  > <https://support.apple.com/en-us/102390> **[ships/docs]**

  Two-stage on BYOD (**[needs user X]**: install profile → *then* enable full trust), one-stage under MDM. Certificates for a **bare LAN IP** are additionally awkward here: you cannot get a publicly-trusted DV certificate for `192.168.1.1` (no CA will issue one — see §1.3 note below), so any iOS trust story for the router requires a *name* + a private root.

**A public CA cannot help you for a LAN IP.** This is the constraint that makes "just get a real cert for the router" a dead end, and it is why the vendor-origin decision is correct:

  > "Let's Encrypt can't provide certificates for 'localhost' because nobody uniquely owns it, and it's not a domain with a TLD… [for a name] you can get a certificate."
  > <https://letsencrypt.org/docs/certificates-for-localhost/> **[docs]**

  Same logic applies to RFC 1918 literals: there is no ACME challenge path for `192.168.1.1`, and no CA will issue for it (CA/Browser Forum baseline requirements require control of a **domain**, and explicitly forbid internal names/IP literals for publicly-trusted certs — <https://cabforum.org/working-groups/server/baseline-requirements/requirements/>). So a *publicly-trusted* certificate on the router is reachable only by pointing a real domain's A record at a private address (split-horizon DNS) — which then fails for any guest whose resolver/DoH disagrees, and requires the router to hold the ACME private key and renew (a standing liability for the project's offline/WAN-less boxes).

### 1.4 Why a click-through is not a trust decision (the custody argument)

Even if you *did* get a secure context and a SW on a click-through origin, the platform itself tells you not to build custody on it. W3C Secure Contexts **§4.1 Threat Models**, non-normative but normative in spirit **[spec]**:

> "**Granting permissions to unauthenticated origins is, in the presence of a network attacker, equivalent to granting the permissions to any origin.** … The algorithms defined in this document require mechanisms that provide for the privacy of data at the application layer, not simply integrity."

A user-clicked exception is not "authenticated" in this sense: the user asserted trust *for that profile on that device at that moment*; the wire is still attacker-writable, and the exception is remembered in the profile (new device, new profile, incognito, cleared session ⇒ prompt again) — **[needs user X]**, once per device per profile, indefinitely. Layered on top:

* Chromium's SW script fetch re-validates the chain, so the click-through does not survive into gate 3 **[measured]**, and MDN documents the failure surface of `ServiceWorkerContainer.register()` as `SecurityError` for a non-trustworthy `scriptURL` — <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register> **[spec]**
* **Service Worker spec §6.1 Secure Context** is unconditional: "Service workers **must** execute in secure contexts. Service worker clients must also be secure contexts to register a service worker registration…" <https://w3c.github.io/ServiceWorker/#secure-context> **[spec]**
* Field behaviour on Android is not merely theoretical: the TP-Link Omada community report has the same self-signed-IP portal page loading on iOS after "Continue" but **failing outright on Android** (<https://community.tp-link.com/en/business/forum/topic/846700>) — cite as a field report, not spec.

**Verdict on Q1.** ✅ **Secure context: YES, after [needs user X].** ❌ **PWA/service worker: NO, ever, on a self-signed origin — measured.** ❌ **Custody on that origin: NO — the spec says so.** ✅ **What it IS good for:** (a) an **operator-owned fleet** where a private root CA is deployed by MDM/Configurator *and* a name (not an IP) is used — there the origin is an ordinary trusted HTTPS origin and **everything works, including SW**; (b) the **router's own admin UI**, which already has TLS at `:8443` with `/etc/tollgate/ssl/server.{crt,key}` (`openwrt/files/etc/config/uhttpd_admin:52-54`) — the operator is the only one who needs to trust it; (c) **lab/test rigs** (this one); (d) internal `*.orangesync.tech`-adjacent services no guest browser ever loads.

---

## 2. What `orangesync.tech` gives us that a LAN IP cannot

### 2.1 The live state of the domain, as measured today

| Check | Result |
|---|---|
| `A orangesync.tech` (DoH, Cloudflare) | `23.182.128.226`, `66.92.204.38`, `23.182.128.51` **[measured]** |
| `AAAA orangesync.tech` | **none** **[measured]** |
| `www.orangesync.tech` | `23.182.128.226` **[measured]** |
| `http://orangesync.tech/` | `308 Permanent Redirect → https://orangesync.tech/`, `Server: Caddy` **[measured]** |
| **`https://orangesync.tech/`** | ⚠️ **`curl: (35) … tlsv1 alert internal error`; `openssl s_client` → `no peer certificate available`; "SSL alert number 80"** **[measured]** |
| TCP `:443` reachable | `23.182.128.51` **OPEN**; `23.182.128.226` and `66.92.204.38` **closed/unreachable from here** **[measured]** |

Two findings with immediate operational value:

1. **The apex is currently broken: Caddy answers on `:80` and 308-redirects, but the TLS handshake on `:443` fails with `alert internal error` (80)** — the classic Caddy signature of *no site block matching the hostname / no obtainable certificate*. The redirect therefore leads into a dead TLS listener. Any operator-facing link to `https://orangesync.tech/` is broken **today**. (Note also that `*.orangesync.tech` services are individually fine per the infrastructure inventory — e.g. `blossom2.`, `git.`, `relay2.` — so this is an apex/Caddyfile gap, not a platform failure.)
2. **The DNS A records have drifted from the written inventory.** `tollgate-infrastructure` (last verified 2026-09-18) lists vps2 `23.182.128.51` and vps3 `23.182.128.219`; today's answers add `23.182.128.226` and `66.92.204.38`. Treat the inventory as stale for *addresses*; keep it authoritative for *service→host intent*.

### 2.2 The concrete wins, enumerated

| # | A LAN IP (`http://192.168.1.1:2051`) cannot | `https://portal.orangesync.tech` can |
|---|---|---|
| 1 | be a **Potentially Trustworthy** origin (§3.1 step 9) | be one by scheme alone — **no CAPPORT, no mDNS, no `.local`, no flag, no policy** |
| 2 | get a **publicly-trusted certificate** (no CA issues for a private IP) | get one free, automated, renewable: **ACME / Let's Encrypt**, with **Cloudflare DNS-01** already wired in this estate (`roles/caddy/templates/Caddyfile.j2`: `tls { dns cloudflare {env.CF_API_TOKEN} }`) |
| 3 | give you a service worker / install prompt at all | **`sw`-eligible by construction** — measured: `register()` **ok** on the public origin, scope = the public origin |
| 4 | be a **stable origin across the fleet** — every router is a different origin, so every router is a different install, a different IndexedDB, a different permission set | **one origin for 10 000 routers** — one install, one permission grant, one storage partition |
| 5 | be **centrally updated** — you cannot ship a portal fix to routers that are already deployed and offline | **central, atomic deploys**: push a new bundle, every installed PWA takes it on next launch |
| 6 | survive **roaming**: origin = scheme+host+port, so moving router changes everything | **the origin does not change when the router does** ⇒ the SW registration, the Cache, the IndexedDB and the wallet survive the move |
| 7 | be **operated with normal tooling** (CDN, headers, observability, rollback) | Caddy on the existing VPSes + Ansible SoT in `OpenTollGate/tollgate-infrastructure-kit`; the estate already serves static SPAs exactly this way (`roles/caddy/templates/Caddyfile.j2`: `root * {{ tollgate_static_dir }}/<site>` + `file_server` + `try_files {path} /index.html`) |
| 8 | be **audited/monitored as one surface** | one vhost, one cert expiry, one deploy pipeline |

**The roaming point (#6) is the load-bearing one for the product**, and it is worth stating in the crisp form the brief asks for: with a stable vendor origin, **one PWA install serves *any* TollGate router the user visits** — because the install, its storage, and its wallet all live on the vendor origin, which is invariant under router changes. A LAN-IP origin cannot express that: each router is a distinct origin, so the user would re-install, re-grant, and re-fund at every stop, with no shared state. This is the difference between "a PWA per router" (incoherent) and "a TollGate app" (a product).

### 2.3 What must be hosted there

* The **PWA shell** — the portal SPA build (the repo's `vite build` output), plus `manifest.webmanifest` with **`id`**, `scope`, `start_url`, 192+512 icons incl. `purpose:"maskable"`, and a **`sw.js`** whose precache allow-list **excludes the entire money path** (never cache `POST :2121/`, `GET /ln-invoice?quote=…`, `/balance`, `/usage`, `/whoami` — a cached `2xx` on the payment POST would *fake a purchase*, and a cached `/usage` would make the portal lie about entitlement; see `DOSSIER-portal.md` gap #4).
* The **wallet**: keys/seed + held Cashu proofs in **IndexedDB on the vendor origin** (`DOSSIER-wallet-libs.md` §1: `dexie`/IndexedDB, seed handling, NUT-13 derivation) — this is what makes roaming carry value (§4).
* The **deep-link contract** the splash page uses to hand over the gateway: `?gw=<ip>&mac=<mac>&nonce=<…>` (the MAC is already the identity the API takes — `src/helpers/lightning.js:9-12`, `src/helpers/tollgate.js:21-25`).
* *(Optional, and the strongest money-path option — see §3.5)* a **vendor relay/rendezvous** endpoint so the PWA never talks to a LAN IP at all.

---

## 3. What the vendor-origin approach costs — honestly

The PWA is **cross-origin from the router**. Everything portal-specific becomes an absolute URL, and every call crosses an origin boundary. This section is the crux of the brief, so it is organised as: *what the calls are* → *what the router must send* → *the two gates the call must pass (CORS, and the address-space permission)* → *the mixed-content question answered with measurements* → *options*.

### 3.1 The exact requests the PWA must make to the router

From `DOSSIER-portal.md` §5.1 (the SPA's entire gateway surface today, plus the routes the wallet design implies). **Authority:** `GET|POST :2121/…` is the **Go module** (`apiListenAddr = ":2121"`, `src/main.go:424`) — **not uhttpd** (see §3.2).

| # | Call | Method + path | Credentialled? | Cross-origin requirements |
|---|---|---|---|---|
| 1 | capability probe | `GET /ln-invoice` (no query) | no | simple request ⇒ **no preflight**; needs `ACAO` to *read* the body |
| 2 | **create invoice (money)** | `POST /ln-invoice?mac=<mac>`, `Content-Type: application/json`, body `{"amount":n,"mint_url":"…"}` | no | **preflight required** (`application/json` is not a CORS-safelisted content type) |
| 3 | invoice status poll (2 s loop) | `GET /ln-invoice?quote=<q>&mac=<mac>` | no | simple request |
| 4 | entitlement / allowance | `GET /usage`, `GET /balance` | no | simple request; must **never** be SW-cached |
| 5 | client identity | `GET /whoami` (yields the MAC) | no | simple request |
| 6 | *(wallet)* mint keyset fees | `GET <mint>/v1/keysets` | no | **not the router** — the mint is a third-party HTTPS origin; CORS-open by policy |

If the design ever adds cookies/HTTP-auth to (2), note the hard CORS rule: **`Access-Control-Allow-Origin: *` is incompatible with credentials**; a credentialled request needs an *exact* origin echo plus `Access-Control-Allow-Credentials: true`, and the router must then implement a real origin allowlist. **Recommendation: keep the money path uncredentialled and sign it instead** (§3.5) — which also keeps the `ACAO` story trivial.

### 3.2 What the router must send — and the brief's premise corrected

> **The brief asks "whether the router's uhttpd can do it". For the money path the answer is: uhttpd is not in that path.** `:2121` is the Go module's own `net/http` listener (`src/main.go:424`). uhttpd serves only **`:2051`** (nodogsplash's portal htdocs: `src/helpers/tollgate.js:12-15`, `packaging/files/etc/uci-defaults/92-tollgate-admin-setup:75`) and **`:8090`/`:8443`** (`uhttpd.admin`, the board UI). So:
> * **CORS for the API belongs in the Go handler** (a `net/http` middleware), not in uhttpd config, and not in nodogsplash. Putting it in the wrong layer is a guaranteed no-op.
> * The `:2051` portal origin (if anything is ever served from it) and the `:8090` admin origin are uhttpd's problem, and uhttpd **does** support response headers — but that is not where the wallet's calls go.

Minimum router-side contract for the vendor origin:

```
# on the :2121 Go listener — middleware, before routing
Access-Control-Allow-Origin: https://portal.orangesync.tech     # exact origin; NOT "*" if any cookie ever appears
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 600
# and: OPTIONS <path> -> 204 with the above, no body
```

**[measured]** — this is precisely what the rig's CORS server did, and it is sufficient *given the permission*:

```
OPTIONS /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None | ACRM: POST
POST    /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None
```

Note the two facts in that log. **(a)** The `POST` is preflighted (correct — `application/json`), and `Access-Control-Request-Method: POST` is sent. **(b)** **`Access-Control-Request-Private-Network` is `None`** — Chrome 156 does **not** send the legacy PNA preflight header. So the router does **not** need `Access-Control-Allow-Private-Network: true`, and implementing it is dead code on current Chrome (a 2022-era blog recipe — <https://developer.chrome.com/blog/private-network-access-preflight> — that the LNA redesign superseded).

Failure modes, both **[measured]** on the no-CORS server (`:8019`):
```
Access to fetch at 'http://192.168.2.20:8019/api.json' from origin 'https://[…]' has been blocked by CORS policy:
  No 'Access-Control-Allow-Origin' header is present on the requested resource.
```
⇒ same public origin, permission granted, **still fails without `ACAO`**. **CORS is non-negotiable and orthogonal to the permission.**

### 3.3 Gate A — mixed content: what it actually is, and the `fetch()` question settled

**Spec, decisive and unambiguous. W3C Mixed Content §3.2 *Blockable Content*** **[spec]**:
> "Any mixed content that is not upgradeable … is considered to be **blockable**."
<https://w3c.github.io/webappsec-mixed-content/>

**MDN, and note whose list `fetch()` is on** **[docs]** — <https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content>:
> "**Blockable content** is defined as 'all mixed content that is not upgradable'. This includes HTTP requests resulting from the following elements (this list is not exhaustive): … **`fetch()` requests**, XMLHttpRequest requests, …"
> "Mixed content requests that would otherwise be upgraded are **blocked if the URL's host is an IP address** rather than a domain name. So `<img src="http://example.com/image.png">` will be upgraded, but `<img src="http://93.184.215.14/image.png">` is blocked."

So **on the spec/MDN record**, `https://page → fetch('http://192.168.1.1:2121/…')` is **blockable mixed content and must be blocked**. Anyone reading only the spec will implement the signed/proxied path, and be *right*. **But it does not fire in Chrome 156 — because Chrome exempts it.** Here is the measurement and then the citation.

**[measured]** — private initiator `https://192.168.2.20:8444/` → `http://192.168.2.20:8018` (CORS) returns **200**, with only a *console notice*:

```
Mixed Content: The page at 'https://192.168.2.20:8444/index.html' was loaded over HTTPS, but requested an insecure
resource 'http://192.168.2.20:8018/api.json'. This content should also be served over HTTPS.
```

That behaviour is documented in the Chrome LNA announcement — **verbatim** **[ships]**, <https://developer.chrome.com/blog/local-network-access>:

> "Because the local network access permission is **restricted to secure contexts**, and it can be difficult to migrate local network devices to HTTPS, the **permission-gated local network requests will now be exempted from mixed content checks** if Chrome knows that the requests will be going to the local network before resolving the destination. Chrome knows a request is going to the local network if:
> * The request hostname is a **private IP literal** (e.g., `192.168.0.1`).
> * The request hostname is a **`.local` domain**.
> * The `fetch()` call is annotated with the option `targetAddressSpace: "local"`.
> ```js
> // Example 1: Private IP literal is exempt from mixed content.
> fetch("http://192.168.0.1/ping");
> // Example 2: `.local` domain is exempt from mixed content.
> fetch("http://router.local/ping");
> // Example 3: Public domain is not exempt from mixed content, even if it resolves to a local network address.
> fetch("http://example.com/ping");
> // Example 4: Adding the `targetAddressSpace` option flags that the request will go to the local network, and is thus exempt.
> fetch("http://example.com/ping", { targetAddressSpace: "local" });
> ```

**Therefore, answering the brief's question precisely:**

> *Is a fetch from `https://origin` to `http://192.168.1.1:2121` blocked as **mixed content** or as an **insecure private-network request**?*
>
> **Neither, as of Chrome 156 — and the brief's premise is inverted.** The mixed-content check is **exempted** for a private-IP-literal target, and the PNA-preflight mechanism is fully **replaced**. What actually blocks it is a third thing the brief did not name: **Local Network Access, a grantable user permission**, which produces an error string that *looks* like CORS (`blocked by CORS policy`) but is an address-space decision.

**This is a policy that tightens, so the exemption is not a business model.** The spec still says *blockable*; Safari and Firefox have no such exemption (see §3.6); and `Permissions-Policy`/enterprise settings can remove it per-site. The design answer is in §3.5, not in relying on the exemption.

### 3.4 Gate B — Local Network Access: the real blocker, measured

This is the finding the brief's framing misses, and it is the single most important technical result in this dossier.

**Chrome's model** **[ships]**, LNA announcement, Chrome 142 launch:
> "Local Network Access … requires the user grant the site permission before such requests can be made. **The ability to request this permission is restricted to secure contexts.** … For the first milestone of Local Network Access, we consider a 'local network request' to be **any request from the public network to a local network or loopback destination**. … **A local network is any destination that resolves to addresses reserved for local use** … private IPv4 addresses specified in Section 3 of [RFC 1918] … Loopback … `127.0.0.0/8` … `::1/128`. **A public network is any other destination.**"

The two halves of that quote are the whole finding: the permission is **grantable only from a secure context**, and the gate fires on exactly our topology — **a public HTTPS page asking to reach a private/loopback address space**.

Historic PNA classification (still the vocabulary, and the same three spaces) — <https://developer.chrome.com/blog/private-network-access-preflight> **[docs]**:
> "**Private network requests are requests whose target server's IP address is more private than that from which the request initiator was fetched.** … public / private / local … A local IP address is considered more private than a private IP address which is considered more private than a public IP address."

**Measured: public origin → private router is DENIED, and no request ever leaves the browser.**

Initiator `https://[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444/` (global IPv6 — genuinely public address space) **[measured]**:

```json
"consoleEntries": [
 "Mixed Content: … requested an insecure resource 'http://192.168.2.20:8018/api.json'. This content should also be served over HTTPS.",
 "Access to fetch at 'http://192.168.2.20:8018/api.json' from origin 'https://[2a01:…:33ed]:8444' has been blocked by CORS policy: Permission was denied for this request to access the `local` address space.",
 "Failed to load resource: net::ERR_FAILED",
 "… 'http://127.0.0.1:8018/api.json' … blocked by CORS policy: Permission was denied for this request to access the `loopback` address space.",
 "… 'http://[2a01:…:33ed]:8018/api.json' … This request has been blocked; the content must be served over HTTPS."
],
"result": { "http_private_192_8018_CORS": {"ok": false, "error": "TypeError: Failed to fetch"},
            "http_private_192_8019_NO_CORS": {"ok": false, "error": "TypeError: Failed to fetch"},
            "http_loopback_8018": {"ok": false, "error": "TypeError: Failed to fetch"} }
```

Three things worth extracting:
* The denial names the **address space** — `local` for the RFC 1918 target, `loopback` for `127.0.0.1`. Misspell it as a permission name and you get nowhere (see below).
* **It is reported as a CORS failure.** `TypeError: Failed to fetch` + a `blocked by CORS policy` console line. Any implementer debugging "CORS is broken" here will chase headers forever while the real cause is a missing permission. **This is a trap worth documenting loudly in the portal's own code comments.**
* Control: the **same public origin** to a **public** address (its own global-IPv6 server) is blocked by *mixed content* ("the content must be served over HTTPS") — i.e. the two gates are distinct and both observable.

**Measured: the permission is real, nameable, and grantable.**

`navigator.permissions.query` on the public origin **[measured]**:
```json
{"local-network-access":{"state":"prompt","name":"local-network-access"},
 "local-network":{"state":"prompt","name":"local-network"},
 "loopback-network":{"state":"prompt","name":"loopback-network"},
 "localNetworkAccess":{"error":"TypeError: … 'localNetworkAccess' is not a valid enum value of type PermissionName."}}
```
So the **web-visible PermissionName is kebab-case** (`local-network-access`), and all three are in state **`prompt`** — a genuine, user-grantable permission (not an unconfigurable block). The Chrome 156 DevTools protocol also lists `localNetwork`/`localNetworkAccess`/`loopbackNetwork` in `Browser.PermissionType` **[measured]** (`/json/protocol`), but `Browser.setPermission` with those camelCase names is rejected (`Invalid PermissionDescriptor name`) **[measured]** — the **CDP emulation names are not the web PermissionName**, another trap.

**Measured: the real prompt, in real headed Chrome.**
```
[2a01:…:33ed]:8444 wants to Access other devices on your local network        [ Block ]  [ Allow ]
```
(captured by screenshot inspection; auto-fired the moment the page fetched the private target — **no user gesture was needed to raise it**, only to drive it.)

**Measured: after Allow, everything works — including the preflighted POST.**

| Probe (public origin, after `Allow`) | Result |
|---|---|
| `GET http://192.168.2.20:8018/api.json` (CORS server) | **200 `cors`** ✅ |
| `GET http://192.168.2.20:8019/api.json` (no CORS) | `TypeError: Failed to fetch` — *genuine* CORS failure (`No 'Access-Control-Allow-Origin' header`) ✅ expected |
| `POST http://192.168.2.20:8018/ln-invoice?mac=…` (`application/json`) | **200 `cors`**, after an `OPTIONS` preflight ✅ |
| `navigator.serviceWorker.register('/sw.js')` | **ok**, `scope: https://[2a01:…:33ed]:8444/` ✅ |
| grant persistence across a **browser restart** | **granted** (run 2 got 200 without clicking Allow) ✅ |

**The grant is sticky per origin — which is exactly why the stable vendor origin matters (§2.2 #4/#6): the user grants local-network access to `portal.orangesync.tech` once, and it then holds for every TollGate router they ever visit.**

**Two more measured/known constraints that shape the wallet design:**

* **Workers cannot raise the prompt.** LNA announcement **[ships]**:
  > "**Local network requests from Service Workers and Shared Workers require that the worker's origin has previously been granted the Local Network Access permission.** If your application makes local network requests from a service worker, you will need to **separately trigger a local network request from your application** in order to trigger the permission prompt."
  ⇒ A background SW poll loop against the router will **silently fail** on a fresh install. The foreground must make one LNA-requiring call *before* any SW-driven polling is relied upon.
* **WebSockets/WebTransport/WebRTC to the local network are not yet gated by LNA** **[ships, as a known limitation]** — but they are still mixed-content-blocked from an HTTPS page (`ws://` from `https://` is not exempted by the three conditions above unless the host is a private IP literal/`.local`), and MQTT-over-WS to `192.168.1.1` is therefore **not** an escape hatch. Do not design a `ws://` keepalive to the router.
* **Enterprise lever (planned, not shipped):** "We will also be adding a Chrome enterprise policy for controlling which sites can and cannot make local network requests (**pre-granting or pre-denying** the permission to those sites)." **[ships: announced]** — this is the fleet-management path for operator-owned devices: pre-grant the vendor origin, no prompt.

### 3.5 The options for the money path, costed

| Option | Install/PWA | The router call | Cleartext on the wire? | Verdict |
|---|---|---|---|---|
| **A. Vendor origin + LNA + CORS on `:2121`** | ✅ full PWA | `fetch('http://<gw>:2121/…')`; passes only after the LNA prompt; needs `ACAO`+`OPTIONS` in the **Go** handler | **yes** — invoice + payment POST readable/alterable on-LAN | **SHIP THIS**, with the money path signed (below). Simplest, measured end-to-end, no new infra. |
| **B. Give the router TLS** | ❌ still gated by LNA (it is an address-space gate, **not** a scheme gate) and the cert still can't be publicly trusted for a LAN IP (§1.3) | `https://<gw>:2121` — removes the mixed-content *notice* and encrypts the wire, but the browser must accept the cert | no | **Not for BYOD.** Adds an interstitial back for zero install gain. Useful only on a managed fleet with a private root CA. |
| **C. Vendor relay (router → vendor, PWA → vendor only)** | ✅ full PWA | **no LAN call at all**: the router holds an **outbound** WSS/Nostr control channel to the vendor; the PWA talks only to `https://portal.orangesync.tech` | no (end-to-end to the vendor) | **The right answer where the router has WAN** — and the project already has the substrate (Nostr relays, `kind:10021` gateway advertisement). Removes the LNA prompt, the mixed-content notice, and the cleartext-money problem in one move. |
| **D. `--unsafely-treat-insecure-origin-as-secure` on a managed fleet** | ✅ on **device-owned** browsers only | direct `http://<gw>:2121` (the flag makes origin *and* the subresource policy moot) | yes | Established as working; **operator fleet only, never BYOD**; note **IP wildcards are rejected** — only hostname patterns wildcard, so the fleet must be standardised on a **hostname** (e.g. `*.tollgate.box`) rather than per-router IPs. |
| **E. Native WebView + `WebViewAssetLoader`** | ✅ (as an app) | app-controlled | n/a | Established; the app-store path, not the walk-up path. |

**The signed money path (do this regardless of A/C).** Since option A's traffic is unauthenticated and in cleartext, the entitlement/payment exchange must be **integrity-protected by signature**, not by transport. Concretely: the router holds a keypair (it already has a Nostr identity per the fleet design); the PWA verifies a signed attestation for `POST /ln-invoice`'s outcome and `GET /usage`/`/balance` responses, so an on-LAN attacker cannot forge "payment accepted" or rewrite an invoice amount. **This is also the only defence against a rogue gateway** — with a stable vendor PWA talking to an unauthenticated LAN endpoint, *any* gateway can impersonate *any* TollGate; the signature is what makes the PWA's "which gateway am I paying?" question answerable (§4.3).

### 3.6 Cross-browser reality (do not overclaim)

| Engine | LNA gate? | Mixed-content exemption for private IP literal? | Consequence |
|---|---|---|---|
| **Chrome/Chromium 142+** | **yes** ([ships], measured 156) | **yes** ([ships], measured) | the measured path above |
| **Chrome 138–141** | opt-in behind `chrome://flags#local-network-access-check` ([ships]) | n/a | pre-142 users get neither the prompt nor (necessarily) the exemption ⇒ mixed-content block or unexplained failure |
| **Safari / WebKit, Firefox/Gecko** | **no LNA implementation announced** | **no such exemption documented** | on those engines `https → http://<private IP>` is expected to be **blocked as mixed content** ⇒ **UNSUPPORTED for option A**; they need option C (or D on managed devices). **Not measured here — flagged as an open item, do not assume.** |

Plus the engine-independent baseline: **iOS Safari never fires `beforeinstallprompt`** — install is a manual *Share → Add to Home Screen* (**[needs user X]**), so the install UX must be written defensively for both paths.

---

## 4. The portable-identity insight: is the framing right?

**Yes — with three sharp caveats, and it changes the "buy again at the new address" design.**

### 4.1 What the stable origin buys the wallet

Because origin = scheme+host+port and the vendor origin is router-invariant, the wallet's **seed and held Cashu proofs live in IndexedDB on `portal.orangesync.tech`** and therefore **persist across router changes, network changes, and reboots** while the user roams. The earlier spike measured the complementary negative (a registration/storage set is *per-origin* and cannot be adopted by another origin) — which is precisely why invariance of the origin is the mechanism that delivers persistence here. So:

> **The client keeps its ecash across roaming; only the ENTITLEMENT is address-scoped.**

That is the correct framing, and it is the *strongest* argument for the vendor origin that is not about installability at all. It also fits the project's existing posture: the portal is a *display-and-forward* client today (`DOSSIER-portal.md` §7 — decode → validate → POST the raw token → trust the router; the merchant redeems), and the wallet plan already treats "zero client balance" as a valid state with a **seed-phrase threshold policy** rather than forced backup (`DOSSIER-wallet-libs.md`; `DOSSIER-portal.md` gap #9). Portable balance + a one-time vendor-origin trust decision is what makes "fund once, roam many routers" a *product sentence* instead of a per-stop chore.

### 4.2 What it implies for "buy again at the new address"

* **Paying twice must be a deliberate act, and the PWA must be able to tell it is somewhere new.** Today's identity primitive is the **MAC** (`/whoami` → `getClientMac`, threaded into every call as `?mac=`) and that is *client*-scoped, not *gateway*-scoped. The PWA needs a **stable gateway identity** to compare against: the gateway already advertises `kind:10021`, which carries the merchant's own identifier — that, not the IP, is what "the new address" should mean.
* **The UI must be honest about the split.** The user can hold 5 000 sats and have **no internet** — that is a new, first-class state ("you have a balance; you are not entitled *here*"). Neither the current portal nor the current wallet model has a vocabulary for it; the i18n set has no keys for it (`DOSSIER-portal.md` gap #6). Design the copy: *balance follows you, access does not*.
* **Entitlement must never be cached or inferred locally.** It is a *destination* property. A cached `/usage` or `/balance` on the vendor origin would make the PWA lie about the very thing that is address-scoped (`DOSSIER-portal.md` gap #4).
* **The repeated-top-up rail is still the open problem.** "Many small top-ups to one session" has no per-amount rail today (one token → one swap → one session grant); the plan's own verdict is that the architecturally correct answer is Spillman/Cashu channels, gated on CDK + a channel-capable client wallet, and that a bespoke drip protocol must **not** be bolted on meanwhile (`DOSSIER-portal.md` gap #10). The roaming framing *increases* the pressure for a channel: a roamer is exactly the user who will hit a new gateway mid-session.

### 4.3 The two risks the framing adds (say them out loud)

1. **Centralised honeypot.** One vendor origin holding every user's Cashu balance is a **much** bigger prize than one portal per router. A single XSS, a compromised CDN edge, a bad dependency, or a stolen deploy key now reaches *all* held value, not one session's worth. The origin's integrity becomes the custody boundary — which is the right security posture *only* if it is actually operated like one (pinned/verified build, no third-party script tags on the money path, strict CSP, subresource integrity, versioned SW that refuses to serve a stale money path).
2. **Impersonation is now possible and must be answered.** Because the PWA is stable and the LAN endpoint is unauthenticated http, **any** gateway can answer as "TollGate". The vendor origin makes this *worse* in that the user cannot tell one router from another by origin anymore. **Mitigation: the signed gateway attestation in §3.5**, verified by the PWA before any payment, plus a nonce in the deep link to prevent replay.

---

## 5. Recommendation — the architecture to ship on `orangesync.tech`

### 5.1 What is hosted there

| Piece | Detail |
|---|---|
| **Hostname** | **`portal.orangesync.tech`** (new vhost; apex left alone except for the fix below) |
| **Host** | the existing Caddy on **vps2 `23.182.128.51`** (already terminates TLS for many `*.orangesync.tech` vhosts). ⚠️ From this host only `23.182.128.51:443` is reachable today — confirm reachability/HA before committing, and note DNS round-robins across three A records. |
| **Certificate** | **public ACME (Let's Encrypt)** via Caddy. The estate already has DNS-01 wired: `roles/caddy/templates/Caddyfile.j2` → `tls { dns cloudflare {env.CF_API_TOKEN} }`, with `acme_email` in `ansible/inventory/group_vars/all.yml`. **A self-signed cert is NOT used anywhere in this design.** |
| **Content** | the portal SPA build (`vite build` output) served with Caddy's existing static pattern (`root * {{ tollgate_static_dir }}/portal` + `file_server` + `try_files {path} /index.html`), plus `manifest.webmanifest` (`id`, `scope`, `start_url`, maskable 192/512 icons) and `sw.js` with a **money-path-excluded** precache allow-list |
| **State** | wallet seed + held Cashu proofs in **IndexedDB on this origin**, `navigator.storage.persist()` requested, plus the `?gw=&mac=&nonce=` deep-link contract |
| **Config-as-code** | a `portal` vhost block added to `OpenTollGate/tollgate-infrastructure-kit` → `ansible/roles/caddy/templates/Caddyfile.j2` (Ansible playbook `04-caddy.yml`, `serial: 1`, Caddy in Docker with the Caddyfile bind-mounted read-only) — **not** hand-edited on the box |
| **Fix while you are there** | **`https://orangesync.tech/` is broken today** (§2.1): Caddy 308s on `:80` into a `:443` listener that fails the handshake (`tlsv1 alert internal error`, `no peer certificate available`). Add/repair the apex site block. |
| **Optional, strongest** | the **vendor-relay** endpoint (§3.5 option C) so a WAN-connected router needs no LAN call at all |

### 5.2 What the router must additionally do

1. **CORS on the Go `:2121` listener** — `Access-Control-Allow-Origin: https://portal.orangesync.tech`, `-Methods: GET, POST, OPTIONS`, `-Headers: Content-Type`, `-Max-Age`, and `OPTIONS → 204`. **In Go, not uhttpd.** Uncredentialled (`ACAO: *` is acceptable *only* while no cookies are used; prefer the exact origin now so credentials can be added later without a break).
2. **A signed money path** (§3.5): sign the create-invoice outcome and the `/usage`/`/balance` responses with the router's key; verify in the PWA; bind the deep link with a nonce. This is not optional — the transport is unauthenticated cleartext under option A.
3. **A stable gateway identity** to advertise and for the PWA to compare (extend the existing `kind:10021` advertisement rather than inventing a new one).
4. **The `:2051` splash deep-link** — hand off `?gw=<ip>&mac=<mac>&nonce=<…>` to `https://portal.orangesync.tech/`. (IP-discovery is a design task, not a workaround: from the http splash page the gateway IP is readable; the PWA needs it passed in.)
5. **Do NOT** add TLS to `:2121` as an installability measure — it does not change the LNA gate, and no publicly-trusted cert can exist for a LAN IP.
6. **Keep the money path out of the SW cache** on the portal side (the SW ships from the vendor origin, so this is a vendor-side gate, but the router's identity/version should be part of what the SW revalidates).
7. *(If option C)* an outbound control channel from the router to the vendor.

### 5.3 The ordered decision list

| # | Decision | Why it is ordered here | Blocking? |
|---|---|---|---|
| **1** | **Ratify the transport decision as an ADR:** vendor origin `portal.orangesync.tech` + public ACME cert; drop self-signed (and note the admin `:8443` private-TLS case is *unaffected* — it is operator-only). | Policy precedes code. The self-signed question is *closed* by §1.2: no SW, ever. | ✅ blocks 2–7 |
| **2** | **Ratify the money-path option:** **A** (LNA + CORS, ship now) vs **C** (vendor relay, WAN only) — or A-then-C. | Determines whether the router needs a relay **and** whether CORS/signing is the whole story. Choose **A + signed path** for the MVP; target **C** where WAN exists. | ✅ blocks 4,5,7 |
| **3** | **Fix the broken apex and stand up the `portal.` vhost + cert** (Ansible, `04-caddy.yml`); verify: handshake OK, redirect works, cert chain validates, bundle served. | Unblocks everything — and it is broken *today*, independently of this project. | ✅ blocks 4 |
| **4** | **Ship the PWA shell on the vendor origin** (manifest `id`/`scope`/`start_url`/maskable icons; SW with money-path-excluded precache; install-onboarding UX incl. the iOS *Add to Home Screen* path). | No SW ⇒ no PWA ⇒ nothing else matters. | ✅ blocks 5 |
| **5** | **Router: CORS middleware on `:2121` + `OPTIONS` handling; verify with a preflighted `POST` from the vendor origin.** | The single hard requirement of the cross-origin design; measured sufficient once the permission is held. | ✅ blocks 6 |
| **6** | **Build the LNA UX:** request + verify access, and make the failure *legible* (`TypeError: Failed to fetch` is a permission denial, not a CORS bug); do a foreground LNA-requiring call **before** any SW polling; consider `targetAddressSpace:"local"` for exemption clarity. | New user gate, single-use per origin. Get it wrong and every bug looks like CORS. | ✅ blocks 7 |
| **7** | **Wallet + persistence on the vendor origin** (IndexedDB, `storage.persist()`, NUT-09 restore, threshold seed policy) and the **roaming UX** (balance follows you; entitlement does not; gateway identity compared, not assumed). | The payoff of the stable origin — and it is only meaningful once 1–6 hold. | — |
| **8** | **Sign the money path** (gateway attestation, nonce in the deep link) and adopt a **freshness discipline** (re-verify the estate inventory; re-check the LNA/enterprise-policy shipped state at implementation time). | Security + drift guards; rides with 5–7 but must land before any real funds. | — |

### 5.4 What must NOT be claimed

* ❌ "**A self-signed certificate works for the portal once the user clicks through.**" It produces a secure context and **no service worker** — measured `SecurityError: … An SSL certificate error occurred when fetching the script`. No SW ⇒ **no PWA, no install, no offline shell.**
* ❌ "**Give the portal HTTPS on the router and it becomes a PWA.**" It moves the problem to an interstitial (per-device, per-profile, phishing-shaped, and known to fail on Android), and no publicly-trusted cert can exist for a LAN IP.
* ❌ "**A trusted local root CA is fine for walk-up/byod users.**" It is not: Chrome on Android **ignores user-installed CAs for apps targeting API 24+** by design, iOS needs a second manual *Certificate Trust Settings* toggle, and both are per-device administrative actions. **USABLE for an operator-owned, MDM-managed fleet. UNSUPPORTED for BYOD.**
* ❌ "**The mixed-content block is what stops `https → http://192.168.x.x`.**" On Chrome 156 it is **exempted** (private IP literal / `.local` / `targetAddressSpace:"local"`). The spec still calls it blockable, and other engines are expected to block it — say "Chrome exempts it; policy is tightening; we do not rely on it".
* ❌ "**The call failed because of CORS**, so we just need `Access-Control-Allow-Origin: *`." A public origin → private router gives a CORS-*shaped* error that is actually **`Permission was denied for this request to access the \`local\` address space`** — a user-permission gate. `ACAO` alone will not fix it, and granting the permission alone will not fix a missing `ACAO` (both were measured independently).
* ❌ "**The router needs `Access-Control-Allow-Private-Network: true`.**" Chrome 156 sends **no** `Access-Control-Request-Private-Network` (measured `None`) — that 2022 recipe is superseded by LNA.
* ❌ "**uhttpd has to grow CORS.**" `:2121` is the Go module's own listener (`src/main.go:424`); uhttpd is not in that path.
* ❌ "**A wallet in a browser on a captive HTTP LAN is safe.**" It is not, and the repo's own plan says so: bearer ecash in a browser over a captive network is an XSS/durability/shared-device target. **Never** present it as "your money is safe here". The vendor origin *concentrates* this risk (one origin = all users' balances) rather than removing it.
* ❌ "**`https://orangesync.tech` is live.**" The apex currently answers on `:80` with a 308 into a TLS listener that **fails the handshake** — measured today.
* ❌ "**Safari/Firefox will behave like Chrome here.**" No equivalent exemption/relay exists for them; treat option A as **UNSUPPORTED** there pending measurement.
* ❌ "**The LNA permission can be raised from the service worker / in the background.**" The worker must rely on the *document's* prior grant; a fresh install's background poll fails silently.

---

## 6. Open items (explicitly not settled here)

1. **Safari/WebKit and Gecko behaviour** for `https → http://<private IP>` (blocked as mixed content vs other) — **not measured**; would need those engines.
2. **The LNA enterprise policy** — announced ("we will also be adding a Chrome enterprise policy") but **no policy name/definition found** in the Chrome Enterprise policy list as fetched today. **Do not cite a name.** Re-check at implementation.
3. **The `/json/protocol` camelCase names vs the web PermissionName mapping** (`localNetworkAccess` in CDP vs `local-network-access` in the Permissions API) — measured on 156; expected to be stable but re-verify.
4. **`targetAddressSpace:"local"` acceptance** — the option is in the LNA spec (`IPAddressSpace { "public", "private", "local" }`) and in the Chrome blog, but my probe did not return before teardown; **not measured**. Re-test when wiring the fetches.
5. **The exact gateway identity carrier** for the roaming comparison (extend `kind:10021`? a new tag?) — a design decision, not a measurement.
6. **Estate inventory drift** — `tollgate-infrastructure` (verified 2026-09-18) does not list `23.182.128.226`/`66.92.204.38`; refresh the skill's host table before deploying.
7. **Chrome's pre-142 population** (138–141) sees neither the prompt nor necessarily the exemption: decide whether to gate onboarding on a UA/behaviour check.

---

## 7. Sources

**Spec**
1. W3C, *Secure Contexts* — §3.1 *Is origin potentially trustworthy?* (+ the "neither origin's domain nor port" note), §3.2, §7.2 *Development Environments*, §4.1 *Threat Models* — <https://w3c.github.io/webappsec-secure-contexts/>
2. W3C, *Service Workers* — §6.1 *Secure Context* — <https://w3c.github.io/ServiceWorker/#secure-context>
3. W3C, *Mixed Content* — §3.1 *Upgradeable Content*, §3.2 *Blockable Content*, §4.1 — <https://w3c.github.io/webappsec-mixed-content/>
4. WICG, *Private Network Access* — `IPAddressSpace { public, private, local }`, `targetAddressSpace`, `Access-Control-Request/Allow-Private-Network` — <https://wicg.github.io/private-network-access/>
5. W3C, *Fetch* — via Mixed Content §4.1 hook — <https://fetch.spec.whatwg.org/>
6. RFC 1918 (private IPv4), RFC 4291 §2.5.3 (`::1/128`) — referenced by the LNA classification.

**MDN / Chrome**
7. MDN, *Mixed content* — blockable content list incl. `fetch()`/XHR; "blocked if the URL's host is an IP address" — <https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content>
8. MDN, *Secure Contexts* — <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>
9. MDN, `ServiceWorkerContainer.register()` — `SecurityError`/`TypeError` — <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register>
10. Chrome for Developers, **"New permission prompt for Local Network Access" (Chrome 142)** — the mixed-content exemption + its 4 examples; the SW/SharedWorker grant caveat; the planned enterprise policy — <https://developer.chrome.com/blog/local-network-access>
11. Chrome for Developers, *Private Network Access: introducing preflights* (superseded) — <https://developer.chrome.com/blog/private-network-access-preflight>
12. Chrome for Developers, *Private Network Access: what's next* — <https://developer.chrome.com/blog/private-network-access-update>
13. Chrome Enterprise policy list (fetched; **no LNA policy definition present**) — <https://chromeenterprise.google/policies/>
14. Peter Beverloo, *Chromium command line switches* — `--unsafely-treat-insecure-origin-as-secure`, `--ignore-certificate-errors` — <https://peter.sh/experiments/chromium-command-line-switches/>
15. Chromium source, `net/base/is_potentially_trustworthy.cc`, `net/base/url_util.cc` (`IsLocalHostname`), `components/policy/.../OverrideSecurityRestrictionsOnInsecureOrigin.yaml` — <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/is_potentially_trustworthy.cc>

**Platform / CA**
16. Android Developers Blog, *Changes to Trusted Certificate Authorities in Android Nougat* — apps targeting API 24 do not trust user-added CAs by default — <https://android-developers.googleblog.com/2016/07/changes-to-trusted-certificate.html>
17. Android Developers, *Network security configuration* (`trust-anchors src="user"`, `debug-overrides`) — <https://developer.android.com/privacy-and-security/security-config>
18. Apple, *Trust manually installed certificate profiles in iOS, iPadOS, and visionOS* — manual *Certificate Trust Settings* toggle; MDM/Configurator auto-trust — <https://support.apple.com/en-us/102390>
19. Let's Encrypt, *Certificates for localhost* — no cert for a name nobody uniquely owns — <https://letsencrypt.org/docs/certificates-for-localhost/>
20. CA/Browser Forum, *Baseline Requirements* — issuance requires domain control; no public certs for IP literals/internal names — <https://cabforum.org/working-groups/server/baseline-requirements/requirements/>
21. Android Developers, `WebViewAssetLoader` (native-wrapper option) — <https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader>
22. TP-Link community, Omada captive portal fails on Android after the "not secure" warning (field report) — <https://community.tp-link.com/en/business/forum/topic/846700>

**Project-internal**
23. `~/reports/pwa-cashu/SPIKE-secure-context.md` (esp. §3(a) caveat and §6 open item on PNA — both closed here)
24. `~/reports/pwa-cashu/DOSSIER-portal.md` — §5.1 gateway endpoints, §5.2 poll loop, §7 display-and-forward client, §8 gaps #4/#6/#7/#9/#10
25. `~/reports/pwa-cashu/DOSSIER-wallet-libs.md` — IndexedDB/seed/proof storage, NUT-13, threshold policy
26. `~/reports/pwa-cashu/PLAN-pwa-client-wallet-v1.md`
27. Skills: `tollgate-infrastructure` (hosts/services/Caddy/Ansible), `tollgate-development` (`references/uhttpd-instance-tls-and-redirect-ownership.md`, portal `:2051` facts)
28. `~/repos/tollgate-infrastructure-kit` — `ansible/playbooks/04-caddy.yml`, `ansible/roles/caddy/{tasks/main.yml,templates/Caddyfile.j2,Caddyfile.http.j2,docker-compose.yml.j2}`, `ansible/inventory/group_vars/all.yml` (`base_domain`, `acme_email`, `tollgate_static_dir`); repo HEAD `30330ca`
29. Code refs cited through the dossiers: `src/main.go:424` (`:2121` Go listener), `src/helpers/tollgate.js:12-15,21-25`, `src/helpers/lightning.js:9-12,21-41,58-68,92-98`, `openwrt/files/etc/config/uhttpd_admin:47,52-54`, `packaging/files/etc/uci-defaults/92-tollgate-admin-setup:75`
