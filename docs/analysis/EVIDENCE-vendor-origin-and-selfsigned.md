# RAW MEASUREMENT EVIDENCE — vendor origin / self-signed / local-network-access

Companion to `DOSSIER-vendor-origin-and-selfsigned.md`. All output below is verbatim from the rig
described in the dossier §0.2, on **Google Chrome for Testing 156.0.8078.4**, Linux x86_64.

Rig scripts (on the measuring host, `/tmp/rig/`):
`http_srv.py` (CORS/no-CORS HTTP "router API" + request logger), `https_srv.py` (dual-stack self-signed TLS),
`cdp.mjs` / `cdp2.mjs` / `lna_cdp.mjs` (headless CDP drivers), `final_flow.sh` (headed interstitial click-through),
`auto_allow.sh` (headed LNA prompt + Allow), `post_allow.sh` (preflighted POST + router-side request log),
`lna_perm.mjs` (CDP grant attempt), `headed_probe.sh` / `click_scroll.sh` (screenshot/coordinate discovery).

---

## E1. Interstitial click-through → secure context but NO service worker

Initiator `https://192.168.2.20:8444/index.html` (self-signed). Headed Chrome under Xvfb+openbox;
real pointer clicks: `Advanced` @ (389,682), scroll, `Proceed to 192.168.2.20 (unsafe)` @ (443,798).

```json
{
 "location": "https://192.168.2.20:8444/index.html",
 "title": "vendor-pwa-rig",
 "isSecureContext": true,
 "hasSW": true,
 "rigLoaded": "string",
 "hasCryptoSubtle": true,
 "hasCaches": true,
 "hasPaymentRequest": true,
 "hasIndexedDB": true,
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

### E1b. Control — the interstitial page itself (origin `null`)

```json
{
 "location": "chrome-error://chromewebdata/",
 "title": "Privacy error",
 "isSecureContext": false,
 "hasSW": false,
 "hasCryptoSubtle": false,
 "hasCaches": false,
 "hasPaymentRequest": false,
 "console": [
  "Mixed Content: The page at 'chrome-error://chromewebdata/' was loaded over HTTPS, but requested an insecure resource 'http://192.168.2.20:8018/api.json'. This content should also be served over HTTPS.",
  "Access to fetch at 'http://192.168.2.20:8018/api.json' from origin 'null' has been blocked by CORS policy: The request client is not a secure context and the resource is in more-private address space `local`.",
  "Failed to load resource: net::ERR_FAILED"
 ]
}
```

### E1c. Stand-in comparison (`--ignore-certificate-errors`) — private initiator

Same page, private initiator `https://192.168.2.20:8444/`:

```json
{
 "isSecureContext": true, "hasSW": true,
 "sw_register": { "ok": true, "scope": "https://192.168.2.20:8444/" },
 "http_private_8018_CORS":     { "ok": true,  "status": 200, "type": "cors" },
 "http_private_8019_NO_CORS":  { "ok": false, "error": "TypeError: Failed to fetch" },
 "http_loopback_8018":         { "ok": true,  "status": 200, "type": "cors" },
 "manifest": { "ok": true, "status": 200 },
 "console": [
  "Mixed Content: … requested an insecure resource 'http://192.168.2.20:8018/api.json' …",
  "Mixed Content: … 'http://192.168.2.20:8019/api.json' …",
  "Access to fetch at 'http://192.168.2.20:8019/api.json' from origin 'https://192.168.2.20:8444' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."
 ]
}
```
**Note the contrast with E1: with `--ignore-certificate-errors` the SW registers; with a real user click-through it does NOT.**
The flag suppresses the error at the network layer and therefore skips gate 3 — which is exactly why the earlier
spike's stand-in could not settle this question.

---

## E2. PUBLIC origin → PRIVATE router — the crux (DENIED, nothing leaves the browser)

Initiator: **`https://[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444/index.html`** (global IPv6 → genuinely public address space).

```json
{
 "pageUrl": "https://[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444/index.html",
 "isSecureContext": true,
 "hasSW": true,
 "result": {
  "http_private_192_8018_CORS":    { "ok": false, "error": "TypeError: Failed to fetch" },
  "http_private_192_8019_NO_CORS": { "ok": false, "error": "TypeError: Failed to fetch" },
  "http_loopback_8018":            { "ok": false, "error": "TypeError: Failed to fetch" },
  "http_public_literal_samehost":  { "ok": false, "error": "TypeError: Failed to fetch" }
 },
 "consoleEntries": [
  "Mixed Content: The page at 'https://[2a01:…:33ed]:8444/index.html' was loaded over HTTPS, but requested an insecure resource 'http://192.168.2.20:8018/api.json'. This content should also be served over HTTPS.",
  "Access to fetch at 'http://192.168.2.20:8018/api.json' from origin 'https://[2a01:…:33ed]:8444' has been blocked by CORS policy: Permission was denied for this request to access the `local` address space.",
  "Failed to load resource: net::ERR_FAILED",
  "Mixed Content: … 'http://192.168.2.20:8019/api.json' …",
  "Access to fetch at 'http://192.168.2.20:8019/api.json' from origin 'https://[2a01:…:33ed]:8444' has been blocked by CORS policy: Permission was denied for this request to access the `local` address space.",
  "Failed to load resource: net::ERR_FAILED",
  "Access to fetch at 'http://127.0.0.1:8018/api.json' from origin 'https://[2a01:…:33ed]:8444' has been blocked by CORS policy: Permission was denied for this request to access the `loopback` address space.",
  "Failed to load resource: net::ERR_FAILED",
  "Mixed Content: … 'http://[2a01:…:33ed]:8018/api.json' … This request has been blocked; the content must be served over HTTPS."
 ]
}
```
Router-side request log for the same run: **no request reached the server** (only the earlier `curl` lines present).
⇒ a public origin cannot even *attempt* a private-space request without the permission.

---

## E3. The permission is real, nameable, and in state `prompt`

`navigator.permissions.query` on the public origin:

```json
{
 "local-network-access": { "state": "prompt", "name": "local-network-access" },
 "local-network":        { "state": "prompt", "name": "local-network" },
 "loopback-network":     { "state": "prompt", "name": "loopback-network" },
 "localNetworkAccess": { "error": "TypeError: … 'localNetworkAccess' is not a valid enum value of type PermissionName." },
 "localNetwork":       { "error": "TypeError: … 'localNetwork' is not a valid enum value of type PermissionName." },
 "loopbackNetwork":    { "error": "TypeError: … 'loopbackNetwork' is not a valid enum value of type PermissionName." },
 "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
}
```

Chrome 156 `/json/protocol` → `Browser.PermissionType` contains: `"localNetwork"`, `"localNetworkAccess"`, `"loopbackNetwork"`.
BUT `Browser.setPermission` with any of those names is rejected:
```json
{"id":1,"error":{"code":-32602,"message":"Invalid PermissionDescriptor name: localNetworkAccess"}}
{"id":2,"error":{"code":-32602,"message":"Invalid PermissionDescriptor name: localNetwork"}}
{"id":3,"error":{"code":-32602,"message":"Invalid PermissionDescriptor name: loopbackNetwork"}}
```
(`Browser.grantPermissions {permissions:["localNetworkAccess"], origin: …}` returns `{}` but has **no effect** on the fetch.)
⇒ **the CDP emulation names are not the web PermissionName; do not use them for automation.**

### E3b. The real prompt (headed Chrome, Xvfb+openbox), captured by screenshot inspection

```
[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444 wants to Access other devices on your local network     [ Block ]  [ Allow ]
```
Raised automatically by the page's fetch (no gesture needed to *raise* it). Buttons at ~`Allow (389,265)`,
`Block (310,265)`.

---

## E4. After Allow — the whole path works, incl. the preflighted POST

```json
{
 "outText": "{ \"priv\": { \"ok\": true, \"status\": 200, \"type\": \"cors\" }, \"privNoCors\": { \"ok\": false, \"error\": \"TypeError: Failed to fetch\" }, \"isSecureContext\": true }",
 "lna": { "priv": { "ok": true, "status": 200, "type": "cors" },
          "privNoCors": { "ok": false, "error": "TypeError: Failed to fetch" },
          "isSecureContext": true },
 "hasSW": true,
 "isSecure": true,
 "attemptReg": { "ok": true, "scope": "https://[2a01:…:33ed]:8444/" },
 "console": [
  "Mixed Content: … requested an insecure resource 'http://192.168.2.20:8018/api.json' …",
  "Mixed Content: … 'http://192.168.2.20:8019/api.json' …",
  "Access to fetch at 'http://192.168.2.20:8019/api.json' from origin 'https://[2a01:…:33ed]:8444' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  "Failed to load resource: net::ERR_FAILED"
 ]
}
```
Note: the `:8019` failure is now a **genuine CORS failure** (`No 'Access-Control-Allow-Origin' header`) — proving the two
gates (permission AND CORS) are independent.

### E4b. Money-path shape: preflighted POST + router-side request log

Run 1 (click Allow), Run 2 (**no click** — persistence check):

```json
RUN1 {"post": {"ok": true, "status": 200, "type": "cors"}}
RUN2 {"post": {"ok": true, "status": 200, "type": "cors"}}
```
Router-side (CORS server on `:8018`) request log:
```
OPTIONS /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None | ACRM: POST
POST    /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None
OPTIONS /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None | ACRM: POST
POST    /ln-invoice?mac=aa:bb:cc:dd:ee:ff | Origin: https://[2a01:…:33ed]:8444 | ACRPN: None
```
`ACRPN` = `Access-Control-Request-Private-Network` → **`None`**: Chrome 156 does **not** send the legacy PNA preflight
header, so `Access-Control-Allow-Private-Network: true` on the router is dead code.
And **Run 2 needed no click** ⇒ the local-network grant is sticky per origin across browser restarts.

---

## E5. Live `orangesync.tech` state (measured 2026-10-14)

```
A     orangesync.tech → 23.182.128.226, 66.92.204.38, 23.182.128.51     (Cloudflare DoH)
AAAA  orangesync.tech → (none)
www.orangesync.tech   → 23.182.128.226

http://orangesync.tech/ →  308 Permanent Redirect  →  https://orangesync.tech/   Server: Caddy
https://orangesync.tech/ →  curl: (35) OpenSSL/3.0.13: error:0A000438:SSL routines::tlsv1 alert internal error

openssl s_client -connect 23.182.128.51:443 -servername orangesync.tech
  CONNECTED(00000003)
  error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error (SSL alert number 80)
  no peer certificate available
  Verification: OK ; New, (NONE), Cipher is (NONE) ; No ALPN negotiated

TCP :443 → 23.182.128.51 OPEN ; 23.182.128.226 closed ; 66.92.204.38 closed
```
⚠️ **The apex is broken today: Caddy redirects :80 → :443 into a TLS listener that fails the handshake.**
⚠️ **Inventory drift:** `tollgate-infrastructure` (verified 2026-09-18) lists vps2 `23.182.128.51` / vps3
`23.182.128.219`; today's A records include `23.182.128.226` and `66.92.204.38`, which are **not** in that table.

---

## E6. Spec/doc text quoted in the dossier (extraction provenance)

| Quoted as | Source fetched |
|---|---|
| §3.1 steps + "Neither origin's domain nor port has any effect…" | `https://w3c.github.io/webappsec-secure-contexts/` (HTTP 200, 128 785 B) |
| "Service workers must execute in secure contexts…" | `https://w3c.github.io/ServiceWorker/` (200, 1 923 358 B) |
| "Any mixed content that is not upgradeable … is considered to be blockable" | `https://w3c.github.io/webappsec-mixed-content/` (200, 122 658 B) |
| "fetch() requests" in the **Blockable** list; "blocked if the URL's host is an IP address" | `https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content` (200, 167 371 B) |
| LNA mixed-content exemption (3 conditions + 4 examples); SW/SharedWorker grant caveat; planned enterprise policy; Chrome 138 opt-in flag | `https://developer.chrome.com/blog/local-network-access` (200, 107 594 B) |
| PNA three address spaces; "more private than" | `https://developer.chrome.com/blog/private-network-access-preflight` (200, 121 042 B) |
| "apps that target API level 24 will—by design—not [trust user-added CAs]…"; "trust only the standardized system CAs maintained in AOSP" | `https://android-developers.googleblog.com/2016/07/changes-to-trusted-certificate.html` (200, 148 498 B) |
| `trust-anchors src="user"`; `debug-overrides` | `https://developer.android.com/privacy-and-security/security-config` (200, 317 076 B) |
| "isn't automatically trusted for SSL… Settings > General > About > Certificate Trust Settings… automatically trusted when installed with Configurator, MDM" | `https://support.apple.com/en-us/102390` (200) |
| "Let's Encrypt can't provide certificates for 'localhost'…" | `https://letsencrypt.org/docs/certificates-for-localhost/` (200, 33 993 B) |
| `targetAddressSpace`; `IPAddressSpace { public, private, local }`; `Access-Control-Request/Allow-Private-Network` | `https://wicg.github.io/private-network-access/` (200, 248 061 B) |
| `Browser.PermissionType` enum incl. `localNetwork`/`localNetworkAccess`/`loopbackNetwork` | `<devtools>/json/protocol` on Chrome 156 |

---

## E7. NOT measured (open items — see dossier §6)

* Safari/WebKit and Firefox/Gecko behaviour for `https → http://<private IP>`.
* `fetch(…, { targetAddressSpace: 'local' })` acceptance (probe did not return before teardown).
* The LNA enterprise policy — announced in the Chrome blog, **no policy name found** in the Chrome Enterprise list as fetched.
* Chrome 138–141 opt-in-flag population (neither prompt nor necessarily the exemption).
