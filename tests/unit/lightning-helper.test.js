// Tests for src/helpers/lightning.js — 65.09% on the baseline.
//
// Every export is a `fetch` call against the backend's /ln-invoice route, and
// the interesting behaviour is in the ENVELOPE each one returns: the mac query
// that must (or must not) be appended, and the LN003/LN004 error objects the
// Lightning component renders. The capability probe deserves its own coverage
// because it is what decides whether the Lightning tab is offered at all on
// older backend builds.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/helpers/tollgate.js reads window.location.hostname at import time; jsdom's
// default origin is http://localhost/, which is also the hostname that arms the
// demo fallback. Pin a real portal host before the module graph loads.
vi.stubGlobal('location', { hostname: 'portal.test' });

const lightning = await import('../../src/helpers/lightning.js');
const { probeLightningCapability, requestInvoice, getInvoiceStatus } = lightning;

const i18n = (key) => key;
const deviceInfo = { type: 'mac', value: '00:11:22:33:44:55' };

const jsonResponse = (body, init = {}) => ({
  ok: true,
  ...init,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const headers = (contentType) => ({ get: () => contentType });

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('location', { hostname: 'portal.test' });
  vi.restoreAllMocks();
});

describe('probeLightningCapability', () => {
  it('reports support when the route answers with our JSON envelope', async () => {
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({ status: 0, error: 'quote is required' }),
      headers: headers('application/json'),
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: true });
    // A GET with no quote is the side-effect-free form of the probe.
    expect(fetchMock).toHaveBeenCalledWith('http://portal.test:2121/ln-invoice', {
      method: 'GET',
    });
  });

  it('reports no support when the route is missing (non-JSON 404)', async () => {
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({}, { ok: false, status: 404 }),
      headers: headers('text/html'),
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
  });

  it('reports no support when the JSON has no status field', async () => {
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({ hello: 'world' }),
      headers: headers('application/json; charset=utf-8'),
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
  });

  it('reports no support when the JSON body is not an object', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: headers('application/json'),
      json: async () => null,
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
  });

  it('reports no support when the body cannot be parsed at all', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: headers('application/json'),
      json: async () => Promise.reject(new SyntaxError('bad json')),
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
  });

  it('reports no support when the request itself throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
    expect(error).toHaveBeenCalled();
  });

  it('treats a missing content-type header as unsupported', async () => {
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({ status: 0 }),
      headers: { get: () => null },
    });

    await expect(probeLightningCapability()).resolves.toEqual({ supported: false });
  });
});

describe('requestInvoice', () => {
  it('posts the amount and mint, carrying the client mac', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 1,
        quote: 'q1',
        invoice: 'lnbc1...',
        mint_url: 'https://mint.example',
        amount: 210,
        expiry: 600,
        state: ' unpaid ',
      })
    );

    const result = await requestInvoice(210, 'https://mint.example', i18n, deviceInfo);

    expect(result).toEqual({
      status: 1,
      quote: 'q1',
      invoice: 'lnbc1...',
      mintUrl: 'https://mint.example',
      amount: 210,
      expiry: 600,
      state: ' unpaid ',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://portal.test:2121/ln-invoice?mac=00%3A11%3A22%3A33%3A44%3A55'
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      amount: 210,
      mint_url: 'https://mint.example',
    });
  });

  it('omits the mac query when the device identity is not a MAC', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 1, quote: 'q' }));

    await requestInvoice(1, 'https://m', i18n, { type: 'ip', value: '10.0.0.1' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://portal.test:2121/ln-invoice');
  });

  it('omits the mac query when no device info was passed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 1, quote: 'q' }));

    await requestInvoice(1, 'https://m', i18n);

    expect(fetchMock.mock.calls[0][0]).toBe('http://portal.test:2121/ln-invoice');
  });

  it('returns LN003 carrying the backend error text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, error: 'mint not allowed' }, { ok: false })
    );

    const result = await requestInvoice(1, 'https://m', i18n, deviceInfo);

    expect(result).toEqual({
      status: 0,
      code: 'LN003',
      label: 'LN003_label',
      message: 'mint not allowed',
    });
    expect(error).toHaveBeenCalled();
  });

  it('falls back to the translated LN003 message when the backend gives none', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0 }, { ok: false }));

    await expect(requestInvoice(1, 'https://m', i18n)).resolves.toMatchObject({
      code: 'LN003',
      message: 'LN003_message',
    });
  });

  it('returns LN003 when the request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(requestInvoice(1, 'https://m', i18n)).resolves.toMatchObject({
      code: 'LN003',
      message: 'LN003_message',
    });
  });

  it('treats an unparseable success body as a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => Promise.reject(new SyntaxError('bad json')),
    });

    await expect(requestInvoice(1, 'https://m', i18n)).resolves.toMatchObject({
      code: 'LN003',
    });
  });
});

describe('getInvoiceStatus', () => {
  it('queries by quote and mac, mapping the snake_case payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 1,
        quote: 'q1',
        mint_url: 'https://mint.example',
        amount: 210,
        state: 'paid',
        access_granted: true,
        allotment: 3600000,
        metric: 'milliseconds',
      })
    );

    const result = await getInvoiceStatus('q1', i18n, deviceInfo);

    expect(result).toEqual({
      status: 1,
      quote: 'q1',
      mintUrl: 'https://mint.example',
      amount: 210,
      state: 'paid',
      accessGranted: true,
      allotment: 3600000,
      metric: 'milliseconds',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://portal.test:2121/ln-invoice?quote=q1&mac=00%3A11%3A22%3A33%3A44%3A55'
    );
    // No method override: this is the default GET.
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('percent-encodes the quote', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 1 }));

    await getInvoiceStatus('a b+c/d', i18n);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://portal.test:2121/ln-invoice?quote=a%20b%2Bc%2Fd'
    );
  });

  it('omits the mac when there is no MAC identity', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 1 }));

    await getInvoiceStatus('q1', i18n, null);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://portal.test:2121/ln-invoice?quote=q1'
    );
  });

  it('reports an unpaid invoice as status 1 with accessGranted false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 1, quote: 'q1', state: 'unpaid', access_granted: false })
    );

    await expect(getInvoiceStatus('q1', i18n)).resolves.toMatchObject({
      status: 1,
      accessGranted: false,
    });
  });

  it('returns LN004 carrying the backend error text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 0, error: 'unknown quote' }, { ok: false })
    );

    await expect(getInvoiceStatus('q1', i18n)).resolves.toEqual({
      status: 0,
      code: 'LN004',
      label: 'LN004_label',
      message: 'unknown quote',
    });
  });

  it('falls back to the translated LN004 message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 0 }, { ok: false }));

    await expect(getInvoiceStatus('q1', i18n)).resolves.toMatchObject({
      code: 'LN004',
      message: 'LN004_message',
    });
  });

  it('returns LN004 when the request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(getInvoiceStatus('q1', i18n)).resolves.toMatchObject({
      code: 'LN004',
    });
  });
});
