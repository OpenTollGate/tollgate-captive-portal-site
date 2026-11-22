# Dossier: Embedded Cashu wallet in a PWA that auto-pays BOLT11

**Question.** Can a captive-portal PWA hold ecash client-side, pay Lightning invoices
automatically on the user's behalf (many small, frequent top-ups to one session), and
**not** nag the user for a seed phrase until the held balance exceeds a threshold?

**Answer up front.** Yes for the wallet mechanics (cashu-ts covers every NUT the design
needs), **yes-but-with-a-real-risk** for seed-phrase-less onboarding: the mechanism is
trivially available (a random seed persisted locally, mnemonic surfaced later), but if the
device is lost *before* the user has ever seen the mnemonic, **the balance is
unrecoverable**. That is a user-facing money-loss path, not a bug. Recommendation in §4:
**cap the value at risk rather than the onboarding friction** — hold a small rolling
pre-paid buffer, keep the auto-melt loop, and *do not* let the un-surfaced balance exceed a
hard ceiling you are willing to write off per device.

**Method / evidence discipline.** Everything below is read from real code. Local clones
(READ-ONLY recon):

| Artefact | Location | Revision |
| --- | --- | --- |
| cashu.me | `~/repos/cashu.me` | `e21f5fab875b67de0fc5367a79710054d2c1f80f` (2026-09-28, merge PR #592) |
| cashu-ts (dev) | `~/repos/cashu-ts` | `145d2426d5071f2c321a6ec1171a5ce1c1ea0466` (2026-10-13) — `package.json` version `5.0.0-rc.11` |
| cashu-ts 4.9.0 (npm, the version cashu.me locks) | `~/repos/npm-cashu-ts/v4.9.0/package` | tarball `cashu-ts-4.9.0.tgz` from registry.npmjs.org |
| cashu-ts 4.11.0 (npm current) | `~/repos/npm-cashu-ts/v4.11.0/package` | tarball `cashu-ts-4.11.0.tgz` |

NUT coverage is measured from the **shipped** type surface `lib/types/index.d.ts` and the
API-Extractor report `etc/cashu-ts.api.md` **inside the npm tarballs**, not from the dev
branch and not from blog posts.

**Things that could not be read (stated, not guessed):**

1. **`https://walle.cashu.me` is not reachable as a web app from here.** It resolves
   (IPv4 `164.90.243.102`, IPv6 `64:ff9b::a45a:f366`) and completes a TLS handshake, but
   presents a **self-signed certificate** — `curl` aborts with
   `SSL certificate problem: self-signed certificate`. With verification disabled
   (`curl -sk`) the origin answers **HTTP 404** with body `404 page not found` and
   `content-type: text/plain`, i.e. **no SPA is served at `/`**. So I cannot verify what
   walle.cashu.me actually renders, and I have **not** assumed it is "cashu.me with a
   different skin". Treat the "imitate walle.cashu.me" requirement as unvalidated.
2. `https://cashu.me` returns **HTTP 200** (reachable) but this dossier reads the repo, not
   the deployment.
3. **There is no LUD-25.** See §7 — this is a correction to the brief, not a lookup failure.

---

## 1. cashu.me architecture: where the seed and the proofs actually live

### 1.1 Stack (measured)

`~/repos/cashu.me/package.json`:

- **Vue 3 + Quasar v2 (Vite)** — **not React**, despite the brief's description. Quasar
  `2.18.2`, Pinia for state, `vite` `2.9.18` resolved in `package-lock.json`.
- `@cashu/cashu-ts` `^4.9.0`, **lockfile-pinned to exactly `4.9.0`**
  (`package-lock.json`: `"resolved": "https://registry.npmjs.org/@cashu/cashu-ts/-/cashu-ts-4.9.0.tgz"`).
- `@scure/bip39` `^1.4.0` (mnemonic generation/derivation).
- `dexie` `^4.0.9` → resolved `4.0.10` (IndexedDB).
- `@vueuse/core` `^10.9.0` → `useLocalStorage`.
- `light-bolt11-decoder`, `bech32`, `nostr-tools`, `@nostr-dev-kit/ndk`.
- Its own `package.json` declares **no `license` field**, but the repo ships
  `LICENSE.md` = **MIT License, Copyright (c) 2023 Cashu**. The *repo* is MIT; the
  `package.json` omission is a packaging gap, not a licence change.

### 1.2 Seed / mnemonic storage — **plaintext localStorage, at rest**

`src/stores/wallet.ts:224`

```ts
mnemonic: useLocalStorage("cashu.mnemonic", ""),
```

- Stored under the localStorage key **`cashu.mnemonic`** as the raw BIP-39 phrase.
- **No encryption.** A grep for `aes`, `crypto.subtle`, `pbkdf2`, `password` across
  `src/stores/`, `src/js/`, `src/boot/` finds nothing protecting the mnemonic (the only
  hit is `src/stores/npubcash.ts:85`, an unrelated URL password field). No WebAuthn gate, no
  passphrase, no OS keychain. Anyone with the origin's localStorage has the wallet.

### 1.3 Key derivation

`src/stores/wallet.ts:293-297, 460-462`

```ts
getters: {
  seed(): Uint8Array { return mnemonicToSeedSync(this.mnemonic); },
},
...
mnemonicToSeedSync: function (mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
},
```

`src/stores/wallet.ts:410-425`

```ts
createWalletInstance(storedMint, url, unit): Wallet {
  const mints = useMintsStore();
  if (this.mnemonic == "") { this.mnemonic = generateMnemonic(wordlist); }
  const bip39seed = mnemonicToSeedSync(this.mnemonic);
  const wallet = new Wallet(url, {
    unit, bip39seed,
    counterSource: this.getOrCreateCounterSource(),
  });
```

- `generateMnemonic` / `mnemonicToSeedSync` / `wordlist` come from `@scure/bip39`
  (`src/stores/wallet.ts:97-98`); the **English** wordlist.
- The BIP-39 seed is handed to cashu-ts as `bip39seed`, which is what drives NUT-13
  deterministic output construction (§3).
- **The seed is created lazily and silently**: `createWalletInstance` and
  `initializeMnemonic()` (`:1748-1753`) both do `if (this.mnemonic == "") this.mnemonic =
  generateMnemonic(wordlist)`. A wallet can therefore exist and hold proofs before the
  user has ever laid eyes on the phrase — the exact primitive our design wants (§4).

### 1.4 Proof storage — Dexie / IndexedDB, plaintext

`src/stores/dexie.ts`

```ts
export class CashuDexie extends Dexie {
  proofs!: Table<WalletProof>; paymentHistory!; mintQuotes!; meltQuotes!; ecashHistory!;
  constructor(databaseName = "db") {
    super(databaseName);
    this.version(1).stores({ proofs: "secret, id, C, amount, reserved, quote" });
    ...
    this.version(4)...   // migration: amount → number, quotes normalized
  }
}
export const cashuDb = new CashuDexie();      // db name "db"
```

- IndexedDB database name **`db`**, table `proofs` primary-keyed on `secret`.
- `reserved` / `quote` columns are the local spend-reservation bookkeeping
  (`src/stores/proofs.ts:85-102` `setReserved`).
- Proof rows are **plaintext**: `secret`, `C`, `amount`, `id`. No encryption.
- Live reactivity via `liveQuery(() => cashuDb.proofs.toArray())`
  (`src/stores/proofs.ts:33`).
- Migration history is visible: v1 proofs only → v2 adds quote tables → v3 adds
  `ecashHistory` → v4 normalises `Amount` fields. Proofs used to live in
  **localStorage** under `cashu.proofs` and were migrated into Dexie
  (`src/stores/dexie.ts:88-127`) — useful precedent if we ever need to move storage.

### 1.5 Backup / export format (relevant to any "encrypted backup" plan)

`src/stores/storage.ts:104-148` `exportWalletState()` dumps a flat JSON object keyed by
localStorage key, with the Dexie tables appended under synthetic magic keys
(`cashu.dexie.db.proofs`, `...paymentHistory`, `...mintQuotes`, `...meltQuotes`,
`...ecashHistory`). Restore (`:42-103`) replays them. **It is a plaintext dump of the
mnemonic plus every proof.** There is also `src/stores/nostrMintBackup.ts` which derives
Nostr keys from the same mnemonic (`mnemonicToSeedSync(mnemonic)`, `:111`) to publish a
mint list to relays — not a proof backup.

### 1.6 Unlock / onboarding UX (the thing we want to change)

`src/stores/welcome.ts` + `src/pages/WelcomePage.vue` + `src/pages/welcome/*`:

- Flow is a **full-screen persistent carousel**: slide 0 Intro → 1 PWA → 2
  `WelcomeSlideChoice` (New / Recover) → 3 `WelcomeSlide3` (seed display) or
  `WelcomeRecoverSeed` (seed entry) → 4 `WelcomeMintSetup` → 5 `WelcomeRestoreEcash`
  (recover path only). `isLastSlide` = 4 for "new", 5 for "recover" (`welcome.ts:51-53`).
- **`@click="choose('new')"` on the choice slide immediately generates the mnemonic**
  (`WelcomeSlide3.vue` created-hook: `if (welcomeStore.onboardingPath === "new" &&
  !walletStore.mnemonic) { initializeMnemonic() }`), renders it **hidden by default**
  (`hideMnemonic = ref(true)`, masked `hiddenMnemonic`) behind a visibility toggle plus a
  copy button, and requires an explicit checkbox before proceeding:
  `v-model="welcomeStore.seedPhraseValidated" data-testid="onboarding-seed-confirmed"`.
- **There is no skip.** `canProceed` (`welcome.ts:66-69`) returns
  `state.seedPhraseValidated` for the "new" path at slide 3 — the only way forward is to
  tick "I have written this down". The E2E helper encodes it as an unavoidable step:
  `test/e2e/pages/WalletPage.ts:34-35` clicks `onboarding-create-wallet` then
  `onboarding-seed-confirmed`.
- Gate on completion is a localStorage flag `cashu.welcome.showWelcome = false`
  (`welcome.ts:20, 97-103`), and `WelcomePage.vue` uses `persistent` on the dialog.

**So: cashu.me's design is the exact opposite of what we want** — it blocks the whole app
behind a mandatory mnemonic confirmation *before* any balance exists. Our PWA needs the
inverse ordering: accumulate first, surface the mnemonic at a value threshold. That is a
UX inversion we must build, not a flag we can flip.

### 1.7 Unlock model generally

There is **no unlock step at all** in cashu.me: `showWelcome` is the only gate, and once
false, `useWalletStore().mnemonic` is read straight out of localStorage on every
`activeWallet()` call. No PIN, no biometric, no session lock. For a captive portal that is
actually convenient (nothing to prompt), but it means "the device is the wallet".

---

## 2. Library + version + licence

| Item | Measured value | Source |
| --- | --- | --- |
| Library cashu.me uses | `@cashu/cashu-ts` | `package.json` dependency |
| Declared range | `^4.9.0` | `package.json:15` |
| **Resolved / locked** | **`4.9.0`** | `package-lock.json` resolved URL `cashu-ts-4.9.0.tgz` |
| Licence (npm metadata) | **`MIT OR Apache-2.0`** (dual) | registry packument for 4.9.0 **and** 4.11.0 |
| Licence (repo files) | `LICENSE.md`: "licensed under Apache 2.0 or MIT, at your option"; `LICENSE-MIT` (© 2023 Cashu) + `LICENSE-APACHE` both present | `~/repos/cashu-ts/LICENSE*.md` |
| Current published `latest` | **`4.11.0`** | npm dist-tags `{latest: 4.11.0, next: 5.0.0-rc.11, v3-lts: 3.7.2}` |
| Dev branch | `5.0.0-rc.11` | `~/repos/cashu-ts/package.json` @ `145d2426` |
| Runtime deps | `@noble/curves`, `@noble/hashes`, `@scure/base`, `@scure/bip32` | packument |
| Module format | **ESM-only since v4** ("CommonJS `require()` is no longer supported") | cashu-ts `README.md:21` |
| Engine floor | Node `>=22.4.0` (build/test tooling) | cashu-ts `AGENTS.md` |

**Licence caveat for §8:** the *npm metadata* says `MIT OR Apache-2.0`; the *repo*
`LICENSE.md` adds "Some files retain their own copyright notice". A dual MIT/Apache-2.0
offer is compatible with GPL-3.0 (MIT is GPL-compatible; Apache-2.0 is compatible with
GPL-3.0 but **not** with GPL-2.0). See §8.

---

## 3. NUT coverage — measured, with symbol names

Measured from `~/repos/npm-cashu-ts/v4.9.0/package/lib/types/index.d.ts` (6639 lines) and
`.../etc/cashu-ts.api.md` (2329 lines). "Supported" = a public symbol exists that
implements the NUT's client half.

### 3.1 Coverage table

| NUT | What it is | Verdict | Public symbols (4.9.0) |
| --- | --- | --- | --- |
| **NUT-00** | Cryptography / BDHKE, `Proof` | **Supported** | `Proof`, `ProofLike`, `Amount`, `SerializeBlindedMessage`; "as recommended by NUT-00" (`index.d.ts:679`) |
| **NUT-01** | `/v1/keys` | **Supported** | `Mint.getKeys(keysetId?, mintUrl?)`, `MintKeys`, `deserializeMintKeys` (`:1041` region) |
| **NUT-02** | Keysets + fees | **Supported** | `Mint.getKeySets()` → `GetKeysetsResponse`; `Keyset`, `input_fee_ppk`; `Wallet.getFeesForKeyset(nInputs, keysetId)`, `Wallet.getFeesForProofs(proofs)`, `Wallet.getFeesToInclude(amount, opts?)`, `Wallet.maxSpendableAfterFees(proofs, feeReserve?)` (`api.md:2162-2181`) |
| **NUT-03** | Swap | **Supported** | `Mint.swap(swapPayload)`; wallet-level `Wallet.prepareSwapToSend(amount, proofs, config, outputConfig)` → `SwapPreview`, `Wallet.completeSwap(swapPreview, privkey?)`, `Wallet.send(...)`; builder `wallet.ops.send(amount, proofs)` → `SendBuilder` |
| **NUT-04** | Mint from Lightning (BOLT11) | **Supported** | `Wallet.createMintQuoteBolt11(amount, description?)`, `Wallet.checkMintQuoteBolt11(quote)`, `Wallet.mintProofsBolt11(amount, quote, config?, outputType?)`, `Wallet.prepareMint('bolt11', …)` / `completeMint(preview)`; `wallet.ops.mintBolt11(amount, quote)` → `MintBuilder` |
| **NUT-05** | **Melt / PAY a BOLT11** | **Supported** | `Wallet.createMeltQuoteBolt11(invoice, amountMsat?)`, `Wallet.checkMeltQuoteBolt11(quote)`, `Wallet.prepareMelt('bolt11', quote, proofsToSend, config, outputType?)`, `Wallet.completeMelt(preview, privkey?, options?)`, `Wallet.meltProofsBolt11(meltQuote, proofsToSend, config?, outputType?)`; `wallet.ops.meltBolt11(quote, proofs)` → `MeltBuilder` |
| **NUT-06** | Mint info | **Supported** | `Mint.getInfo()` → `GetInfoResponse`, `MintInfo` with `.cache` (persistable for offline!), `isSupported(num)` (typed `(num: 4 \| 5)` for mint/melt), `supportedMethods('mint'\|'melt')`, `supportsMintMeltMethod(op, method, unit)`, `getMintMeltMethod(op, method, unit)`; `MintInfo` "does not need a live connection" (`docs-src/usage/mint_capabilities.md`) |
| **NUT-07** | Proof state check | **Supported** | `Mint.check(checkPayload)`; `Wallet.checkProofsStates(proofs)` → `ProofState[]`; `Wallet.groupProofsByState(proofs)` → `{unspent, pending, spent}`; `CheckStateEnum = {UNSPENT, PENDING, SPENT}`; streams `WalletEvents.proofStateUpdates` / `proofStatesStream` |
| **NUT-08** | Overpaid Lightning fee return | **Supported** | `MeltProofsConfig.nut08Change?: boolean` ("Request NUT-08 blank outputs so the mint can return unspent fee reserve. **Defaults to true**"); `MeltProofsResponse.change: Proof[]`; `Wallet.createMeltChangeProofs(outputData, changeSigs)` for deferred/async change |
| **NUT-09** | Restore signatures | **Supported**, partially UX-shaped | `Mint.restore(restorePayload)`; `Wallet.restore(start, count, config?)` (low-level scan) and `Wallet.batchRestore(gapLimit?, batchSize?, counter?, keysetId?)` (`index.d.ts:5693`, both present in 4.9.0 **and** 4.11.0) |
| **NUT-10** | Well-known secrets | **Supported** | `createSecret`-family well-known secret helpers (`index.d.ts:687` "Create a NUT-10 well known secret"); HTLC secret parsing/validation (`:3725-3729`) |
| **NUT-11** | P2PK | **Supported** | `P2PKOptions`; `SendBuilder.asP2PK(options)` / `keepAsP2PK`; `MintBuilder.asP2PK`; `MeltBuilder.asP2PK`; `Wallet.signP2PKProofs(proofs, privkey, outputData?, quoteId?)`; `getP2PKExpectedWitnessPubkeys(secret)`, `getP2PKSigFlag(secret)`; `deriveKeyPair(seed, 'P2PK', counter)` |
| **NUT-12** | DLEQ | **Supported** | `requireSigDleq` wallet option ("NUT-12 MUST verify-if-present", default flips to `false` in v5, `:1198`); BAT DLEQ validation (`:257`) |
| **NUT-13** | **Deterministic secrets / BIP32-style** | **Supported** | `deriveSecret(seed, keysetId, counter)` (**deprecated**); `deriveSecretAndBlindingFactor(seed, keysetId, counter)` → `{secret, blindingFactor}` — "the **preferred NUT-13 derivation API**"; `WalletOptions.bip39seed`, `secretsPolicy?: 'auto'\|'deterministic'\|'random'`, `counterSource?: CounterSource`, `counterInit?: Record<string,number>`; `wallet.counters.{peekNext, advanceToAtLeast, setNext, snapshot}`; `WalletEvents.countersReserved`; builders `.asDeterministic(counter?, denoms?)` |
| NUT-14 (HTLC) | | Supported | `createHTLCSecret`-family / HTLC witness (`:3725`) |
| NUT-15 (MPP) | multi-path | Supported | `Wallet.createMultiPathMeltQuote(invoice, millisatPartialAmount)`; `Mpp: multi-path payments (NUT-15)` (`:1913`) |
| NUT-16 (animated QR) | | Not needed | only referenced upstream as an open PR in cashu-ts (#1309) |
| NUT-17 (WebSocket sub) | | Supported | `Mint.connectWebSocket()`, `WSConnection`, `WebSocketSupport`; `wallet.on.mintQuoteUpdates` / `meltQuoteUpdates` / `onceMintPaid` / `onceMeltPaid` |
| NUT-18 (payment requests) | | Supported | `PaymentRequest.amountToSend(mintUrl, methods)`, `Wallet.isPaymentRequestSatisfied(pr, proofs, amount?, opts?)`; cashu.me's `src/stores/payment-request.ts` |
| NUT-19 (cached responses) | idempotent retries | Supported | referenced with the two-step `prepareMelt`/`completeMelt` pattern (`docs-src/usage/melt_token.md` §2: "replay-safe recovery alongside NUT-19 transport retries") |
| NUT-20 (quote signatures) | | Supported | `createLockedMintQuote(amount, pubkey, description?)`; `MintQuoteBaseRequest.pubkey`; `MintQuoteBaseResponse.pubkey`; `deriveKeyPair(seed, 'QuoteLock', counter)` |
| NUT-21/22 (OIDC / BATs) | | Supported, **irrelevant to us** | `oidcAuth(opts?)`, `AuthProvider` |
| NUT-23 (BOLT11/BOLT12 method aliases) | | Supported | `MintQuoteBaseResponse` state derived from NUT-04 accounting fields where mints omit `state` (`:2604-2616`); `prefer_async` melt support |
| NUT-25 (BOLT12 / amountless) | | Supported | `MintQuoteBolt12Response.amount: null` for amountless offers (`:3147`) |
| NUT-28 (blinded auth / P2BK) | | Supported | `deriveBlindedSecretKey`-family (`:767`), `deriveP2BKSecretKeys(...)` |
| NUT-29 (batch mint) | | Supported | `Mint.mintBatchBolt11/Bolt12`, `Wallet.prepareBatchMint(...)`, `completeBatchMint(...)` |
| NUT-30 (onchain) | | Present but **`@experimental`** | `meltProofsOnchain`, `createMeltQuoteOnchain`, `MeltQuoteOnchainResponse` |

### 3.2 The verdict for **our** flow

The five NUTs the design cannot do without are all present and first-class:

- **NUT-04** (get ecash in) — `createMintQuoteBolt11` / `mintProofsBolt11`
- **NUT-05** (pay the BOLT11 — the whole point) — `createMeltQuoteBolt11` / `meltProofsBolt11`
- **NUT-07** (know if a proof is live) — `checkProofsStates` / `groupProofsByState`
- **NUT-08** (get the unused routing fee back on *many small* melts — materially matters when
  tops are frequent) — `nut08Change` defaults **true**
- **NUT-13 + NUT-09** (deterministic restore; the enabler of the thresholded-mnemonic design)
  — `deriveSecretAndBlindingFactor` + `batchRestore`

NUT-02 fee handling matters more than it looks: with many small melts, the input fee and the
`fee_reserve` on each melt are a real fraction of the amount moved. cashu-ts gives us
`includeFees`, `getFeesToInclude`, `maxSpendableAfterFees` and `getFeesForProofs` to size a
top-up so the payee nets the invoice amount.

### 3.3 Discrepancies worth knowing (measured, not inferred)

1. **The docs are ahead of the shipped code by one symbol.** cashu-ts
   `docs-src/usage/restore_proofs.md` and `docs-src/deterministic_counters.md` both document
   **`wallet.restoreAll()`** returning `{ proofs, lastCounters }`. `grep -c 'restoreAll'`
   over the shipped `.d.ts` returns **0 in 4.9.0 and 0 in 4.11.0**. The shipped API is
   `restore(start, count, config?)` and `batchRestore(gapLimit?, batchSize?, counter?,
   keysetId?)` returning `{ proofs, lastCounterWithSignature? }`. **Code against
   `batchRestore`, not `restoreAll`** — cashu.me does exactly that
   (`src/stores/restore.ts:91-95`). This is the kind of "docs say it exists, types say it
   doesn't" gap that burns a day.
2. **`Amount` not `number`.** In v4 `Proof.amount` is `bigint`, and API DTOs return
   `Amount` objects. v4 enforces this: "refuse implicit numeric coercion of Amount"
   (CHANGELOG, 5.0.0-rc.11 fixes). cashu.me carries shims for it —
   `src/js/cashu-amount.ts`, `Amount.from(x).toNumber()` (`src/stores/walletBolt11.ts:41-43`).
   Budget for this: it is the #1 source of silent unit bugs.
3. **`MeltQuoteState` is `{UNPAID, PENDING, PAID}`** (`index.d.ts:2019-2023`) and
   `MintQuoteState` is `{UNPAID, PAID, ISSUED}`. `PENDING` is a first-class melt state — see
   the failure mode in §5.4.
4. **The `preimage` machinery in 4.9.0 is HTLC, not melt verification.** I grepped the
   shipped ESM bundle: every `preimage` occurrence in 4.9.0 is NUT-14 HTLC witness handling
   (`Hashlock spend failed, wrong preimage for hash`) or onchain `payment_preimage`
   normalisation. **There is no "verify the melt preimage against the invoice payment hash"
   check in 4.9.0.** That check was added later: CHANGELOG 5.0.0-rc.11 lists
   `fix(mint): check a bolt11 melt preimage against the invoice payment hash (#1161)`.
   **Consequence: on 4.9.0 the ONLY trustworthy success signal for a melt is the mint's
   `MeltQuoteState.PAID`, and you cannot independently verify it.** On 4.11.0/5.0.0-rc a
   preimage check exists. Prefer a version that has it (§5.4).

---

## 4. Seed-phrase-less design feasibility — **the key question**

### 4.1 Can a wallet hold and spend ecash with no user-visible mnemonic? **Yes.**

The mechanism is already present in cashu.me and is not a hack:

- cashu.me generates the mnemonic **silently on demand** and never requires it to exist
  first: `if (this.mnemonic == "") { this.mnemonic = generateMnemonic(wordlist); }`
  (`src/stores/wallet.ts:416-418, 1748-1753`).
- It spends by handing the BIP-39 seed to cashu-ts (`bip39seed`, `:419-423`). Nothing in the
  spend path requires a human to have read the phrase.
- cashu.me surfaces the phrase only in a UI step it *chooses* to make mandatory. Our PWA
  simply does not render that step until we decide to.

So: **device-generated random seed → persisted locally → mnemonic surfaced later on a
threshold** is a feasible design with this library, and NUT-13 deterministic derivation is
what makes "later" mean anything.

### 4.2 What exactly does NUT-13 need?

From the spec (`https://raw.githubusercontent.com/cashubtc/nuts/main/13.md`, read live):

- A **`seed`** derived from a 12-word BIP-39 mnemonic. In cashu-ts that is
  `WalletOptions.bip39seed: Uint8Array` — the caller supplies it.
- **A separate counter `counter_k` per keyset `k`** — "the wallet **MUST** keep track of a
  separate counter for each keyset `k` it uses".
- Derivation is keyset-version-dependent:
  - keyset IDs starting **`01`** → **HMAC-SHA256**: `message =
    b"Cashu_KDF_HMAC_SHA256" || keyset_id_bytes || counter_k_bytes(BE u64) ||
    derivation_type_byte`, where `0x00` = secret and `0x01` = blinded message;
    `secret = hmac_digest`, `blinding_factor = hmac_digest % N`.
  - keyset IDs starting **`00`** → legacy **BIP-32** path (deprecated).
- **P2PK keys** use a fixed path `m/129373'/10'/0'/0'/{counter}` (cashu-ts
  `deriveKeyPair(seed, 'P2PK', counter)`).
- cashu-ts exposes exactly this as `deriveSecretAndBlindingFactor(seed, keysetId, counter)`
  ("the preferred NUT-13 derivation API") and creates deterministic outputs via
  `.asDeterministic(counter?, denoms?)` on every builder, with counters reserved atomically
  and reported through `wallet.on.countersReserved({counterKey, start, count, next})`.

**What we must persist for recovery to work — this is a short list, and it is the whole
security story:**

1. the **seed** (or mnemonic),
2. the **per-keyset counter** `next` (or at least the highest used index) for *every* keyset
   of *every* mint we have ever held value at, and
3. the **mint URL(s)** — the mint must be asked to replay signatures (NUT-09), so a seed
   without the mint list is only half a backup. cashu.me knows this: it has a dedicated
   `nostrMintBackup.ts` that publishes the mint list to Nostr, keyed off the same mnemonic.

Two documented limits:

- **Only deterministic outputs are recoverable.** Random-secret proofs are not
  (`docs-src/usage/restore_proofs.md`). So we must run with
  `secretsPolicy: 'deterministic'` (or `.asDeterministic()` on every output path) **from the
  very first proof** — if even one path creates a random-secret proof, that value is
  unrecoverable forever. This is a build-time invariant, not a runtime option.
- **Quote-lock keys (NUT-13 type for NUT-20) are not seed-recoverable.** "Quote lock keys
  live on a per-mint cursor the mint has no record of, so a seed-only restore cannot rebuild
  it; `recoverQuoteLockKey` scans for a known quote pubkey instead" (same doc). **Design
  consequence: do not use NUT-20 locked quotes in the auto-top-up loop.** An in-flight
  locked quote whose locked proofs are stranded is exactly the failure we cannot afford.

### 4.3 Recovery story if the device is lost **before** the user ever saw the seed

Be blunt about this, because it is the crux:

> **If the seed has never left the device and the device is gone, the ecash is gone.** Not
> "hard to recover" — gone. Ecash is a bearer instrument; the mint holds no account and no
> identity for the holder, and NUT-09 will only replay signatures to someone who can present
> the same deterministic derivation, which means the same seed. There is no support path, no
> "reset my password", no central authority. Whatever the browser profile held — the
> localStorage `cashu.mnemonic` value and the IndexedDB `proofs` table — was the money.

Second-order losses that are easy to miss:

- Clearing site data / "clear browsing data" / a browser profile reset / an incognito or
  private window that closes **destroys** the wallet. A captive-portal PWA is exactly the
  context where a user is most likely to be in a throwaway browsing mode.
- iOS Safari evicts IndexedDB and localStorage for origins unused for ~7 days (ITP). A
  captive-portal session wallet that the user only revisits will be silently wiped. This is
  arguably a *bigger* practical risk than device theft.
- A second device is a **separate wallet** with zero balance. There is no "sign in".

### 4.4 Recommendation (with the trade-off stated)

**Do not gate on the mnemonic; gate on the amount at risk.** Concretely:

1. **Cap the un-surfaced balance.** Pick a per-device ceiling `T` that you are willing to
   write off. Hold **at most `T`** sats in the silent wallet. Keep the auto-melt loop working
   inside that budget. Only when the *retained* balance would exceed `T` do you block and
   require the mnemonic to be written down (then lift the cap).
2. **Do not keep a "float" if you can avoid it.** The lowest-risk shape is *exactly-on-demand*
   melt: mint a quote for the invoice amount `+ fee_reserve + input fees`, pay immediately,
   and keep zero residual balance. If there is no resting balance, there is nothing to lose
   and no seed to surface at all — the "wallet" is a transient. cashu.me's own melt path is
   already shaped this way (`meltGeneric` sizes the swap to `quote.amount +
   quote.fee_reserve`, `src/stores/walletMelt.ts:161`). Prefer this if the top-up cadence
   allows it; it makes the seed-phrase question mostly moot.
3. **Make the seed phase a deliberate one-time step, not a nag.** When the threshold is
   crossed, show the phrase once with the same friction cashu.me applies (hidden-by-default +
   explicit confirmation checkbox, `data-testid="onboarding-seed-confirmed"` pattern) and
   record completion in localStorage. Never interrupt a payment to do it.
4. **Persist the recovery triple from proof #1**: `{seed, countersByKeyset, mintUrls}`.
   Counters via `wallet.on.countersReserved` → atomic upsert (`docs-src/deterministic_counters.md`
   §2). This is not optional — without counters, a later restore re-derives colliding outputs
   and the mint rejects them (`outputs have already been signed`).
5. **Own the eviction risk explicitly.** Treat "site data was cleared" as a *normal* event,
   not an edge case. Test it. Optionally persist an **encrypted** copy of the recovery triple
   somewhere the user already trusts, and surface a "this device is the wallet" warning in
   the UI before the first sat is ever acquired.

**Trade-off, stated plainly:** we trade recoverability for zero-onboarding friction. The
mitigation is not a technical trick — it is *bounding the loss* to a number we are happy to
absorb. If the business cannot accept writing off `T` sats per lost device, then the design
must be exactly-on-demand (no resting balance) or it must prompt earlier. There is no third
option; the protocol has no account layer to recover against.

---

## 5. Automatic BOLT11 melt — exact call sequence

### 5.1 The canonical one-step path (from the shipped docs)

`~/repos/npm-cashu-ts/v4.9.0/package/docs-src/usage/melt_token.md` §1:

```ts
const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed, counterSource });
await wallet.loadMint();                       // REQUIRED first — else "mint info not initialized"

const invoice = 'lnbc…';                       // the BOLT11 to pay
const meltQuote = await wallet.createMeltQuoteBolt11(invoice);   // NUT-05 quote
const amountToSend = meltQuote.amount.add(meltQuote.fee_reserve); // NUT-08 fee reserve!

const { keep: proofsToKeep, send: proofsToSend } =
  await wallet.send(amountToSend, proofs, { includeFees: true });  // NUT-03 swap, sized

const meltResponse = await wallet.meltProofsBolt11(meltQuote, proofsToSend); // NUT-05 melt
// persist proofsToKeep and meltResponse.change
```

Doc's own warning, verbatim: *"Show `amount + fee_reserve` as the cost. A mint may return no
change even when routing cost less than the reserve, so treat `change` as a refund to
reconcile afterwards, not a figure to promise."*

And on the melt entry point (`index.d.ts:6117-6122`):
*"ProofsToSend must be at least amount+fee_reserve from the melt quote. This function does
not perform coin selection!"* — **you must size the proofs yourself**; that is what
`includeFees: true` on the preceding `send` is for.

### 5.2 The replay-safe two-step path (use this for auto-pay)

`docs-src/usage/melt_token.md` §2 — "recommended pattern when you want replay-safe recovery
alongside NUT-19 transport retries":

```ts
const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const amountToSend = meltQuote.amount.add(meltQuote.fee_reserve);
const { send: proofsToSend } = await wallet.send(amountToSend, proofs, { includeFees: true });

const meltPreview = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend);
// PERSIST serializeMeltPreview(meltPreview)  <-- crash-safe
const meltResponse = await wallet.completeMelt(meltPreview);
```

Builder form (`docs-src/wallet_ops/melt.md`):

```ts
const preview = await wallet.ops.meltBolt11(meltQuote, myProofs).asDeterministic().prepare();
const { quote, change } = await wallet.completeMelt(preview);
```

**This is what our auto-pay loop should use.** A captive-portal payment can be interrupted by
a tab close, a network drop, or the portal redirecting; the persisted `MeltPreview` is what
lets us either retry idempotently or reconstruct change.

### 5.3 How cashu.me does it (the shape to copy)

Two files, a clean separation:

**Quote (no money moves yet)** — `src/stores/walletBolt11.ts:221-237`:

```ts
export async function meltQuoteBolt11(this: any, wallet: Wallet, request: string,
                                      mpp_amount: number | undefined = undefined) {
  const mintStore = useMintsStore();
  let data;
  if (mpp_amount) { data = await wallet.createMultiPathMeltQuote(request, mpp_amount * 1000); }
  else            { data = await wallet.createMeltQuoteBolt11(request); }
  mintStore.assertMintError(data);
  return normalizeMeltQuote(data);
}
```

**Execute (money moves)** — `src/stores/walletMelt.ts:148-249` `meltGeneric()`, the sequence:

```
meltGeneric(proofs, quote, mintWallet, silent, checkQuote, method, ...)
 1. amount = quote.amount + quote.fee_reserve                       (:161)   NUT-08 reserve
 2. { sendProofs } = await this.send(proofs, mintWallet, amount,
                                    /*invalidate*/ false, /*includeFees*/ true)  (:165-172)
      -> internally: selectProofsToSend(..., includeFees, exactMatch=true);
         if no exact match:  swapWallet.ops.send(amount, spendableProofs)
                              .asDeterministic().keyset(id)
                              .proofsWeHave(spendableProofs)
                              .includeFees(includeFees).run()      (wallet.ts:717-748)
 3. throw if sendProofs.length == 0 ("could not split proofs.")     (:174-176)
 4. proofStore.setReserved(sendProofs, true, quote.quote)           (:192)
      -> local spend-reservation; prevents double-spend of in-flight proofs
 5. preview = await mintWallet.prepareMelt(method,
                 toMeltQuote(quote), sendProofs, { keysetId })     (:204-209)
    await this.setMeltChangeOutputData(quote.quote, preview.outputData)   (:210)  NUT-08 blanks persisted
 6. data = await mintWallet.completeMelt(preview, undefined, opts)  (:211-215)
 7. updateOutgoingInvoiceInHistory(normalizeMeltQuote(data.quote))   (:218-219)
 8. if (data.quote.state != MeltQuoteState.PAID) throw "Invoice not paid."  (:231-233)  <-- SUCCESS TEST
 9. if (data.change != null) proofsStore.addMissingProofs(data.change)      (:235-237)  NUT-08 change
10. proofsStore.removeProofs(sendProofs)                                     (:239)     inputs are SPENT
11. amount_paid = amount - sumProofs(data.change ?? [])                     (:241)     report real cost
```

Note `checkQuote` is threaded in as `(id) => mintWallet.mint.checkMeltQuoteBolt11(id)`
(`walletBolt11.ts:292`) — the **mint** is the only authority on whether the invoice was paid.

### 5.4 Detecting success — and the failure mode that will bite us

- **Only `MeltQuoteState.PAID` means paid.** From the spec-side rule set already proven in
  this codebase's neighbourhood: `GET /v1/melt/quote/bolt11/{id}` answers
  `UNPAID` / `PENDING` / `PAID`, and **an unknown state is an error, never success**. Treating
  `PENDING` as success spends real money twice.
- cashu.me's guard is the model: `if (data.quote.state != MeltQuoteState.PAID) throw new
  Error("Invoice not paid.")` (`walletMelt.ts:231-233`).
- **Bug found in cashu.me's own path — worth not copying.** The local "already paid" guard in
  `src/stores/walletBolt11.ts:252-260` is:

  ```ts
  if (this.invoiceHistory.find(
        (i) => i.request === request && i.amount < 0 && i.status === "paid")) {
    notifyError("Invoice already paid.");
    throw new Error("invoice already paid.");
  }
  ```

  This is a **local, client-side** dedupe keyed on a client-writable history row. It is not a
  NUT-07 `checkProofsStates` check and not a mint query. For a loop that fires "many small
  frequent" payments it will reject legitimate repeat payments (the same well-known invoice,
  e.g. a portal's fixed price invoice, paid twice = "already paid"), while providing no
  protection against the real double-spend, which is at the proof layer. **Use
  `checkProofsStates` on the input proofs and the mint's quote state as the authorities; do
  not build the top-up loop's idempotency on a local history string match.**
- Prefer a cashu-ts that can verify the preimage (§3.3 item 4). On 4.9.0 you cannot.
- For the async/`prefer_async` case (`docs-src/usage/melt_token.md` §3): the melt can return
  **before** the Lightning payment completes and **without** NUT-08 change signatures. Then
  you must persist `preview.outputData` and later call
  `Wallet.createMeltChangeProofs(outputData, changeSigs)` against the eventual paid quote to
  reclaim change. **If you ignore this, the fee reserve is silently donated to the mint.**
  With many small melts that adds up.

---

## 6. Service-worker / offline constraints

### 6.1 What is local vs. what needs the mint

Derived from the API surface, not from folklore:

| Operation | Needs the mint? | Symbol |
| --- | --- | --- |
| Read own balance | **No** | local `proofs` table |
| Balance after fees | **No** | `Wallet.maxSpendableAfterFees(proofs, feeReserve?)`, `getFeesForProofs(proofs)` |
| Mint capability questions | **No**, if cached | `MintInfo` constructed from a persisted `info.cache` — *"does not need a live connection"* (`docs-src/usage/mint_capabilities.md`) |
| Decode a token | **No** | `Wallet.decodeToken(token)` (pass keysets for short v2 ids) |
| **Offline send / split** | **No** | `Wallet.sendOffline(amount, proofs, config?)`; builders `offlineExactOnly(requireDleq?)` / `offlineCloseMatch(requireDleq?)` — *"Force a pure offline, exact match selection. No mint calls are made."* |
| Verify a proof is unspent (**NUT-07**) | **Yes** | `checkProofsStates` |
| Receive / redeem a token (**NUT-03 swap**) | **Yes** | `receive(...)` |
| Mint ecash from Lightning (**NUT-04**) | **Yes** | `mintProofsBolt11(...)` |
| **Pay an invoice (**NUT-05 melt**)** | **Yes — unavoidably** | `createMeltQuoteBolt11` + `meltProofsBolt11` |
| Restore (**NUT-09**) | **Yes** | `batchRestore(...)` |
| Live quote updates (**NUT-17**) | **Yes** (WebSocket) | `Mint.connectWebSocket()`, `wallet.on.*` |

**The honest summary:** a Cashu wallet can *hold, count and even offline-spend* without the
mint, but **melt — paying the BOLT11 — is a mint round-trip by construction.** The mint is the
one doing the Lightning payment on our behalf. So an "offline auto-pay" cannot exist. What
*can* be offline is everything up to the quote: pre-compute the exact proof set with
`offlineExactOnly`, cache `MintInfo`, and have the melt request be the single network
operation that fires when connectivity returns.

### 6.2 Service-worker specifics

- **Do not put the wallet in the service worker.** The proofs live in IndexedDB; a SW has its
  own global scope and lifecycle, and cashu-ts drives `fetch`/WebSocket with stateful
  `KeyChain`/counter objects. Keep the wallet in the page/app scope; the SW is for precache
  and navigation fallback only — which is exactly how cashu.me uses it.
- **cashu.me's service worker does no wallet work at all.** `src-pwa/custom-service-worker.js`
  is workbox boilerplate (`precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`,
  a `NavigationRoute` fallback) and is only picked up when `workboxMode` is
  `injectManifest` — and `quasar.config.js:169` sets **`workboxMode: "generateSW"`**, so that
  custom SW file is **dead code in the default build**. It is a good template and nothing more.
- The PWA manifest is used for intent routing, not storage:
  `src-pwa/manifest.json` declares `protocol_handlers` for **`web+cashu`** → `/?token=%s` and
  **`web+lightning`** → `/?lightning=%s`. Useful for a captive portal (deep-link an invoice
  straight into the pay flow).
- **Storage in a captive portal is the weak point, not the SW.** IndexedDB is per-origin; a
  captive portal served on a transient or per-session origin will not keep a wallet across
  sessions. And SW registration itself requires a secure context — an HTTPS captive portal
  qualifies, an HTTP interception page does not. If the portal is served before HTTPS
  authorisation, `navigator.serviceWorker` will be unavailable and the PWA will not install
  at all.

### 6.3 Vite / bundling notes (measured)

- **ESM-only.** cashu-ts v4 dropped CJS: *"CommonJS `require()` is no longer supported"*
  (`README.md:21`). If any part of the build (a SW bundle, an old tool) emits CJS, it will not
  resolve.
- **A standalone build exists for non-bundlers** but is *not* on npm: *"The standalone bundle
  is published as part of GitHub Releases rather than the npm [package]"* (`README.md:71`).
  For a Vite build, import the ESM entry: `exports['.'].import = './lib/cashu-ts.es.js'`.
- **Bundle size:** `lib/cashu-ts.es.js` is **216,755 bytes** for 4.9.0 (minified-ish ESM, no
  gzip measured here). No `Buffer` shim needed — the ESM build references `Buffer` **4**
  times and ships without a `buffer` polyfill dependency; cashu.me's `quasar.config.js`
  carries no node-polyfill plugin. `@noble/*` + `@scure/*` are pure-JS and browser-clean.
- **The known `Buffer` trap is on the *consumer* side, not the library**: cashu.me's
  `wallet.ts:94-96` has a commented-out `window.Buffer = Buffer` block, i.e. someone once
  needed it and the need was removed rather than kept. If BIP-39 tooling (`@scure/bip39`)
  is pulled in alongside, verify no transitive `buffer` requirement survives into the SW
  bundle.
- **Service-worker bundling itself:** no cashu-ts issue found that reports SW packaging
  breakage. I searched the cashu-ts issue/PR tracker —
  `repo:cashubtc/cashu-ts service worker` → **2 hits, both Dependabot `vitest` bumps, neither
  relevant**; `repo:cashubtc/cashu-ts worker` → 14 hits, all dependency bumps plus
  `fix(transport): stop pool claims after a failure` (#798) and `perf(wallet): run state-check
  batches through a bounded request pool` (#789), which are *runtime-level* concurrency fixes,
  not bundler problems. So: **no known cashu-ts/SW or cashu-ts/Vite incompatibility to
  inherit.** The absence of issues is the finding; do not over-read it as a guarantee.
- **Node engine floor** is `>=22.4.0` for *building/testing* cashu-ts itself; irrelevant to
  consuming it in a browser.

---

## 7. Prior art we should NOT rebuild

### 7.1 "Auto-pay an invoice from ecash" — this is the wrong abstraction to shop for

**No mature, general-purpose "auto-pay arbitrary BOLT11 from ecash" library exists**, and that
is unsurprising: paying an invoice with ecash is a ~15-line sequence with 4 library calls
(§5.1). The packages that describe themselves this way are **scoped to a specific rail**:

| Package | Version | Licence | What it actually is | Rebuild? |
| --- | --- | --- | --- | --- |
| **`@cashu/coco-core`** | 2.0.0 | **no licence field in npm metadata** (repo `cashubtc/coco` reports **MIT**) | Modular, storage-agnostic wallet **core** — proof management, mint sync, quote lifecycle, **counter tracking**, typed event bus, plugin system. Adapters: `@cashu/coco-indexeddb` ("IndexedDB storage adapter for Coco in **browser and worker environments**"), `@cashu/coco-sqlite`, `@cashu/coco-expo-sqlite`, `@cashu/coco-react` (React hooks). Deps: `@cashu/cashu-ts`, `@noble/*`, `@scure/bip32`. Repo pushed 2026-10-09. | **Adopt, don't rebuild** — this is the closest thing to a "wallet-as-a-service core", and it already solves the boring 80% (counters, quote lifecycle, state). ⚠ Its browser adapter is **`@cashu/coco-indexeddb`**, i.e. it targets web workers/IndexedDB — verify it runs in a *service worker* specifically before betting on it. |
| `@te-btc/agent-wallet` | 0.1.0 | MIT | "Agent-native Cashu wallet — budget enforcement, proof storage, **L402 auto-pay**". Deps include `better-sqlite3` → **Node-only, not a PWA dependency**. | Read as design prior art for **budget enforcement** (which is our threshold idea). Do not depend on it. |
| `botwallets` | 0.3.0 | MIT | "Bitcoin ecash wallets for bots — simple Cashu wallet API". `better-sqlite3` → Node. | Prior art only. |
| `402-mcp` | 4.4.0 | MIT | "L402 client MCP: agents discover, pay for and consume Lightning and ecash". | Prior art for the L402 shape. |
| `@gandlaf21/cashu-wallet-engine` | 0.1.1 | **none declared** | "a cashu wallet engine that can be used in the browser". | **No licence → do not embed.** |
| `@cashu/crypto` | 0.3.4 | MIT | "Basic cashu crypto functions" — the primitives layer under cashu-ts. | Redundant; cashu-ts covers it. |
| `@linky-fit/linkshu` | 0.5.0 | 0BSD | "Typed Cashu wallet services with pluggable storage, built on Effect." | Alternative core; Effect-shaped, heavier. |
| `hyperwave-wallet-cashu` | 0.4.0 | Apache-2.0 | Cashu wallet over bare-runtime modules (`bare-crypto`, `bare-fetch`) — **not a browser target**. | No. |
| `@nostr-dev-kit/ndk-wallet` | 0.7.1 | MIT | NDK's wallet (NWC + Cashu bridges). | Only if we also need Nostr wallet-connect. |
| `@getalby/lightning-tools` | 9.0.1 | MIT | LNURL / Lightning-address helpers, zero deps. | Adopt if we need LNURL resolve (see §7.3). |

**Verdict:** build the auto-pay loop ourselves against cashu-ts (it is genuinely small, §5),
and consider `@cashu/coco-core` + `@cashu/coco-indexeddb` as the persistence/counter layer if
we want someone else to own the counter-lifecycle correctness — which is the part that is
easy to get subtly wrong and expensive to get wrong (proof loss).

### 7.2 "LNURL-cash" / LDK-LSP-style: what exists

The brief asked about `LUD-25`. **There is no LUD-25.** Verified two ways:

- The LNURL spec repo's own document list (`github.com/lnurl/luds/contents/`) contains
  `01.md … 21.md, 23.md` — **it stops at LUD-23**; there is no `22.md` and no `24/25`.
- `github.com/lnurl/luds/README.md` (fetched live) is now a **deprecation stub**: *"This spec
  is deprecated, it has been translated in a bunch of standalone documents describing each
  specific super-small self-contained LNURL standard at
  https://github.com/fiatjaf/lnurl-rfc/tree/luds."*

So any "LUD-25" reference is either a misnumbering (very likely **LUD-25 does not exist;
LUD-23 is the last**, and the "cashu over LNURL" idea lives in the **NUT** series and in
**npub.cash**, not in LUD) or refers to a non-canonical numbering. Treat a spec citation of
"LUD-25" as unverified until someone produces the URL.

What actually exists in this space, and is worth using:

- **npub.cash** — a Lightning address backed by Cashu, keyed on a Nostr pubkey. cashu.me
  integrates it as a store (`src/stores/npubcash.ts`, 775 lines) and exposes it in settings
  (`src/pages/settings/LightningAddressSettings.vue`, `npub.cash hostname` field); helpers in
  `src/js/lnurl.ts` build `https://npub.cash/.well-known/lnurlp/<name>`. This is the
  "Lightning address → ecash" rail.
- **`npubcash-sdk`** (npm `0.3.2`, **no licence field — do not embed**) and
  **`coco-cashu-plugin-npc`** (`3.0.0`, MIT, repo `Egge21M/coco-cashu-plugin-npc` — "bridges
  NPubCash server with coco wallet"): the plugin is the licensed way to use that rail.
- **`lnurl-pay`** (`5.0.2`, MIT) / **`lnurl`** (`0.27.0`, MIT) / `js-lnurl` (**no licence**) —
  LNURL-pay client helpers, if the portal wants to resolve a Lightning address. Note
  `lnurl-pay`'s dep list is ugly (`assert`, `axios`, `base64-js`, `aes-js`) — `@getalby/lightning-tools`
  is the cleaner choice at zero deps.

**Verdict:** for *auto-paying a BOLT11 the portal already holds*, npub.cash / LNURL is
irrelevant — it is a *receiving* rail. Do not add it. Only reach for LNURL if the portal
wants to pay to a Lightning address rather than an invoice.

### 7.3 What we must NOT rebuild

1. **BDHKE / crypto primitives.** Do not hand-roll. Use cashu-ts (or `@cashu/crypto`).
   A from-scratch implementation is only justified with no library dep at all (e.g. a Deno
   service) and even then only by mirroring `@cashu/crypto`'s source exactly.
2. **Counter lifecycle + restore.** This is the subtle, expensive-to-get-wrong part.
   `@cashu/coco-core` exists specifically to own it. If we hand-roll, we must implement:
   per-keyset counter persistence on `countersReserved`, gap-limit restore via
   `batchRestore(gapLimit, batchSize, counter, keysetId)`, and counter advancement past
   `lastCounterWithSignature` (`src/stores/restore.ts:132-143` shows why: sparse restored
   proofs would otherwise collide).
3. **Token serialisation.** `getEncodedToken` / `getDecodedToken`. If we ever hand a token to
   a cdk-cli-backed service, note the measured reality that cashu-ts V4 CBOR tokens are
   rejected by cdk-cli-backed consumers while Nutshell-CLI JSON V4 tokens are accepted — a
   serializer incompatibility, not a bug in either. Only relevant if we *gift* tokens.
4. **The unlock/backup UX.** cashu.me's hidden-then-confirm pattern is the reference; don't
   invent a new one.

---

## 8. Licensing — is embedding this in a GPL-3.0 project compatible?

**Reference point:** GPL-3.0 is compatible with MIT/BSD/Apache-2.0. (Apache-2.0 is
GPL-3.0-compatible but **not** GPL-2.0-compatible — relevant only if the target is GPL-2.0,
not GPL-3.0.) The practical requirement for all of the below is the normal one: **preserve the
copyright notice and licence text** in the distribution.

| Dependency | Version | Licence (measured) | Embed in GPL-3.0? | Notes |
| --- | --- | --- | --- | --- |
| `@cashu/cashu-ts` | 4.9.0 / 4.11.0 | **`MIT OR Apache-2.0`** (npm metadata; repo `LICENSE.md` = "Apache 2.0 **or** MIT, at your option") | **✅ Yes** | Pick either branch; MIT is the simpler one. Repo licence adds "Some files retain their own copyright notice" — keep upstream notices. Note the `package.json` has **no `license` field** on cashu.me itself (repo `LICENSE.md` is MIT) — a packaging gap, not a licence conflict. |
| `@scure/bip39`, `@noble/curves`, `@noble/hashes`, `@scure/base`, `@scure/bip32` | as pulled | MIT (permissive, pure-JS) | **✅ Yes** | Transitive deps of cashu-ts; audit-friendly, no native code. |
| `@cashu/coco-core` | 2.0.0 | **npm metadata has no licence field**; GitHub `cashubtc/coco` reports **MIT** | **✅ Yes, with a caveat** | The *repo* is MIT; npm metadata omits it. Record the repo's LICENSE file in our SBOM, not the npm field. |
| `@cashu/coco-indexeddb` | 2.0.0 | same as core | **✅ Yes, same caveat** | Needed if we adopt coco for browser persistence. |
| `coco-cashu-plugin-npc` | 3.0.0 | **MIT** | **✅ Yes** | npm GitHub metadata reports `license: null` for the repo, but the package declares MIT. Only needed for the npub.cash rail. |
| `lnurl-pay` | 5.0.2 | MIT | ✅ Yes | Heavier dep tree than needed. |
| `lnurl` | 0.27.0 | MIT | ✅ Yes | |
| `@getalby/lightning-tools` | 9.0.1 | MIT | ✅ Yes | Zero-dependency LNURL/Lightning-address helper; prefer over `lnurl-pay`. |
| `@nostr-dev-kit/ndk-wallet` | 0.7.1 | MIT | ✅ Yes | Only if a Nostr wallet integration is in scope. |
| cashu.me source (if we copy code, not just depend) | `e21f5fa` | **MIT** (`LICENSE.md`, © 2023 Cashu) | **✅ Yes** | Copying patterns/code from cashu.me into a GPL-3.0 project is fine **provided we retain its MIT notice**. |
| `@gandlaf21/cashu-wallet-engine` | 0.1.1 | **none declared, no repo** | **❌ No** | No licence = all rights reserved by default. **Do not depend on or copy.** |
| `npubcash-sdk` | 0.3.2 | **none declared, no repo** | **❌ No** | Same. Reach npub.cash through `coco-cashu-plugin-npc` (MIT) instead. |
| `@te-btc/agent-wallet`, `botwallets`, `402-mcp`, `hyperwave-wallet-cashu`, `@linky-fit/linkshu` | see §7.1 | MIT / Apache-2.0 / 0BSD / none | Mostly ✅ on licence, ❌ on **fit** | `better-sqlite3` and `bare-*` deps make them Node/non-browser. Licence is not the blocker; the runtime is. `botwallets` and `402-mcp` are MIT and fine if ever needed. |
| `ecash-lib` / `ecash-wallet` (Bitcoin Cash eCash) | 4.14.4 / 6.2.4 | MIT | **N/A — wrong technology** | **Trap:** "ecash" here means Bitcoin Cash's `eCash` chain (cashaddr), *not* Chaumian Cashu. Do not confuse them. |

**Licence traps to record in the SBOM:**

1. **Absent licence ≠ permissive.** `@gandlaf21/cashu-wallet-engine` and `npubcash-sdk` look
   like the right shape and have **no licence at all**. GPL-3.0 projects cannot embed them.
2. **npm metadata and repo files disagree in both directions** here: cashu-ts declares
   `MIT OR Apache-2.0` on npm and has a proper `LICENSE.md`; coco's *repo* is MIT but its
   *npm* metadata has no licence; coco-cashu-plugin-npc is MIT on npm but `null` on GitHub.
   **Resolve each dependency from its repo LICENSE file, not from the registry field.**
3. **Nothing here is copyleft-incompatible.** The whole candidate set is MIT/Apache-2.0/
   0BSD/ISC. There is no GPL-3.0 conflict to design around — the constraint is the reverse
   (a GPL-3.0 project must not *silently* absorb unlicensed code).

---

## 9. Risk register (top risks, ranked)

1. **Silent, total loss of held ecash when the device/profile is lost or evicted before the
   mnemonic is surfaced.** Mechanism: plaintext seed in `localStorage["cashu.mnemonic"]` +
   plaintext proofs in IndexedDB `db.proofs`; ecash is bearer; iOS ITP / "clear site data" /
   private-window exit destroys it with no recovery path. §4.3. Mitigation: bound the exposure
   (`T` sats), prefer exactly-on-demand melt with zero resting balance, test the cleared-data
   path deliberately.
2. **Recovery is broken in practice even when the user later has the seed, because the
   counters or the mint list were not persisted.** NUT-13 needs a **per-keyset** counter and
   NUT-09 needs the **mint URL**; and only `deterministic` outputs are recoverable at all, so a
   single random-secret output path silently produces unrecovable value. §4.2. Mitigation:
   `secretsPolicy: 'deterministic'` as a build-time invariant, persist
   `{seed, countersByKeyset, mintUrls}` from proof #1, `countersReserved` → atomic upsert,
   **never NUT-20 locked quotes in the top-up loop**.
3. **Auto-pay correctness under interruption: double-spend, stranded proofs, or donated fee
   reserve.** A melt can be interrupted after the swap but before completion; `MeltQuoteState.PENDING`
   is a first-class state that must never be read as success; an async melt returns before
   payment and without NUT-08 change, so ignoring `preview.outputData` gives the reserve to
   the mint; and cashu.me's own local "invoice already paid" guard is a client-side string
   match that will *both* wrongly block legitimate repeat payments and fail to prevent the
   real proof-layer double-spend. §5.4. Mitigation: two-step `prepareMelt`/`completeMelt` with
   the preview persisted, local proof reservation (`setReserved`), success **only** on
   `PAID`, NUT-07 `checkProofsStates` as the idempotency authority.

**Two more worth a line each:** cashu.me is **Vue/Quasar, not React** — the brief's
stack assumption is wrong and any "port the React wallet" plan starts from a false premise.
And **`walle.cashu.me` is not verifiable from here** (self-signed cert, 404 at `/`), so
"imitate walle.cashu.me" is currently an unvalidated requirement.

---

## Appendix A — Key file:line index

**cashu.me @ `e21f5fab875b67de0fc5367a79710054d2c1f80f`**

| Concern | Location |
| --- | --- |
| Seed in plaintext localStorage | `src/stores/wallet.ts:224` (`useLocalStorage("cashu.mnemonic", "")`) |
| Seed → BIP-39 | `src/stores/wallet.ts:293-297`, `:460-462` |
| Silent mnemonic generation | `src/stores/wallet.ts:416-418`, `:1748-1753`, `:463-471` |
| Wallet construction w/ `bip39seed` + `counterSource` | `src/stores/wallet.ts:410-425` |
| `countersReserved` → persistence hook | `src/stores/wallet.ts:426-428`, `:404-409` |
| Counter source (ephemeral, shared) | `src/stores/wallet.ts:384-391` |
| Swap-with-fees send path | `src/stores/wallet.ts:717-748` (`.includeFees(includeFees)`) |
| Melt execution (`meltGeneric`) | `src/stores/walletMelt.ts:148-249` (reserve at `:161`) |
| Melt quote (BOLT11) | `src/stores/walletBolt11.ts:221-237` |
| Suspect local "already paid" guard | `src/stores/walletBolt11.ts:252-260` |
| Mint via `ops.mintBolt11().asDeterministic()` | `src/stores/walletBolt11.ts:154-164` |
| NUT-20 locked-quote handling | `src/stores/walletBolt11.ts:56-67` |
| Dexie schema / migrations | `src/stores/dexie.ts:19-80` |
| Proof CRUD + reservation | `src/stores/proofs.ts:82-151` |
| Restore via `batchRestore` + NUT-07 + counter advance | `src/stores/restore.ts:73-143` |
| Backup export (plaintext) | `src/stores/storage.ts:104-148` |
| Onboarding state machine | `src/stores/welcome.ts` |
| Seed-display slide (hidden by default, confirm checkbox) | `src/pages/welcome/WelcomeSlide3.vue` |
| Mandatory-step gate | `src/stores/welcome.ts:66-69`; `test/e2e/pages/WalletPage.ts:34-35` |
| Service worker (dead code: `workboxMode: generateSW`) | `src-pwa/custom-service-worker.js`, `quasar.config.js:169` |
| PWA protocol handlers | `src-pwa/manifest.json` |
| npub.cash rail | `src/stores/npubcash.ts`, `src/js/lnurl.ts`, `src/pages/settings/LightningAddressSettings.vue` |
| Nostr mint-list backup | `src/stores/nostrMintBackup.ts` |

**cashu-ts @ `145d2426d5071f2c321a6ec1171a5ce1c1ea0466` (dev branch = 5.0.0-rc.11)**

| Concern | Location |
| --- | --- |
| NUT-13 derivation API | `docs-src/usage/derive_keys.md`, `src/…`; symbol `deriveSecretAndBlindingFactor` |
| Counter persistence contract | `docs-src/deterministic_counters.md` |
| Restore flow (+ the phantom `restoreAll`) | `docs-src/usage/restore_proofs.md` |
| Melt recipes / fee reserve / NUT-19 replay safety | `docs-src/usage/melt_token.md`, `docs-src/wallet_ops/melt.md` |
| Mint capability inspection / offline `MintInfo` | `docs-src/usage/mint_capabilities.md` |
| Fee helpers table | `docs-src/usage/fees.md` |
| ESM-only + standalone-bundle policy | `README.md:21`, `README.md:71` |
| Preimage-vs-payment-hash fix | `CHANGELOG.md` → 5.0.0-rc.11, `fix(mint): check a bolt11 melt preimage against the invoice payment hash (#1161)` |

**Measured NUT coverage + symbol names:** `~/repos/npm-cashu-ts/v4.9.0/package/lib/types/index.d.ts`
and `.../etc/cashu-ts.api.md` (`Wallet` @ `api.md:2093`, `Mint` @ `api.md:897`,
`MintBuilder` @ `:982`, `WalletOps` @ `:2272`, `SendBuilder`/`MeltBuilder` in `api.md`).

## Appendix B — External references read live during this recon

- NUT specs (raw): `https://raw.githubusercontent.com/cashubtc/nuts/main/{00…13,20}.md` —
  NUT-13 read in full; NUT-02/03/05/06/07/08/09 headers read. Mandatory-vs-optional flags
  recorded: NUT-00/02/03/04/05/06 mandatory; NUT-07/08/09/13 optional.
- LNURL LUD directory: `https://api.github.com/repos/lnurl/luds/contents/` → `01.md … 23.md`
  (**no 24, no 25**); `https://raw.githubusercontent.com/lnurl/luds/master/README.md` →
  deprecation stub pointing at `github.com/fiatjaf/lnurl-rfc/tree/luds`.
- npm registry packuments: `@cashu/cashu-ts` (167 versions; dist-tags
  `{latest: 4.11.0, next: 5.0.0-rc.11, v3-lts: 3.7.2}`), `@cashu/coco-*`, `@te-btc/agent-wallet`,
  `botwallets`, `402-mcp`, `@gandlaf21/cashu-wallet-engine`, `coco-cashu-plugin-npc`,
  `npubcash-sdk`, `@linky-fit/linkshu`, `hyperwave-wallet-cashu`, `@nostr-dev-kit/ndk-wallet`,
  `@getalby/lightning-tools`, `lnurl-pay`, `lnurl`, `@cashu/crypto`, `beignet`, `ecash-wallet`,
  `ecash-lib`.
- GitHub API: `cashubtc/coco` (MIT, default branch `master`, pushed 2026-10-09);
  `Egge21M/coco-cashu-plugin-npc`; issue searches on `cashubtc/cashu-ts` for
  `service worker` / `worker` / `vite` / `bundle`.
- `https://walle.cashu.me` — **unreachable as a web app** (self-signed cert; 404 at `/` with
  `content-type: text/plain`). `https://cashu.me` — HTTP 200.
