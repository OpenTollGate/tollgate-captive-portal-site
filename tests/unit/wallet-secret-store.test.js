// Unit gate for src/helpers/wallet-secret-store.js — the CHOSEN secret-storage
// path of docs/architecture/pwa-client-wallet-adr-delta.md §5.6.
//
// What this file is FOR, stated so a future reader does not weaken it:
//
//   The design's promise is "you never write anything down; the most you can
//   lose is T". That promise is only honest if (a) the seed really does survive
//   a page reload WITHOUT the user doing anything, and (b) the moment the
//   origin's storage is destroyed — `Clear-Site-Data: "storage"`, "clear site
//   data", a profile reset, a private window closing — is a NORMAL, TESTED
//   event, not an edge case. §5.4 item 6 and §5.6.3 both say so.
//
// So the persist/restore test and the CLEARED-DATA test are not two tests of
// one feature: the second is the one that decides whether the design is safe.
// A suite that passes with the wipe test deleted is a suite that is testing the
// happy path of a wallet that silently zeroes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import en from '../../public/locales/en.json';
import {
  BACKUP_MAGIC,
  DB_NAME,
  ERR,
  KDF_BOUNDS,
  KDF_FALLBACK_PARAMS,
  KDF_PARAMS,
  RECORD_KEY,
  SecretStoreError,
  STORE_NAME,
  buildBackupFile,
  clearSiteData,
  createRecoveryRecord,
  decryptRecoveryRecord,
  describeDurability,
  encryptRecoveryRecord,
  enforceRestingCap,
  generateSeedPhrase,
  isValidSeedPhrase,
  openSecretStore,
  requestPersistentStorage,
  shareBackup,
  validateRecoveryRecord,
} from '../../src/helpers/wallet-secret-store.js';

// A fixed phrase so failures are reproducible. This is a TEST vector, never a
// funded wallet — it is the canonical BIP-39 reference vector.
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSPHRASE = 'correct horse battery staple';

// The SHIPPED KDF cost is N=2^17 (~0.7 s per derivation on the build box). That
// is right for a one-off export/restore and wrong for a 62-case unit suite, so
// every case here derives at N=2^10 and ONE case below pins the shipped
// parameters. Do not "fix" a slow suite by removing that pin: the pin is what
// proves the shipped default was not silently weakened to make the tests fast.
const FAST_KDF = { N: 2 ** 10 };
const fast = { kdfParams: FAST_KDF };

const record = (overrides = {}) =>
  createRecoveryRecord({
    seed: SEED,
    countersByKeyset: { '009a1f293253e41e': 7 },
    mintUrls: ['https://mint.minibits.cash/Bitcoin'],
    // The wallet would report this; the module refuses to assume it.
    keysetPolicy: 'deterministic',
    now: 1_760_000_000_000,
    ...overrides,
  });

let indexedDBFactory;
const originalIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  // A fresh factory per test: IndexedDB state must not leak between tests, and
  // that isolation is itself the property we are simulating (a different
  // device/origin starts empty).
  indexedDBFactory = new IDBFactory();
  globalThis.indexedDB = indexedDBFactory;
});

afterEach(() => {
  globalThis.indexedDB = originalIndexedDB;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The recovery triple (NUT-09 needs seed + counters + mints)
// ─────────────────────────────────────────────────────────────────────────────

describe('recovery record: the NUT-09 triple is enforced at write time', () => {
  it('accepts a complete triple', () => {
    const r = record();
    expect(validateRecoveryRecord(r)).toEqual({ ok: true });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('rejects a phrase that is not valid BIP-39 (checksum or wordlist)', () => {
    expect(isValidSeedPhrase(SEED)).toBe(true);
    expect(isValidSeedPhrase(SEED.replace('about', 'abandon'))).toBe(false);
    expect(isValidSeedPhrase('not a mnemonic at all')).toBe(false);
    expect(() => record({ seed: 'abandon abandon abandon' })).toThrow(SecretStoreError);
    try {
      record({ seed: 'abandon abandon abandon' });
    } catch (error) {
      expect(error.code).toBe(ERR.INVALID_SEED);
    }
  });

  it('normalises whitespace exactly as the constructor does', () => {
    // A phrase pasted from a password manager arrives with a double space or a
    // trailing newline. If `isValidSeedPhrase` answered false there while
    // `createRecoveryRecord` accepted and rewrote it, the UI's "is this a seed?"
    // gate and the storage gate would disagree about the same paste.
    const messy = `  ${SEED.replace(' ', '  ')}\n`;
    expect(isValidSeedPhrase(messy)).toBe(true);
    expect(record({ seed: messy }).seed).toBe(SEED);
    // And it still rejects a genuinely broken phrase after normalisation.
    expect(isValidSeedPhrase(`  ${SEED.replace('about', 'abandon')}  `)).toBe(false);
  });

  it('rejects a missing or empty countersByKeyset — a seed alone cannot restore', () => {
    expect(() => record({ countersByKeyset: undefined })).toThrow(SecretStoreError);
    expect(() => record({ countersByKeyset: {} })).toThrow(/countersByKeyset is empty/);
  });

  it('rejects a non-integer or negative counter', () => {
    for (const bad of [1.5, -1, '7', null]) {
      const verdict = validateRecoveryRecord({
        ...record(),
        countersByKeyset: { '009a1f293253e41e': bad },
      });
      expect(verdict.ok, `counter ${String(bad)} must be refused`).toBe(false);
      expect(verdict.code).toBe(ERR.MISSING_COUNTERS);
    }
  });

  it('rejects a missing or non-http mint URL', () => {
    expect(() => record({ mintUrls: [] })).toThrow(/mintUrls is required/);
    expect(() => record({ mintUrls: ['mint.example.com'] })).toThrow(/not an http/);
  });

  it('rejects a record whose keyset policy is not deterministic', () => {
    const verdict = validateRecoveryRecord({ ...record(), keysetPolicy: 'random' });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/not recoverable/);
  });

  it('rejects a record with NO keyset policy — the module cannot vouch for a wallet it never saw', () => {
    // The policy is the CALLER's statement about its wallet. Defaulting it here
    // would make the record assert "deterministic" on behalf of code that never
    // looked, which is the failure the field exists to prevent.
    const { keysetPolicy, ...withoutPolicy } = record();
    expect(keysetPolicy).toBe('deterministic');
    const verdict = validateRecoveryRecord(withoutPolicy);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/keysetPolicy is required/);
    // And the constructor refuses it too, rather than stamping a value it cannot
    // know.
    expect(() => createRecoveryRecord({ ...record(), keysetPolicy: undefined })).toThrow(
      /keysetPolicy is required/
    );
  });

  it('stamps the policy the caller supplied, and refuses a non-deterministic one at write time', () => {
    expect(record({ keysetPolicy: 'deterministic' }).keysetPolicy).toBe('deterministic');
    expect(() => record({ keysetPolicy: 'random' })).toThrow(/not recoverable/);
  });

  it('rejects an unknown record version instead of guessing', () => {
    const verdict = validateRecoveryRecord({ ...record(), v: 99 });
    expect(verdict.code).toBe(ERR.UNSUPPORTED_BACKUP_VERSION);
  });

  it('generates a fresh, valid 12-word phrase on demand', () => {
    const fresh = generateSeedPhrase();
    expect(fresh.split(' ')).toHaveLength(12);
    expect(bip39.validateMnemonic(fresh, english)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Persist / restore across a page load (the "nothing written down" path)
// ─────────────────────────────────────────────────────────────────────────────

describe('device-local store: persists across a reload with no user action', () => {
  it('writes the triple and reads it back from a NEW store handle (a reload)', async () => {
    const first = await openSecretStore({ indexedDB: indexedDBFactory });
    await first.save(record());
    first.close();

    // A reload is a new handle onto the same origin storage — nothing that was
    // held in memory survives, only what was written.
    const second = await openSecretStore({ indexedDB: indexedDBFactory });
    const loaded = await second.load();
    second.close();

    expect(loaded).not.toBeNull();
    expect(validateRecoveryRecord(loaded)).toEqual({ ok: true });
    expect(loaded.seed).toBe(SEED);
    expect(loaded.countersByKeyset).toEqual({ '009a1f293253e41e': 7 });
    expect(loaded.mintUrls).toEqual(['https://mint.minibits.cash/Bitcoin']);
  });

  it('returns null (not a fabricated empty wallet) when nothing has been stored', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await expect(store.load()).resolves.toBeNull();
    store.close();
  });

  it('refuses to store a broken triple rather than leaving a half-usable wallet', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await expect(
      store.save({ v: 1, seed: SEED, countersByKeyset: {}, mintUrls: ['https://m.test'] })
    ).rejects.toBeInstanceOf(SecretStoreError);
    await expect(store.load()).resolves.toBeNull();
    store.close();
  });

  it('reports NO_INDEXEDDB instead of throwing a bare TypeError when storage is absent', async () => {
    await expect(openSecretStore({ indexedDB: null })).rejects.toMatchObject({
      code: ERR.NO_INDEXEDDB,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLEARED-DATA PATH — the test that decides whether the design is safe
// ─────────────────────────────────────────────────────────────────────────────

describe('cleared-data path: the wipe is a normal event, and only a backup survives it', () => {
  it('destroys the stored seed completely, and says so rather than pretending', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await store.save(record());
    expect((await store.load()).seed).toBe(SEED);
    store.close();

    await clearSiteData({ indexedDB: indexedDBFactory });

    const after = await openSecretStore({ indexedDB: indexedDBFactory });
    // Not "some fields missing", not "an empty wallet" — nothing at all.
    await expect(after.load()).resolves.toBeNull();
    after.close();
  });

  it('leaves the user at durability level "none", which mandates a disclosure', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await store.save(record());
    store.close();
    await clearSiteData({ indexedDB: indexedDBFactory });

    const after = await openSecretStore({ indexedDB: indexedDBFactory });
    const present = (await after.load()) !== null;
    after.close();

    const durability = describeDurability({ caps: { persistent: 'unavailable' }, recordPresent: present });
    expect(durability.level).toBe('none');
    expect(durability.durableCopy).toBe(false);
    // A wiped origin is indistinguishable from a fresh one, so the app must
    // disclose at the next funded moment instead of assuming it is new.
    expect(durability.wipeLossUndetectable).toBe(true);
    expect(en[durability.disclosureKey]).toBeTruthy();
  });

  it('RECOVERS from a wipe using a backup taken before it — the whole point of rank 2', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    const original = record();
    await store.save(original);
    const envelope = await encryptRecoveryRecord(original, PASSPHRASE, fast);
    store.close();

    // The event this design exists for.
    await clearSiteData({ indexedDB: indexedDBFactory });

    const wiped = await openSecretStore({ indexedDB: indexedDBFactory });
    await expect(wiped.load()).resolves.toBeNull();

    const recovered = await decryptRecoveryRecord(envelope, PASSPHRASE);
    expect(recovered.seed).toBe(SEED);
    expect(recovered.countersByKeyset).toEqual(original.countersByKeyset);
    expect(recovered.mintUrls).toEqual(original.mintUrls);

    // Restoring is an ordinary write, so the wallet is live again immediately.
    await wiped.save(recovered);
    expect((await wiped.load()).seed).toBe(SEED);
    wiped.close();
  });

  it('has no "belt and braces" second on-origin bucket to fall back to', async () => {
    // §5.6.2: storing the seed in localStorage + IndexedDB + OPFS + a cookie
    // buys NOTHING against clear-site-data, because they all die together.
    // This asserts the module never wrote a second copy anywhere: after a wipe,
    // nothing on the origin can resurrect the seed.
    //
    // Assertions made REAL (a review caught the earlier version of this test
    // passing vacuously): `databases()` existing is asserted rather than
    // defaulted to `[]`, localStorage is asserted to be a real API before the
    // absence claim means anything, and every database AND every key in it is
    // enumerated — not just the one name we expected to write.
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await store.save(record());
    store.close();

    // Before the wipe the database must actually exist, or "absent after" is
    // not a statement about anything.
    expect(typeof indexedDBFactory.databases).toBe('function');
    const before = await indexedDBFactory.databases();
    expect(before.map((d) => d.name)).toContain(DB_NAME);

    await clearSiteData({ indexedDB: indexedDBFactory });

    const after = await indexedDBFactory.databases();
    expect(after.map((d) => d.name)).not.toContain(DB_NAME);

    // Enumerate every remaining database and every key in it: a second bucket
    // under another name would be exactly the §5.6.2 defect.
    const residue = [];
    for (const info of after) {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDBFactory.open(info.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const storeName of Array.from(db.objectStoreNames)) {
        const tx = db.transaction(storeName, 'readonly');
        const keys = await new Promise((resolve, reject) => {
          const req = tx.objectStore(storeName).getAllKeys();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        residue.push(...keys.map((k) => `${info.name}/${storeName}/${k}`));
      }
      db.close();
    }
    expect(residue).toEqual([]);

    // localStorage: only a real claim if the API exists in this environment.
    expect(typeof globalThis.localStorage).toBe('object');
    const localKeys = [];
    for (let i = 0; i < globalThis.localStorage.length; i += 1) {
      localKeys.push(globalThis.localStorage.key(i));
    }
    expect(localKeys).toEqual([]);
  });

  it('REFUSES (does not hang) when the wipe is blocked by a live connection', async () => {
    // `deleteDatabase` fires `onblocked` when another tab or an open handle still
    // holds the database — not `onerror`. A promise that only listens for the
    // latter never settles, and a wipe helper that hangs is worse than one that
    // fails: the caller has no way to tell a blocked wipe from a slow one. A
    // test that never returns would also hang CI rather than report anything.
    const held = await openSecretStore({ indexedDB: indexedDBFactory });
    await held.save(record());
    await expect(clearSiteData({ indexedDB: indexedDBFactory })).rejects.toMatchObject({
      code: ERR.STORE_BLOCKED,
    });
    // The data is still there, and the store is still usable: a blocked wipe is
    // a no-op, not a half-delete.
    await expect(held.load()).resolves.toMatchObject({ seed: SEED });
    held.close();
    // With the connection closed the same call succeeds.
    await expect(clearSiteData({ indexedDB: indexedDBFactory })).resolves.toMatchObject({
      cleared: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Encrypted export: portable, opaque, and authenticated
// ─────────────────────────────────────────────────────────────────────────────

describe('encrypted export: portable and opaque, never called "protected"', () => {
  it('round-trips the full triple under the right passphrase', async () => {
    const original = record();
    const envelope = await encryptRecoveryRecord(original, PASSPHRASE, fast);
    const back = await decryptRecoveryRecord(envelope, PASSPHRASE);
    expect(back).toEqual({ ...original });
  });

  it('ships the N=2^17 scrypt cost, and travels the parameters with the blob', async () => {
    // The one case that pays the real cost. `encryptRecoveryRecord` with NO
    // env must use KDF_PARAMS — i.e. the fast path the other cases use is opt-in
    // only, and cannot leak into the shipped default.
    const envelope = await encryptRecoveryRecord(record(), PASSPHRASE);
    const parsed = JSON.parse(envelope);
    expect(KDF_PARAMS).toEqual({ N: 131072, r: 8, p: 1, dkLen: 32 });
    expect(parsed.kdf).toEqual({ name: 'scrypt', ...KDF_PARAMS });
    // And a blob made at the shipped cost decrypts at the shipped cost.
    await expect(decryptRecoveryRecord(envelope, PASSPHRASE)).resolves.toMatchObject({ seed: SEED });
    // Deliberately slow: two full-cost derivations (~0.7 s each idle, several
    // seconds on a loaded CI box). Keep the real cost, raise the budget.
  }, 60_000);

  it('falls back to a cheaper cost when the shipped one cannot be allocated', async () => {
    // A low-end phone can refuse the 128 MiB buffer. Falling back keeps the
    // export working; the envelope records WHICH cost was used, so the backup
    // still restores anywhere. The first attempt is made to fail like an OOM.
    expect(KDF_FALLBACK_PARAMS.N).toBeLessThan(KDF_PARAMS.N);
    expect(KDF_FALLBACK_PARAMS.N).toBeGreaterThanOrEqual(KDF_BOUNDS.minN);
    expect(KDF_BOUNDS.maxN).toBeGreaterThanOrEqual(KDF_PARAMS.N);

    const tried = [];
    const oomAtShippedCost = async (pw, salt, params) => {
      tried.push(params.N);
      if (params.N === KDF_PARAMS.N) throw new RangeError('Array buffer allocation failed');
      // Delegate the fallback attempt to the real derivation at its own cost.
      const real = await import('@noble/hashes/scrypt.js');
      return real.scryptAsync(pw, salt, params);
    };

    const envelope = await encryptRecoveryRecord(record(), PASSPHRASE, {
      scryptAsync: oomAtShippedCost,
    });
    const parsed = JSON.parse(envelope);
    // The fallback cost is what the envelope records — and it still decrypts.
    expect(tried).toEqual([KDF_PARAMS.N, KDF_FALLBACK_PARAMS.N]);
    expect(parsed.kdf).toMatchObject({ N: KDF_FALLBACK_PARAMS.N, r: 8, p: 1, dkLen: 32 });
    await expect(decryptRecoveryRecord(envelope, PASSPHRASE)).resolves.toMatchObject({ seed: SEED });
  }, 60_000);

  it('reports BOTH costs failing as a typed error, never a silent no-op', async () => {
    const alwaysOom = async () => {
      throw new RangeError('Array buffer allocation failed');
    };
    await expect(
      encryptRecoveryRecord(record(), PASSPHRASE, { scryptAsync: alwaysOom })
    ).rejects.toMatchObject({ code: ERR.KDF_FAILED });
  });

  it('carries NO plaintext seed, mint URL, counter or word from the phrase', async () => {
    const envelope = await encryptRecoveryRecord(record(), PASSPHRASE, fast);
    for (const word of SEED.split(' ')) {
      expect(envelope).not.toContain(word);
    }
    expect(envelope).not.toContain('minibits');
    expect(envelope).not.toContain('009a1f293253e41e');
    const parsed = JSON.parse(envelope);
    expect(parsed.magic).toBe(BACKUP_MAGIC);
    expect(parsed.aead).toBe('xchacha20poly1305');
    // KDF parameters travel with the blob so a future cost increase does not
    // strand backups made today.
    expect(parsed.kdf).toMatchObject({ name: 'scrypt', N: FAST_KDF.N, r: 8, p: 1 });
  });

  it('is non-deterministic: the same record encrypts to a different blob each time', async () => {
    const a = await encryptRecoveryRecord(record(), PASSPHRASE, fast);
    const b = await encryptRecoveryRecord(record(), PASSPHRASE, fast);
    expect(a).not.toBe(b);
  });

  it('refuses a wrong passphrase with a TYPED error, never a partial record', async () => {
    const envelope = await encryptRecoveryRecord(record(), PASSPHRASE, fast);
    await expect(decryptRecoveryRecord(envelope, 'wrong')).rejects.toMatchObject({
      code: ERR.WRONG_PASSPHRASE_OR_TAMPERED,
    });
  });

  it('detects tampering (Poly1305), and does not distinguish it from a wrong passphrase', async () => {
    const envelope = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, fast));
    const ct = Buffer.from(envelope.ct, 'base64');
    ct[0] ^= 0x01;
    envelope.ct = ct.toString('base64');
    await expect(decryptRecoveryRecord(JSON.stringify(envelope), PASSPHRASE)).rejects.toMatchObject(
      { code: ERR.WRONG_PASSPHRASE_OR_TAMPERED }
    );
  });

  it('rejects a non-backup, a version downgrade, and an empty passphrase', async () => {
    await expect(decryptRecoveryRecord('{"hello":"world"}', PASSPHRASE)).rejects.toMatchObject({
      code: ERR.NOT_A_BACKUP,
    });
    await expect(decryptRecoveryRecord('not json', PASSPHRASE)).rejects.toMatchObject({
      code: ERR.NOT_A_BACKUP,
    });
    const good = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, fast));
    await expect(
      decryptRecoveryRecord(JSON.stringify({ ...good, v: 2 }), PASSPHRASE)
    ).rejects.toMatchObject({ code: ERR.UNSUPPORTED_BACKUP_VERSION });
    await expect(encryptRecoveryRecord(record(), '', fast)).rejects.toMatchObject({
      code: ERR.EMPTY_PASSPHRASE,
    });
  });

  it('refuses every manipulated header: kdf, salt, nonce, aead, or version', async () => {
    // The parameters travel inside the file so old backups keep working. Whoever
    // supplies the file can also rewrite the parameters, so every field must be
    // refused when edited.
    //
    // Measured scope of this test (verified by mutation): it is driven by the
    // *validators and the key/nonce inputs*, NOT by the AEAD's AAD binding.
    // Replacing `canonicalHeader` with a constant leaves this test green, because
    // kdf/salt feed the derived key, nonce feeds the stream, and magic/v/aead are
    // rejected by explicit checks before any decryption. The AAD is
    // defence-in-depth for a future header field that is none of those three
    // things; do not read this test as proof that it works.
    // Built at N=2^11 (not the suite's usual 2^10) so "weaken N" is a real edit
    // rather than a no-op that would have made this case pass vacuously.
    const good = JSON.parse(
      await encryptRecoveryRecord(record(), PASSPHRASE, { kdfParams: { N: 2 ** 11 } })
    );
    expect(good.kdf.N).toBe(2 ** 11);
    const edits = {
      'kdf.N weakened to 1024': { ...good, kdf: { ...good.kdf, N: 2 ** 10 } },
      'kdf.N strengthened': { ...good, kdf: { ...good.kdf, N: 2 ** 12 } },
      'kdf.r raised': { ...good, kdf: { ...good.kdf, r: 9 } },
      'kdf.dkLen changed': { ...good, kdf: { ...good.kdf, dkLen: 16 } },
      'aead relabelled': { ...good, aead: 'aes-gcm' },
      'salt swapped': { ...good, salt: Buffer.alloc(16, 1).toString('base64') },
      'nonce swapped': { ...good, nonce: Buffer.alloc(24, 2).toString('base64') },
      'magic changed': { ...good, magic: 'NOT-A-BACKUP' },
      'version bumped': { ...good, v: 2 },
    };
    for (const [what, envelope] of Object.entries(edits)) {
      await expect(
        decryptRecoveryRecord(JSON.stringify(envelope), PASSPHRASE),
        `${what} must not be accepted`
      ).rejects.toBeInstanceOf(SecretStoreError);
    }
  });

  it('refuses an unbounded or malformed KDF header before deriving (memory-exhaustion guard)', async () => {
    const good = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, fast));
    const hostile = [
      { ...good, kdf: { ...good.kdf, N: 2 ** 30 } }, // ~1 TiB of scrypt memory
      { ...good, kdf: { ...good.kdf, N: 3 } }, // not a power of two
      { ...good, kdf: { ...good.kdf, N: 1.5 } },
      { ...good, kdf: { ...good.kdf, r: 4096 } },
      { ...good, kdf: { ...good.kdf, p: -1 } },
      { ...good, kdf: { ...good.kdf, dkLen: 1 } },
      { ...good, kdf: { name: 'argon2id', N: 1024, r: 8, p: 1, dkLen: 32 } },
      { ...good, kdf: undefined },
    ];
    for (const envelope of hostile) {
      // Typed, and quick: the point is that no derivation is attempted.
      const t0 = Date.now();
      await expect(decryptRecoveryRecord(JSON.stringify(envelope), PASSPHRASE)).rejects.toMatchObject(
        { code: ERR.UNSUPPORTED_KDF }
      );
      expect(Date.now() - t0).toBeLessThan(1000);
    }
  });

  it('refuses a header that is in-bounds per FIELD but not per PRODUCT (the real cost)', async () => {
    // Bounding N and r separately is not a memory guard: N=2^20 and r=16 both
    // pass, and 128·N·r is then 2 GiB in one allocation — a killed tab, not a
    // catchable error. The ceiling is the shipped KDF_PARAMS allocation.
    expect(128 * KDF_PARAMS.N * KDF_PARAMS.r).toBe(KDF_BOUNDS.maxMemoryBytes);
    const good = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, fast));
    const productBombs = [
      { ...good, kdf: { name: 'scrypt', N: 2 ** 20, r: 16, p: 1, dkLen: 32 } }, // 2 GiB
      { ...good, kdf: { name: 'scrypt', N: 2 ** 20, r: 8, p: 1, dkLen: 32 } }, // 1 GiB
      { ...good, kdf: { name: 'scrypt', N: 2 ** 18, r: 16, p: 1, dkLen: 32 } }, // 512 MiB
    ];
    for (const envelope of productBombs) {
      const t0 = Date.now();
      await expect(
        decryptRecoveryRecord(JSON.stringify(envelope), PASSPHRASE),
        `N=${envelope.kdf.N} r=${envelope.kdf.r} must be refused before deriving`
      ).rejects.toMatchObject({ code: ERR.UNSUPPORTED_KDF });
      expect(Date.now() - t0).toBeLessThan(1000);
    }
    // The ceiling is not a floor: a cheap-but-legal backup still restores, which
    // is what makes old backups safe if the shipped cost is ever raised.
    const cheap = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, { kdfParams: { N: 2 ** 12 } }));
    await expect(decryptRecoveryRecord(JSON.stringify(cheap), PASSPHRASE)).resolves.toMatchObject({
      seed: SEED,
    });
  });

  it('refuses to ENCRYPT with parameters it would refuse to decrypt (a caller bug, not a device limit)', async () => {
    // The two-attempt loop must not swallow this and retry at the fallback cost:
    // "your parameters were rejected" and "this device ran out of memory" are
    // different failures and the caller has to be able to tell them apart.
    for (const kdfParams of [{ N: 3 }, { N: 2 ** 30 }, { N: 2 ** 20, r: 16 }, { dkLen: 16 }]) {
      await expect(
        encryptRecoveryRecord(record(), PASSPHRASE, { kdfParams }),
        `kdfParams ${JSON.stringify(kdfParams)} must be refused, not retried`
      ).rejects.toMatchObject({ code: ERR.UNSUPPORTED_KDF });
    }
  });

  it('turns a mangled base64 field into a TYPED error, not a raw DOMException', async () => {
    const good = JSON.parse(await encryptRecoveryRecord(record(), PASSPHRASE, fast));
    for (const field of ['salt', 'nonce', 'ct']) {
      for (const bad of ['@@@', '', undefined, 42]) {
        await expect(
          decryptRecoveryRecord(JSON.stringify({ ...good, [field]: bad }), PASSPHRASE),
          `${field}=${String(bad)} must be typed`
        ).rejects.toMatchObject({ code: ERR.NOT_A_BACKUP });
      }
    }
    // Right alphabet, wrong length: also a typed refusal, before any derivation.
    await expect(
      decryptRecoveryRecord(JSON.stringify({ ...good, salt: Buffer.alloc(4, 1).toString('base64') }), PASSPHRASE)
    ).rejects.toMatchObject({ code: ERR.NOT_A_BACKUP });
  });

  it('refuses to ENCRYPT a triple that could not restore (counters missing)', async () => {
    await expect(
      encryptRecoveryRecord(
        { v: 1, seed: SEED, countersByKeyset: {}, mintUrls: ['https://m.test'] },
        PASSPHRASE,
        fast
      )
    ).rejects.toBeInstanceOf(SecretStoreError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Delivering the blob: Web Share first, download fallback, honest "no rail"
// ─────────────────────────────────────────────────────────────────────────────

describe('backup delivery: one tap where the platform allows it, honest fallback otherwise', () => {
  const backup = () => buildBackupFile('{"magic":"x"}', { now: 1_760_000_000_000 });

  it('names the file recognisably and without a per-second timestamp', () => {
    const b = backup();
    // 1_760_000_000_000 ms = 2025-10-09 UTC. Pinned so a future "helpful"
    // change to a per-second or locale-dependent name fails here.
    expect(b.filename).toBe('tollgate-wallet-backup-20251009.json');
  });

  it('shares the file when canShare({files}) says yes (Chrome Android, iOS Safari)', async () => {
    const calls = [];
    const nav = {
      canShare: () => true,
      share: async (data) => {
        calls.push(data);
      },
    };
    const result = await shareBackup(backup(), { navigator: nav });
    expect(result.state).toBe('shared');
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toHaveLength(1);
  });

  it('treats a dismissed share sheet as "cancelled", not as an error to report', async () => {
    const nav = {
      canShare: () => true,
      share: async () => {
        const err = new Error('dismissed');
        err.name = 'AbortError';
        throw err;
      },
    };
    const result = await shareBackup(backup(), { navigator: nav });
    expect(result.state).toBe('cancelled');
    // A dismissed sheet is NOT evidence of a backup: a caller that promoted the
    // wallet to "exported" here would tell the user they have a file they do not.
    expect(result.exportedAt).toBeNull();
  });

  it('falls back to a download when files cannot be shared (Firefox shares no files)', async () => {
    const clicked = [];
    const anchor = {
      set href(v) {
        clicked.push(`href:${v}`);
      },
      set download(v) {
        clicked.push(`download:${v}`);
      },
      click: () => clicked.push('click'),
      remove: () => {},
    };
    const doc = {
      createElement: () => anchor,
      body: { appendChild: () => {} },
    };
    const nav = { canShare: () => false };
    const revoked = [];
    const deferred = [];
    const urlApi = {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: (u) => revoked.push(u),
    };
    const result = await shareBackup(backup(), {
      navigator: nav,
      document: doc,
      urlApi,
      now: 1_760_000_000_000,
      defer: (fn) => deferred.push(fn),
    });
    expect(result.state).toBe('downloaded');
    expect(result.exportedAt).toBe(1_760_000_000_000);
    expect(clicked).toContain(`download:${backup().filename}`);
    expect(clicked).toContain('click');

    // The revoke must NOT happen in the same task as the click: Firefox can
    // abort the download when its blob URL dies first. This is the assertion the
    // earlier version of this test lacked, and the bug it let through.
    expect(revoked).toEqual([]);
    expect(deferred).toHaveLength(1);
    deferred[0]();
    expect(revoked).toEqual(['blob:test']);
  });

  it('says "unavailable" rather than silently dropping the backup', async () => {
    // No `document` key at all: the real "this context has no DOM" path, rather
    // than an explicit null which short-circuits the same check.
    const nav = {};
    const result = await shareBackup(backup(), { navigator: nav, urlApi: undefined });
    expect(result.state).toBe('unavailable');
    expect(result.exportedAt).toBeNull();
    // And the caller is told to hand the text over by hand, not left with nothing.
    expect(result.reason).toBeTruthy();
  });

  it('degrades to a download when Safari has already spent the user activation (NotAllowedError)', async () => {
    // The KDF runs before `share()`, so on iOS the transient activation is
    // usually gone and `share()` rejects. That must still produce a file — the
    // module's own docstring says so — rather than surfacing an error to a user
    // whose backup is their only copy.
    const clicked = [];
    const anchor = {
      set href(v) {
        clicked.push(`href:${v}`);
      },
      set download(v) {
        clicked.push(`download:${v}`);
      },
      click: () => clicked.push('click'),
      remove: () => {},
    };
    const nav = {
      canShare: () => true,
      share: async () => {
        const err = new Error('user activation required');
        err.name = 'NotAllowedError';
        throw err;
      },
    };
    const result = await shareBackup(backup(), {
      navigator: nav,
      document: { createElement: () => anchor, body: { appendChild: () => {} } },
      urlApi: { createObjectURL: () => 'blob:ios', revokeObjectURL: () => {} },
      defer: () => {},
    });
    expect(result.state).toBe('downloaded');
    expect(result.exportedAt).not.toBeNull();
    expect(clicked).toContain('click');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. persist() is best-effort and secure-context-gated — never a guarantee
// ─────────────────────────────────────────────────────────────────────────────

describe('persistence request: reports the truth on the plain-HTTP portal origin', () => {
  it('reports "unavailable" where navigator.storage.persist does not exist', async () => {
    const result = await requestPersistentStorage({ storage: { persist: undefined } });
    expect(result.state).toBe('unavailable');
    expect(result.reason).toMatch(/secure-context-gated/);
  });

  it('reports granted and denied distinctly, with the eviction class each buys', async () => {
    await expect(
      requestPersistentStorage({ storage: { persist: async () => true } })
    ).resolves.toMatchObject({ state: 'granted' });
    const denied = await requestPersistentStorage({ storage: { persist: async () => false } });
    expect(denied.state).toBe('denied');
    expect(denied.reason).toMatch(/evictable/);
  });

  it('never claims eviction-proof storage even when granted', async () => {
    const granted = await requestPersistentStorage({ storage: { persist: async () => true } });
    expect(granted.reason).toMatch(/NOT clear-site-data/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The cap T — the promise that makes the rest safe
// ─────────────────────────────────────────────────────────────────────────────

describe('resting cap: "the most you can lose is T" is classified honestly', () => {
  it('is "ok" inside the cap with a durable copy already taken', () => {
    expect(enforceRestingCap({ balanceSats: 40, capSats: 80, lastExportAt: 1 })).toMatchObject({
      state: 'ok',
      maxLossSats: 80,
      mustExport: false,
    });
  });

  it('demands an export when value exists but no durable copy does', () => {
    expect(enforceRestingCap({ balanceSats: 40, capSats: 80 })).toMatchObject({
      state: 'export-due',
      mustExport: true,
    });
  });

  it('flags over-cap loudly — the promise is already broken at that point', () => {
    const verdict = enforceRestingCap({ balanceSats: 81, capSats: 80, lastExportAt: 1 });
    expect(verdict.state).toBe('over-cap');
    expect(verdict.mustExport).toBe(true);
    expect(verdict.reason).toMatch(/promise is already broken/);
    // The reported max loss is the ACTUAL balance, not the cap.
    expect(verdict.maxLossSats).toBe(81);
  });

  it('treats a zero balance as nothing-to-lose, not as a pending export', () => {
    expect(enforceRestingCap({ balanceSats: 0, capSats: 80 })).toMatchObject({ state: 'ok' });
  });

  it('refuses to round an UNKNOWN balance up to healthy', () => {
    // The mint is unreachable, or the amount failed to parse. "I do not know" is
    // the most dangerous state for a promise about how much can be lost, so it
    // must never come back as `ok` / no-export-needed.
    for (const unknown of [undefined, null, NaN, Infinity, '40', {}]) {
      const verdict = enforceRestingCap({ balanceSats: unknown, capSats: 80 });
      expect(verdict.state, `balance ${String(unknown)}`).toBe('unknown');
      expect(verdict.mustExport).toBe(true);
      expect(verdict.maxLossSats).toBeNull();
      expect(verdict.reason).toMatch(/NOT bounded/);
    }
  });

  it('treats a falsy or nonsense lastExportAt as NO export, not as "exported in 1970"', () => {
    // `0` is the default a caller reaches for when it means "not set". Reading it
    // as a timestamp would promote unexported funds to `ok` — the exact lie the
    // module exists to prevent. `NaN`, a negative and a string are the same class.
    for (const bogus of [0, -1, NaN, '1760000000000', Infinity]) {
      const verdict = enforceRestingCap({ balanceSats: 40, capSats: 80, lastExportAt: bogus });
      expect(verdict.state, `lastExportAt ${String(bogus)}`).toBe('export-due');
      expect(verdict.mustExport, `lastExportAt ${String(bogus)}`).toBe(true);
    }
    // A real evidence timestamp still suppresses the prompt.
    expect(enforceRestingCap({ balanceSats: 40, capSats: 80, lastExportAt: 1_760_000_000_000 }).state).toBe('ok');
  });

  it('refuses a missing or nonsense cap instead of defaulting it to zero', () => {
    // Defaulting capSats to 0 would turn every positive balance into over-cap,
    // which silently reports the promise as broken for a config mistake.
    for (const bad of [undefined, null, NaN, 0, -1, '80']) {
      expect(() => enforceRestingCap({ balanceSats: 40, capSats: bad }), `cap ${String(bad)}`).toThrow(
        /capSats must be a positive finite number/
      );
    }
  });

  it('never smooths over-cap or unknown back to ok, whatever lastExportAt says', () => {
    // A durable copy does not rescue the cap promise: the money is still at risk
    // of the user's device, not of eviction. Keep the two independent.
    expect(
      enforceRestingCap({ balanceSats: 200, capSats: 80, lastExportAt: 1 }).state
    ).toBe('over-cap');
    expect(enforceRestingCap({ balanceSats: NaN, capSats: 80, lastExportAt: 1 }).state).toBe(
      'unknown'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Disclosure wording — the forbidden claims are absent from the catalog
// ─────────────────────────────────────────────────────────────────────────────

describe('disclosure copy: EVERY secret_* string may not say the false things (§5.6.6)', () => {
  // Scan the whole added namespace, not a hand-picked subset: an earlier version
  // of this suite listed 8 keys and would have stayed green if, say,
  // `secret_persist_granted` were reworded to "encrypted at rest, so it is
  // protected" — the exact claim the module exists to refuse.
  const secretKeys = Object.keys(en).filter((k) => k.startsWith('secret_'));
  const requiredKeys = [
    'secret_disclosure_none',
    'secret_disclosure_evictable',
    'secret_disclosure_exported',
    'secret_loss_cap',
    'secret_loss_over_cap',
  ];

  it('finds the whole namespace, not just the keys the helper returns', () => {
    // 19 today; a floor, not an equality, so adding a string cannot fail here —
    // but dropping the namespace (or a key rename) can.
    expect(secretKeys.length).toBeGreaterThanOrEqual(19);
    for (const key of requiredKeys) expect(secretKeys).toContain(key);
  });

  it('defines every key the durability helper can return, non-empty', () => {
    for (const key of secretKeys) {
      expect(typeof en[key], `${key} must be a string`).toBe('string');
      expect(en[key].trim().length, `${key} must not be empty`).toBeGreaterThan(0);
    }
  });

  it('never claims safety, custody, a keychain, or that encryption protects the money', () => {
    const forbidden = [
      /your money is safe/i,
      /the money is safe/i,
      /is safe to use/i,
      /secure enclave/i,
      /keychain/i,
      /keystore/i,
      /hardware-backed/i,
      /encrypted at rest/i,
      /protected by encryption/i,
      /we can recover it for you/i,
      /sign in to restore/i,
    ];
    for (const key of secretKeys) {
      for (const pattern of forbidden) {
        expect(en[key], `${key} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('states the loss cap by name, and does not promise recovery from the seed alone', () => {
    expect(en.secret_loss_cap).toMatch(/\{\{cap\}\}/);
    // The over-cap string is the honest counterpart: a user holding MORE than the
    // cap must not be shown "the most you can lose is {{cap}}".
    expect(en.secret_loss_over_cap).toMatch(/\{\{cap\}\}/);
    for (const key of secretKeys) {
      expect(en[key]).not.toMatch(/restore from the seed alone/i);
    }
  });

  it('does not let the persist-granted string out-claim the module itself', () => {
    // `requestPersistentStorage` reports "survives storage pressure, NOT
    // clear-site-data". The user-facing string must not contradict it.
    expect(en.secret_persist_granted).not.toMatch(/until you clear/i);
    expect(en.secret_persist_granted).toMatch(/clear site data|reset|storage pressure/i);
  });

  it('never asserts a wiped device is a BRAND NEW one', () => {
    // A wipe is indistinguishable from a fresh install, which is why the module
    // reports `wipeLossUndetectable`. "...on it yet" would assert newness.
    expect(en.secret_disclosure_none).not.toMatch(/yet/i);
    expect(en.secret_disclosure_none).toMatch(/erased|no wallet is stored/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. The durability verdict is driven by EVIDENCE, not by intent
// ─────────────────────────────────────────────────────────────────────────────

describe('durability: "you have a backup" is only said after a backup actually left', () => {
  it('does not accept a cancelled share as evidence', async () => {
    const nav = {
      canShare: () => true,
      share: async () => {
        const err = new Error('dismissed');
        err.name = 'AbortError';
        throw err;
      },
    };
    const evidence = await shareBackup(buildBackupFile('{"a":1}'), { navigator: nav });
    expect(evidence.exportedAt).toBeNull();
    // Feeding that to the verdict must NOT produce 'exported'.
    expect(
      describeDurability({ recordPresent: true, lastExportAt: evidence.exportedAt }).level
    ).toBe('evictable');
  });

  it('promotes to "exported" only when an exportedAt was returned', () => {
    const verdict = describeDurability({ recordPresent: true, lastExportAt: 1_760_000_000_000 });
    expect(verdict.level).toBe('exported');
    expect(verdict.durableCopy).toBe(true);
    expect(verdict.wipeLossUndetectable).toBe(false);
  });

  it('does not promote on a falsy or nonsense lastExportAt', () => {
    // The "you have a backup file you can restore from on another device" string
    // is the most consequential sentence in the module. A caller that defaults
    // `lastExportAt` to `0` must land on `evictable`, not on that string.
    for (const bogus of [0, -1, NaN, '1760000000000', Infinity, undefined]) {
      const verdict = describeDurability({ recordPresent: true, lastExportAt: bogus });
      expect(verdict.level, `lastExportAt ${String(bogus)}`).toBe('evictable');
      expect(verdict.durableCopy, `lastExportAt ${String(bogus)}`).toBe(false);
      expect(verdict.disclosureKey, `lastExportAt ${String(bogus)}`).not.toBe('secret_disclosure_exported');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. A corrupt stored record is refused on READ, not handed to the caller
// ─────────────────────────────────────────────────────────────────────────────

describe('stored record: re-validated on load, so a bad write cannot become a wallet', () => {
  it('refuses a record that is invalid but present (a future version, or devtools)', async () => {
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    // Bypass `save`'s validation the way a hand edit or a future writer would.
    const raw = await new Promise((resolve, reject) => {
      const openReq = indexedDBFactory.open(DB_NAME);
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    await new Promise((resolve, reject) => {
      const tx = raw.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(
        { v: 1, seed: 'not a mnemonic', countersByKeyset: {}, mintUrls: [], keysetPolicy: 'deterministic' },
        RECORD_KEY
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    raw.close();

    await expect(store.load()).rejects.toMatchObject({ code: ERR.CORRUPT_RECORD });
    store.close();
  });
});
