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
 * @param {number} [input.now]                epoch ms, injectable for tests
 * @returns {object} frozen record
 */
export function createRecoveryRecord({ seed, countersByKeyset, mintUrls, now } = {}) {
  const record = {
    v: RECORD_VERSION,
    seed: typeof seed === 'string' ? seed.trim().replace(/\s+/g, ' ') : seed,
    countersByKeyset: countersByKeyset,
    mintUrls: mintUrls,
    // Only `deterministic` outputs are NUT-09 recoverable. Recording it makes a
    // future accidental switch to random secrets a *visible* backup defect
    // instead of a silent one.
    keysetPolicy: 'deterministic',
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

  if (record.keysetPolicy !== undefined && record.keysetPolicy !== 'deterministic') {
    return {
      ok: false,
      code: ERR.MISSING_COUNTERS,
      message: `keysetPolicy ${record.keysetPolicy} is not recoverable (only deterministic is)`,
    };
  }

  return { ok: true };
}

/** True when `seed` is a valid BIP-39 mnemonic in the English wordlist. */
export function isValidSeedPhrase(seed) {
  return typeof seed === 'string' && bip39.validateMnemonic(seed.trim(), englishWordlist);
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
      return value === undefined ? null : value;
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
  await wrapRequest(f.deleteDatabase(name));
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
  const params = { ...KDF_PARAMS, ...(env.kdfParams || {}) };
  const salt = randomBytes(env, SALT_BYTES);
  const nonce = randomBytes(env, NONCE_BYTES);
  const kdf = { name: 'scrypt', ...params };
  const key = await scryptAsync(
    new TextEncoder().encode(passphrase.normalize('NFKD')),
    salt,
    { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen }
  );
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(
    new TextEncoder().encode(JSON.stringify(record))
  );

  // The envelope carries everything needed to decrypt on a NEW device with
  // nothing but the passphrase: KDF params, salt, nonce. AAD binds the magic +
  // version so a version downgrade cannot be replayed.
  return JSON.stringify({
    magic: BACKUP_MAGIC,
    v: BACKUP_VERSION,
    aead: 'xchacha20poly1305',
    kdf,
    salt: toBase64(salt),
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
  const kdf = envelope.kdf || {};
  if (kdf.name !== 'scrypt' || !Number.isInteger(kdf.N) || !Number.isInteger(kdf.r)) {
    throw new SecretStoreError(ERR.NOT_A_BACKUP, 'unsupported KDF');
  }

  const key = await scryptAsync(
    new TextEncoder().encode(passphrase.normalize('NFKD')),
    fromBase64(envelope.salt),
    { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen || 32 }
  );

  let plaintext;
  try {
    plaintext = xchacha20poly1305(key, fromBase64(envelope.nonce)).decrypt(
      fromBase64(envelope.ct)
    );
  } catch {
    throw new SecretStoreError(
      ERR.WRONG_PASSPHRASE_OR_TAMPERED,
      'the passphrase is wrong or the backup was modified'
    );
  }

  const record = JSON.parse(new TextDecoder().decode(plaintext));
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
 * @returns {Promise<{state: 'shared'|'cancelled'|'downloaded'|'unavailable', reason?: string}>}
 */
export async function shareBackup(backup, env = {}) {
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
      return { state: 'shared' };
    } catch (error) {
      // AbortError means the user closed the sheet — not a failure to report.
      if (error && error.name === 'AbortError') return { state: 'cancelled' };
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
    if (typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(url);
    return { state: 'downloaded' };
  }

  return {
    state: 'unavailable',
    reason: 'neither Web Share (files) nor a download anchor is available in this context',
  };
}

// ── the policy cap (T), and what may be promised ────────────────────────────

/**
 * Enforce the resting-balance cap.
 *
 * "The most you can lose is T" is the load-bearing promise of the design, and
 * it is true only while the unexported balance stays under the cap. This is a
 * pure function so the rule is testable and cannot drift into the UI.
 *
 * @param {object} input
 * @param {number} input.balanceSats
 * @param {number} input.capSats
 * @param {number|null} [input.lastExportAt]
 * @returns {{state: 'ok'|'export-due'|'over-cap', maxLossSats: number, mustExport: boolean, reason: string}}
 */
export function enforceRestingCap({ balanceSats, capSats, lastExportAt = null } = {}) {
  const balance = Number.isFinite(balanceSats) ? balanceSats : 0;
  const cap = Number.isFinite(capSats) ? capSats : 0;

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
 */
export function describeDurability({ caps = {}, recordPresent = false, lastExportAt = null } = {}) {
  if (!recordPresent) {
    return {
      level: 'none',
      disclosureKey: 'secret_disclosure_none',
      maxLossSatsKey: 'secret_loss_cap',
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
      maxLossSatsKey: 'secret_loss_cap',
      durableCopy: true,
      wipeLossUndetectable: false,
      reasons: ['an encrypted backup exists off-device'],
    };
  }
  return {
    level: 'evictable',
    disclosureKey: 'secret_disclosure_evictable',
    maxLossSatsKey: 'secret_loss_cap',
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
