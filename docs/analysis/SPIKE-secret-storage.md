# SPIKE — Device-local / file-system secret storage for a PWA Cashu wallet

**Status:** Spike complete. Findings + ranked recommendation. NO production code.
**Author:** manager (Felix), 2026-10-14
**Answers:** operator's question — *"How about we offer to store the secret on the user's device / file system so that the user doesn't need to write anything down and to reduce the interactivity for the user? Would this help?"*
**Evidence rule applied:** every claim below carries a source URL, and is labelled **spec / ships in browser X / UNSUPPORTED**. Browser-version numbers are read from MDN Browser Compat Data (BCD) `main` and caniuse `fulldata-json`, fetched 2026-10-14. Where BCD and caniuse disagree, both are cited and the disagreement is stated.

---

## 0. Answer first

**Yes, it helps — but not for the reason the question implies, and it cannot remove the write-down step by itself.**

The operator's two goals are separable and have *opposite* difficulty:

| Goal | Achievable without a write-down? | Why |
|---|---|---|
| **Reduce interactivity** (no phrase ceremony, wallet works immediately) | **YES, today, on every browser** | Generate entropy on-device and persist it. This is a pure client-side choice; cashu.me already does exactly this and *chooses* to show the reveal step. |
| **A secret that survives eviction without the user writing anything down** | **NO — not on all browsers, and not with a single mechanism** | Eviction (`clear site data`, OS pressure, browser reset) destroys *all* origin-scoped storage at once, including any device-local key. Surviving it requires the secret (or a wrapping key) to live **outside the origin's storage**, which on mobile is only reachable via the File System Access API (no iOS, no Firefox) or a passkey. |

So "store it on the device" **does** remove the write-down for the common case, and it does reduce interactivity. What it does **not** do is make the secret durable — it converts "the user must write something down" into "the user must accept a bounded, disclosed loss unless they later opt into an export". The correct design is therefore: *device-local by default, cheap export on demand, passkey as an opportunistic wrapper — and the loss bounded by a policy cap, not by the storage mechanism.*

---

## 1. Browser storage options, measured

### 1.1 What "clear site data" actually removes

`Clear-Site-Data: "storage"` — "The server signals that the client should remove **all DOM storage** for the origin of the response URL", and MDN enumerates exactly what that covers:

> **localStorage** (`localStorage.clear`), **sessionStorage** (`sessionStorage.clear`), **IndexedDB** (`IDBFactory.deleteDatabase` per database), **Service worker registrations** (`ServiceWorkerRegistration.unregister`), **Web SQL databases** (deprecated), **FileSystem API data**.

Source: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data>. Note the enumeration is of *origin storage*; it does **not** cover a file the user chose via `showSaveFilePicker()` (§2) — that file is the user's, not the origin's.

This is a **server-sent header** and is total by definition: nothing an origin stores under its own bucket is exempt.

The user-facing equivalent (browser settings → "Clear site data" / "Clear browsing data → Cookies and site data") is the same: it removes everything under the origin. **No storage mechanism on this list survives it.** This is the single most important fact in the spike — it is why "store it on the device" cannot be a backup.

### 1.2 What ITP removes on iOS Safari (the 7-day eviction)

WebKit's own list of *"script-writable storage forms affected"* by the seven-day cap, quoted verbatim:

> **Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and cache**

Source: <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/> ("7-Day Cap on All Script-Writeable Storage").

Two consequences that change the design:

1. **OPFS and cookies are handled differently, and OPFS is not on that 2022 list.** MDN frames OPFS as "subject to browser storage quota restrictions, just like any other origin-partitioned storage mechanism", and states plainly: **"Clearing storage data for the site deletes the OPFS."** Source: <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system>. So OPFS is *not* an ITP-7-day item by documented policy, but it *is* destroyed by clear-site-data — same as IndexedDB. **Do not treat OPFS as a durability improvement over IndexedDB. It is not.**

2. **An installed home-screen web app is exempt from the 7-day cap.** Quoted verbatim from the same WebKit post:

   > "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use. Their days of use will match actual use of the web application which resets the timer. **We do not expect the first-party in such a web application to have its website data deleted.** … It is not the intention of Intelligent Tracking Prevention to delete website data for first parties in web applications."

   This is a **written, citable commitment from Apple** and it is the strongest durability guarantee any PWA gets on iOS. It is also the *only* one — it requires the install step, which is exactly the friction the operator is trying to remove. **This is the central tension of the whole spike.**

### 1.3 `navigator.storage.persist()` — what it does and does not buy

Ships **everywhere**: Chrome/Chrome Android 55, Safari/iOS 15.2, Firefox 57. Source: BCD `api/StorageManager.json`.

- Default is **best-effort**: "evicted … without interrupting the user".
- `persist()` promotes to **persistent**: "only evicted, or deleted, if the user chooses to".
- Grant model: **Chrome auto-decides by heuristics** (site engagement, installed?, bookmarked?, notification permission) and "does not show any prompts"; **Safari auto-decides silently**; **Firefox shows a popup**.
- Persistent storage protects: **Cache API, Cookies, DOM Storage (localStorage), File System API (including the sandboxed/OPFS one), IndexedDB, Service Workers**.

Sources: <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria> and <https://web.dev/articles/persistent-storage>.

**Reading:** `persist()` defends against *storage-pressure eviction* (the "OS eviction" column). It does **not** defend against clear-site-data, a browser profile reset, or private browsing. It is necessary, cheap, and free of prompts — **call it, but never rely on it alone.**

### 1.4 Private browsing

"Browsers may apply different quotas, and stored data is usually deleted when the private browsing mode ends." (MDN, quotas/eviction article, above.) A captive portal is a plausible first contact, and on iOS a captive-portal "Sign in" sheet can open in a context the user never returns to. **Private-mode and one-shot-context contact must be assumed, not treated as an edge case.**

### 1.5 WebSQL — DEAD

caniuse `sql-storage`: note reads *"The Web SQL Database specification is no longer being maintained and support is intended to be dropped in future versions."* Chrome `y` through v118, `n` from v119 onward; Safari `n` from 27. Source: <https://caniuse.com/sql-storage>. **UNSUPPORTED — do not use.**

### 1.6 Summary matrix

| Mechanism | Wiped by clear-site-data | Wiped by ITP ~7d (iOS) | Private browsing | Protected by `persist()` | Persists across browser updates | User can FIND + COPY it |
|---|---|---|---|---|---|---|
| `localStorage` | **YES** | **YES** (named in WebKit list) | session-only | yes | yes | no (devtools only) |
| `IndexedDB` | **YES** | **YES** (named in WebKit list) | session-only | yes | yes | no |
| Cache API | **YES** | **YES** ("Service Worker registrations and cache") | session-only | yes | yes | no |
| Cookie (`Secure`, `Max-Age`, `SameSite=Lax`) | **YES** | 7-day cap on **client-side** cookies (*"cap the expiry of client-side cookies to seven days"*); **cookies are not in the 2022 script-writable list**, but they are cleared by any purge | session-only | yes | yes | partially — visible in the browser's site-data UI, but not "copy this string" |
| **WebSQL** | n/a — **DEAD** | n/a | n/a | n/a | n/a | n/a |
| **OPFS** | **YES** (MDN: "Clearing storage data for the site deletes the OPFS") | not on the documented 2022 list → **unknown**, treat as YES | n/a | yes (named as "File System API (browser-provided and sandboxed file system)") | yes | **NO — "not visible to the user"** |
| **Installed home-screen PWA** | **YES** (still an origin) | **NO — Apple states it will not** | n/a | yes | yes | n/a |

**Verdict for §1:** every *device-local* bucket is eviction-coupled and invisible. Storage diversity (localStorage + IndexedDB + OPFS + cookie) buys **nothing** against clear-site-data, because they all die together. **Storing the seed in more places on the device is not a mitigation** — that is the single most likely design mistake here.

---

## 2. The File System Access API — the operator's "file system" idea

### 2.1 Support, measured

From BCD `api/Window.json` (`showSaveFilePicker` / `showOpenFilePicker` / `showDirectoryPicker` all have identical rows):

| Browser | `show{Save,Open}FilePicker`, `showDirectoryPicker` |
|---|---|
| Chrome desktop | **86** ✅ |
| Edge desktop | mirror of Chrome ✅ |
| **Chrome Android** | **132** ✅ |
| **Safari / Safari iOS** | **`false` — UNSUPPORTED** ❌ |
| **Firefox / Firefox Android** | **`false` — UNSUPPORTED** ❌ |
| WebView Android / Samsung Internet | mirror / mirror (pickers inheriting Chrome 132) |

Corroborated two ways:
- Chrome's own release notes: *"The File System Access API on Android and WebView … **From Chrome 132, the API is now available on Android and in WebViews.**"* — <https://developer.chrome.com/blog/new-in-chrome-132>
- Chrome Status feature "File System Access" (id `6284708426022912`): status **Enabled by default, desktop 86**; the **Android milestone field is empty**, and a separate feature "Origin Private File System (OPFS) on Android" (id `5079634203377664`) is **Enabled by default, android 109** — i.e. Chrome's own tracker records OPFS-on-Android as a *distinct* ship from the pickers. Source: <https://chromestatus.com/features/6284708426022912>

**Disagreement stated:** caniuse `native-filesystem-api` shows `and_chr = n` for all current versions and carries the notes *"Can be enabled in desktop Chromium browsers with the `#native-file-system-api` flag"* and *"Parts of the API are still missing."* Source: <https://caniuse.com/native-filesystem-api>. **BCD + Google's own blog are the stronger evidence for Chrome 132 on Android; caniuse appears not to have picked the Android ship up.** Either way the iOS/Firefox answer is unambiguous and identical in both sources: **UNSUPPORTED**.

### 2.2 Permission model, and whether a PWA can re-open a handle silently

- The pickers require a **user gesture**; the user chooses a path; the origin receives a `FileSystemFileHandle`.
- The grant is **per-origin and revocable**, surfaced in the address-bar icon: *"the browser shows an icon in the address bar … The user can always revoke that access if they choose."* Source: <https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>
- Handles **are serializable into IndexedDB**: *"Objects based on `FileSystemHandle` can also be serialized into an IndexedDB database instance, or transferred via `postMessage()`."* — <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API>
- **But a re-opened handle does not come back `granted`.** MDN, `queryPermission()`: *"other than through the user revoking permission, **a handle retrieved from IndexedDB is also likely to resolve with `prompt`**."* → you must call `requestPermission()` **inside a user gesture** before use. Source: <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission>
- Chrome's older capability page still describes the *write* permission as tab-scoped: *"can continue to save changes to the file without prompting until all tabs for its origin are closed. Once a tab is closed, the site loses all access. The next time the user uses the web app, they will be re-prompted."* (same URL). MDN's `queryPermission` page is the more current statement; both agree on the operative point.

**Answer to "can it re-open a previously-granted handle WITHOUT re-prompting?" — NO.** The *grant* survives in IndexedDB across sessions; the *permission* does not, and re-acquiring it costs one user gesture per session. **This is cheaper than writing down 12 words, but it is not zero interaction.**

### 2.3 Does it give us a user-visible, user-copyable, NON-evictable secret file?

**On Chrome desktop and Chrome Android 132+: YES — and this is genuinely the only mechanism in the whole spike that does.** The reason is structural and worth stating precisely:

> A `FileSystemFileHandle` obtained via `showSaveFilePicker()` points at a file in the **user-visible file system**. That file is **not origin storage**. `Clear-Site-Data: "storage"`, "clear site data", an ITP purge, and a browser profile reset all destroy the *origin's bucket* — including the IndexedDB record that held the *handle*. **They do not delete the user's file.** The ciphertext (or even the plaintext seed) sits in the user's Downloads/Documents folder, visible in the Files app, copyable to Drive, e-mail, or a USB stick, and re-grantable to the site after the purge.

That is the property no other mechanism on the list has, and it is exactly what the operator is reaching for. The costs, stated honestly:

- **iOS: UNSUPPORTED.** `safari_ios: false`. There is no path to this on iPhone/iPad.
- **Firefox: UNSUPPORTED.** desktop and Android both `false`.
- **Chrome Android needs 132+.** Real, current, but a floor to declare.
- **One gesture per session** for re-grant.
- **Safe Browsing friction**: writes to the user-visible FS are not in-place and pass security checks — *"These changes are being made to the user-visible file system, so there are a lot of security checks in place (for example, safe browsing in Chrome). … The original is not modified unless it passes all the security checks."* Also: certain folders are refused (*"core operating system folders"*). Source: <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system>

**Caution against a seductive-but-wrong shortcut:** OPFS (`navigator.storage.getDirectory()`) *looks* like the same thing and is *not*. It has **no permission model and no user visibility** (MDN: *"Permission prompts and security checks are not required to access files in the OPFS"*; *"The OPFS is not intended to be visible to the user"*). OPFS is a faster IndexedDB — same eviction class. **Only the picker APIs produce a non-evictable, user-visible file.** Do not let a design review conflate them.

---

## 3. Encrypted export + cloud / self-hosted sync

### 3.1 The Web Share API is the right rail on mobile

BCD `api/Navigator.json`:

| API | Chrome desktop | Chrome Android | Safari / iOS | Firefox |
|---|---|---|---|---|
| `navigator.share` | 128 | **61** | **12.1** | desktop 71 (flag) / Android 79 |
| `navigator.share({files})` | 89 | **76** | **14** | **`false` — UNSUPPORTED** |
| `navigator.canShare` | 128 | 75 | 14 | 96 (flag) / 96 |

So on **both** target mobile platforms (Chrome Android ≥76, iOS Safari ≥14) the share sheet accepts a `File`/`Blob` — which is what lands a backup in **Files / Google Drive / OneDrive / e-mail** with **one tap**. Firefox cannot share files at all. A fallback `<a download>` link covers it.

Sources: <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share>, <https://caniuse.com/web-share>.

### 3.2 Is an encrypted blob *less* friction than a phrase?

**Yes, materially — for the BYOD user, and this is the best friction-per-satoshi trade in the spike.** Compare what the user does:

| | Mnemonic phrase | Share-sheet blob |
|---|---|---|
| User action | read 12 words off a screen, hand-copy them, verify, store somewhere safe | tap "Save backup", tap "Drive" |
| Error mode | transcription error, screenshot to camera roll, photo of screen in cloud | none |
| Recoverability | NUT-09 restore if all three inputs retained | restore from the blob |
| User-visible? | yes | yes |
| Survives clear-site-data? | yes (it's off-device) | yes (it's off-device) |

**The one honest catch:** the blob still needs a **key**, and if the key is on the same device, the blob is only protected against *theft of the blob*, not against *loss of the device*. Two ways to close it:
1. **User passphrase** → this re-introduces a write-down, i.e. it is a *phrase by another name*. Do **not** present it as "nothing to write down".
2. **Passkey-PRF-derived key** → see §4. This is the only combination that is genuinely *nothing to write down **and** recoverable on another device*.

### 3.3 Publishing the encrypted blob somewhere recoverable

Mechanically easy (Blossom / NIP-96 host, a nostr event, or any object store) and **safe only if the key never accompanies it**. The honest accounting: publishing buys **availability of the ciphertext** and nothing else. If the key is device-local, publishing does not improve recovery after device loss — it just makes the ciphertext easier to find later. **Publishing is a genuine win only when paired with a PRF-derived key (§4), because then the key survives device loss via the platform keychain.**

---

## 4. Platform keystores and credential managers

### 4.1 WebAuthn / passkeys — the PRF extension

**What PRF is.** A pseudo-random function bound to a credential: *"Allows a relying party to get outputs for either one or two inputs from a pseudo-random function (PRF) associated with a credential. A PRF is effectively a random oracle — a function that returns a random value for any given input, but will always return the same value for the same input."* The canonical use MDN names first is *"generate a symmetric key for encrypting sensitive data"*. Spec: <https://w3c.github.io/webauthn/#prf-extension>; explainer prose: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions>.

**Support — and this is where the honest answer turns.** BCD `api/CredentialsContainer.json` separates PRF at **registration** from PRF at **assertion**, and they are *not* the same:

| `prf` extension | Chrome desktop | Chrome Android | **Safari / iOS** | Firefox desktop | Firefox Android |
|---|---|---|---|---|---|
| at **`create()`** (registration) | 116 ✅ | 116 ✅ | **18 ✅** | 139 ✅ (135–138 partial, *"Not supported on macOS"*) | 149 ✅ |
| at **`get()`** (assertion) | 116 ✅ | 116 ✅ | **`false` — UNSUPPORTED** ❌ | 139 ✅ | **`false`** ❌ |

Sources: <https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create>, <https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get>. Chromium's tracker confirms PRF as **"Enabled by default"** for Chrome: <https://chromestatus.com/feature/5138422207348736>.

**Why this is decisive.** A wallet must derive the *same* key on **every** unlock. `create()` happens **once**, at enrolment. On Safari, PRF output is therefore available **only at the single moment the passkey is created** — you cannot re-derive it on a later login. Microsoft's PRF explainer makes the same point from the other direction, and MDN flags the asymmetry directly: *"evaluating a PRF when creating a credential may not be supported, and this would be reported in the output"* (and the reverse — `get()` omits `enabled`).

**A second, worse problem: Safari's implementation has open correctness bugs.** From WebKit Bugzilla (queried 2026-10-14), all still `NEW`:

- **311099** — *"[WebAuthn] PRF extension returns **encrypted** hmac-secret output for CTAP2 security keys (missing decryption step)"* (2026-04-09) → on a hardware security key, Safari returns the wrong bytes.
- **314934** — *"WebAuthn PRF results return `null` during `navigator.credentials.get()` for YubiKey C Bio … (firmware 5.7.4)"* (2026-09-07).
- **284166** — *"PRF Extension Not Supported in Safari's **Cross-Device** WebAuthn Flow"* (2025-04-27) → the QR/hybrid flow — i.e. the exact flow a walk-up BYOD user hits when their passkey lives on their phone and they're on a laptop.

For completeness, the implementation bug itself is closed: **WebKit 259934** *"[WebAuthn] Implement PRF extension + hmac-secret"* → **RESOLVED FIXED**, committed `303406@main` on 2025-11-21. Mozilla's **Bug 1958716** *"Android support for WebAuthn PRF extension"* → **RESOLVED FIXED** (2026-01-29), which is why `firefox_android` moved 139 → 149.

**Honest verdict on PRF:**
- **Chrome (desktop + Android 116+): usable today**, create *and* get. This is a real "no write-down" rail.
- **Safari 18+: `create()`-only, and buggy.** It cannot carry a wallet on iOS today. Treat any iOS PRF path as **degrade-to-nothing**, validated at runtime via `getClientExtensionResults().prf`.
- **Firefox Android: `get()` UNSUPPORTED.** Firefox desktop works.

Because passkeys sync through the platform keychain (iCloud Keychain, Google Password Manager), a *working* PRF would let the user recover on a **new device** by signing in with the same passkey — the key is re-derived, nothing was ever written down. **That is the only design in this spike that satisfies both operator goals simultaneously.** It is available on Chrome today and **not** on iOS Safari today.

### 4.2 Credential Management API / `PasswordCredential`

BCD `api/PasswordCredential.json` + `api/CredentialsContainer.json`: `PasswordCredential` is **Chrome 51 / Chrome Android 51 only — Safari `false`, Firefox `false`.** `CredentialsContainer.store()` exists everywhere (Chrome 51, Safari 13, Firefox 60) but only mediates WebAuthn/Federated, not a password store on Safari/Firefox. Sources: <https://developer.mozilla.org/en-US/docs/Web/API/PasswordCredential>, <https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/store>.

**What this means for "store the seed as a saved password so Android's autofill can give it back": not a rail.** `PasswordCredential` cannot be *read back* by script on Safari or Firefox at all, and even on Chrome it exists for *submitting* an autofilled credential, not for reading a secret out of the password manager. The Android/Chrome autofill password store is **not script-readable** — a page can only *offer* a credential to be saved. **Do not design around it.**

### 4.3 OS-level keychain access from a PWA

**UNSUPPORTED, and there is no partial path.** A web page — installed PWA or not — has **no API** to read or write the iOS Keychain, the Android Keystore, or the Android credential store. WebAuthn (§4.1) is the *only* bridge that reaches a platform-held key, and it is deliberately constrained to sign/assert, with PRF as the one extension that yields derived bytes. There is **no** `Keychain`, `Keystore`, or `SecureEnclave` binding in the web platform.

Sources: the WebAuthn API surface itself — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API> — contains the complete set of bridging primitives (`navigator.credentials.{create,get}`, `PublicKeyCredential`, extensions). Nothing else reaches platform keys.

**Consequence for the ADR:** any sentence of the form *"we store the seed in the device's secure enclave / OS keychain"* is **false for a PWA** and must not appear.

---

## 5. Device-local hardware-backed options

Same answer as §4.3, stated separately because it is the claim most likely to be written by accident:

- **Secure Enclave (iOS) / StrongBox-TEE (Android) / TPM / Windows Hello:** reachable from a PWA **only** through WebAuthn, i.e. only as a *signing operation against a passkey*, plus PRF for derivation. There is no general-purpose keygen/keyhandle API on the web platform.
- **`crypto.subtle.generateKey(..., extractable: false)` with a non-extractable `CryptoKey` stored in IndexedDB:** this is a *real* API that exists and *does* keep the raw key bytes out of JS. It is worth noting as the **correct way to hold a wrapping key** in a PWA. **But it is not hardware-backed** — it is a software key held by the browser — and it is **origin storage**, so it is destroyed by clear-site-data and (probably) ITP exactly like everything else in §1.1. It is a good hygiene choice and **not** a durability mechanism.
- **WebAuthn `largeBlob` extension** (store bytes *with* a passkey): Chrome desktop 113, Safari/iOS 17, Firefox 139; **but `chrome_android` and `safari_ios` for `get()` is `false`** in BCD (`api/CredentialsContainer.json`), and Firefox Android is `false`. **Not a viable store on the two mobile targets.** UNSUPPORTED for this purpose.

---

## 6. The honest recommendation, ranked

Two populations, because they have different constraints and the answer **differs**.

### 6.1 Population (i) — BYOD walk-up user (captive portal, mixed iOS/Android, throwaway contact)

**Rank 1 — Device-local seed in IndexedDB, `navigator.storage.persist()` requested, value capped below a threshold `T`.** *(works on 100% of targets)*
No phrase, no user action, wallet live immediately. Accepts eviction by construction: the pre-reveal wallet is a **petty-cash purse**, and the design promise is *"you may lose up to T"*, disclosed in one plain line. **The cap — not the storage — is what makes this safe.** This is the only mechanism that works on every browser the operator will meet.

**Rank 2 — One-tap encrypted export via the Web Share API, offered (never forced) once balance ≥ `T`.** *(Chrome Android ≥76, iOS Safari ≥14; Firefox cannot share files)*
Gives the user a **non-evictable, user-visible** copy with one tap to Files/Drive — the *outcome* of "write it down" without the ceremony or the transcription errors. This is the highest-value friction reduction in the spike.

**Rank 3 — Passkey PRF as an opportunistic wrapper, runtime-detected.** *(Chrome desktop + Android 116+ ✅; Safari 18+ create-only ❌; Firefox Android get() ❌)*
Where it works, it upgrades the design to *"nothing written down **and** recoverable on a new device"*. Where it doesn't (all of iOS today), **silently fall through to Rank 1+2** — feature-detect via `getClientExtensionResults().prf` and never block on it.

**Rank 4 — File System Access API secret file.** *(Chrome desktop 86+, Chrome Android 132+; iOS UNSUPPORTED, Firefox UNSUPPORTED)*
Genuinely non-evictable and user-visible — but re-prompts every session, and is **absent on iOS**, the population's likeliest platform. **Offer it when `showSaveFilePicker` exists; never make it the only path.**

**Do NOT build for this population:** mnemonics as the primary ceremony (it is the friction we are removing), a user passphrase (a phrase by another name), `PasswordCredential` (Chrome-only, not read-back), publishing a blob whose key is device-local (buys availability, not recovery).

### 6.2 Population (ii) — operator-controlled fleet device (known platform, known browser)

**Rank 1 — File System Access API secret file (Chrome Android 132+ / Chrome desktop).** The fleet is a *known* platform, so the support limits stop being a blocker and become a configuration requirement. This is the **strongest** option in the entire spike *for this population*: the secret file lives **outside origin storage**, so it is **unaffected by clear-site-data, ITP, profile reset and OS storage-pressure eviction**; it is user-visible and operator-copyable; and the per-session re-grant is one tap on a device the operator controls and provisions.

**Rank 2 — Passkey PRF + platform keychain sync.** A provisioned passkey in the fleet device's Google Password Manager gives a synced, hardware-backed, no-write-down derivation. Real on Chrome Android.

**Rank 3 — IndexedDB + `persist()` + scheduled encrypted export to an operator-controlled location.** The safety net behind Rank 1; also the answer when the fleet is iOS or Firefox.

**Do NOT build for this population:** anything depending on a user gesture the fleet has no user for; anything assuming iOS (no FSA, PRF create-only).

### 6.3 The failure semantics of the recommended combination — precise

The recommended design is the **composition**: *seed in IndexedDB (persisted) + one-tap encrypted export + PRF key-wrapper when available + FSA secret file when available.* Exactly what happens in each failure mode:

| Event | Seed in IndexedDB | Encrypted export (off-device) | PRF-wrapped key | FSA secret file | Net outcome |
|---|---|---|---|---|---|
| **`Clear-Site-Data: "storage"` / "clear site data"** | **DESTROYED** (total, by definition) | survives | **passkey survives** — platform keychain, not origin storage; re-derivable | **handled record destroyed, but the FILE on disk SURVIVES** (not origin storage) | Recoverable if *either* the exported blob *or* the FSA file *or* a working PRF passkey exists. Otherwise **the balance ≤ T is lost — by design, and disclosed.** |
| **iOS ITP 7-day eviction** | **DESTROYED if not installed**; **survives if added to home screen** (Apple's written commitment, §1.2) | survives | n/a on iOS today (PRF create-only) | n/a on iOS | Recoverable if installed, or if the user took the export. **This is why the install prompt is a data-durability feature, not a UX nicety** — say so in the ADR. |
| **OS storage-pressure eviction** | survives if `persist()` granted; else evictable **without interrupting the user** | survives | survives | survives | Lowest-risk mode. `persist()` is the defence; request it early, at a moment of user intent. |
| **Device loss / theft** | gone | **survives — this is the export's whole purpose** | **survives** — passkey syncs to the user's new device; key re-derives | gone (unless the file was copied off — which the user can do) | Recoverable via export or synced passkey. **Not recoverable from device-local storage alone — and the ADR must not pretend otherwise.** |
| **Browser change** (Safari → Chrome, or a reset) | gone | survives | **platform-dependent** — iCloud→Google does not sync; a new passkey = a **new PRF value = the old ciphertext is unreadable** | survives, if the file is re-granted | The export is the only rail that is genuinely browser-independent. **Warn: PRF-wrapping is bound to the passkey, not to the user.** |
| **Private browsing / one-shot captive-portal context** | lost at session end | survives only if the user completed the export *in* that session | n/a | written to the user's FS, so it survives | **Assume this happens. Never generate funds-bearing state the user hasn't exported without disclosing it.** |

---

## 7. What to document in the ADR — the promise, and what must NOT be claimed

### 7.1 The promise (claimable, each backed by §1–§5)

1. **"You never have to write anything down to use this."** True. The seed is generated on-device and persisted; the reveal step is a choice, not a requirement. *(cashu.me already generates silently and chooses to render the reveal — cite it.)*
2. **"If you install the app to your home screen, Apple has stated it will not evict your data."** True, and quotable verbatim from WebKit — the strongest durability claim available on iOS.
3. **"If you lose the device, one tap on an exported backup is enough — and where your passkey supports it, you don't even need the backup."** True, scoped to the browsers where each mechanism is verified present.
4. **"The most you can lose is `T`."** True, and it is the load-bearing promise. `T` is a policy constant; the *cap* is the mitigation.

### 7.2 Must NOT be claimed (each is FALSE, with the citation that makes it false)

| Forbidden claim | Why it is false |
|---|---|
| "Your money is safe here." | A bearer wallet in a browser on a captive HTTP network is an XSS/shared-device/eviction target. Carried over from the portal plan doc itself. |
| "We store your seed in the device's secure enclave / OS keychain." | **No web API reaches the platform keychain.** WebAuthn is the only bridge, and only as sign/PRF. §4.3, §5. |
| "The secret is encrypted at rest, so it's protected." | If the wrapping key is also in device storage, encryption buys **nothing** against eviction (both die together) and **nothing** against XSS (the page reads both). Its only real property is that the blob is **portable-and-opaque** — safe to publish or share. Say *that*, not "protected". |
| "The File System Access API works on mobile." | It works on **Chrome Android 132+**. **iOS and Firefox: UNSUPPORTED.** §2.1. |
| "A passkey protects the wallet." | Passkeys authenticate; PRF *derives*. And on **Safari PRF is `create()`-only with open correctness bugs** (WebKit 311099/314934/284166). §4.1. |
| "OPFS is more durable than IndexedDB." | Same eviction class; MDN states clear-site-data deletes the OPFS. It is faster, not safer. §1.2, §2.3. |
| "We can read the seed back out of the password manager." | `PasswordCredential` is Chrome-only and not read-back; the Android autofill store is not script-readable. §4.2. |
| "Restore from the seed alone." | **NUT-09 needs three things: seed + per-keyset counter + mint URL(s)** — and only `secretsPolicy: 'deterministic'` outputs are recoverable at all. Any backup blob must carry all three, with the counter at a defined height. |
| "Top up via a locked quote and restore later." | **NUT-20 locked quotes are NOT seed-recoverable.** They must be excluded from the auto-top-up loop. |

### 7.3 Two design constraints to carry into the ADR from this spike

1. **Install-to-home-screen is a data-durability control, not a UX nicety.** On iOS it is the difference between "Apple promises not to evict" and "evicted in 7 days". The install prompt must be justified to the user in those terms.
2. **Storage diversity is not a mitigation.** localStorage + IndexedDB + OPFS + cookie all die together on clear-site-data. Redundancy must be **across the origin boundary** (an exported file, an FSA file, a synced passkey) — never within it. Any design review that proposes "belt and braces, store it in three places" has misunderstood this spike.

---

## 8. Scope limits of this spike

- **Not tested on a device.** All version claims are from BCD/caniuse/Chromium-Status as fetched 2026-10-14, plus vendor blogs and bug trackers. **PRF behaviour on real iOS 18/26 hardware and real Chrome Android 132+ hardware is unverified by us** and is the top item to measure before any code — especially given the three open Safari PRF bugs.
- **The secure-context precondition still gates everything.** Service workers, `persist()`, WebAuthn and the picker APIs all require a **secure context**; the portal is plain HTTP on an IP (`PLAN §D3`). Nothing in this spike is reachable until D3 is answered.
- **BCD vs caniuse disagreement on Chrome Android pickers is unresolved by us.** BCD + Google's blog say 132; caniuse says `n`. Verify against a real Chrome Android build before the ADR commits to a version floor.

---

## Sources

- MDN — Clear-Site-Data: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data>
- MDN — Storage quotas and eviction criteria: <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria>
- MDN — Origin private file system: <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system>
- MDN — File System API: <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API>
- MDN — `FileSystemHandle.queryPermission()`: <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission>
- MDN — WebAuthn extensions (`prf`): <https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions>
- MDN — `CredentialsContainer.create()` / `.get()`: <https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/create> · <https://developer.mozilla.org/en-US/docs/Web/API/CredentialsContainer/get>
- MDN — `PasswordCredential`: <https://developer.mozilla.org/en-US/docs/Web/API/PasswordCredential>
- MDN — `Navigator.share`: <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share>
- MDN Browser Compat Data (source of all version numbers): <https://github.com/mdn/browser-compat-data>
- web.dev — Persistent storage: <https://web.dev/articles/persistent-storage>
- Chrome for Developers — File System Access: <https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>
- Chrome for Developers — New in Chrome 132 (FSA on Android/WebView): <https://developer.chrome.com/blog/new-in-chrome-132>
- Chrome Status — File System Access: <https://chromestatus.com/features/6284708426022912> · WebAuthn PRF: <https://chromestatus.com/feature/5138422207348736>
- WebKit blog — ITP 7-day cap, script-writable storage list, home-screen carve-out: <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>
- W3C — WebAuthn PRF extension: <https://w3c.github.io/webauthn/#prf-extension>
- WebKit Bugzilla — 259934 (fixed) · 284166 · 311099 · 314934 (all NEW): <https://bugs.webkit.org/show_bug.cgi?id=259934> · <https://bugs.webkit.org/show_bug.cgi?id=284166> · <https://bugs.webkit.org/show_bug.cgi?id=311099> · <https://bugs.webkit.org/show_bug.cgi?id=314934>
- Mozilla Bugzilla — 1958716 (Android PRF, FIXED): <https://bugzilla.mozilla.org/show_bug.cgi?id=1958716>
- caniuse — File System Access API: <https://caniuse.com/native-filesystem-api> · Web SQL: <https://caniuse.com/sql-storage> · Passkeys: <https://caniuse.com/passkeys> · Web Share: <https://caniuse.com/web-share>
- passkeys.dev — device support matrix (last updated 2026-09-21): <https://passkeys.dev/device-support/>
