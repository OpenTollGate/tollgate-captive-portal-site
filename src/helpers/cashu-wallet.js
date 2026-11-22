// helpers/cashu-wallet.js
//
// The CLIENT-side Cashu wallet for the captive-portal PWA: a resting balance
// bought in granules and spent by automatic BOLT11 melt.
//
// This module is CONVENIENCE, NOT CUSTODY. A bearer wallet in a browser over a
// captive network is a theft/durability target (XSS, shared device, storage
// eviction); the loss-bounding mechanism is the granule size and the `T` cap
// (docs/architecture/pwa-client-wallet-adr-delta.md §2 D1, §5.4), NOT this
// file. Nothing here should ever be described to a user as "your money is safe".
//
// ── The invariants this file exists to enforce (each one has a test) ─────────
//
// 1. DETERMINISTIC SECRETS FROM THE FIRST PROOF. `secretsPolicy` is pinned to
//    'deterministic' in `createWallet` and there is no option to change it
//    (§5.4 item 5). A single random-secret output makes that value
//    unrecoverable forever, so it is a build-time invariant, not a runtime knob.
//
// 2. COUNTERS ARE PERSISTED BEFORE THE MINT SEES THEM. `wallet.on.countersReserved`
//    fires synchronously after reservation and before the enclosing wallet
//    method returns; the handler must have written `start + count` to storage
//    BEFORE the exposing network call completes. This is why the counter store
//    is written through a serialised queue and the wallet is never used with
//    the library's in-memory ephemeral default (§5.4 item 5, error 10002).
//
// 3. THE MELT IS REPLAY-SAFE. `prepareMelt` -> persist the serialised preview ->
//    `completeMelt`. Never the one-shot `meltProofsBolt11` in an auto-pay loop:
//    a tab close or a network drop mid-melt would otherwise leave the wallet
//    unable to tell "not paid" from "paid but we lost the change" (§5.2 of the
//    wallet-libs dossier, cashu.me walletMelt.ts:148).
//
// 4. SUCCESS IS `PAID`, AND NOTHING ELSE. `MeltQuoteState.PENDING` is a
//    first-class state and MUST NEVER be read as success — a pending melt is an
//    unknown, and the only authority on it is the mint (§5.4).
//
// 5. NO NUT-20 LOCKED QUOTES anywhere in the top-up loop. Quote-lock keys are
//    not seed-recoverable, so a stranded locked quote is unrecoverable value.
//    `mintQuote` refuses a `pubkey` option outright rather than documenting it.
//
// 6. NOTHING CARRIES ACROSS AN ADDRESS ROTATION (D1/R1). The store is keyed by
//    the portal origin + gateway identity; `openWallet` on a different gateway
//    simply does not find the previous wallet, and the client buys again. There
//    is no rebind path here on purpose.

import {
  Amount,
  MeltQuoteState,
  OutputData,
  Wallet,
  createEphemeralCounterSource,
  deserializeProofs,
  getEncodedToken,
  normalizeProofAmounts,
  serializeProofs,
  sumProofs,
} from '@cashu/cashu-ts';

import {
  createRecoveryRecord,
  generateSeedPhrase,
  openSecretStore,
} from './wallet-secret-store.js';

// ── typed refusals ──────────────────────────────────────────────────────────

export const WERR = Object.freeze({
  NO_WALLET: 'E_NO_WALLET',
  NO_PROOF_STORE: 'E_NO_PROOF_STORE',
  BAD_SEED: 'E_BAD_SEED',
  BAD_GRANULE: 'E_BAD_GRANULE',
  NUT20_FORBIDDEN: 'E_NUT20_FORBIDDEN',
  MELT_NOT_PAID: 'E_MELT_NOT_PAID',
  MELT_UNKNOWN: 'E_MELT_UNKNOWN',
  INSUFFICIENT: 'E_INSUFFICIENT',
  MINT_UNREACHABLE: 'E_MINT_UNREACHABLE',
  DOUBLE_SPEND_GUARD: 'E_RESERVED',
});

export class WalletError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'WalletError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ── policy (the D1/D4 knobs, expressed once) ────────────────────────────────

// The granule is the LOSS UNIT: a rotation mid-flight forfeits at most one
// granule (§2.2). `T` is the cap on the resting balance and is expressed as a
// small multiple of the granule so the two knobs move together (§5.4 item 2).
export const DEFAULT_POLICY = Object.freeze({
  granuleSats: 10,
  restingCapMultiples: 8,
  // keep the resting balance at or above this many granules before topping up
  topUpBelowGranules: 2,
});

export const restingCapSats = (policy = DEFAULT_POLICY) =>
  Math.max(1, Math.floor(policy.granuleSats)) * Math.max(1, Math.floor(policy.restingCapMultiples));

/**
 * Validate a policy object. Refuses a zero/negative granule instead of guessing:
 * a zero granule means an unbounded loss unit, which is the exact thing D1 uses
 * the granule to prevent.
 */
export function validatePolicy(policy = {}) {
  const merged = { ...DEFAULT_POLICY, ...policy };
  for (const key of ['granuleSats', 'restingCapMultiples', 'topUpBelowGranules']) {
    const value = merged[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new WalletError(WERR.BAD_GRANULE, `${key} must be a positive integer, got ${value}`);
    }
  }
  return Object.freeze(merged);
}

/**
 * Should the client buy another granule right now?
 *
 * This is the whole client policy engine's decision surface: it is pure, it
 * takes the balance, and it never mutates. `mintHealthy` being false suppresses
 * the buy (a top-up against an unreachable mint burns the attempt budget).
 */
export function shouldTopUp({ balanceSats = 0, policy = DEFAULT_POLICY, mintHealthy = true, inFlight = false } = {}) {
  if (!mintHealthy || inFlight) return false;
  const p = validatePolicy(policy);
  const floor = p.topUpBelowGranules * p.granuleSats;
  return balanceSats < floor && balanceSats < restingCapSats(p);
}

// ── the counter store (§5.4 item 5) ─────────────────────────────────────────

/**
 * A durable, per-keyset counter source backed by a plain async read/write pair.
 *
 * cashu-ts fires `on.countersReserved` synchronously and does NOT await the
 * handler, so two reservations can overlap. This queue serialises the writes and
 * makes each one an atomic upsert of `start + count` (never a decrement, never a
 * read-modify-write that could move the cursor backwards).
 *
 * `todo`: it implements the `CounterSource` interface itself, so it can be
 * handed to the wallet as `counterSource` — the library then reserves through
 * THIS object rather than an in-memory ephemeral source.
 */
export function createDurableCounterSource({ read, write, initial = {} } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new WalletError(WERR.NO_PROOF_STORE, 'a counter source needs both read() and write()');
  }
  let cursor = { ...initial };
  let queue = Promise.resolve();

  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    // keep the chain alive but never let a rejection poison it
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const persist = (keysetId, next) =>
    enqueue(async () => {
      if (typeof next === 'number' && Number.isFinite(next)) {
        if (cursor[keysetId] === undefined || next > cursor[keysetId]) cursor[keysetId] = next;
      }
      await write(keysetId, cursor[keysetId] ?? 0);
      return cursor[keysetId] ?? 0;
    });

  const source = {
    /** Reserve `n` counters; n === 0 is a read-only peek per the v4 contract. */
    async reserve(keysetId, n) {
      const count = Math.max(0, Math.floor(n || 0));
      const start = cursor[keysetId] ?? 0;
      if (count === 0) return { start, count: 0 };
      const next = start + count;
      // Write BEFORE returning: the caller is about to hand [start, next) to the mint.
      await persist(keysetId, next);
      return { start, count };
    },
    async advanceToAtLeast(keysetId, minNext) {
      const current = cursor[keysetId] ?? 0;
      await persist(keysetId, Math.max(current, Math.floor(minNext)));
    },
    async setNext(keysetId, next) {
      await enqueue(async () => {
        cursor[keysetId] = Math.floor(next);
        await write(keysetId, cursor[keysetId]);
      });
    },
    async snapshot() {
      return { ...cursor };
    },
  };
  return source;
}

// ── the proof store (reservation-aware) ─────────────────────────────────────

/**
 * In-memory proof set with an explicit RESERVED partition.
 *
 * The lesson from cashu.me (`proofStore.setReserved(sendProofs, true, quote)`) is
 * that in-flight proofs must be removed from the spendable set BEFORE the melt
 * request goes out, or a second top-up can pick the same proofs and the mint
 * rejects one of them — or worse, both are consumed and one is a real
 * double-spend attempt. Reservation is local state; `settle`/`release` clear it.
 *
 * The store is deliberately storage-agnostic: `toJSON`/`fromJSON` round-trip
 * through `serializeProofs`, and the caller owns the IndexedDB write.
 */
export function createProofStore(initial = []) {
  let proofs = [];
  let reserved = new Map(); // secret -> { proof, reason }

  const key = (p) => String(p.secret);
  const setAll = (list) => {
    proofs = normalizeProofAmounts(list || []);
    for (const k of [...reserved.keys()]) {
      if (!proofs.some((p) => key(p) === k)) reserved.delete(k);
    }
  };
  setAll(initial);

  return {
    /** Spendable (unreserved) proofs. */
    spendable() {
      return proofs.filter((p) => !reserved.has(key(p)));
    },
    all() {
      return proofs.slice();
    },
    reservedProofs() {
      return [...reserved.values()].map((r) => r.proof);
    },
    balanceSats() {
      return sumProofs(proofs).toNumber();
    },
    spendableSats() {
      return sumProofs(this.spendable()).toNumber();
    },
    /** Atomically move proofs out of the spendable set. Refuses a partial match. */
    reserve(list, reason) {
      const secrets = (list || []).map(key);
      const missing = secrets.filter((s) => !proofs.some((p) => key(p) === s));
      if (missing.length) {
        throw new WalletError(WERR.DOUBLE_SPEND_GUARD, 'cannot reserve proofs the store does not hold', {
          missing,
        });
      }
      for (const secret of secrets) {
        if (reserved.has(secret)) {
          throw new WalletError(WERR.DOUBLE_SPEND_GUARD, 'proofs are already reserved', { secret, reason });
        }
      }
      for (const p of proofs) {
        if (secrets.includes(key(p))) reserved.set(key(p), { proof: p, reason });
      }
      return list;
    },
    /** Reserved proofs are SPENT: drop them from the store entirely. */
    settle(list) {
      const secrets = new Set((list || []).map(key));
      for (const s of secrets) reserved.delete(s);
      proofs = proofs.filter((p) => !secrets.has(key(p)));
    },
    /** Reserved proofs were NOT spent: make them spendable again. */
    release(list) {
      for (const s of (list || []).map(key)) reserved.delete(s);
    },
    /** Add proofs (change, minted outputs), ignoring exact duplicates by secret. */
    add(list) {
      for (const p of normalizeProofAmounts(list || [])) {
        if (!proofs.some((existing) => key(existing) === key(p))) proofs.push(p);
      }
    },
    toJSON() {
      return { proofs: serializeProofs(proofs), reserved: [...reserved.keys()] };
    },
    fromJSON(snapshot) {
      setAll(deserializeProofs(snapshot?.proofs || []));
      for (const secret of snapshot?.reserved || []) {
        const proof = proofs.find((p) => key(p) === secret);
        if (proof) reserved.set(secret, { proof, reason: 'restored' });
      }
      return this;
    },
    encodeToken(mintUrl, unit = 'sat') {
      return getEncodedToken({ mint: mintUrl, proofs: this.spendable(), unit }, { removeDleq: false });
    },
  };
}

// ── the wallet ──────────────────────────────────────────────────────────────

const mnemonicToSeedBytes = async (seedPhrase) => {
  const { mnemonicToSeedSync } = await import('@scure/bip39');
  return mnemonicToSeedSync(seedPhrase.trim().replace(/\s+/g, ' '));
};

/**
 * Create a wallet bound to a mint.
 *
 * `secretsPolicy` and the counter source are NOT options: the first is a
 * build-time invariant and the second must be durable. A caller that wants a
 * different wallet does not get one from this function.
 */
export async function createWallet({ mintUrl, seedPhrase, counterSource, keysetId, logger } = {}) {
  if (typeof mintUrl !== 'string' || !/^https?:\/\//i.test(mintUrl)) {
    throw new WalletError(WERR.NO_WALLET, `not an http(s) mint URL: ${mintUrl}`);
  }
  if (typeof seedPhrase !== 'string' || seedPhrase.trim().length === 0) {
    throw new WalletError(WERR.BAD_SEED, 'a seed phrase is required: deterministic secrets need one');
  }
  if (!counterSource || typeof counterSource.reserve !== 'function') {
    throw new WalletError(
      WERR.NO_PROOF_STORE,
      'a durable counter source is required — the in-memory default re-derives used output counters after a reload, which a mint rejects'
    );
  }
  const bip39seed = await mnemonicToSeedBytes(seedPhrase);

  const wallet = new Wallet(mintUrl, {
    unit: 'sat',
    bip39seed,
    // THE invariant: never 'auto' (which may pick random), never 'random'.
    secretsPolicy: 'deterministic',
    counterSource,
    ...(keysetId ? { keysetId } : {}),
    ...(logger ? { logger } : {}),
  });
  await wallet.loadMint();
  return wallet;
}

/**
 * Open (or create) the device-local wallet for one gateway origin.
 *
 * The recovery triple is persisted from proof #1 (§5.4 item 5): a seed alone is
 * half a backup, and a seed without counters restores to colliding outputs that
 * the mint refuses. `mintUrls` is persisted with it because NUT-09 has to ask a
 * specific mint to replay signatures.
 *
 * `originKey` is the rotation boundary: pass the gateway identity (origin/host),
 * so a different router simply yields a fresh wallet. NOTHING is carried across.
 */
export async function openWallet({ originKey, mintUrl, secretStore, counterSource, proofs, logger } = {}) {
  const store = secretStore || (await openSecretStore());
  let record = await store.load();

  if (!record) {
    // Seed-phrase-less onboarding: the mnemonic is generated silently on demand
    // and never shown. There is deliberately no reveal step here — the reveal is
    // the threshold moment (§5.5), owned by the UI, not by the wallet.
    const seed = generateSeedPhrase();
    // Counters cannot be invented: NUT-13 needs a per-keyset cursor and the
    // keyset is only known once the mint is loaded, so the record is created
    // with the mint URL and the keyset's first cursor at wallet-open time.
    record = createRecoveryRecord({
      seed,
      countersByKeyset: { [originKey]: 0 },
      mintUrls: [mintUrl],
      keysetPolicy: 'deterministic',
    });
    await store.save(record);
  }

  const counters =
    counterSource ||
    createDurableCounterSource({
      initial: { ...record.countersByKeyset },
      read: async (keysetId) => (await store.load())?.countersByKeyset?.[keysetId] ?? 0,
      write: async (keysetId, next) => {
        const current = await store.load();
        if (!current) return;
        await store.save(
          createRecoveryRecord({
            seed: current.seed,
            countersByKeyset: { ...current.countersByKeyset, [keysetId]: next },
            mintUrls: current.mintUrls,
            keysetPolicy: 'deterministic',
          })
        );
      },
    });

  // Bump the persisted cursor whenever the library reserves counters. The
  // handler is fire-and-forget in cashu-ts, so it schedules the durable write and
  // swallows its own failures: an unhandled rejection here would be invisible.
  const wallet = await createWallet({ mintUrl, seedPhrase: record.seed, counterSource: counters, logger });
  wallet.on.countersReserved(({ keysetId, start, count }) => {
    counters.advanceToAtLeast(keysetId, start + count).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('countersReserved: could not persist the counter cursor', keysetId, error?.message);
    });
  });

  const proofStore = createProofStore(proofs || []);
  return { wallet, proofStore, record, secretStore: store, counterSource: counters };
}

/**
 * Buy a granule: ask the gateway for an invoice, pay it, then mint the ecash.
 *
 * NUT-20 IS REFUSED. A locked quote's key is not seed-recoverable, so a quote
 * stranded by a closed tab would be value the user can never claim. `pubkey` is
 * rejected by name here rather than silently ignored.
 */
export async function mintQuote({ wallet, amountSats, requestInvoice, pubkey } = {}) {
  if (pubkey !== undefined) {
    throw new WalletError(
      WERR.NUT20_FORBIDDEN,
      'NUT-20 locked mint quotes are forbidden in the top-up loop: the quote-lock key is not seed-recoverable'
    );
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    throw new WalletError(WERR.BAD_GRANULE, `amountSats must be a positive integer, got ${amountSats}`);
  }
  if (typeof requestInvoice !== 'function') {
    throw new WalletError(WERR.MINT_UNREACHABLE, 'a requestInvoice() callback is required to pay the quote');
  }
  const quote = await wallet.createMintQuoteBolt11({ amount: Amount.from(amountSats) });
  const payment = await requestInvoice(quote);
  if (!payment || payment.paid !== true) {
    // Not paid -> no proofs are minted, and the quote is simply abandoned.
    return { paid: false, quote, payment, proofs: [] };
  }
  const proofs = await wallet.mintProofsBolt11(quote, quote, {});
  return { paid: true, quote, payment, proofs };
}

// ── the replay-safe melt ────────────────────────────────────────────────────

/**
 * Serialise a prepared melt into a JSON-safe form we can persist before the
 * network call. `MeltPreview` itself holds bigints and Uint8Arrays.
 */
export function serializeMeltPreview(preview) {
  return {
    method: preview.method,
    quote: preview.quote.quote,
    quoteState: preview.quote.state,
    amount: String(preview.quote.amount),
    feeReserve: String(preview.quote.fee_reserve ?? 0),
    expiry: preview.quote.expiry ?? null,
    inputs: serializeProofs(preview.inputs),
    outputData: preview.outputData.map((o) => OutputData.serialize(o)),
  };
}

/**
 * The replay-safe two-step melt.
 *
 *   prepareMelt -> PERSIST the preview -> completeMelt
 *
 * Every exit path says exactly which of the three states the money is in:
 *   paid    the mint says PAID and we have the change
 *   unpaid  the mint says UNPAID and we released the proofs (they are still ours)
 *   unknown PENDING (or a transport failure) — the proofs stay RESERVED and the
 *           caller must resume from the persisted preview or ask the mint again.
 *
 * PENDING is never returned as paid. That is the whole point of the function.
 */
export async function meltToInvoice({
  wallet,
  proofStore,
  invoice,
  journal,
  config = {},
} = {}) {
  if (!wallet || !proofStore) {
    throw new WalletError(WERR.NO_WALLET, 'meltToInvoice needs a wallet and its proof store');
  }

  const quote = await wallet.createMeltQuoteBolt11(invoice);
  const needed = Amount.from(quote.amount).add(Amount.from(quote.fee_reserve ?? 0));
  const spendable = proofStore.spendable();
  const available = sumProofs(spendable);
  if (available.lessThan(needed)) {
    throw new WalletError(WERR.INSUFFICIENT, 'the wallet cannot cover this invoice plus its fee reserve', {
      needed: needed.toString(),
      available: available.toString(),
    });
  }

  // Size the inputs ourselves: prepareMelt does NOT do coin selection.
  const { send } = await wallet.send(needed, spendable, { includeFees: true, keep: undefined });
  if (!send || send.length === 0) {
    throw new WalletError(WERR.INSUFFICIENT, 'could not split proofs to cover the invoice');
  }

  // RESERVE BEFORE the mint sees the inputs, so a concurrent top-up cannot pick them.
  proofStore.reserve(send, quote.quote);

  const preview = await wallet.prepareMelt('bolt11', quote, send, { ...config, nut08Change: true });
  // PERSIST before completing: this is what makes a crash resumable.
  if (typeof journal?.save === 'function') {
    await journal.save({ quote: quote.quote, preview: serializeMeltPreview(preview) });
  }

  let response;
  try {
    response = await wallet.completeMelt(preview);
  } catch (error) {
    // The inputs may or may not have been spent. Keep them reserved and say so.
    return {
      outcome: 'unknown',
      state: 'UNKNOWN',
      quote,
      inputs: send,
      error,
      code: WERR.MELT_UNKNOWN,
    };
  }

  const state = response?.quote?.state;
  if (state === MeltQuoteState.PAID) {
    proofStore.settle(send);
    const change = response.change || [];
    if (change.length) proofStore.add(change);
    if (typeof journal?.clear === 'function') await journal.clear(quote.quote);
    return {
      outcome: 'paid',
      state,
      quote: response.quote,
      change,
      // real cost = what was sent minus what came back as NUT-08 change
      paidSats: sumProofs(send).subtract(sumProofs(change)).toNumber(),
    };
  }

  if (state === MeltQuoteState.UNPAID) {
    proofStore.release(send);
    if (typeof journal?.clear === 'function') await journal.clear(quote.quote);
    return { outcome: 'unpaid', state, quote: response?.quote || quote, inputs: send };
  }

  // PENDING (or anything unrecognised): NOT success.
  return {
    outcome: 'unknown',
    state: state ?? 'UNKNOWN',
    quote: response?.quote || quote,
    inputs: send,
    code: WERR.MELT_UNKNOWN,
  };
}

/**
 * Resume a melt that was interrupted after `prepareMelt`.
 *
 * The mint is the only authority on whether the invoice was paid, so this asks
 * `checkMeltQuoteBolt11` and then either recovers the change (NUT-08 blanks were
 * persisted with the preview) or releases the inputs.
 */
export async function resumeMelt({ wallet, proofStore, journal, quoteId } = {}) {
  const saved = await journal?.load?.(quoteId);
  if (!saved) return { outcome: 'absent' };

  const quote = await wallet.checkMeltQuoteBolt11(quoteId);
  const state = quote?.state;

  if (state === MeltQuoteState.PAID) {
    const outputs = (saved.preview.outputData || []).map((o) => OutputData.deserialize(o));
    const signatures = (quote.change || []).filter((s) => !Amount.from(s.amount).isZero());
    const change = signatures.length ? wallet.createMeltChangeProofs(outputs, signatures) : [];
    proofStore.settle(proofStore.reservedProofs());
    if (change.length) proofStore.add(change);
    await journal.clear(quoteId);
    return { outcome: 'paid', state, quote, change };
  }

  if (state === MeltQuoteState.UNPAID) {
    proofStore.release(proofStore.reservedProofs());
    await journal.clear(quoteId);
    return { outcome: 'unpaid', state, quote };
  }

  // Still PENDING: keep everything reserved and report honestly.
  return { outcome: 'unknown', state: state ?? 'UNKNOWN', quote };
}

/**
 * The journal that makes the melt resumable across a page reload (L0 of §6.6.4:
 * "resumable journal + top-up on next open is MANDATORY and must be sufficient
 * alone"). Storage-agnostic: `read`/`write`/`remove` are injected.
 */
export function createMeltJournal({ read, write, remove } = {}) {
  return {
    async save(entry) {
      await write(entry.quote, entry);
    },
    async load(quoteId) {
      return (await read(quoteId)) || null;
    },
    async clear(quoteId) {
      await remove(quoteId);
    },
  };
}

// ── re-exported for callers that must not re-derive them ────────────────────

export { Amount, MeltQuoteState, createEphemeralCounterSource, sumProofs, serializeProofs, deserializeProofs };
