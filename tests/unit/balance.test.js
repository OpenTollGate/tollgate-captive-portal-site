import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getInternetBalance,
  formatBalance,
  fetchBalanceData,
  formatMetricValue,
  getMetricLabel,
} from '../../src/helpers/balance.js';

// ---------------------------------------------------------------------------
// Characterization tests for the "internet balance" layer.
//
// The module already exists; these tests pin the behaviour it has today. They
// are load-bearing: every assertion below was checked against a mutation of the
// module (each helper's return value flipped) and failed there — the mutation
// run is recorded in the PR body for this change.
// ---------------------------------------------------------------------------

// Real 1-sat v4 (`cashuB`) note from mint.coinos.io, the same production
// fixture tests/unit/mint-fee.test.js reasons about. Using a REAL token keeps
// the "valid balance" case honest: validateToken actually decodes it.
const REAL_TOKEN =
  'cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O';

const i18n = (key, fallback) => (fallback !== undefined ? fallback : key);

const SAT_MINT = {
  url: 'https://mint.coinos.io',
  price: 1,
  unit: 'sat',
  metric: 'milliseconds',
  step_size: 60000,
  min_steps: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getInternetBalance', () => {
  it('returns the token amount and the allocation it buys', () => {
    const result = getInternetBalance(REAL_TOKEN, SAT_MINT, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(1);
    expect(result.value.unit).toBe('sat');
    // 1 sat at 1 sat/step with a 60 s step buys 60 s, which formatTimeInSeconds
    // renders in its largest fitting unit: 1 minute
    expect(result.value.allocation).toEqual({ value: 1, unit: 'minute' });
  });

  it('passes an invalid token straight through without deriving a balance', () => {
    const result = getInternetBalance('not-a-cashu-token', SAT_MINT, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU101');
    expect(result.value).toBeUndefined();
  });

  it('reports an empty token as CU100 rather than throwing', () => {
    const result = getInternetBalance('', SAT_MINT, i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('CU100');
  });
});

describe('formatBalance', () => {
  it('joins value and unit', () => {
    expect(formatBalance({ value: 10, unit: 'min' })).toBe('10 min');
  });

  it('renders empty for a missing allocation', () => {
    expect(formatBalance(null)).toBe('');
    expect(formatBalance(undefined)).toBe('');
  });

  it('renders empty when the value is null', () => {
    expect(formatBalance({ value: null, unit: 'min' })).toBe('');
  });
});

describe('fetchBalanceData', () => {
  it('reads the balance from the tollgate :2121 backend', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ remaining: 42 }) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBalanceData(i18n);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/:2121\/balance$/);
    expect(result).toEqual({ status: 1, value: { remaining: 42 } });
  });

  it('reports a non-OK response as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const result = await fetchBalanceData(i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('network');
    expect(result.message).toBe('Balance unavailable');
  });

  it('reports a thrown request as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await fetchBalanceData(i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe('network');
  });
});

describe('formatMetricValue', () => {
  it('renders an em dash for a missing amount', () => {
    expect(formatMetricValue(undefined, 'bytes')).toBe('—');
    expect(formatMetricValue(null, 'bytes')).toBe('—');
  });

  it('treats zero as a real amount, not as missing', () => {
    expect(formatMetricValue(0, 'bytes')).toBe('0 B');
    expect(formatMetricValue(0, 'milliseconds')).toBe('0s');
  });

  it('scales byte amounts through B/KB/MB/GB', () => {
    expect(formatMetricValue(512, 'bytes')).toBe('512 B');
    expect(formatMetricValue(2048, 'bytes')).toBe('2 KB');
    expect(formatMetricValue(3 * 1048576, 'bytes')).toBe('3.0 MB');
    expect(formatMetricValue(2 * 1073741824, 'bytes')).toBe('2.0 GB');
  });

  it('scales time amounts through seconds/minutes/hours', () => {
    expect(formatMetricValue(45 * 1000, 'milliseconds')).toBe('45s');
    expect(formatMetricValue(90 * 1000, 'milliseconds')).toBe('1 min');
    expect(formatMetricValue((3600 + 120) * 1000, 'milliseconds')).toBe('1h 2m');
  });
});

describe('getMetricLabel', () => {
  it('labels bytes and time, translating when a t is supplied', () => {
    expect(getMetricLabel('bytes')).toBe('Data');
    expect(getMetricLabel('milliseconds')).toBe('Time');
    expect(getMetricLabel('bytes', (k) => `T:${k}`)).toBe('T:balance_data');
    expect(getMetricLabel('milliseconds', (k) => `T:${k}`)).toBe('T:balance_time');
  });
});
