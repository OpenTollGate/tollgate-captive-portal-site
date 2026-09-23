import { describe, it, expect } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';
import { mintUrlFromToken, normalizeMintUrl, findMintOption } from '../../src/helpers/cashu.js';

// ---------------------------------------------------------------------------
// Real production fixtures (same bytes as tests/unit/mint-fee.test.js).
//
// COINOS_TOKEN is a REAL v4 (`cashuB`) note from mint.coinos.io: 1 sat, one
// proof, unit sat, keyset id `01182e5f5e35aecd` (a v2 SHORT id — the exact
// shape cashu-ts cannot map without the mint's keysets, so the decode must go
// through the keyset-agnostic `getTokenMetadata` path).
// ---------------------------------------------------------------------------
const COINOS_TOKEN =
  "cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O";

// MINIBITS_TOKEN mirrors the Minibits shape: an 8-byte (16 hex char) v2 short
// keyset id, 1 sat, one proof, mint https://mint.minibits.cash/Bitcoin.
const MINIBITS_TOKEN = getEncodedToken({
  mint: 'https://mint.minibits.cash/Bitcoin',
  unit: 'sat',
  proofs: [
    {
      amount: 1,
      id: '01fc0ec0e59cd6fa',
      secret: 'minibits-fixture-secret',
      C: `02${'a'.repeat(64)}`,
    },
  ],
});

const CUBA_TOKEN = getEncodedToken({
  mint: 'https://mint.cubabitcoin.org',
  unit: 'sat',
  proofs: [
    {
      amount: 1,
      id: '01ad268c4d1f5826',
      secret: 'cuba-fixture-secret',
      C: `02${'a'.repeat(64)}`,
    },
  ],
});

describe('mintUrlFromToken', () => {
  it('returns the coinos mint URL embedded in a real v4 cashuB note', () => {
    expect(COINOS_TOKEN.startsWith('cashuB')).toBe(true);
    expect(mintUrlFromToken(COINOS_TOKEN)).toBe('https://mint.coinos.io');
  });

  it('returns the Minibits mint URL embedded in a short-keyset note', () => {
    expect(mintUrlFromToken(MINIBITS_TOKEN)).toBe('https://mint.minibits.cash/Bitcoin');
  });

  it('tolerates surrounding whitespace', () => {
    expect(mintUrlFromToken(`  ${COINOS_TOKEN}\n`)).toBe('https://mint.coinos.io');
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
    ['not a cashu token', 'https://example.com/note'],
    ['the bare prefix', 'cashuB'],
    ['a truncated cashuB note', COINOS_TOKEN.slice(0, 40)],
    ['garbage after the prefix', 'cashuBnot-valid-cbor!!'],
    ['a truncated cashuA payload', 'cashuAabcdef'],
  ])('returns null (and never throws) for %s', (_label, input) => {
    let result;
    expect(() => {
      result = mintUrlFromToken(input);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe('normalizeMintUrl', () => {
  it('treats scheme, trailing slash and case as the same mint', () => {
    const canonical = normalizeMintUrl('https://mint.example.com');
    expect(canonical).toBeTruthy();
    expect(normalizeMintUrl('https://mint.example.com/')).toBe(canonical);
    expect(normalizeMintUrl('http://mint.example.com')).toBe(canonical);
    expect(normalizeMintUrl('HTTPS://Mint.Example.COM//')).toBe(canonical);
    expect(normalizeMintUrl('  https://mint.example.com  ')).toBe(canonical);
    expect(normalizeMintUrl('https://mint.example.com:443')).toBe(canonical);
  });

  it('does not fold a different host or path together', () => {
    const canonical = normalizeMintUrl('https://mint.example.com');
    expect(normalizeMintUrl('https://mint.other.com')).not.toBe(canonical);
    expect(normalizeMintUrl('https://mint.example.com.evil.io')).not.toBe(canonical);
    expect(normalizeMintUrl('https://mint.example.com/b')).not.toBe(canonical);
  });

  it('returns null for anything that is not a usable URL string', () => {
    for (const input of ['', '   ', null, undefined, 42, {}, []]) {
      expect(normalizeMintUrl(input)).toBeNull();
    }
  });
});

// The options the router advertises (shape of getAccessOptions() output).
const options = [
  { url: 'https://mint.minibits.cash/Bitcoin', price: 100, unit: 'sat', asset_type: 'cashu' },
  { url: 'https://mint.example.com', price: 210, unit: 'sat', asset_type: 'cashu' },
];

describe('findMintOption', () => {
  it('matches every scheme/trailing-slash/case variant of the same mint', () => {
    for (const variant of [
      'https://mint.example.com',
      'https://mint.example.com/',
      'http://mint.example.com',
      'HTTPS://MINT.EXAMPLE.COM',
    ]) {
      expect(findMintOption(variant, options)).toBe(options[1]);
    }
  });

  it('matches the advertised minibits URL against the note spelling', () => {
    expect(findMintOption('https://mint.minibits.cash/Bitcoin', options)).toBe(options[0]);
  });

  it('returns null for a mint the router does not accept', () => {
    expect(findMintOption('https://mint.cubabitcoin.org', options)).toBeNull();
    expect(findMintOption('https://mint.other.com', options)).toBeNull();
  });

  it('returns null (no throw) for missing/empty inputs', () => {
    expect(findMintOption(null, options)).toBeNull();
    expect(findMintOption('https://mint.example.com', [])).toBeNull();
    expect(findMintOption('https://mint.example.com', undefined)).toBeNull();
    expect(findMintOption(undefined, null)).toBeNull();
  });

  it('resolves a real note to the advertised option the note came from', () => {
    expect(findMintOption(mintUrlFromToken(COINOS_TOKEN), [
      { url: 'http://mint.coinos.io/', price: 210, unit: 'sat' },
      { url: 'https://mint.cubabitcoin.org', price: 100, unit: 'sat' },
    ]).url).toBe('http://mint.coinos.io/');
    expect(findMintOption(mintUrlFromToken(CUBA_TOKEN), [
      { url: 'https://mint.coinos.io', price: 210, unit: 'sat' },
    ])).toBeNull();
  });
});
