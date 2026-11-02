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
  KDF_PARAMS,
  SecretStoreError,
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
// is right for a one-off export/restore and wrong for a 38-case unit suite, so
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

  it('rejects a missing or empty countersByKeyset — a seed alone cannot restore', () => {
    expect(() => record({ countersByKeyset: undefined })).toThrow(SecretStoreError);
    expect(() => record({ countersByKeyset: {} })).toThrow(/countersByKeyset is empty/);
  });

  it('rejects a non-integer or negative counter', () => {
    const verdict = validateRecoveryRecord({
      ...record(),
      countersByKeyset: { '009a1f293253e41e': 1.5 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(ERR.MISSING_COUNTERS);
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
    const store = await openSecretStore({ indexedDB: indexedDBFactory });
    await store.save(record());
    store.close();
    await clearSiteData({ indexedDB: indexedDBFactory });

    const databases =
      typeof indexedDBFactory.databases === 'function'
        ? await indexedDBFactory.databases()
        : [];
    expect(databases.map((d) => d.name)).not.toContain(DB_NAME);
    expect(globalThis.localStorage?.getItem?.(`${DB_NAME}.seed`) ?? null).toBeNull();
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
    await expect(shareBackup(backup(), { navigator: nav })).resolves.toEqual({ state: 'cancelled' });
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
    const urlApi = {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {},
    };
    const result = await shareBackup(backup(), { navigator: nav, document: doc, urlApi });
    expect(result.state).toBe('downloaded');
    expect(clicked).toContain(`download:${backup().filename}`);
    expect(clicked).toContain('click');
  });

  it('says "unavailable" rather than silently dropping the backup', async () => {
    await expect(shareBackup(backup(), { navigator: {}, document: null })).resolves.toMatchObject({
      state: 'unavailable',
    });
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

describe('resting cap: "the most you can lose is T" is enforced, not asserted', () => {
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
  });

  it('treats a zero balance as nothing-to-lose, not as a pending export', () => {
    expect(enforceRestingCap({ balanceSats: 0, capSats: 80 })).toMatchObject({ state: 'ok' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Disclosure wording — the forbidden claims are absent from the catalog
// ─────────────────────────────────────────────────────────────────────────────

describe('disclosure copy: the catalog may not say the false things (§5.6.6)', () => {
  const requiredKeys = [
    'secret_disclosure_none',
    'secret_disclosure_evictable',
    'secret_disclosure_exported',
    'secret_loss_cap',
    'secret_export_action',
    'secret_export_passphrase_label',
    'secret_export_warning',
    'secret_restore_action',
  ];

  it('defines every key the durability helper can return', () => {
    for (const key of requiredKeys) {
      expect(en[key], `${key} must be defined in public/locales/en.json`).toBeTruthy();
      expect(typeof en[key]).toBe('string');
      expect(en[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('never claims safety, custody, a keychain, or that encryption protects the money', () => {
    const forbidden = [
      /your money is safe/i,
      /secure enclave/i,
      /os keychain/i,
      /keychain/i,
      /encrypted at rest/i,
      /protected by encryption/i,
      /we can recover it for you/i,
      /sign in to restore/i,
    ];
    for (const key of requiredKeys) {
      for (const pattern of forbidden) {
        expect(en[key], `${key} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('states the loss cap by name, and does not promise recovery from the seed alone', () => {
    expect(en.secret_loss_cap).toMatch(/\{\{cap\}\}/);
    for (const key of requiredKeys) {
      expect(en[key]).not.toMatch(/restore from the seed alone/i);
    }
  });
});
