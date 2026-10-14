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
- iOS Safari deletes script-writable storage — WebKit's own list names **IndexedDB** first, then
  LocalStorage, media keys, sessionStorage, and service-worker registrations and cache — for origins
  unused for ~7 days of Safari use (ITP). The cap is published as a **cookie** cap with
  script-writable storage *aligned* to it, and the home-screen carve-out does not name IndexedDB, so
  the install's protective scope is `UNVERIFIED` (§5.6.5). A captive-portal session wallet the user
  only revisits will be silently wiped. This is arguably a **bigger practical risk than device
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
| **iOS ITP 7-day cap** | **At risk in a Safari tab; whether the install protects the IndexedDB bucket is `UNVERIFIED` (§5.6.5).** | survives | n/a on iOS today (PRF `create()`-only) | n/a on iOS | The cap is published by WebKit as a **cookie** cap with script-writable storage *aligned* to it; the home-screen carve-out does not name IndexedDB. **Do not depend on the install for this row** — recoverability is the export, and the loss is capped at `T`. |
| **OS storage-pressure eviction** | survives if `persist()` granted; else evictable *without interrupting the user* | survives | survives | survives | Lowest-risk mode. Request `persist()` early, at a moment of user intent. |
| **Device loss / theft** | gone | **survives — this is the export's purpose** | **survives** — passkey syncs; key re-derives | gone unless the user copied the file off | Recoverable via export or synced passkey. **Not recoverable from device-local storage alone — and this ADR must not pretend otherwise.** |
| **Browser change / reset** | gone | survives | platform-dependent; a new passkey = **new PRF = old ciphertext unreadable** | survives if re-granted | The export is the only browser-independent rail. |
| **Private browsing / one-shot captive-portal context** | lost at session end | survives only if the export was completed in that session | n/a | survives (written to the user's FS) | **Assume this happens.** Never create funds-bearing state the user has not exported without disclosing it. |

#### 5.6.4 Install-to-home-screen is RECOMMENDED and materially better — but it is NOT the proof store's durability guarantee

> **CORRECTED 2026-10-14 — this subsection previously overstated the claim.** It said the install
> means *"Apple has stated it will not evict this app's data"* and that the evicted class is
> *"script-writable storage — explicitly including IndexedDB."* Both of those are **stronger than the
> published sources support.** The correction, the pinned evidence, and the exact wording that may
> and may not be used are recorded in **§5.6.5**; §5.6.3's table row and the two cross-references at
> §6.6.5/§6.6.6 have been re-scoped to match. **Read §5.6.5 before quoting this subsection.**

What the install provably buys the wallet, and it is worth having:

- a **stable app identity** and standalone launch (§3.3; the manifest `id` defect is §6.3);
- an **install-gated** capability set — Periodic Background Sync is `CONTENT_SETTING_BLOCK` without
  it, and on iOS there is **no service worker at all** without it ([SB §3.2]);
- a **longer-lived service-worker registration**, which is what makes L1 (§6.6.4) reachable at all
  rather than moot.

What it must **not** be claimed to buy: **protection of the wallet's IndexedDB proof store.** The
seven-day cap is, in WebKit's own framing, a **cookie** cap — *"ITP deletes all cookies created in
JavaScript and all other script-writeable storage after 7 days of no user interaction with the
website"* (`https://webkit.org/tracking-prevention/`, fetched 2026-10-14) — and the home-screen
carve-out is one sentence of **expectation** about *"the first-party in such a web application"*
whose *"website data"* it says it does not expect to see deleted, **not** a named guarantee about
IndexedDB (`https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/`, 2020-03-24).
The precise scope of the carve-out is therefore **`UNVERIFIED`** (§5.6.5), and it is **not** what the
wallet's durability rests on.

**The durability story that does not depend on the install is the one in §5.6.1–§5.6.3:** keep the
device-local balance below `T`, offer the one-tap encrypted export once balance ≥ `T`, and accept
that before the reveal the wallet is a **petty-cash purse** whose loss is capped and disclosed. The
install remains **recommended** and remains a first-order *capability* requirement — it is the
*gate* for background work and for a real service worker — but the ecash's survival is a function of
the **export** and the **cap**, not of the install.

#### 5.6.5 The iOS 7-day eviction claim — precise scope, pinned evidence, and the wording that is permitted

This subsection exists because the riskiest sentence in this document is the one about iOS storage
eviction. It is the kind of claim that is *remembered* more strongly than it was ever *published*,
so the evidence is quoted here verbatim and the permitted wording is pinned to it. **No other part
of this ADR may state a stronger version than what follows.**

**(a) What WebKit actually published, quoted.**
`https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/` (2020-03-24), section
*"7-Day Cap on All Script-Writeable Storage"*, says: *"we announced that ITP would cap the expiry of
client-side cookies to seven days… Now ITP has aligned the remaining script-writable storage forms
with the existing client-side cookie restriction, deleting all of a website's script-writable
storage after seven days of Safari use without user interaction on the site."* The affected list it
gives is **Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and
cache**, and the same post's home-screen paragraph reads: *"Web applications added to the home
screen are not part of Safari and thus have their own counter of days of use… We do not expect the
first-party in such a web application to have its website data deleted."*

**(b) Which of those two quotations is load-bearing for a bearer-value wallet.** The *home-screen*
sentence, and it is weaker than it reads. It is (i) a sentence of **expectation** (*"we do not
expect"*), (ii) about a **generic** unit — *"the first-party"*, *"its website data"* — and (iii) in a
post whose **declared subject is cookies**. So it supports the statement *"Apple states it does not
expect an installed home-screen web app's website data to be evicted on the Safari counter"* and
**nothing stronger**; it does **not** name IndexedDB, and it does **not** say "IndexedDB survives on
the install". **Whether the carve-out as implemented today covers the IndexedDB bucket is
therefore `UNVERIFIED`** and is recorded as an open field-check (§11(10)).

**(c) The correction to the widespread "script-writable storage cap ⇒ IndexedDB is capped" reading.**
Two independent observations weaken it, and both are primary:

- **WebKit's own *normative* documentation is narrower than the blog post's headline.** The
  WebKit Tracking Prevention policy page — *"7-Day Cap on All Script-Writeable Storage"* under
  **Cookies** — says *"ITP deletes all cookies created in JavaScript and all other script-writeable
  storage after 7 days of no user interaction with the website"*
  (`https://webkit.org/tracking-prevention/`, fetched 2026-10-14). The heading is on the **cookie**
  family, and the enumerated *"latter storage forms"* are the ones the blog post already listed.
  There is no independent statement anywhere in the policy that gives **IndexedDB** a seven-day
  lifetime of its own.
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

**So the correction is this: the 7-day cap is a COOKIE cap, with script-writable storage *aligned to*
it (localStorage being the documented implementation side-effect — WebKit's own justification is
that third-party scripts *"moved to other means of first-party storage such as LocalStorage"*).** It
is **not** a published, IndexedDB-specific eviction guarantee, and any sentence that treats
"In 7 days iOS deletes the wallet's IndexedDB" — **or** its converse, "the install guarantees the
wallet's IndexedDB survives" — as *settled* is **unverified and must not be stated as fact**.
**`UNVERIFIED` is the label for both directions.** This is not a licence to weaken the design: the
mitigations in §5.6.1–§5.6.3 never depended on either direction, because they bound the loss at `T`
and rely on the **export** for durability.

**(d) The permitted wording.** Use exactly this:

> On iOS, adding the portal to the Home Screen is **recommended** and is a **capability**
> requirement — it is what makes a service-worker registration and any background wake possible at
> all ([SB §3.2]). Apple's published statement is that it does *not expect* an installed
> home-screen web app's *"website data"* to be deleted on Safari's seven-day non-use counter
> (`https://webkit.org/blog/10218/`, 2020-03-24). That statement does **not** name IndexedDB, so
> whether it protects the wallet's proof store is **`UNVERIFIED`** (§5.6.5(b)). The wallet's
> durability therefore rests on the **balance cap `T`** and the **one-tap encrypted export**, not on
> the install — and the seven-day cap remains a real risk to **cookie-backed** state either way.

**(e) `VERIFIED` vs `UNVERIFIED`, so a reader can tell them apart.**

| Statement | Status |
|---|---|
| WebKit deletes index-closed script-writable storage after 7 days of Safari use without interaction | **VERIFIED** — named in the post and the policy page, IndexedDB first in the list |
| The cap is described by WebKit in cookie terms, with script-writable storage *aligned* to it | **VERIFIED** — policy page heading + quoted justification |
| Firefox/MDN classify IndexedDB as *storage*, not *cookies* | **VERIFIED** — MDN Storage Access Policy, per-API block enumeration |
| Home-screen web apps are on their own day-counter | **VERIFIED** — same post, quoted above |
| **The carve-out protects the wallet's IndexedDB bucket in practice** | **`UNVERIFIED`** — not named; a field check (§11(10)); do not assert it in either direction |
| **Install-to-home-screen is required because otherwise the ecash is deleted in 7 days** | **`UNVERIFIED` as stated** — the correct statement is that the install is a *capability* requirement (§5.6.4) and the export is the durability rail |

The WebKit source *files* were also checked, so the reader knows the limit of the check: the
`monitoredDataTypes()` set that ITP acts on — read from
`https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/NetworkProcess/Classifier/WebResourceLoadStatisticsStore.cpp`
— is `Cookies, DOMCache, IndexedDBDatabases, LocalStorage, MediaKeys, SearchFieldRecentSearches,
SessionStorage, ServiceWorkerRegistrations, FileSystem, ScreenTime, EnhancedSecurityRecord`, i.e. the
post's list is confirmed in code; but the *algorithm that selects which of them to delete for a given
origin* lives in the classifier's own task buckets, which is where the home-screen carve-out would be
implemented and which this ADR did **not** audit. **Stated so the claim's boundary is visible: the
list is verified, the carve-out's per-type behaviour is not.**

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
| "Add to Home Screen on iOS and your money is safe — the install exempts the wallet from the 7-day deletion." | **The scope of the carve-out is `UNVERIFIED` (§5.6.5).** WebKit's carve-out is about *"website data"* generically and does not name IndexedDB; the 7-day cap is published as a **cookie** cap with script-writable storage aligned to it. The install is a *capability* requirement; durability is the `T` cap plus the export. |
| "In 7 days iOS deletes the wallet's IndexedDB." | **Also `UNVERIFIED` as a flat statement** (§5.6.5(c)). It is the `UNVERIFIED` converse of the row above, and the same rule applies: label it, do not assert it. |

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
example).

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
reachable before §3.4's transport finding is resolved.

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

**A cross-cutting precondition for rows 1–5:** every one of them is **unreachable until §3.4's
transport finding lands**. Push needs a **secure-context, installable origin**; a native app needs
the same portal to authenticate against; a TWA needs an installable web app to wrap
[SB §0][SB 26][SB 27][SB 28]. **Transport is step zero for all six rows — including the one we are
shipping.**

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
   justify this by the iOS ITP carve-out** — that carve-out does not name IndexedDB and
   its scope is `UNVERIFIED` (§5.6.5). Durability here comes from the journal being
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
  background wake — and is RECOMMENDED for identity and registration lifetime, but it is NOT
  promised as proof-store data durability.** Apple's published carve-out is about *"website data"*
  generically and does not name IndexedDB; its scope is `UNVERIFIED` (§5.6.5). The wallet's
  durability promise is the `T` cap plus the one-tap encrypted export (§5.6.4).
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
   Apple's published carve-out is a sentence of *expectation* about *"the first-party"*'s *"website
   data"* and **does not name IndexedDB**; the 7-day cap is published by WebKit as a **cookie** cap
   with script-writable storage *aligned* to it §5.6.5(a)–(c). The install is a **capability**
   requirement (§5.6.4); durability is the `T` cap plus the export.
10. ❌ **"In 7 days iOS deletes the wallet's IndexedDB."** The `UNVERIFIED` converse of item 9, and
    equally not permitted as a flat statement §5.6.5(c). **Label it, do not assert it in either
    direction.**
11. ❌ **"Background sync registration is free and always available."** Registration *"may only be
    made while the main app is open"*, i.e. the platform grants durability of the attempt, **not**
    freedom to schedule it [SB §2.4][SB 29] — and Periodic Background Sync is
    `CONTENT_SETTING_BLOCK` without an installed PWA and never prompts [SB §2.3][SB 16].

#### 6.6.8 OPEN BLOCKING QUESTION — a MODULE policy question, before implementation

**Can an UNAUTHENTICATED client reach the Cashu mint through the walled garden?**

The payment leg (client → mint) is an internet service; the venue leg
(client → router → WAN) is what the granule buys and what is *gone* when
entitlement lapses. The deadlock is that the payment leg normally **rides through**
the venue leg — if the client has no entitlement it typically has no path to the
mint, so it cannot pay.

**TollGate already half-answers this:** the module advertises `kind:21023
no-reachable-mints` when there is no uplink, i.e. **mint reachability is already
treated as a payment precondition.** What is **`UNMEASURED`** is whether the portal's
nodogsplash pre-auth allow-list currently permits mint traffic through the walled
garden.

The consequence is a fork in the entire scheduler design:

- **If mint traffic IS pre-auth reachable** → a background top-up is **RESTORATIVE**:
  it can recover after the entitlement has already lapsed.
- **If it is NOT** → every background top-up must fire **while entitlement is STILL
  LIVE**, i.e. it can only ever **PRE-EMPT** a lapse, which changes the scheduler's job
  entirely (the scheduler must know the runway and act before exhaustion, not after
  failure).

**This needs a module-owner answer BEFORE any implementation card**, and whichever way
it resolves, the ADR must state it as an explicit assumption, because the design's
honesty depends on it. It is tracked as open question §11(6).

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
- **Resolve the item that is currently `UNVERIFIED` and load-bearing in two places: does the iOS
  Home Screen install actually protect the wallet's IndexedDB bucket from the 7-day cap?** The
  published carve-out is about *"website data"* generically and does not name IndexedDB (§5.6.5(b)),
  so it is recorded as an **open question §11(10)** rather than settled. Field check: install the
  web app, leave it unopened for >7 days of Safari use, and read the IndexedDB bucket back. Until
  that is done, no claim in either direction may appear in user-facing text.
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
- **Not deferred:** §6.6.8's module policy question is an **open blocking question**,
  not a nice-to-have — it is answered before implementation, and it is recorded as
  such in §11(6).
- **Sequencing unchanged:** the red baseline is fixed first (§6.2), the transport
  question resolves before any background-autonomy work (§3.4 / §6.6.1), and L0
  ships and is proven crash-safe before L1 or L2 are attempted (§6.6.4).
- **`if`/`elif`, stated precisely so a future loop cannot over-build:** **`if`** the origin becomes
  secure-context and installable (§3.4) **`then`** L0+L1 ship; **`elif`** the origin does not
  **`then`** L0 alone is the entire product, and the "until §3.4 resolves" caveats come out of the
  user-facing copy (§6.6.7 item 8) but nothing else changes; **L2 stays out either way until the
  operator says otherwise.** §6.6.4.1 is an inventory, **not a backlog** — it exists so the option
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
| Background-autonomy requirement documented with the honest per-platform limits, the three-layer ship decision (L0 mandatory / L1 mandatory best-effort / L2 optional-removable), the promises, the prohibitions, and the open blocking module question | §6.6 |
| Background-execution **limits + documented workarounds** recorded as a decision-ready inventory (L2 included) with cost and sovereignty per option, explicitly marked NOT-to-build-now so a future loop need not re-derive it | §6.6.4.1 |
| Every prohibition carries the citation that **falsifies** it, not just an assertion that it is false | §6.6.7 items 1–11 |
| iOS install-durability claim scope-corrected: install = **capability** requirement, durability = the `T` cap + the export; carve-out scope labelled **UNVERIFIED** | §5.6.4, §5.6.5, §6.6.6 |
| Operator's scope framing recorded (ADR consolidated to the default branch as part of this PR) | §6.7, §6.6.8 |
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
  guarantee), the new §5.6.5 (the eviction-scope audit) was **added** to pin the published wording, label the carve-out's scope
  `UNVERIFIED`, and prescribe the permitted sentence, and the strong version of the claim was
  softened to match the evidence in **five more places** — §5.3's bullet, §5.6.3's table row,
  the pre-existing prohibition subsection (renumbered §5.6.6 from §5.6.5), §6.6.5 item 6, and §6.6.6. **No claim was deleted and none was
  strengthened**; the two directions that could not be verified from a primary source (the install
  guarantees IndexedDB survival / iOS deletes IndexedDB in 7 days) are both labelled `UNVERIFIED`
  rather than asserted or silently dropped.

---

## 11. Open questions this delta does not close

1. Whether the portal can be served over an **accepted** TLS certificate
   pre-authorisation — the only route to a real SW/install prompt (§3.4 (a)).
   Needs its own ADR.
2. The operator's concrete value for `T` **below the cap the reverse decision
   requires** — see the dedicated item §11(7); the earlier "this delta recommends
   `T = 0`" reading is superseded by §5.4.
3. ADR question **E/D** on the module side (per-step invoice vs. metered claim),
   which WS-3 is blocked on.
4. The CSP `connect-src` `http:` vs `https:` lead in §3.5 — unverified in a real
   browser and material to the wallet.
5. Where service-worker updates get versioned relative to the feed's portal pin
   — moot until §11(1) resolves.
6. **BLOCKING, module-owner answer required BEFORE implementation (§6.6.8): can an
   UNAUTHENTICATED client reach the Cashu mint through the walled garden?** If yes, a
   background top-up is **restorative** (can recover after a lapse); if no, every
   background top-up must fire while entitlement is **still live**, i.e. it can only
   ever **pre-empt** a lapse — which changes the scheduler's job entirely. Note the
   partial evidence: the module already advertises `kind:21023 no-reachable-mints`
   when there is no uplink, so mint reachability is already a payment precondition.
   What is `UNMEASURED` is the portal's nodogsplash **pre-auth allow-list** content.
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
10. **`UNVERIFIED` and load-bearing in two places — does the iOS Home Screen install actually
    protect the wallet's IndexedDB bucket from the 7-day cap?** WebKit's published carve-out is
    about *"website data"* generically and does not name IndexedDB, and the 7-day cap is published
    as a **cookie** cap with script-writable storage aligned to it (§5.6.5(b)–(c)). This is the
    document's own highest-priority field check: it is the difference between the install being a
    *capability* requirement (what we claim) and a *data-durability* requirement (what we do not).
    Until it is resolved, **both** the strong claim and its flat converse are `UNVERIFIED` and
    neither may reach user-facing text.
