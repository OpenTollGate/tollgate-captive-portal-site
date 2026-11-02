# Dossier: captive-portal stack decision — React+cashu-ts vs React+coco vs Vue/Quasar port

**Date:** 2026-10-14
**Question:** the TollGate captive portal is a React 18 + Vite 7 SPA that must become an
installable PWA carrying a client-side Cashu ecash wallet that auto-pays Lightning
invoices. Q1: should we port it to Vue/Quasar to reuse cashu.me? Q2: should we adopt
`cashubtc/coco` instead of the cashu.me wallet stack?
**Verdict up front:** **stay React + `@cashu/cashu-ts` and hand-roll a ~300–500 LOC
wallet layer. Do not port. Do not adopt coco at this phase.**

Repos inspected (all under `~/repos/`, real source read, no inference from memory):

| Repo | Tip SHA | Tip date |
|---|---|---|
| `OpenTollGate/tollgate-captive-portal-site` | `c2ddba1218a653c0ef09d7857495e580d8865aff` | 2026-10-13 |
| `cashubtc/cashu.me` | `e21f5fab875b67de0fc5367a79710054d2c1f80f` | 2026-09-28 |
| `cashubtc/coco` | `03d5896caf39625aa70d57d1a5ad404a66bf7e16` | 2026-10-09 |
| `cashubtc/cashu-ts` (reference) | `145d2426d5071f2c321a6ec1171a5ce1c1ea0466` (5.0.0-rc.11) | 2026-10-13 |

A framing correction first, because it changes what Q2 is even asking. **`wallet.cashu.me`
is not a library and cannot be the wallet engine.** cashu.me is a standalone MIT PWA with
its own origin, routing, Dexie schema, 14 locales and 91 views (`src/`, 30,448 code LOC /
113 files, measured with pygount). You can link *out* to it from a captive portal, and you
can copy *source patterns* out of it (it is MIT, `LICENSE.md`), but you cannot embed it.
So the real three-way is: **plain cashu-ts** vs **coco** vs **cashu.me's source patterns
transplanted into our framework**. That last one turns out to be worth about 300 lines —
which is why the port in Q1 does not pay for itself.

---

## 1. The current portal's real size and shape

Measured with `pygount` (code lines, comments/blanks excluded) at
`c2ddba12` (see `~/reports/pwa-cashu/measure.py`, kept in-tree):

| Path | code LOC | files | breakdown |
|---|---|---|---|
| `src/` | **2,860** | 35 | JSX 1,314 / SCSS 714 / JS 588 / JS 244 |
| `admin/` | **2,506** | 27 | TS 858 / JS 507 / CSS 1,082 / JSON 42 / HTML 17 |
| `tests/` | **1,706** | 23 | JS 748 / JS 570 / JSX 341 / Bash 47 |
| `packaging/` | **1,643** | 8 | all Bash (POSIX sh guards) |
| `public/` | 243 | 3 | manifest + 404.html |
| `scripts/` | 110 | 2 | build-all.mjs, brand-id.mjs |
| `docs/` | 1 file | 1 | `pwa-client-wallet-plan.md` (116 lines) |

`src/` by file (`wc -l`, raw lines incl. comments/blanks — total 3,432):

```
471  src/App.jsx              435  src/components/Cashu.jsx     430  src/helpers/cashu.js
314  src/helpers/tollgate.js  289  src/components/Lightning.jsx 270  src/helpers/qr-code.js
173  src/components/BalancePage.jsx   139  src/BalancePage.jsx   130  src/components/Background.jsx
120  src/helpers/lightning.js 115  src/helpers/mint-fee.js       88  src/helpers/clipboard.js
 78  src/helpers/balance.js    67  src/components/ErrorBoundary.jsx   53  Icon.jsx
 46  Status.jsx  44  helpers/i18n.js  41  DeviceInfo.jsx  39  LanguageSwitcher.jsx  21  index.jsx
```

**14 production JSX modules** in `src/` (10 of them in `components/`) plus one JSX test.
Current framework: React **18.2**, `@vitejs/plugin-react` 4.6, Vite **7**, vitest 3.2,
`@testing-library/react` 16.3, sass 1.89 (`package.json:32-34,41-46`). i18next +
react-i18next; `supportedLanguages = ["en"]` today (`src/helpers/i18n.js:8`).

**Build config:** `vite.config.js` is 59 lines — the react plugin plus a hand-written
`generateAssetManifestPlugin` that walks `build/` and emits `asset-manifest.json`
(`vite.config.js:6-45`), with **two HTML entries** (`index.html` → portal, `balance.html`),
`outDir: "build"` (`vite.config.js:50-58`). `vitest.config.js` is 13 lines (jsdom, globals,
`src/test/setup.js`, includes `src/**/*.test.*` and `tests/unit/**`). `playwright.config.js`
is 53 lines: **two projects** (Desktop Chrome + Pixel 7, deliberately chromium-backed —
see its own comment at lines 28-31), `fullyParallel: false, workers: 1`, a self-declared
`webServer`, and `toHaveScreenshot` tolerances of 2% pixel ratio / 0.2 threshold.

**Tests:** 18 unit-test files under `tests/unit/` + 2 co-located under `src/`, 5 Playwright
specs under `tests/e2e/`, 2 committed visual baselines
(`tests/e2e/visual.spec.mjs-snapshots/*.png`), and a Playwright `admin/` suite. Counted
`it(`/`test(` call sites: ~144 in vitest files, 13 in the e2e specs. The e2e suite has a
mock backend that **stubs `@cashu/cashu-ts` itself**
(`tests/e2e/helpers/mock-backend.mjs:3`).

**`admin/` is _not_ React — it is Preact 10** (`admin/src/main.tsx:1-2`
`import { render } from 'preact'`, 11 route/component files importing `preact/hooks`),
built by a second Vite config (`admin/vite.config.mjs`) with its own browserslist/devDeps
(`package.json:7,10,38`). `npm run build` (`scripts/build-all.mjs`) builds **both** apps in
one pass and warns that one build ships exactly one brand skin.

**Git shape:** 121 commits; `shortlog -sn`: Felix 30, Amperstrand 25, Lone 23,
c03rad0r 23, origami74 8, amperstand 5, Arjen 3, 3 + 2 drive-by. The tip commit is a
real bug-fix merge (#72), i.e. the tree is under active maintenance by four-plus people.

**What a Vue/Quasar port would actually have to touch:** `src/` 2,860 + `admin/`
2,506 (Preact→Vue, a second rewrite) + `tests/` 1,706 across 23 files + 18 unit files'
worth of `@testing-library/react` idioms + 2 committed PNG visual baselines + the
`asset-manifest.json` contract + the `index.html`→`splash.html` rename hook
(`package.json:18`). Call it **~7,000 LOC of first-party code and tests**, plus a second
framework in the repo (or an admin rewrite too).

---

## 2. What porting would actually buy us — the honest reuse delta

Going Vue/Quasar does **not** import cashu.me as a library. It makes cashu.me's *patterns*
copy-pasteable. So the question is: how many lines of cashu.me are (a) on our money path
and (b) framework-neutral enough to copy verbatim?

The money path in cashu.me is three files:

| File | lines |
|---|---|
| `src/stores/wallet.ts` | 1,776 |
| `src/stores/walletMelt.ts` | 447 |
| `src/stores/walletBolt11.ts` | 455 |
| **total** | **2,678** |

I measured framework coupling by counting lines that reference `this.`, a `use*Store()`,
or `notify`: **136 of 2,461 non-comment lines = 6%** across those three files
(`walletMelt.ts` 61/447 = 14%, `walletBolt11.ts` 76/455 = 17%). So in principle ~94% of
that code is not Vue/Pinia-specific. **That is the trap.** The 94% is not "reusable
wallet code" — it is either (i) generic `@cashu/cashu-ts` call sequencing that copies into
any framework *with or without a port*, or (ii) cashu.me's own app apparatus that we do
not need and would not want:

- `src/stores/wallet.ts` carries mint management, keyset caching, on-chain (NUT-30)
  flows, BIP-39 seed handling, a WebSocket lane, restore, and a **hand-rolled counter
  persistence layer** — `useLocalStorage("cashu.keysetCounters")` at `wallet.ts:227-235`,
  `getOrCreateCounterSource()` at `:384`, `increaseKeysetCounter()` at `:404`,
  `wallet.on.countersReserved(...)` at `:426`. That last one is important: **cashu.me does
  not solve deterministic counter persistence with a library either; it keeps counters in
  `localStorage` by hand.** So "reuse cashu.me" buys us a weaker
  localStorage-based counter store, not a solved problem.
- The rest (`transactionWorker.ts` 1,537, `npubcash.ts` 775, `mints.ts` 692, `nostr.ts`
  578, `nwc.ts` 551, `paymentHistory.ts` 538, `mintRecommendations.ts` 580,
  `nostrMintBackup.ts` 426, `nostrUser.ts` 406, `payment-request.ts` 347,
  `walletOnchain.ts` 404 … — 35 store files, 12,849 lines total, 28 of them
  `defineStore`) is a *full standalone wallet product*.
- 91 `.vue` files; **81 of them use `<q-*` Quasar components**, 43 distinct Quasar tags.
  All of that is throwaway for us.
- `src-pwa/` (custom-service-worker.js, manifest.json, register-service-worker.js) is
  **Quasar-mode scaffolding** driven by `quasar.config.js:168-183` (`workboxMode:
  "generateSW"`, `injectPwaMetaTags`) — useful reading, not portable code.

**The genuinely instructive part** — the melt sequence — is `meltGeneric()`
(`walletMelt.ts:148` onward): split proofs to `quote.amount + quote.fee_reserve` via
`this.send(...)`, mark them reserved, `retryOnceOnRecoverableError(keysetId, () =>
mintWallet.prepareMelt(method, quote, sendProofs))`, then complete. Around it:
`meltQuoteBolt11()` (`walletBolt11.ts:221`, wraps `wallet.createMeltQuoteBolt11(request)`),
`meltInvoiceDataBolt11()` (`:239`), `checkOutgoingInvoiceBolt11()` (`:352`),
`mintOnPaidBolt11()` (`:365`).

**That is ~300 lines of pattern, and it is framework-neutral.** It transplants into React
in an afternoon by reading the two files — with no port, no second framework, no rewrite
of 2,860 LOC of working portal and 1,706 LOC of passing tests.

**Reuse delta of the port, quantified: ~300 lines of readable pattern against ~7,000 LOC
of first-party rewrite, plus a second framework in the repo, plus the `admin/` question.**
That is a ~1:23 ratio against us. This is the whole answer to Q1.

---

## 3. What porting costs — every cost I can find in the repo

1. **The guest SPA.** 2,860 code LOC / 35 files, of which 1,314 JSX + 714 SCSS. Rewrite.
   The SCSS is layout for a specific React component tree and does not survive either.
2. **The admin board.** 2,506 code LOC / 27 files, **Preact 10, not React**
   (`admin/src/main.tsx:1`). Porting the portal to Vue leaves the repo with three
   frameworks, or forces a second rewrite. It also has its own Playwright suite
   (`admin/tests/*.spec.mjs`, 5 specs) and its own build config.
3. **The test suite.** 1,706 LOC / 23 files; 18 unit files using
   `@testing-library/react`; 5 Playwright specs; **2 committed PNG baselines**
   (`tests/e2e/visual.spec.mjs-snapshots/`) that a re-render invalidates; and
   `tests/e2e/helpers/mock-backend.mjs` which stubs `@cashu/cashu-ts` by module name.
   All of it must be re-derived, not just re-typed — the tests encode real bugs
   (the `CU102` keyset-mapping saga documented at `src/helpers/cashu.js:112-125`,
   `:193-228`; the race test `src/components/__tests__/Cashu.race.test.jsx`).
4. **The feed's pinned reproducible bundle — this is the sharpest cost.**
   `tmbg-830/packaging/build-inputs.json:35-38` pins the portal at
   `6c25834c835cb9981bcd0fcbd9ecded464478a19`. `packaging/portal-build.sh:63-72`
   **hard-fails on any floating `PORTAL_REF`**, and mandates an **exact** node
   `v22.17.0` / npm `10.9.2` (`:74-79`, from `build-inputs.json:17-27`), with
   `SOURCE_DATE_EPOCH` normalization (`:166`, `normalize_mtime`). The script requires the
   pinned tree to produce **exactly five build products** and refuses a partial bundle
   (`portal-build.sh:108-128`):
   1. `build/*` → guest SPA → `/etc/tollgate/tollgate-captive-portal-site`
   2. `build/admin/index.html` → `packaging/files/tollgate-admin/` → `/www/<brand>`
   3. `openwrt/rpcd/tollgate` (rpcd plugin, installed `0755`)
   4. `openwrt/rpcd/tollgate_acl.json`
   5. `packaging/files/etc/uci-defaults/92-tollgate-admin-setup` with `__ADMIN_HOME__`
      substituted by `sed` (`:157-163`, with an explicit failure check)
   A Vue rewrite changes every one of those outputs and the reproducibility contract,
   for a **router-firmware** artifact where a stale bundle has already shipped once
   ("a stale copy once shipped the pre10 admin board", `portal-build.sh:23`).
   The pin is currently 11 commits behind main, so the release line is already lagging.
5. **Bundle/byte budget on a router.** `npm run build` output is ~1,016 KiB total, main
   chunk `build/assets/index-*.js` = **361,923 bytes** (`~/repos/tollgate-portal-work/build`).
   This is served from OpenWrt flash over a captive pre-auth network. Any port resets the
   tuning that produced that number.
6. **Team velocity and known-bug surface.** Four-plus active contributors, 121 commits,
   tip is a bug-fix merge from *yesterday* relative to the SHA. The `cashu.js` helpers
   encode hard-won decode precedence for real-world tokens (coinos/minibits v4 `cashuB`
   with v2 short keyset ids) — rewriting means rediscovering that.
7. **i18n / branding / packaging coupling.** i18n via react-i18next + an HTTP backend
   (`src/helpers/i18n.js`), a brand-descriptor system shared between the Preact admin and
   the build script (`scripts/build-all.mjs`, `scripts/brand-id.mjs`), and 1,643 LOC of
   POSIX-sh packaging guards gated in CI (`packaging/tests/`, wired in
   `.github/workflows/ci.yml:38-96`) that assert the shipped SPA's behaviour.

**Zero of these costs are paid back by §2's ~300 lines.**

---

## 4. coco — what it actually is

**It is a wallet engine/library, not an app.** `README.md`: "A modular, TypeScript-first
toolkit for building Cashu wallets and applications… a storage-agnostic core that handles
**proof management, mint synchronization, quote lifecycle, counter tracking, and state
updates through a typed event bus**." Monorepo, 10 packages:

| Package | version | depends on | prod code | unpacked |
|---|---|---|---|---|
| `@cashu/coco-core` | 2.0.0 | **`@cashu/cashu-ts: 5.0.0-rc.4`** (exact), `@noble/curves ^2.0.1`, `@noble/hashes ^2.0.1`, `@scure/bip32 ^2.0.1` | 21,262 / 186 files | 819,878 B |
| `@cashu/coco-indexeddb` | 2.0.0 | `dexie ^4.0.8` | 4,356 / 32 files | 133,213 B |
| `@cashu/coco-react` | 2.0.0 | peer `react: ^19` | 1,515 / 31 files | 48,917 B |
| `@cashu/coco-sqlite` | 2.0.0 | `better-sqlite3` | 243 / 10 files | — |
| `@cashu/coco-adapter-tests`, `-sqlite-bun`, `-expo-sqlite`, `packages/cocod` (private CLI), `packages/docs` | | | core tests: 28,348 / 97 files | |

**Architecture** (`packages/core/Manager.ts:279-...`, 1,214 lines): a `Manager` facade
exposing `mint`, `wallet`, `keyring`, `history`, `auth`, `ops`, `quotes`,
`paymentRequests` and `ext` (plugin extensions), plus `.on()/.once()` over a typed event
bus. Behind it: `MintService` 671, `ProofService` 926, `CounterService`, `SeedService`,
`TokenService`, `QuoteLifecycle` **1,615**, `MeltOperationService` 823,
`MeltTransitions` 768, `MintOperationService` 1,022, `SendOperationService` 1,240,
`ReceiveOperationService` 851, `WalletRestoreService`, and optional watchers
(`MeltQuoteWatcherService` 599, `ProofStateWatcherService`, `MintOperationWatcher`).

**Does it own the four things we'd otherwise hand-roll? Yes — that is exactly its value
proposition:**

| Concern | coco owns it? | Evidence |
|---|---|---|
| Deterministic counter persistence | **Yes** | `CounterService` + `coco_cashu_counters` table keyed `&[mintUrl+keysetId]` (`packages/indexeddb/src/lib/schema.ts:44`, `CounterRepository.ts`); `manager.on('counter:updated', …)` (`packages/core/README.md` quick-start) |
| Quote lifecycle | **Yes** | `manager.quotes.mint.create/get/refresh`, `manager.quotes.melt.create/get/listPending/refresh`, `QuoteLifecycle.ts` (1,615) |
| Mint management | **Yes** | `manager.mint.addMint(...)`, `MintService` |
| Proof storage + reservation | **Yes** | `ProofService`, `spendable` vs `reserved` balances (`manager.wallet.balances.byMint()`) |
| Melt resume / crash recovery | **Yes, as a saga** | `ops.melt` states `init → prepared → executing → pending → finalized` (+ `rolling_back → rolled_back`), `ops.melt.recovery.run()`, `refresh()`, `reclaim()`, `cancel()`, `diagnostics.isLocked()`; `MeltQuoteWatcherService` + `MeltSettlementProcessor` (`packages/docs/pages/melt-operations.md`) |
| Restore (NUT-09) | **Yes** | `WalletRestoreService`, `WalletApi.restore`/`sweep` with `units` filter |
| Browser/IndexedDB adapter | **Yes** | `@cashu/coco-indexeddb`, `new IndexedDbRepositories({ name })`, default DB `coco_cashu`, `await repositories.init()` |
| React hooks | Yes, but **React 19 only** | `@cashu/coco-react` peer `react: ^19`; portal is React 18.2 |

**Licence:** **MIT** — `LICENSE` is 21 lines, "MIT License / Copyright (c) 2025 Cashu".
MIT is compatible with the portal's GPL-3.0 (one-way compatible: MIT code may be
incorporated into a GPL-3.0 work). No licence blocker.

**Stability — this is where it gets uncomfortable:**

- Published versions: 13 total. `1.0.0-rc.0` **2026-03-31** → `1.0.0` 2026-05-05 →
  `1.0.1` 2026-05-19 → `2.0.0-rc.0` 2026-07-02 → **`2.0.0` 2026-08-17**. That is
  **six RCs in the 1.0 line and four in the 2.0 line (10 RCs in ~5 months), and a
  major version bump 4½ months after first publish.**
- Latest stable (`2.0.0`) is **~2 months old** at dossier date; the repo is very active
  (271 commits in the last 90 days) with a tip 4 days before the portal's.
- **`@cashu/coco-core@2.0.0` pins `@cashu/cashu-ts` to an exact release candidate,
  `5.0.0-rc.4`.** The portal is on `@cashu/cashu-ts` **2.9.0** (`package.json:21`,
  installed and confirmed `2.9.0`, MIT) — the stable line. Adopting coco therefore means
  either a **2.9.0 → 5.0.0-rc.4 jump with documented breakages** or two copies of
  cashu-ts in the tree. The documented breakages are relevant to code we already have:
  - `getDecodedToken(tokenString, keysetIds: readonly string[])` — the second argument
    becomes **required** and must be an *array of id strings*; passing anything else
    **throws** `CTSError` (`cashu-ts src/utils/core.ts:470-479`;
    `migration-4.0.0.md:610-625` says "TS error in v4 — second arg required"). Our
    `src/helpers/cashu.js:215` and `src/helpers/mint-fee.js:34` call it with a
    `MintKeyset[]` *or nothing*. In 2.9.0 the signature is
    `getDecodedToken(tokenString: string, keysets?: MintKeyset[])` (confirmed in the
    installed `lib/types/utils.d.ts:94`). This is a genuine migration on the exact
    function our token-validation path is built around.
  - `CounterSource` gains a **required** `reserveAt(keysetId, start, count)` that must be
    atomic in one transaction (`migration-5.0.0.md:404-437`), and
    `OperationCounters.keysetId` is renamed `counterKey` (`:441-455`).
  - Amount model moves to bigint-backed `Amount`; `checkProofsStates` requires `id` on
    every proof (`:459-463`).
- `@cashu/coco-react` peer `react: ^19` vs the portal's React 18.2 — so either a React
  18→19 upgrade (its own risk surface across 14 modules and 18 test files) or driving
  `Manager` imperatively and forgoing the hooks.
- **Storage security:** coco's own docs warn that adapters do **not** encrypt at rest and
  that stored data includes bearer proofs, proof secrets, P2PK private keys and NUT-20
  quote keys (`packages/docs/pages/storage-adapters.md`). The only browser seed helper
  shipped is `localStorageSeedGetter()`, whose own warning says: *"Do not use it for
  Wallets that hold real funds."* On a captive portal in a pre-auth Wi-Fi network —
  frequently a shared device — that is precisely the threat model the portal's own plan
  already flags (`docs/pwa-client-wallet-plan.md:66-69, 104-106`).
- **Bundle tax:** ~930 KiB unpacked for core+adapter+dexie on top of a 1,016 KiB
  bundle, delivered from router flash.
- **cashu.me does not use coco.** Zero `coco` references in its `package.json` or `src/`.
  So choosing coco is not "reusing the reference wallet"; it is adopting a young
  engine the flagship wallet does not yet run.

**Would coco remove work we'd otherwise hand-roll? Yes — the counter persistence, restore
and melt-resume layer.** But that layer is the small part of this job (§5), and coco's
price for removing it is an exact RC pin on `cashu-ts` inside the one component that must
be reproducible in a router firmware feed, plus ~930 KiB of bundle and a React 19
decision.

---

## 5. Recommendation

### First, size the thing we are deciding about

The portal's ecash job is small, because **the router already owns the invoice and the
quote.** `src/helpers/lightning.js` just POSTs to the backend and gets back
`{quote, invoice, mint_url, amount, expiry, state}` (`lightning.js:58-90`) and polls
status (`:92-120`). The client's job is: hold proofs; given an invoice, create a melt
quote at the mint; reserve/split proofs; melt; handle `pending`; report back. Today the
portal is **decode-only** — `src/helpers/cashu.js:2` imports exactly
`getTokenMetadata, getDecodedToken`, and there is **no `new CashuWallet`, no mint call,
and no proof store anywhere** in `src/` (grepped). So nothing has to be *undone*.

New first-party work, honestly bounded:

| Piece | LOC | Risk |
|---|---|---|
| IndexedDB proof + keyset + counter store (wrap `idb`/raw IDB) | 80–150 | low |
| Deterministic counter persistence off `wallet.on.countersReserved` → IDB | 40–80 | **medium** — this is the real footgun |
| Melt sequence (quote → exact-amount split → reserve → melt → pending check → settle), ported as *pattern* from `walletMelt.ts:148` | 150–250 | medium |
| Restore (NUT-09 `wallet.restore`) | 40–80 | low |
| PWA shell (`vite-plugin-pwa`), manifest icons, offline splash/balance | ~100 + config | low |
| **Total** | **~400–700 LOC, of which maybe 250 is genuinely subtle** | |

### Ranked recommendation

**1st — (a) Stay React/Vite + `@cashu/cashu-ts` directly, hand-roll the store. ← DO THIS.**
- *Cost:* ~400–700 LOC ours + tests, ~1–2 weeks; one new devDependency
  (`vite-plugin-pwa`); a small CSP change (see below).
- *Benefit:* zero framework rewrite; the 2,860 LOC portal, 2,506 LOC admin, 1,706 LOC of
  tests, the pinned reproducible bundle and the five-product contract are all untouched;
  no new runtime dependency inside a router firmware artifact; no React 19 or cashu-ts 5
  migration forced on us now; we keep the `CU1xx` decode precedence we paid for.
- *Why 1st:* the wallet layer is a few hundred lines; the portal is thousands. Amortizing
  a 930 KiB engine, an RC pin and a framework-scale dependency against ~300 lines of
  hand-rolling is a bad trade, and the incrementality is right: this is phase 2 of a
  three-phase plan (`docs/pwa-client-wallet-plan.md:81-91`), and phase 3 (Spillman
  channels) is where the client engine genuinely gets big — not now.

**2nd — (b) React + `@cashu/coco-core` + `@cashu/coco-indexeddb`. Revisit at the channel phase.**
- *Cost:* forces `cashu-ts` 2.9.0 → `5.0.0-rc.4` (or dual copies) with the documented
  breakages on `getDecodedToken` we currently depend on; ~930 KiB unpacked; skip
  `@cashu/coco-react` (React 19 peer) or upgrade React; unencrypted-at-rest bearer proofs
  with a localStorage seed helper its authors disclaim; a 2.0.0 engine published 2 months
  ago with 10 RCs behind it, inside a reproducible firmware build.
- *Benefit:* removes counter persistence, restore, and melt-resume/recovery from our
  plate — maybe 250–350 of our 400–700 lines.
- *Trigger to revisit:* coco's `cashu-ts` pin lands on a **stable, non-RC** release
  compatible with our line, **and** `@cashu/coco-react` publishes a React 18 peer range (or
  we upgrade React for other reasons), **and** we are building the channel rail — where a
  saga-based operation engine actually amortizes. Do not adopt it just to write a
  counter: `docs/pwa-client-wallet-plan.md` rates persisted proofs as "**Medium**" effort,
  and the counter is the only hard part of that.
- *Note:* if we do adopt it, `manager.ops.melt` is a superset of our requirement and its
  melt states map 1:1 onto what we must show the user.

**3rd — (c) Port the portal to Vue/Quasar. Do not do this.**
- *Cost:* ~7,000 LOC of first-party rewrite (2,860 `src/` + 2,506 Preact `admin/` +
  1,706 tests) plus 23 test files re-derived, 2 visual baselines invalidated, a second
  (or third) framework in the repo, and every byte of the five-product pinned bundle
  churned in a firmware feed that already shipped a stale bundle once.
- *Benefit:* cashu.me's ~300 framework-neutral lines become copy-pasteable instead of
  read-and-reimplement. **~1:23 against.**
- Also note the reuse is weaker than it looks: cashu.me's own counter persistence is a
  hand-rolled `localStorage` layer (`wallet.ts:227-235, 384-408, 426`), so even the port
  does not hand us a solved counter — it hands us a *worse* one (localStorage, not
  IndexedDB). And its PWA wiring is Quasar-CLI-specific (`src-pwa/`,
  `quasar.config.js:168-183`), so it does not transfer either.

### Two concrete findings from this investigation that matter regardless of the choice

1. **The current CSP will block mint calls.** `index.html:9` sets
   `connect-src 'self' http: ws:` — no `https:`, and no mint origins. The moment the
   wallet calls an https mint, it is blocked. This must change (ideally to an explicit
   allow-list derived from the router's advertised mints) as part of any of the three
   options, and it is a security-relevant change, not a formality.
2. **`manifest.json`'s `start_url` looks broken for the _served_ tree.** The build
   renames `build/index.html` → `build/splash.html` (`package.json:18`), and the served
   webroot contains `splash.html`, `balance.html`, `404.html` — **no `index.html`**
   (verified in the built tree at `~/repos/tollgate-portal-work/build/`, matching
   `portal-build.sh:129-152` which stages `build/*` minus `admin`). But
   `public/manifest.json` declares `"start_url": "."`. On the served directory that
   resolves to a path with no `index.html`. **Flag: verify installability on a real
   router; `start_url` should almost certainly be `"splash.html"`.** Also missing:
   `maskable` icon purpose (all three icons are `purpose: "any"`, or no purpose at all
   for the favicon entry) and any localisation of `name`/`short_name`.

---

## 6. If (b) — the concrete integration contract

Recorded so the option is decision-ready, not because it is recommended. Everything in
the left column is what we would delete from our own plan; the right column is what
stays ours.

| Hand-rolled piece (option a) | Replaced by (option b) |
|---|---|
| IDB proof store + keyset cache | `new IndexedDbRepositories({ name: 'tollgate' })` + `await repo.init()`, then `initializeCoco({ repo, seedGetter })` (`packages/indexeddb/README.md`) |
| Counter persistence off `countersReserved` | `CounterService` + `coco_cashu_counters` table; observe `manager.on('counter:updated', …)` |
| Melt: quote → split → reserve → melt → pending → settle | `manager.quotes.melt.create({ mintUrl, method: 'bolt11', methodData: { invoice } })` → `manager.ops.melt.prepare({ quote })` → `manager.ops.melt.execute(op.id)` → `refresh(op.id)` / `reclaim(op.id)`; `manager.ops.melt.recovery.run()` on boot |
| "Is this operation in flight?" UI state | `manager.ops.melt.getByQuote({ mintUrl, quoteId })`, `listByQuote`, `diagnostics.isLocked(opId)` |
| Restore (NUT-09) on load | `manager.wallet.restore({ units: ['sat'] })` / `.sweep()` |
| Balance display | `manager.wallet.balances.byMint()` → `.spendable` / `.reserved` |
| Proof-state polling | `manager.enableProofStateWatcher()`; or `enableMeltQuoteWatcher()` + `enableMeltSettlementProcessor()` |
| React glue | `@cashu/coco-react` (`CocoCashuProvider`, `useMeltOperation`) **only after a React 19 upgrade**; otherwise drive `Manager` directly — it is framework-agnostic |

**What remains ours under (b), unchanged:** the TollGate protocol itself — the
`/ln-invoice` fetch and `mac=` device attribution (`src/helpers/lightning.js:8-20, 58-90,
92-120`); `getAccessOptions` / `calculateAllocation` / price-per-step parsing
(`src/helpers/tollgate.js`, 314 lines); the `CU1xx` decode precedence and `canSubmitAnyway`
bypass (`src/helpers/cashu.js:171-292`); the mint-URL normalisation and unsupported-mint
UX (`cashu.js:73-168`, `Cashu.jsx:83-...`); the token-submission POST and kind-21023 error
mapping (`cashu.js:301-430`); the whole portal and Preact admin UI; i18n; branding;
packaging and its 1,643 LOC of guards. **coco replaces the store and the melt saga only.
It cannot replace any TollGate-specific line, and it drags `cashu-ts` 2.9.0 → 5.0.0-rc.4
across the decode path those lines sit on.**

---

## 7. What I could not determine

- **Whether `@cashu/cashu-ts` 5.0.0's `getDecodedToken(tokenString, keysetIds)` change
  breaks our exact call sites** — our calls
  (`src/helpers/cashu.js:215`, `src/helpers/mint-fee.js:34`) are wrapped in try/catch with
  a metadata-first fallback, so they may degrade gracefully rather than crash, but I did
  not run the upgrade to prove it. Treat "2.9.0 → 5.x" as an unmeasured, non-trivial task.
- **coco's real-world behaviour on an OpenWrt-served captive portal** (IndexedDB
  availability in captive WebViews; eviction under pressure) — not tested, only read.
- **The exact served webroot contents on router hardware.** My `start_url` finding is
  from the built tree plus `portal-build.sh`'s staging loop plus the
  `90-tollgate-captive-portal-symlink` uci-default; I did not read a device's
  `/etc/tollgate/tollgate-captive-portal-site/`. Verify before acting on it.
- **No LOC/effort estimate is validated by an actual build.** A `pygount`/`wc -l`
  measurement is a size proxy, not a schedule. The ~300-line melt-path estimate is a
  read-and-count, not a port.
- I did not evaluate a fourth option (a **Preact** wallet, matching `admin/`) — the guest
  portal is React 18 and the admin is Preact 10, so the repo already carries two
  frameworks; consolidating is a separate question the operator did not ask.

---

### Reproduction

`~/reports/pwa-cashu/measure.py` (pygount wrapper used for every LOC figure above):

```
python3 ~/reports/pwa-cashu/measure.py ~/repos/tollgate-captive-portal-site src admin packaging tests public docs openwrt scripts
python3 ~/reports/pwa-cashu/measure.py ~/repos/cashu.me src
```
