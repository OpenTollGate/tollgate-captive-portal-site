// Tests for src/helpers/tollgate.js — the portal's backend client (58% on the
// baseline).
//
// Everything here goes through `fetch`, so the suite stubs the global and
// drives the response shapes the TollGate backend actually returns: the kind
// 10021 details event with its tag vocabulary, the `mac=<addr>` /whoami text,
// and the kind 21023 backend notice. The error envelopes (TG001..TG005) are
// part of the UI contract — their codes are what the portal renders and what
// the i18n catalogue keys off — so each is asserted by code, not just by
// "status 0".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads `window.location.hostname` at import time, and jsdom's
// default origin is http://localhost/ — which is ALSO the hostname that arms
// the demo/mock fallback in fetchTollgateData's catch block. Pin a non-local
// host before importing so the real error envelopes are reachable, and keep
// the localhost behaviour as its own explicitly-stubbed case below.
const { mockWindowLocation } = vi.hoisted(() => ({
  mockWindowLocation: { hostname: 'tollgate.test' },
}));
vi.stubGlobal('location', mockWindowLocation);

const tollgate = await import('../../src/helpers/tollgate.js');

const {
  getTollgateBaseUrl,
  getPortalBaseUrl,
  getClientMac,
  fetchTollgateData,
  getAccessOptions,
  getStepSizeValues,
  formatTimeInSeconds,
  formatDataSize,
  calculateAllocation,
} = tollgate;

const i18n = (key) => key;

// A details event shaped like a real one: metric + step_size + step_purchase_limits
// + two price_per_step tags, one of which is not cashu and must be dropped.
const detailsEvent = {
  kind: 10021,
  id: 'deadbeef',
  tags: [
    ['metric', 'milliseconds'],
    ['step_size', '600000'],
    ['step_purchase_limits', '2', '10'],
    ['price_per_step', 'cashu', '210', 'sat', 'https://mint.example.com', '2'],
    ['price_per_step', 'cashu', '420', 'sat', 'https://other.example.com', '1'],
    ['price_per_step', 'ln', '100', 'sat', 'https://ln.example.com', '1'],
  ],
  content: '',
};

const jsonResponse = (body, init = {}) => ({
  ok: true,
  ...init,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const textResponse = (text, init = {}) => ({
  ok: true,
  ...init,
  json: async () => JSON.parse(text),
  text: async () => text,
});

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('base urls', () => {
  it('derives the backend and portal origins from the served hostname', () => {
    expect(getTollgateBaseUrl()).toBe('http://tollgate.test:2121');
    expect(getPortalBaseUrl()).toBe('http://tollgate.test:2051');
  });
});

describe('getClientMac', () => {
  it('returns the trimmed MAC when /whoami identified the client by mac', () => {
    expect(getClientMac({ type: 'mac', value: ' 00:11:22:33:44:55 ' })).toBe(
      '00:11:22:33:44:55'
    );
  });

  it('returns an empty string when there is no device info at all', () => {
    expect(getClientMac()).toBe('');
    expect(getClientMac(null)).toBe('');
  });

  it('returns an empty string for a non-mac identity type', () => {
    expect(getClientMac({ type: 'ip', value: '10.0.0.1' })).toBe('');
  });

  it('returns an empty string when the identified value is not a string', () => {
    expect(getClientMac({ type: 'mac', value: 1234 })).toBe('');
    expect(getClientMac({ type: 'mac' })).toBe('');
  });
});

describe('fetchTollgateData', () => {
  it('returns the details event and the parsed device identity', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(detailsEvent))
      .mockResolvedValueOnce(textResponse('mac=00:11:22:33:44:55\n'));

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.detailsEvent).toBe(detailsEvent);
    expect(result.value.deviceInfo).toEqual({
      type: 'mac',
      value: '00:11:22:33:44:55',
    });
    // The backend base url is the one the spec pins on 2121.
    expect(fetchMock.mock.calls[0][0]).toBe('http://tollgate.test:2121/');
    expect(fetchMock.mock.calls[1][0]).toBe('http://tollgate.test:2121/whoami');
  });

  it('keeps a non-mac identity type rather than assuming mac', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(detailsEvent))
      .mockResolvedValueOnce(textResponse('ip=10.0.0.7'));

    const result = await fetchTollgateData(i18n);

    expect(result.value.deviceInfo).toEqual({ type: 'ip', value: '10.0.0.7' });
  });

  it('falls back to identity keys when called without an i18n function', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(detailsEvent, { ok: false }));

    const result = await fetchTollgateData();

    expect(result).toEqual({
      status: 0,
      code: 'TG001',
      label: 'TG001_label',
      message: 'TG001_message',
    });
  });

  it('reports TG001 when the details endpoint is not ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false }));

    const result = await fetchTollgateData(i18n);

    expect(result.code).toBe('TG001');
    expect(result.status).toBe(0);
  });

  it('reports TG002 when /whoami is not ok', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(detailsEvent))
      .mockResolvedValueOnce(textResponse('', { ok: false }));

    const result = await fetchTollgateData(i18n);

    expect(result.code).toBe('TG002');
    expect(result.status).toBe(0);
  });

  describe('backend notice (kind 21023)', () => {
    it('surfaces the notice level, code and content as the error', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 21023,
          tags: [
            ['level', 'error'],
            ['code', 'TG900'],
          ],
          content: 'backend is degraded',
        })
      );

      const result = await fetchTollgateData(i18n);

      expect(result).toEqual({
        status: 0,
        code: 'TG900',
        label: 'TG900_label',
        message: 'backend is degraded',
        isBackendNotice: true,
        retryable: false,
      });
      // A notice short-circuits: /whoami is never requested.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('marks a warning notice as retryable', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 21023,
          tags: [['level', 'warning']],
          content: '',
        })
      );

      const result = await fetchTollgateData(i18n);

      expect(result.retryable).toBe(true);
      expect(result.code).toBe('backend-notice');
    });

    it('defaults the level to error, so a notice with no tags is not retryable', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ kind: 21023, tags: [], content: '' })
      );

      const result = await fetchTollgateData(i18n);

      expect(result.code).toBe('backend-notice');
      expect(result.label).toBe('backend-notice_label');
      expect(result.message).toBe('TG005_message');
      expect(result.retryable).toBe(false);
    });

    it('uses the TG005 fallback label when the notice code has no catalogue entry', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ kind: 21023, tags: [['code', 'TG901']], content: 'x' })
      );

      const result = await fetchTollgateData(i18n);

      // label lookup is `${code}_label` first, TG005_label as fallback
      expect(result.label).toBe('TG901_label');
      expect(result.message).toBe('x');
    });

    it('tolerates a notice with no tags array at all', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ kind: 21023, content: '' }));

      const result = await fetchTollgateData(i18n);

      expect(result.code).toBe('backend-notice');
      expect(result.isBackendNotice).toBe(true);
    });
  });

  it('reports TG003 when the network call itself throws outside the demo fallback', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // vitest runs with import.meta.env.DEV === true, which arms the demo/mock
    // fallback in the catch block — so the real TG003 envelope is only
    // reachable in a build where DEV and VITE_MOCK are both off. Both the env
    // stubs and a fresh module registry are needed: the module was imported at
    // file scope, before these stubs existed.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_MOCK', '');
    // afterEach's unstubAllGlobals restored jsdom's own location, whose
    // hostname IS "localhost" — which arms the demo fallback on its own. Pin a
    // non-local host again so only the env decides.
    vi.stubGlobal('location', { hostname: 'tollgate.test' });
    vi.resetModules();
    const fresh = await import('../../src/helpers/tollgate.js');
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    const result = await fresh.fetchTollgateData(i18n);

    expect(result).toEqual({
      status: 0,
      code: 'TG003',
      label: 'TG003_label',
      message: 'TG003_message',
    });
    expect(error).toHaveBeenCalled();
  });

  it('substitutes mock data when the backend is unreachable on localhost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_MOCK', '');
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    // Re-import with a localhost hostname so the demo fallback arms itself
    // through the hostname predicate alone, not through DEV.
    vi.resetModules();
    vi.stubGlobal('location', { hostname: 'localhost' });
    const fresh = await import('../../src/helpers/tollgate.js');
    const result = await fresh.fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.detailsEvent.kind).toBe(10021);
    expect(result.value.deviceInfo).toEqual({
      type: 'mac',
      value: '1A:2B:3C:4D:5E',
    });
    expect(warn).toHaveBeenCalled();
  });

  it('uses the mock fallback in a DEV build even on a non-local host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));

    // No env or hostname override here: vitest's DEV build is the trigger.
    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.deviceInfo.type).toBe('mac');
  });
});

describe('getAccessOptions', () => {
  it('maps the cashu price_per_step tags into options', () => {
    const options = getAccessOptions(detailsEvent, i18n);

    // NOTE: the map does not compact, so the non-cashu tag leaves an
    // `undefined` HOLE at the end of the array instead of being removed. That
    // is the current behaviour; the Lightning/BalancePage screens gate on
    // truthiness, so it is asserted here rather than fixed in a coverage card.
    expect(options).toHaveLength(3);
    expect(options[2]).toBeUndefined();

    const real = options.filter(Boolean);
    expect(real).toHaveLength(2);
    expect(real.map((o) => o.url)).toEqual([
      'https://mint.example.com',
      'https://other.example.com',
    ]);
    for (const option of real) {
      expect(option.asset_type).toBe('cashu');
      expect(option.metric).toBe('milliseconds');
      expect(option.step_size).toBe(600000);
      expect(option.unit).toBe('sat');
      expect(option.step_purchase_limits).toEqual({ min: 2, max: 10 });
    }
  });

  it('sorts by price per step, so a bulk option can outrank a cheaper single step', () => {
    const options = getAccessOptions(detailsEvent, i18n);
    // 210/2 = 105 per step beats 420/1 = 420 per step.
    expect(options[0].price).toBe(210);
    expect(options[0].min_steps).toBe(2);
  });

  it('parses min_steps and defaults it to 0 when the tag omits it', () => {
    const options = getAccessOptions(
      {
        tags: [
          ['metric', 'bytes'],
          ['step_size', '1024'],
          ['price_per_step', 'cashu', '10', 'sat', 'https://a.example'],
        ],
      },
      i18n
    );

    expect(options[0].min_steps).toBe(0);
  });

  it('coerces a non-numeric min_steps to 0', () => {
    const options = getAccessOptions(
      {
        tags: [
          ['metric', 'bytes'],
          ['step_size', '1024'],
          ['price_per_step', 'cashu', '10', 'sat', 'https://a.example', 'abc'],
        ],
      },
      i18n
    );

    expect(options[0].min_steps).toBe(0);
  });

  it('defaults the step purchase limits when the tag is malformed', () => {
    const options = getAccessOptions(
      {
        tags: [
          ['metric', 'bytes'],
          ['step_size', '1024'],
          ['step_purchase_limits', 'oops', 'nah'],
          ['price_per_step', 'cashu', '10', 'sat', 'https://a.example'],
        ],
      },
      i18n
    );

    expect(options[0].step_purchase_limits).toEqual({ min: 1, max: 0 });
  });

  it('returns TG004 when metric or step_size is missing', () => {
    expect(getAccessOptions({ tags: [['metric', 'bytes']] }, i18n)).toEqual({
      status: 0,
      code: 'TG004',
      label: 'TG004_label',
      message: 'TG004_message',
    });
    expect(getAccessOptions({ tags: [['step_size', '10']] }, i18n).code).toBe(
      'TG004'
    );
  });

  it('returns an empty array when the event or its tags are absent', () => {
    expect(getAccessOptions(null, i18n)).toEqual([]);
    expect(getAccessOptions({}, i18n)).toEqual([]);
    expect(getAccessOptions({ tags: 'nope' }, i18n)).toEqual([]);
  });

  it('leaves a null hole for every option it rejects', () => {
    const options = getAccessOptions(
      {
        tags: [
          ['metric', 'bytes'],
          ['step_size', '1024'],
          ['price_per_step', 'cashu', '0', 'sat', 'https://a.example'],
          ['price_per_step', 'cashu', 'free', 'sat', 'https://b.example'],
          ['price_per_step', 'cashu', '5', 'sat', ''],
        ],
      },
      i18n
    );

    // Zero price, unparseable price and empty mint url are all rejected — but
    // by returning early from the map callback, which leaves three `undefined`
    // holes rather than an empty array. Consumers gate on truthiness;
    // asserted as-is.
    expect(options).toEqual([undefined, undefined, undefined]);
  });

  it('defaults the unit to sat when the tag omits it', () => {
    const options = getAccessOptions(
      {
        tags: [
          ['metric', 'bytes'],
          ['step_size', '1024'],
          ['price_per_step', 'cashu', '10', '', 'https://a.example'],
        ],
      },
      i18n
    );

    expect(options[0].unit).toBe('sat');
  });
});

describe('formatting helpers', () => {
  it('formats sub-minute durations as seconds, pluralised', () => {
    expect(formatTimeInSeconds(1000, false, i18n)).toEqual({
      value: 1,
      unit: 'second',
    });
    expect(formatTimeInSeconds(30000, false, i18n)).toEqual({
      value: 30,
      unit: 'second_plural',
    });
  });

  it('keeps two decimals when seconds are fractional', () => {
    expect(formatTimeInSeconds(1500, false, i18n)).toEqual({
      value: '1.50',
      unit: 'second_plural',
    });
  });

  it('uses abbreviations when asked', () => {
    expect(formatTimeInSeconds(1000, true, i18n).unit).toBe('second_abbreviation');
    expect(formatTimeInSeconds(60000, true, i18n).unit).toBe('minute_abbreviation');
    expect(formatTimeInSeconds(3600000, true, i18n).unit).toBe('hour_abbreviation');
  });

  it('promotes whole minutes and hours with singular/plural units', () => {
    expect(formatTimeInSeconds(60000, false, i18n)).toEqual({
      value: 1,
      unit: 'minute',
    });
    expect(formatTimeInSeconds(120000, false, i18n)).toEqual({
      value: 2,
      unit: 'minute_plural',
    });
    expect(formatTimeInSeconds(3600000, false, i18n)).toEqual({
      value: 1,
      unit: 'hour',
    });
    expect(formatTimeInSeconds(7200000, false, i18n)).toEqual({
      value: 2,
      unit: 'hour_plural',
    });
  });

  it('formats bytes below a kibibyte as a raw count', () => {
    expect(formatDataSize(512, i18n)).toEqual({ value: 512, unit: 'B' });
  });

  it('formats kibibytes and mebibytes by magnitude', () => {
    expect(formatDataSize(5 * 1048576, i18n)).toEqual({
      value: '5.00',
      unit: 'MiB',
    });
    expect(formatDataSize(3 * 1073741824, i18n)).toEqual({
      value: '3.000',
      unit: 'GiB',
    });
  });

  it.fails('formats a kibibyte-range size instead of throwing', () => {
    // PRODUCT BUG, asserted as a FAILING expectation rather than pinned as
    // correct. src/helpers/tollgate.js:286 computes
    //     unit: i18n("KiB").toFixed(1)
    // i.e. it calls .toFixed on the translated UNIT STRING instead of on the
    // byte value, so formatDataSize throws a TypeError for any size in
    // [1024, 1048576). getStepSizeValues/calculateAllocation route byte-metric
    // gateways straight into it, so a tollgate whose step_size lands in that
    // window crashes the render.
    //
    // `it.fails` is deliberate and is the reviewer's point taken: a plain
    // `expect(...).toThrow()` would make today's crash the CONTRACT and turn
    // the one-line fix into a test failure. Here the suite expects the correct
    // behaviour and documents that it currently does not hold — so fixing the
    // bug makes this test fail-to-fail, i.e. it goes red and demands to be
    // promoted to `it`. Fixing product code is out of scope for this card.
    expect(() => formatDataSize(2048, i18n)).not.toThrow();
    expect(formatDataSize(2048, i18n)).toEqual({ value: '2.0', unit: 'KiB' });
  });

  it('formats the step size according to the event metric', () => {
    // The step-size view abbreviates: 600 s is shown as "10 min", not
    // "10 minutes".
    expect(getStepSizeValues({ metric: 'milliseconds', step_size: 600000 }, i18n)).toEqual({
      value: 10,
      unit: 'minute_abbreviation',
    });
    expect(getStepSizeValues({ metric: 'bytes', step_size: 1048576 }, i18n)).toEqual({
      value: '1.00',
      unit: 'MiB',
    });
    expect(getStepSizeValues({ metric: 'parsecs', step_size: 1 }, i18n)).toBe(false);
  });

  it.fails('returns a KiB step size instead of throwing', () => {
    // Same product bug, reached through the step-size door: a byte-metric
    // gateway whose step_size lands in [1024, 1048576) crashes the render.
    // `it.fails` for the same reason as above — the CORRECT behaviour is
    // asserted, and the current throw is recorded as a known failure so a fix
    // turns this red instead of silently breaking it.
    expect(getStepSizeValues({ metric: 'bytes', step_size: 4096 }, i18n)).toEqual({
      value: '4.0',
      unit: 'KiB',
    });
  });
});

describe('calculateAllocation', () => {
  it('scales the allocation by amount, price and min_steps', () => {
    // 210 sat buys 2 steps of 600 s = 20 minutes.
    expect(
      calculateAllocation(210, { metric: 'milliseconds', step_size: 600000, price: 210, min_steps: 2 }, i18n)
    ).toEqual({ value: 20, unit: 'minute_plural' });
  });

  it('treats a missing min_steps as one step', () => {
    expect(
      calculateAllocation(105, { metric: 'milliseconds', step_size: 600000, price: 210 }, i18n)
    ).toEqual({ value: 5, unit: 'minute_plural' });
  });

  it('formats a byte allocation through formatDataSize', () => {
    expect(
      calculateAllocation(2, { metric: 'bytes', step_size: 1048576, price: 1, min_steps: 1 }, i18n)
    ).toEqual({ value: '2.00', unit: 'MiB' });
  });

  it('returns undefined for an unrecognised metric', () => {
    expect(
      calculateAllocation(10, { metric: 'parsecs', step_size: 1, price: 1 }, i18n)
    ).toBeUndefined();
  });
});
