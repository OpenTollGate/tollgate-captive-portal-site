import { describe, it, expect } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';
import { validateToken } from '../../src/helpers/cashu.js';

const i18n = (key) => key;

const buildV4Token = (amounts) =>
  getEncodedToken({
    mint: 'https://mint.minibits.cash/Bitcoin',
    unit: 'sat',
    proofs: amounts.map((amount, i) => ({
      amount,
      id: '00ad268c4d1f5826',
      secret: `secret-${i}`,
      C: `02${'a'.repeat(64)}`,
    })),
  });

// Build a v4 token whose proofs carry a v2 SHORT keyset id (`01`-prefixed).
// This is the exact Bug A trigger: cashu-ts's getDecodedToken(token) (no
// keysets) throws "A short keyset ID v2 was encountered, but got no keysets
// to map it to." on such tokens — the portal was misreporting that as CU102
// and the operator could never pay. coinos.io and minibits note mint both
// rotate short v2 keysets, so this shape is production-real.
const buildV4ShortKeysetToken = (amounts) =>
  getEncodedToken({
    mint: 'https://mint.minibits.cash/Bitcoin',
    unit: 'sat',
    proofs: amounts.map((amount, i) => ({
      amount,
      id: '01ad268c4d1f5826',
      secret: `secret-${i}`,
      C: `02${'a'.repeat(64)}`,
    })),
  });

const buildV2Token = (amounts) => {
  const payload = {
    token: [
      {
        mint: 'https://mint.minibits.cash/Bitcoin',
        proofs: amounts.map((amount, i) => ({
          amount,
          id: '00ad268c4d1f5826',
          secret: `secret-${i}`,
          C: `02${'a'.repeat(64)}`,
        })),
      },
    ],
  };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `cashuA${b64}`;
};

describe('validateToken', () => {
  it('decodes a v4 (cashuB/CBOR) token and sums its proofs', () => {
    const token = buildV4Token([200, 10]);
    expect(token.startsWith('cashuB')).toBe(true);

    const result = validateToken(token, undefined, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(210);
    expect(result.value.proofCount).toBe(2);
    expect(result.value.unit).toBe('sat');
  });

  it('BUG A regression: decodes a v4 token with a v2 SHORT keyset id — does NOT bounce to CU102', () => {
    // coinos.io / minibits notes use short v2 keyset ids. Before the fix, this
    // token threw inside getDecodedToken(token) and the portal returned CU102,
    // so the operator could never pay. It must now decode to a valid value.
    const token = buildV4ShortKeysetToken([200, 10]);
    expect(token.startsWith('cashuB')).toBe(true);

    const result = validateToken(token, undefined, i18n);
    expect(result.status).toBe(1);
    expect(result.code).toBeUndefined();
    expect(result.value.amount).toBe(210);
    expect(result.value.proofCount).toBe(2);
    expect(result.value.unit).toBe('sat');
  });

  it('still decodes a legacy v2 (cashuA) token', () => {
    const token = buildV2Token([64, 32]);
    expect(token.startsWith('cashuA')).toBe(true);

    const result = validateToken(token, undefined, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(96);
    expect(result.value.proofCount).toBe(2);
  });

  it('rejects a token that cannot be decoded with CU102', () => {
    const result = validateToken('cashuBnot-valid-cbor!!', undefined, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU102');
  });

  it('rejects an empty token with CU100', () => {
    const result = validateToken('', undefined, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU100');
  });

  it('rejects a non-cashu string with CU101', () => {
    const result = validateToken('lnbc1notacashutoken', undefined, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU101');
  });
});
