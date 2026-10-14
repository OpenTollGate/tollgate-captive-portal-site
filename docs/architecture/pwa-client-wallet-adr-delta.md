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
`docs/pwa-client-wallet-plan.md`), plus the seed-threshold question, and it
records one dependency decision that the prior plan did not anticipate:

| # | Decision | Status |
|---|---|---|
| **D1** | How "roam/rotate without losing significant money" is implemented under R1–R6 | **Answered here (§2).** Rule: no cross-address carry-over; bound the loss with a small granule plus client-held unspent ecash. |
| **D2** | Scope now vs. after the release | **Answered here (§6).** WS-1 and WS-2 in one consolidated portal PR after the release; WS-3 is a separate module PR; WS-4 tracked only. |
| **D3** | The secure-context question | **Answered here (§3).** It is not a spike to run — it is a measured structural constraint with a decided consequence. |
| **D4** | The seed threshold `T` | **Answered here (§5).** `T` is a policy constant; the recommended default and the reasoning are recorded, and `T = 0` is the recommended *starting* configuration. |
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

### 3.4 The three options, and the one this delta recommends

- **(a) Serve the portal over TLS with a certificate the client will accept.**
  This is the only path to a real SW and a real install prompt. It is *not* just
  "copy what the admin board did": the admin's certificate is at
  `/etc/tollgate/ssl/server.{crt,key}` and, for a captive portal, the certificate
  must be accepted by a client that has **not yet been authorised** — i.e. it
  must survive captive-portal detection and the browser's interstitial, which is
  a materially harder problem than the admin board's post-auth TLS. Designing
  that is **out of scope for this delta** and needs its own ADR.
- **(b) Accept an iOS-only / manual-add-to-home-screen PWA.** Costs nothing to
  build; delivers no offline story, no service worker and no Android install
  prompt.
- **(c) A non-HTTP install rail** (e.g. an app-store or side-loaded shell). Out
  of scope; recorded so it is not rediscovered.

**Recommendation: proceed explicitly on (b) for the first release, and record
(a) as its own ADR to be written before any service-worker work.** The
practical consequence for WS-1 is that it must be **scoped as "app-like
presentation + manual add-to-home-screen guidance", not "installable PWA with
offline shell."** The prior plan's Option A (*"Low — add `vite-plugin-pwa` +
manifest icons"*, `docs/pwa-client-wallet-plan.md:52`) is unachievable as
described: without a secure context you get no SW and no install prompt no
matter how many icons you add.

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
- iOS Safari evicts IndexedDB and localStorage for origins unused for ~7 days
  (ITP). A captive-portal session wallet the user only revisits will be silently
  wiped. This is arguably a **bigger practical risk than device theft** `[D:wallet §4.3]`.
- A second device is a separate wallet with zero balance. There is no "sign in".

### 5.4 The decision on `T`

**Recommendation: start at `T = 0` — i.e. exactly-on-demand melt with zero
resting balance — and raise it only if the top-up cadence demands it.**

1. **Prefer exactly-on-demand.** The lowest-risk shape is to mint a quote for
   the invoice amount `+ fee_reserve + input fees`, pay immediately, and keep
   **zero residual balance**. If there is no resting balance there is nothing to
   lose and no seed to surface *at all*; the "wallet" is a transient. cashu.me's
   own melt path is already this shape — `meltGeneric` sizes the swap to
   `quote.amount + quote.fee_reserve` (`src/stores/walletMelt.ts:161`)
   `[D:wallet §4.4]`. **Choosing `T = 0` makes the seed-phrase question mostly
   moot, which is the honest way to satisfy "no nagging": remove the thing being
   nagged about.**
2. **When a resting balance is required, cap it at `T`.** `T` is a **policy
   constant, operator-tunable**. The prior plan's suggestion is *"~1 day of
   typical usage, i.e. tens of sats"*
   (`docs/pwa-client-wallet-plan.md:178`). This delta adopts that reasoning with
   one addition: because the granule is the loss unit under D1 (§2), `T` should
   also be expressed as **a small multiple of the granule**, so the two knobs
   move together. `T = 0` needs no number; `T > 0` should be a granule multiple
   and should be chosen by the operator as *"a number we are happy to absorb per
   lost device"*.
3. **The cap is what makes the seed-phrase-less design safe — not the
   encryption.** Before the first reveal, funds are **unrecoverable by
   construction** (the seed never left the device and was never shown). That is
   acceptable *only* because the balance is capped below `T`. If the business
   cannot accept writing off `T` sats per lost device, the design must be
   exactly-on-demand (`T = 0`) or it must prompt earlier. There is no third
   option; the protocol has no account layer to recover against `[D:wallet §4.4]`.
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

Panel 3 (§7.4) is the threshold-seed moment. It must never appear *before* a
balance exists and never interrupt a payment — those are the two failure modes
that turn a threshold into the nag the requirement forbids.

---

## 6. D2 — scope, sequencing and the workstreams

### 6.1 Workstreams

| WS | Content | Repo | Gate |
|---|---|---|---|
| **WS-1** | App-like shell: manifest reconciliation (`start_url`/`scope`/`id`/maskable icon, §6.3), manual add-to-home-screen guidance, i18n keys. **No service worker** (D3 §3.4: not achievable on HTTP-on-IP). | portal | after release |
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
the plain-HTTP origin and the app degrades predictably, until (a) in §3.4 lands.

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
- Under `T = 0` (the §5.4 recommendation) **this panel is unreachable by
  construction**, because there is never a resting balance. That is the intended
  outcome, and the panel exists for the `T > 0` configuration.

---

## 8. Acceptance mapping

| Requirement | Where satisfied |
|---|---|
| ADR delta vs. `session-ticket-decision.md` R1–R6, covering D1 and loss bounding via granule size + client-held unspent ecash | §2 (esp. §2.2, §2.4) |
| Secure-context section stating exactly which install/offline paths are possible on an HTTP-on-IP portal | §3 (esp. the §3.3 table) |
| Both false premises corrected with evidence | §9 |
| Panels 1–3 mockups delivered | §7 + `docs/mockups/pwa-wallet-*.svg` |
| NUT/dependency decision documented | §4 |
| Every claim cited `file:line` or doc URL | inline throughout; unmeasured items labelled `UNMEASURED` |
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

---

## 11. Open questions this delta does not close

1. Whether the portal can be served over an **accepted** TLS certificate
   pre-authorisation — the only route to a real SW/install prompt (§3.4 (a)).
   Needs its own ADR.
2. The operator's actual value for `T` if `T > 0` is chosen (this delta
   recommends `T = 0`, §5.4).
3. ADR question **E/D** on the module side (per-step invoice vs. metered claim),
   which WS-3 is blocked on.
4. The CSP `connect-src` `http:` vs `https:` lead in §3.5 — unverified in a real
   browser and material to the wallet.
5. Where service-worker updates get versioned relative to the feed's portal pin
   — moot until §11(1) resolves.
