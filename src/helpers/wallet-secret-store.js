// helpers/wallet-secret-store.js
//
// The CHOSEN secret-storage path from
// `docs/architecture/pwa-client-wallet-adr-delta.md` §5.6 (rank 1 + rank 2):
//
//   rank 1  seed in IndexedDB + `navigator.storage.persist()` + value capped at T
//   rank 2  one-tap ENCRYPTED EXPORT via the Web Share API (file), <a download>
//           fallback where files cannot be shared
//
// This module is the substrate WS-2 consumes. It deliberately contains NO wallet
// and NO mint calls: it only decides where the recovery triple lives, how it
// leaves the device, and what the app is allowed to claim about it.
//
// ── Read this before editing ─────────────────────────────────────────────────
//
// 1. EVICTION IS THE THREAT, NOT THEFT. `Clear-Site-Data: "storage"`, "clear
//    browsing data", a profile reset and OS storage pressure all destroy every
//    origin-scoped bucket AT ONCE. Storing the seed in more places inside the
//    origin (localStorage + IndexedDB + OPFS + cookie) buys NOTHING: they die
//    together. Durability requires the secret to cross the origin boundary —
//    an exported file, a File System Access file, or a synced passkey. That is
//    the whole design, and §5.6.2 of the ADR forbids the "belt and braces"
//    variant.
//
// 2. `navigator.storage.persist()` IS SECURE-CONTEXT-GATED. On the portal
//    origin (`http://<lan-ip>:2051`) it does not exist, so on THAT origin the
//    seed is evictable-always. Do not paper over it: `requestPersistentStorage`
//    reports `unavailable`, never `granted`.
//
// 3. `crypto.subtle` IS ALSO SECURE-CONTEXT-GATED. This is why the encrypted
//    export uses the pure-JS @noble primitives rather than AES-GCM from
//    WebCrypto: an export that only works on the vendor origin would silently
//    fail on the captive portal, which is exactly where the user first gets
//    funded. XChaCha20-Poly1305 + scrypt are constant across both origins.
//
// 4. "ENCRYPTED AT REST" IS NOT A PROTECTION CLAIM. If the wrapping key is
//    held on the same origin as the ciphertext, both die together (eviction)
//    and the page can read both (XSS). Encryption here buys PORTABILITY AND
//    OPACITY — the blob is safe to hand to Files/Drive/e-mail — and nothing
//    else. §5.6.6 lists this as a forbidden claim; the wording lives in the
//    locale catalog and a test pins that the forbidden sentences are absent.
//
// 5. A BACKUP WITHOUT THE COUNTERS IS NOT A BACKUP. NUT-09 replays signatures
//    from a deterministic derivation, so recovery needs the seed AND the
//    per-keyset counter AND the mint URL(s). Any record that omits the counters
//    is rejected here rather than becoming a backup that restores to an empty
//    wallet.

import * as bip39 from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

// ── constants ───────────────────────────────────────────────────────────────

export const RECORD_VERSION = 1;
export const BACKUP_VERSION = 1;
export const BACKUP_MAGIC = 'tollgate.cashu.recovery';
export const BACKUP_MEDIA_TYPE = 'application/json';

// IndexedDB coordinates. One database, one store, one key: the recovery
// triple is a single object, so a partially-written wallet is not a state this
// store can produce.
export const DB_NAME = 'tollgate-wallet-secret';
export const DB_VERSION = 1;
export const STORE_NAME = 'recovery';
export const RECORD_KEY = 'v1';

// scrypt cost. Chosen for a *phone* inside a captive-portal session. Measured
// on this repo's build box (8 vCPU, Node 22.17.0, `performance.now` around
// `scryptAsync`, r=8 p=1 dkLen=32), min of 5 samples, and re-measured because
// the box is shared:
//
//     N=2^14  16 MiB    106 ms (1m load 0.3)  /  218 ms (1m load 16.7)
//     N=2^15  32 MiB    199 ms               /  399 ms
//     N=2^16  64 MiB    357 ms               /  704 ms
//     N=2^17 128 MiB    692 ms               / 1867 ms   <- chosen
//
// The spread is CPU contention, not a different cost, and it is the honest
// range for a number like this: quote it as "~0.7 s idle, up to ~2 s on a busy
// desktop, several seconds on a low-end phone", never as a single figure. It is
// a one-off cost on a button press (an export, or a restore), not on an unlock
// path, which is what makes that acceptable. The parameters travel in the
// envelope, so raising them later does not strand backups made today.
export const KDF_PARAMS = Object.freeze({ N: 2 ** 17, r: 8, p: 1, dkLen: 32 });

// The fallback cost, used only when the shipped cost cannot be ALLOCATED (a
// low-end phone with other tabs open: N=2^17,r=8 needs one 128 MiB buffer). The
// envelope records whichever cost was actually used, so a backup made on the
// fallback restores anywhere. 2^15 = 32 MiB, still far above a GPU-fodder cost.
export const KDF_FALLBACK_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, dkLen: 32 });

// Bounds for a KDF header that arrives from a FILE, i.e. from an attacker. A
// backup envelope carries its own scrypt parameters so old backups keep
// working, which means a hostile file can ask us to allocate 128·N·r bytes.
// These bounds are what stop `N: 2**30` from being a memory-exhaustion gadget.
export const KDF_BOUNDS = Object.freeze({
  minN: 2 ** 10,
  maxN: 2 ** 20,
  maxR: 16,
  maxP: 4,
});

export const SALT_BYTES = 16;
export const NONCE_BYTES = 24;

// ── typed failures ──────────────────────────────────────────────────────────

export const ERR = Object.freeze({
  INVALID_SEED: 'E_SEED',
  MISSING_COUNTERS: 'E_COUNTERS',
  MISSING_MINTS: 'E_MINTS',
  NOT_A_BACKUP: 'E_NOT_BACKUP',
  UNSUPPORTED_BACKUP_VERSION: 'E_BACKUP_VERSION',
  WRONG_PASSPHRASE_OR_TAMPERED: 'E_AUTH',
  NO_INDEXEDDB: 'E_NO_IDB',
  EMPTY_PASSPHRASE: 'E_PASSPHRASE',
  UNSUPPORTED_KDF: 'E_KDF',
  KDF_FAILED: 'E_KDF_FAILED',
  CORRUPT_RECORD: 'E_CORRUPT_RECORD',
  STORE_BLOCKED: 'E_IDB_BLOCKED',
  BAD_CAP: 'E_BAD_CAP',
});

export class SecretStoreError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SecretStoreError';
    this.code = code;
  }
}

// ── the recovery record (the NUT-09 triple, §5.4 item 5) ─────────────────────

/**
 * Build a validated recovery record.
 *
 * @param {object} input
 * @param {string} input.seed                 BIP-39 mnemonic
 * @param {Record<string, number>} input.countersByKeyset
 * @param {string[]} input.mintUrls
 * @param {string} [input.keysetPolicy]       the WALLET's actual policy for this mint
 * @param {number} [input.now]                epoch ms, injectable for tests
 * @returns {object} frozen record
 */
export function createRecoveryRecord({
  seed,
  countersByKeyset,
  mintUrls,
  keysetPolicy,
  now,
} = {}) {
  const record = {
    v: RECORD_VERSION,
    seed: typeof seed === 'string' ? seed.trim().replace(/\s+/g, ' ') : seed,
    countersByKeyset: countersByKeyset,
    mintUrls: mintUrls,
    // Only `deterministic` outputs are NUT-09 recoverable. This is the CALLER's
    // statement about the wallet it is reading, not a constant this module can
    // know — a hard-coded 'deterministic' would assert something about a wallet
    // it has never seen, and nothing in the module could detect a wallet that
    // switched to random secrets. So it is an input, and `validateRecoveryRecord`
    // REFUSES it when absent rather than filling it in.
    keysetPolicy,
    createdAt: typeof now === 'number' ? now : Date.now(),
  };
  const verdict = validateRecoveryRecord(record);
  if (!verdict.ok) {
    throw new SecretStoreError(verdict.code, verdict.message);
  }
  return Object.freeze(record);
}

/**
 * Validate a recovery record. Returns a verdict, never throws, so a caller can
 * surface the specific defect instead of a generic "invalid".
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
export function validateRecoveryRecord(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, code: ERR.INVALID_SEED, message: 'no record' };
  }
  if (record.v !== RECORD_VERSION) {
    return {
      ok: false,
      code: ERR.UNSUPPORTED_BACKUP_VERSION,
      message: `record version ${record.v} is not ${RECORD_VERSION}`,
    };
  }
  const seed = record.seed;
  if (typeof seed !== 'string' || seed.length === 0) {
    return { ok: false, code: ERR.INVALID_SEED, message: 'seed must be a non-empty string' };
  }
  // Checksum, word count AND the wordlist are all checked by this call: a
  // transposed phrase from a hand copy fails here, which is the point.
  if (!bip39.validateMnemonic(seed, englishWordlist)) {
    return { ok: false, code: ERR.INVALID_SEED, message: 'seed is not a valid BIP-39 mnemonic' };
  }

  const counters = record.countersByKeyset;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) {
    return {
      ok: false,
      code: ERR.MISSING_COUNTERS,
      message: 'countersByKeyset is required: NUT-09 replay needs a per-keyset counter',
    };
  }
  const keysetIds = Object.keys(counters);
  if (keysetIds.length === 0) {
    return {
      ok: false,
      code: ERR.MISSING_COUNTERS,
      message: 'countersByKeyset is empty: a seed alone cannot restore',
    };
  }
  for (const id of keysetIds) {
    const n = counters[id];
    if (!Number.isInteger(n) || n < 0) {
      return {
        ok: false,
        code: ERR.MISSING_COUNTERS,
        message: `counter for keyset ${id} must be a non-negative integer`,
      };
    }
  }

  const mints = record.mintUrls;
  if (!Array.isArray(mints) || mints.length === 0) {
    return {
      ok: false,
      code: ERR.MISSING_MINTS,
      message: 'mintUrls is required: NUT-09 must ask a specific mint to replay signatures',
    };
  }
  for (const url of mints) {
    if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url)) {
      return { ok: false, code: ERR.MISSING_MINTS, message: `not an http(s) mint URL: ${url}` };
    }
  }

  if (record.keysetPolicy !== 'deterministic') {
    return {
      ok: false,
      code: ERR.MISSING_COUNTERS,
      message:
        record.keysetPolicy === undefined
          ? 'keysetPolicy is required: a backup must record that the keysets are NUT-09 deterministic'
          : `keysetPolicy ${record.keysetPolicy} is not recoverable (only deterministic is)`,
    };
  }

  return { ok: true };
}

/**
 * True when `seed` is a valid BIP-39 mnemonic in the English wordlist.
 *
 * Normalises whitespace the same way `createRecoveryRecord` does. Without that,
 * a phrase pasted from a password manager with a double or trailing space
 * validates here and is then rewritten by the constructor, so the two halves of
 * the "is this a seed?" question disagree about the same input.
 */
export function isValidSeedPhrase(seed) {
  if (typeof seed !== 'string') return false;
  return bip39.validateMnemonic(seed.trim().replace(/\s+/g, ' '), englishWordlist);
}

/** Generate a fresh 12-word seed on the device. Entropy comes from the platform CSPRNG. */
export function generateSeedPhrase(strength = 128) {
  return bip39.generateMnemonic(englishWordlist, strength);
}

// ── the IndexedDB store (rank 1) ────────────────────────────────────────────

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb request failed'));
  });
}

/**
 * Wrap a request that has an `onblocked` state.
 *
 * `deleteDatabase` (and an upgrade with another tab holding an older version)
 * fires `blocked`, NOT `error`. A promise that only listens for the latter never
 * settles, and a wipe-simulation helper that hangs is worse than one that
 * throws — the test would time out with no diagnosis at all.
 */
function wrapBlockableRequest(request, what) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`${what} failed`));
    request.onblocked = () =>
      reject(
        new SecretStoreError(
          ERR.STORE_BLOCKED,
          `${what} is blocked: another tab or open connection still holds the database`
        )
      );
  });
}

/**
 * Open the secret store.
 *
 * @param {object} [opts]
 * @param {IDBFactory} [opts.indexedDB]  injectable for tests
 * @param {string} [opts.dbName]
 * @returns {Promise<object>} store handle
 */
export async function openSecretStore(opts = {}) {
  // `hasOwnProperty` rather than `||`: an explicit `indexedDB: null` must mean
  // "there is no IndexedDB here", which is the ordinary state on a browser with
  // storage disabled and the state the cleared-data test needs to model.
  const factory = Object.prototype.hasOwnProperty.call(opts, 'indexedDB')
    ? opts.indexedDB
    : typeof indexedDB !== 'undefined'
      ? indexedDB
      : undefined;
  if (!factory) {
    throw new SecretStoreError(
      ERR.NO_INDEXEDDB,
      'IndexedDB is unavailable in this context — the seed cannot be kept on the device, so a backup is mandatory before funding'
    );
  }
  const dbName = opts.dbName || DB_NAME;
  const openReq = factory.open(dbName, DB_VERSION);
  openReq.onupgradeneeded = () => {
    const db = openReq.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };
  const db = await wrapRequest(openReq);

  const withStore = (mode, fn) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('indexeddb transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb transaction aborted'));
    });
  };

  return {
    dbName,
    /** Persist (or replace) the record. Validated first: never store a broken triple. */
    async save(record) {
      const verdict = validateRecoveryRecord(record);
      if (!verdict.ok) throw new SecretStoreError(verdict.code, verdict.message);
      await withStore('readwrite', (s) => s.put(record, RECORD_KEY));
      return record;
    },
    /** @returns {Promise<object|null>} */
    async load() {
      const value = await withStore('readonly', (s) => wrapRequest(s.get(RECORD_KEY)));
      if (value === undefined || value === null) return null;
      // Re-validate on READ as well as on write. A record written by a future
      // version, or edited through devtools, must not be handed to the caller as
      // a usable wallet: the same check that guards `save` also guards `load`,
      // and a bad one degrades to "no wallet here" instead of a half-usable one.
      const verdict = validateRecoveryRecord(value);
      if (!verdict.ok) {
        throw new SecretStoreError(ERR.CORRUPT_RECORD, `stored record is not usable: ${verdict.message}`);
      }
      return value;
    },
    async clear() {
      await withStore('readwrite', (s) => s.delete(RECORD_KEY));
    },
    close() {
      db.close();
    },
  };
}

/**
 * Simulate / execute the event the whole design is built around: the origin's
 * storage is gone. `Clear-Site-Data: "storage"` deletes the database itself,
 * not just the key, so the wipe must delete the database.
 *
 * This exists as a first-class function because "treat site-data clearing as a
 * normal event, not an edge case" is §5.4 item 6, and a test that does not
 * exercise this path is not a test of the design.
 */
export async function clearSiteData(opts = {}) {
  // Same reasoning as openSecretStore: an explicit `indexedDB: null` must not
  // silently fall back to the global.
  const f = Object.prototype.hasOwnProperty.call(opts, 'indexedDB')
    ? opts.indexedDB
    : typeof indexedDB !== 'undefined'
      ? indexedDB
      : undefined;
  if (!f) return { cleared: false, reason: ERR.NO_INDEXEDDB };
  const name = opts.dbName || DB_NAME;
  // `onblocked`, not `onerror`, is what fires when another tab still holds the
  // database — so this must reject rather than hang.
  await wrapBlockableRequest(f.deleteDatabase(name), `deleteDatabase(${name})`);
  return { cleared: true, dbName: name };
}

// ── eviction protection (best-effort, never a guarantee) ────────────────────

/**
 * Ask for persistent storage. On the portal origin this is unavailable, and
 * saying so is the point: §5.6.1 is explicit that `persist()` defends ONLY
 * against storage-pressure eviction and never against clear-site-data, a
 * profile reset or private browsing.
 *
 * @returns {Promise<{state: 'granted'|'denied'|'unavailable', reason: string}>}
 */
export async function requestPersistentStorage(env = {}) {
  const storage =
    env.storage || (typeof navigator !== 'undefined' ? navigator.storage : undefined);
  if (!storage || typeof storage.persist !== 'function') {
    return {
      state: 'unavailable',
      reason:
        'navigator.storage.persist is secure-context-gated: absent on the plain-HTTP portal origin',
    };
  }
  try {
    const granted = await storage.persist();
    return {
      state: granted ? 'granted' : 'denied',
      reason: granted
        ? 'persistent bucket: survives storage pressure, NOT clear-site-data'
        : 'best-effort bucket: evictable without interrupting the user',
    };
  } catch (error) {
    return { state: 'unavailable', reason: String((error && error.message) || error) };
  }
}

// ── encrypted export (rank 2) ───────────────────────────────────────────────

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(env, n) {
  const source = env.randomBytes ? env.randomBytes(n) : crypto.getRandomValues(new Uint8Array(n));
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * The authenticated header.
 *
 * Every field here is covered by the Poly1305 tag, so it cannot be edited
 * without the passphrase. That matters most for `kdf`: the parameters travel in
 * the file (so old backups keep working), and an unauthenticated `kdf` would let
 * whoever supplied the file claim `N: 2` and hand us a backup that opens with a
 * weak derivation, or claim `N: 2**30` and turn restore into a memory bomb.
 * `salt` and `nonce` are in here too — a swapped salt is a different key, and a
 * swapped nonce with a reused key would be a nonce-reuse bug.
 *
 * Serialised by hand in a FIXED order rather than via JSON.stringify of the
 * parsed object, so a field order change in a future writer cannot silently
 * invalidate every existing backup.
 */
function canonicalHeader({ magic, v, aead, kdf, salt }) {
  return JSON.stringify({
    aead,
    kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen },
    magic,
    salt,
    v,
  });
}

/** Validate KDF parameters that arrived from a FILE, before they are used. */
function assertSafeKdfParams(kdf) {
  const bad = (why) => new SecretStoreError(ERR.UNSUPPORTED_KDF, `refusing backup KDF: ${why}`);
  if (!kdf || kdf.name !== 'scrypt') throw bad('only scrypt is understood');
  const ints = ['N', 'r', 'p', 'dkLen'];
  for (const field of ints) {
    if (!Number.isInteger(kdf[field])) throw bad(`${field} is not an integer`);
  }
  if (kdf.N < KDF_BOUNDS.minN || kdf.N > KDF_BOUNDS.maxN) {
    throw bad(`N ${kdf.N} is outside ${KDF_BOUNDS.minN}..${KDF_BOUNDS.maxN}`);
  }
  // scrypt requires a power of two; a non-power-of-two N throws inside @noble
  // with a raw error, so reject it here where the failure can be typed.
  if ((kdf.N & (kdf.N - 1)) !== 0) throw bad(`N ${kdf.N} is not a power of two`);
  if (kdf.r < 1 || kdf.r > KDF_BOUNDS.maxR) throw bad(`r ${kdf.r} is outside 1..${KDF_BOUNDS.maxR}`);
  if (kdf.p < 1 || kdf.p > KDF_BOUNDS.maxP) throw bad(`p ${kdf.p} is outside 1..${KDF_BOUNDS.maxP}`);
  if (kdf.dkLen !== 32) throw bad(`dkLen ${kdf.dkLen} is not 32`);
  return kdf;
}

/** Decode one base64 envelope field, or fail with a typed error. */
function decodeField(envelope, field) {
  const value = envelope[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, `envelope field ${field} is missing`);
  }
  try {
    return fromBase64(value);
  } catch {
    // A truncated or e-mail-mangled backup is the ordinary case here, not an
    // attack: it must reach the UI as "that file is not a backup", never as a
    // raw DOMException the caller cannot branch on.
    throw new SecretStoreError(ERR.NOT_A_BACKUP, `envelope field ${field} is not valid base64`);
  }
}

async function deriveKey(passphrase, salt, kdf, env = {}) {
  // `env.scryptAsync` is a test seam only: it exists so the OOM-fallback path can
  // be exercised without actually allocating 128 MiB and dying. Production never
  // passes it.
  const scrypt = env.scryptAsync || scryptAsync;
  try {
    return await scrypt(new TextEncoder().encode(passphrase.normalize('NFKD')), salt, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      dkLen: kdf.dkLen,
    });
  } catch (error) {
    throw new SecretStoreError(
      ERR.KDF_FAILED,
      `the key derivation failed on this device (${String((error && error.message) || error)})`
    );
  }
}

/**
 * Encrypt a recovery record into a portable JSON envelope.
 *
 * The passphrase is the ONLY thing the user must remember, so this is the rail
 * that turns "write down 12 words" into "pick a passphrase you already know".
 * It is deliberately the *second* option: §5.6.1 rank 2 offers it once the
 * balance reaches T, never before, and never mid-payment.
 *
 * @returns {Promise<string>} JSON text, safe to hand to Files/Drive/e-mail
 */
export async function encryptRecoveryRecord(record, passphrase, env = {}) {
  const verdict = validateRecoveryRecord(record);
  if (!verdict.ok) throw new SecretStoreError(verdict.code, verdict.message);
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new SecretStoreError(ERR.EMPTY_PASSPHRASE, 'a passphrase is required to encrypt');
  }

  // `env.kdfParams` exists for the test suite (a full-cost scrypt per case is
  // ~0.7 s of CPU and dominates a parallel run). Production never passes it, so
  // the shipped cost is KDF_PARAMS and the default-cost test pins that.
  const wanted = { ...KDF_PARAMS, ...(env.kdfParams || {}) };
  const salt = randomBytes(env, SALT_BYTES);
  const nonce = randomBytes(env, NONCE_BYTES);

  // Two attempts, not one: the shipped cost allocates a 128 MiB buffer, which a
  // low-end phone with other tabs open can refuse. The fallback is only used
  // when the FIRST attempt fails to allocate, and the parameters of whichever
  // one succeeded are recorded in the envelope — so a backup made on the
  // fallback restores on any device. A failure at both costs is a typed error,
  // because "the export button does nothing" is the worst possible outcome here.
  const attempts = env.kdfParams ? [wanted] : [wanted, { ...KDF_FALLBACK_PARAMS }];
  let kdf = null;
  let key = null;
  const failures = [];
  for (const candidate of attempts) {
    const params = { name: 'scrypt', ...candidate };
    try {
      assertSafeKdfParams(params);
      key = await deriveKey(passphrase, salt, params, env);
      kdf = params;
      break;
    } catch (error) {
      failures.push(params.N);
    }
  }
  if (!key) {
    throw new SecretStoreError(
      ERR.KDF_FAILED,
      `the key derivation failed at every supported cost (tried N=${failures.join(', ')})`
    );
  }

  const saltB64 = toBase64(salt);
  const header = { magic: BACKUP_MAGIC, v: BACKUP_VERSION, aead: 'xchacha20poly1305', kdf, salt: saltB64 };
  const ciphertext = xchacha20poly1305(key, nonce, new TextEncoder().encode(canonicalHeader(header))).encrypt(
    new TextEncoder().encode(JSON.stringify(record))
  );

  // The envelope carries everything needed to decrypt on a NEW device with
  // nothing but the passphrase: KDF params, salt, nonce. The header above is
  // passed as AAD, so none of it can be edited without failing authentication.
  return JSON.stringify({
    ...header,
    nonce: toBase64(nonce),
    ct: toBase64(ciphertext),
  });
}

/**
 * Decrypt a backup envelope. Throws a typed error rather than returning junk:
 * a wrong passphrase and a tampered ciphertext are the SAME failure by design
 * (Poly1305 authenticates), and neither may be reported as "restored".
 *
 * @returns {Promise<object>} the validated recovery record
 */
export async function decryptRecoveryRecord(envelopeText, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new SecretStoreError(ERR.EMPTY_PASSPHRASE, 'a passphrase is required to decrypt');
  }
  let envelope;
  try {
    envelope = typeof envelopeText === 'string' ? JSON.parse(envelopeText) : envelopeText;
  } catch {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, 'not JSON');
  }
  if (!envelope || envelope.magic !== BACKUP_MAGIC) {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, 'missing backup magic');
  }
  if (envelope.v !== BACKUP_VERSION) {
    throw new SecretStoreError(
      ERR.UNSUPPORTED_BACKUP_VERSION,
      `backup version ${envelope.v} is not ${BACKUP_VERSION}`
    );
  }
  const aead = envelope.aead;
  if (aead !== 'xchacha20poly1305') {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, `unsupported AEAD ${aead}`);
  }
  // Bounds BEFORE the derivation: these parameters came from a file, and an
  // unbounded N is a memory-exhaustion gadget (128·N·r bytes).
  const kdf = assertSafeKdfParams(envelope.kdf);

  const salt = decodeField(envelope, 'salt');
  const nonce = decodeField(envelope, 'nonce');
  const ciphertext = decodeField(envelope, 'ct');
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES) {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, 'wrong salt or nonce length');
  }

  const key = await deriveKey(passphrase, salt, kdf);

  let plaintext;
  try {
    plaintext = xchacha20poly1305(key, nonce, new TextEncoder().encode(canonicalHeader(envelope))).decrypt(
      ciphertext
    );
  } catch {
    // One failure for a wrong passphrase AND for tampering, deliberately: an
    // oracle that distinguished them would confirm a guessed passphrase on a
    // file the attacker already has.
    throw new SecretStoreError(
      ERR.WRONG_PASSPHRASE_OR_TAMPERED,
      'the passphrase is wrong or the backup was modified'
    );
  }

  let record;
  try {
    record = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    // Authenticated but unparseable: a writer bug, not a user error. Still typed.
    throw new SecretStoreError(ERR.CORRUPT_RECORD, 'the backup decrypted to something that is not JSON');
  }
  const verdict = validateRecoveryRecord(record);
  if (!verdict.ok) {
    // Decryption succeeded but the payload is not a usable triple. That is a
    // corrupt backup, not a wrong passphrase — say which.
    throw new SecretStoreError(verdict.code, verdict.message);
  }
  return record;
}

/** A stable, recognisable filename. No timestamp: re-exporting overwrites rather than litters. */
export function backupFilename(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `tollgate-wallet-backup-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(
    d.getUTCDate()
  )}.json`;
}

/**
 * Build the shareable/downloadable artifact.
 *
 * @returns {{filename: string, text: string, file: File|null}}
 */
export function buildBackupFile(envelopeText, opts = {}) {
  const filename = opts.filename || backupFilename(opts.now);
  const file =
    typeof File === 'function'
      ? new File([envelopeText], filename, { type: BACKUP_MEDIA_TYPE })
      : null;
  return { filename, text: envelopeText, file };
}

/**
 * Hand the backup to the OS.
 *
 * Web Share with `files` is the one-tap rail on BOTH target mobile platforms
 * (Chrome Android >= 76, iOS Safari >= 14). Firefox cannot share files at all,
 * so the `<a download>` path is a real fallback and not decoration.
 *
 * "One tap" is a claim about THIS function, not about the whole export: the
 * caller must derive the key (seconds of scrypt) before it has a file to share,
 * and Safari's transient user activation for `share()` is typically gone by
 * then. So on iOS expect `NotAllowedError` here followed by the download path —
 * which is honest and still saves the file, just not via the share sheet. Do not
 * describe the iOS flow to a user as "one tap to your Files app".
 *
 * The return value is the durability EVIDENCE, not just a status word:
 * `exportedAt` is set only when the file actually left the page, so a caller
 * cannot promote a wallet to "you have a backup" after the user dismissed the
 * sheet. That distinction is the difference between a disclosure that is true
 * and one that lies to a user about their only copy.
 *
 * @returns {Promise<{state: 'shared'|'cancelled'|'downloaded'|'unavailable', exportedAt: number|null, reason?: string}>}
 */
export async function shareBackup(backup, env = {}) {
  const now = typeof env.now === 'number' ? env.now : Date.now();
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : undefined);
  const canShareFiles =
    !!nav &&
    typeof nav.canShare === 'function' &&
    !!backup.file &&
    (() => {
      try {
        return nav.canShare({ files: [backup.file] });
      } catch {
        return false;
      }
    })();

  if (canShareFiles) {
    try {
      await nav.share({ files: [backup.file], title: 'TollGate wallet backup' });
      return { state: 'shared', exportedAt: now };
    } catch (error) {
      // AbortError means the user closed the sheet — not a failure to report,
      // and NOT evidence of a backup.
      if (error && error.name === 'AbortError') return { state: 'cancelled', exportedAt: null };
      // Anything else falls through to the download path rather than losing
      // the backup.
    }
  }

  const doc = 'document' in env ? env.document : typeof document !== 'undefined' ? document : undefined;
  const urlApi = 'urlApi' in env ? env.urlApi : typeof URL !== 'undefined' ? URL : undefined;
  if (
    doc &&
    urlApi &&
    typeof urlApi.createObjectURL === 'function' &&
    typeof Blob === 'function'
  ) {
    const url = urlApi.createObjectURL(new Blob([backup.text], { type: BACKUP_MEDIA_TYPE }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = backup.filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke LATER, never in the same task. Revoking synchronously can abort the
    // download it was created for: the browser hands the blob URL to the
    // download manager and resolves it asynchronously, so a URL that is gone
    // first leaves Firefox (the browser this branch exists for) with nothing.
    // The leak is bounded — one blob per export, released on the next one.
    if (typeof urlApi.revokeObjectURL === 'function') {
      const release = () => urlApi.revokeObjectURL(url);
      if (typeof env.defer === 'function') env.defer(release);
      else if (typeof setTimeout === 'function') setTimeout(release, 60_000);
      // No timer available at all: leak the one URL rather than lose the file.
    }
    return { state: 'downloaded', exportedAt: now };
  }

  return {
    state: 'unavailable',
    exportedAt: null,
    reason: 'neither Web Share (files) nor a download anchor is available in this context',
  };
}

// ── the policy cap (T), and what may be promised ────────────────────────────

/**
 * Classify the resting balance against the cap.
 *
 * "The most you can lose is T" is the load-bearing promise of the design, and
 * it holds only while the unexported balance stays under the cap. This is a
 * pure function so the rule cannot drift into the UI — but note what that means
 * and what it does not: **it classifies, it does not enforce.** A wallet write
 * path that never calls it is unaffected, so the caller (WS-2) is what enforces
 * the cap. Read `state` and refuse the write; do not treat this module's
 * existence as the enforcement.
 *
 * An UNKNOWN balance is never `ok`. If the mint is unreachable or the amount did
 * not parse, we cannot say the loss is bounded by T, so the honest answer is
 * `unknown` with `mustExport: true`.
 *
 * @param {object} input
 * @param {number} input.balanceSats
 * @param {number} input.capSats
 * @param {number|null} [input.lastExportAt]
 * @returns {{state: 'ok'|'export-due'|'over-cap'|'unknown', maxLossSats: number|null, mustExport: boolean, reason: string}}
 */
export function enforceRestingCap({ balanceSats, capSats, lastExportAt = null } = {}) {
  if (!Number.isFinite(capSats) || capSats <= 0) {
    throw new SecretStoreError(
      ERR.BAD_CAP,
      `capSats must be a positive finite number, got ${capSats}: without a cap there is no bound to promise`
    );
  }
  const cap = capSats;

  if (!Number.isFinite(balanceSats)) {
    return {
      state: 'unknown',
      maxLossSats: null,
      mustExport: true,
      reason:
        'balance is unknown (mint unreachable or amount unparsed): the loss is NOT bounded by the cap until it is known, so treat it as an export-due state',
    };
  }
  const balance = balanceSats;

  if (balance > cap) {
    return {
      state: 'over-cap',
      maxLossSats: balance,
      mustExport: true,
      reason: `balance ${balance} exceeds the cap ${cap}: the "at most T" promise is already broken`,
    };
  }
  if (balance > 0 && lastExportAt === null) {
    return {
      state: 'export-due',
      maxLossSats: cap,
      mustExport: true,
      reason: 'no durable copy exists yet; offer the encrypted export now',
    };
  }
  return {
    state: 'ok',
    maxLossSats: cap,
    mustExport: false,
    reason: 'within the cap; loss is bounded by T',
  };
}

/**
 * The honest durability verdict for the current device, and the disclosure text
 * key the UI must show. Four levels, in ascending durability:
 *
 *   'none'       no store at all — a backup is mandatory BEFORE funding
 *   'evictable'  seed on the device, no durable copy (the petty-cash purse)
 *   'exported'   seed on the device AND a portable encrypted backup exists
 *   'passkey'    seed wrapped by a PRF-derived key (opportunistic, Chrome only)
 *
 * There is deliberately no 'safe' level and no wording that implies custody.
 *
 * `lastExportAt` must come from EVIDENCE, i.e. from `shareBackup()['exportedAt']`
 * for a run that actually handed the file off — never from the fact that the
 * export sheet was opened. A cancelled or unavailable share is not a backup, and
 * telling a user "you have a backup file" when they dismissed the sheet is the
 * one lie this module exists to prevent.
 *
 * This module does not persist `lastExportAt`. Whatever owns the wallet must,
 * because `'exported'` is otherwise forgotten on the next reload and the user
 * drops back to `'evictable'` with a backup they still have.
 *
 * `overCap` is passed through rather than hidden: when it is true the "at most T"
 * promise is already broken, so the UI must show the over-cap string, not the cap.
 */
export function describeDurability({
  caps = {},
  recordPresent = false,
  lastExportAt = null,
  overCap = false,
} = {}) {
  if (!recordPresent) {
    return {
      level: 'none',
      disclosureKey: 'secret_disclosure_none',
      maxLossSatsKey: overCap ? 'secret_loss_over_cap' : 'secret_loss_cap',
      overCap,
      durableCopy: false,
      // A wiped origin looks identical to a fresh one. We cannot know, so the
      // UI must disclose at the first funded moment rather than guess.
      wipeLossUndetectable: true,
      reasons: ['no recovery record on this device'],
    };
  }
  if (lastExportAt !== null) {
    return {
      level: 'exported',
      disclosureKey: 'secret_disclosure_exported',
      maxLossSatsKey: overCap ? 'secret_loss_over_cap' : 'secret_loss_cap',
      overCap,
      durableCopy: true,
      wipeLossUndetectable: false,
      reasons: ['an encrypted backup exists off-device'],
    };
  }
  return {
    level: 'evictable',
    disclosureKey: 'secret_disclosure_evictable',
    maxLossSatsKey: overCap ? 'secret_loss_over_cap' : 'secret_loss_cap',
    overCap,
    durableCopy: false,
    wipeLossUndetectable: true,
    reasons: [
      caps.persistent === 'granted'
        ? 'persistent bucket: survives storage pressure only'
        : 'best-effort or unavailable persistence: evictable at any time',
      'clearing site data deletes the seed permanently',
    ],
  };
}
