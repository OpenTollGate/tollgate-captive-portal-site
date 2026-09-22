import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestInvoice, getInvoiceStatus } from '../../src/helpers/lightning.js';
import { getClientMac } from '../../src/helpers/tollgate.js';

// Bug B (A): the portal knows its client MAC from the /whoami device info
// (`mac=00:11:22:33:44:55` -> deviceInfo {type:'mac', value}). The backend's
// lightning handler reads it from the "mac" query parameter and only falls back
// to an IP-derived lookup when it is empty, so both the invoice CREATE and the
// STATUS POLL must carry it.
const MAC = '00:11:22:33:44:55';
const deviceInfo = { type: 'mac', value: MAC };

const i18n = (key) => key;

const jsonResponse = (payload, ok = true) => ({
  ok,
  headers: { get: () => 'application/json' },
  json: async () => payload,
});

const stubFetch = (payload) => {
  const mock = vi.fn(async () => jsonResponse(payload));
  vi.stubGlobal('fetch', mock);
  return mock;
};

const lastCall = (mock) => {
  const [url, options = {}] = mock.mock.calls.at(-1);
  return { url: new URL(url), raw: url, options };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getClientMac', () => {
  it('extracts the MAC from the /whoami device info the portal already holds', () => {
    expect(getClientMac(deviceInfo)).toBe(MAC);
  });

  it('returns an empty string when there is no MAC identity to send', () => {
    expect(getClientMac(null)).toBe('');
    expect(getClientMac(undefined)).toBe('');
    expect(getClientMac({})).toBe('');
    // a non-mac identity (e.g. an IP-derived one) must never be sent as "mac"
    expect(getClientMac({ type: 'ip', value: '10.0.0.1' })).toBe('');
    expect(getClientMac({ type: 'mac', value: '   ' })).toBe('');
  });
});

describe('lightning invoices carry the client MAC', () => {
  it('invoice STATUS POLL includes ?quote=...&mac=...', async () => {
    const mock = stubFetch({
      status: 1,
      quote: 'test-quote',
      state: 'UNPAID',
      access_granted: false,
    });

    const result = await getInvoiceStatus('test-quote', i18n, deviceInfo);

    expect(result.status).toBe(1);
    const { url, raw } = lastCall(mock);
    expect(url.pathname).toBe('/ln-invoice');
    expect(url.searchParams.get('quote')).toBe('test-quote');
    expect(url.searchParams.get('mac')).toBe(MAC);
    // the MAC is URL-encoded in the raw query string (colons -> %3A)
    expect(raw).toContain(`quote=test-quote&mac=${encodeURIComponent(MAC)}`);
  });

  it('invoice CREATE (POST) includes the mac query parameter', async () => {
    const mock = stubFetch({
      status: 1,
      quote: 'test-quote',
      invoice: 'lnbc1test',
      mint_url: 'https://mint.minibits.cash/Bitcoin',
      amount: 210,
      expiry: 0,
      state: 'UNPAID',
    });

    const result = await requestInvoice(210, 'https://mint.minibits.cash/Bitcoin', i18n, deviceInfo);

    expect(result.status).toBe(1);
    const { url, options } = lastCall(mock);
    expect(options.method).toBe('POST');
    expect(url.pathname).toBe('/ln-invoice');
    expect(url.searchParams.get('mac')).toBe(MAC);
    // the POST body is unchanged — the backend still gets amount + mint_url
    expect(JSON.parse(options.body)).toEqual({
      amount: 210,
      mint_url: 'https://mint.minibits.cash/Bitcoin',
    });
  });

  it('still polls without a mac when the portal has no MAC identity', async () => {
    const mock = stubFetch({ status: 1, quote: 'test-quote', state: 'UNPAID' });

    const result = await getInvoiceStatus('test-quote', i18n, undefined);

    expect(result.status).toBe(1);
    const { url } = lastCall(mock);
    expect(url.searchParams.has('mac')).toBe(false);
    expect(url.search).toBe('?quote=test-quote');
  });

  it('URL-encodes a quote that needs escaping and keeps the mac param intact', async () => {
    const mock = stubFetch({ status: 1, quote: 'a b/c', state: 'UNPAID' });

    await getInvoiceStatus('a b/c', i18n, deviceInfo);

    const { url } = lastCall(mock);
    expect(url.searchParams.get('quote')).toBe('a b/c');
    expect(url.searchParams.get('mac')).toBe(MAC);
  });
});
