import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchTollgateData,
  getAccessOptions,
  getClientMac,
} from '../../src/helpers/tollgate.js';

// ---------------------------------------------------------------------------
// TIP-01 parse-surface vectors (part of #34).
//
// The portal consumes a user-facing subset of the TollGate protocol: the
// bootstrap pair (`GET /` details event + `GET /whoami` device text), the
// kind-21023 notice events, and the price-sheet tags of the details event.
// Until a change here is driven by the backend actually shipping it, every
// ACCEPT vector below is pinned byte-exact against the shapes the portal
// parses today, with the fixture block above each case naming its provenance.
//
// Provenance of the fixtures:
//   - SPEC details event / notice events: OpenTollGate/tollgate TIP-01.md
//     (kind 10021 advertisement example; the two kind 21023 notice examples),
//     completed where the spec elides fields with "...".
//   - price_per_step tag shape: the tip01-linked comment in
//     src/helpers/tollgate.js (["price_per_step", "<bearer_asset_type>",
//     "<price>", "<unit>", "<mint_url>", "<min_steps>"]).
//   - whoami text: the portal's backend contract, as already documented in
//     lightning-mac.test.js (`mac=00:11:22:33:44:55`).
//
// The canonical cross-implementation vectors file (#34 refers to
// tollgate-rs' cross-vectors/tollgate-cross-vectors.json) does not exist yet —
// when it lands, this fixture block is the swap point for its
// portal-relevant entries.
// ---------------------------------------------------------------------------

const SPEC_DETAILS_EVENT = {
  kind: 10021,
  id: '298930dc3fbc7d6cd81fa256f75982647a66459870f84df4ab1394c653605b38',
  pubkey: '24d63662d5f5b0b85e78e1a7c1c4c74c0c9e0e5ba1b0c8e0d0a0b0c0d0e0f66',
  created_at: 0,
  tags: [
    ['metric', 'milliseconds'],
    ['step_size', '60000'], // 1 minute step size
    ['step_purchase_limits', '1', '0'], // min 1 step, max infinite
    ['tips', '1', '2', '5'],
    // Two mints so the price-per-step sort is pinned too: 210/1 steps for
    // coinos, 100 sat with min_steps 2 for minibits (100/2 = 50 < 210).
    ['price_per_step', 'cashu', '210', 'sat', 'https://mint.coinos.io', 1],
    ['price_per_step', 'cashu', '100', 'sat', 'https://mint.minibits.cash/Bitcoin', 2],
  ],
  content: '',
  sig: '0f3aed6edd5725865c863c4c2e4e019f8e81370944d1bb9df702102dec95d1e0',
};

// TIP-01.md "No Upstream Error" example, verbatim fields.
const SPEC_NOTICE_NO_UPSTREAM = {
  kind: 21023,
  pubkey: SPEC_DETAILS_EVENT.pubkey,
  created_at: 0,
  tags: [
    ['level', 'error'],
    ['code', 'upstream-error-not-connected'],
  ],
  content: 'TollGate Currently has no upstream connection.',
};

// TIP-01.md "Payment Error" example (carries the optional p tag), verbatim
// fields.
const SPEC_NOTICE_PAYMENT = {
  kind: 21023,
  pubkey: SPEC_DETAILS_EVENT.pubkey,
  created_at: 0,
  tags: [
    ['p', '63gy9xvq00000000000000000000000000000000000000000000000000000xvq'],
    ['level', 'error'],
    ['code', 'payment-error-token-spent'],
  ],
  content: 'Payment processing failed: Token already spent',
};

const WHOAMI_TEXT = 'mac=00:11:22:33:44:55';

// jsdom serves the portal from http://localhost:2051, so the helper derives
// the backend base URL http://localhost:2121 — fetch stubs route on exactly
// these URLs, byte-exact like the real calls.
const DETAILS_URL = 'http://localhost:2121/';
const WHOAMI_URL = 'http://localhost:2121/whoami';

const i18n = (key) => key;

const textResponse = (body, ok = true) => ({
  ok,
  json: async () => JSON.parse(body),
  text: async () => body,
});

// Route the stubbed global fetch by URL: `details` serves `GET /`, `whoami`
// serves `GET /whoami`. Passing `null` makes that endpoint fail with !ok; a
// string body is served ok (so `.json()` is what throws on it).
const stubBackend = ({ details, whoami }) => {
  const mock = vi.fn(async (url) => {
    if (url === DETAILS_URL) {
      if (details === null) return { ok: false, status: 503 };
      if (typeof details === 'string') return textResponse(details);
      return textResponse(JSON.stringify(details));
    }
    if (url === WHOAMI_URL) {
      if (whoami === null) return { ok: false, status: 503 };
      return textResponse(whoami);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

describe('fetchTollgateData (TIP-01 bootstrap: details event + whoami)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the spec details event and device info byte-exact', async () => {
    const mock = stubBackend({ details: SPEC_DETAILS_EVENT, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.detailsEvent).toEqual(SPEC_DETAILS_EVENT);
    expect(result.value.deviceInfo).toEqual({ type: 'mac', value: '00:11:22:33:44:55' });
    expect(mock.mock.calls.map(([url]) => url)).toEqual([DETAILS_URL, WHOAMI_URL]);
  });

  it('maps the spec 21023 no-upstream notice onto the error surface', async () => {
    stubBackend({ details: SPEC_NOTICE_NO_UPSTREAM, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result).toEqual({
      status: 0,
      code: 'upstream-error-not-connected',
      label: 'upstream-error-not-connected_label',
      message: 'TollGate Currently has no upstream connection.',
      isBackendNotice: true,
      retryable: false,
    });
  });

  it('maps the spec 21023 payment notice (optional p tag present)', async () => {
    stubBackend({ details: SPEC_NOTICE_PAYMENT, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(0);
    expect(result.code).toBe('payment-error-token-spent');
    expect(result.message).toBe('Payment processing failed: Token already spent');
    expect(result.isBackendNotice).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it('treats level=warning as retryable', async () => {
    const notice = {
      ...SPEC_NOTICE_NO_UPSTREAM,
      tags: [['level', 'warning'], ['code', 'session-error']],
      content: 'Session expiring soon.',
    };
    stubBackend({ details: notice, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.retryable).toBe(true);
  });

  it('defaults a 21023 with no level/code tags to error/backend-notice', async () => {
    const notice = { kind: 21023, tags: [], content: '' };
    stubBackend({ details: notice, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.code).toBe('backend-notice');
    expect(result.retryable).toBe(false);
    expect(result.message).toBe('TG005_message'); // empty content -> i18n fallback
  });

  it('reports TG001 when the details endpoint is not ok (whoami never called)', async () => {
    const mock = stubBackend({ details: null, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(0);
    expect(result.code).toBe('TG001');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('reports TG002 when whoami is not ok', async () => {
    stubBackend({ details: SPEC_DETAILS_EVENT, whoami: null });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(0);
    expect(result.code).toBe('TG002');
  });

  it('falls back to the dev mock event when the details body is not JSON (localhost)', async () => {
    // Pinning current behavior, not endorsing it: in dev/localhost context a
    // malformed details body is swallowed by the catch block and replaced by
    // the mock event, so the UI never sees the backend's garbage. The mock
    // event's own shape doubles as a tip01 example the README requires the
    // mocks to track.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubBackend({ details: '{not json', whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.detailsEvent.kind).toBe(10021);
    expect(result.value.detailsEvent.tags).toEqual(
      expect.arrayContaining([
        ['metric', 'milliseconds'],
        ['step_size', '600000'],
      ]),
    );
    expect(result.value.deviceInfo).toEqual({ type: 'mac', value: '1A:2B:3C:4D:5E' });
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('passes a non-10021 event through verbatim (no kind validation on the details path)', async () => {
    // Current contract: only kind 21023 is special-cased. A session event
    // (kind 1022) from `GET /` is returned as the details event unmodified —
    // the price-sheet consumer, not this fetch, rejects it (TG004 below).
    const sessionEvent = {
      kind: 1022,
      tags: [['p', '6hjq1fi6'], ['allotment', '60000'], ['metric', 'milliseconds']],
    };
    stubBackend({ details: sessionEvent, whoami: WHOAMI_TEXT });

    const result = await fetchTollgateData(i18n);

    expect(result.status).toBe(1);
    expect(result.value.detailsEvent).toEqual(sessionEvent);
  });
});

describe('getAccessOptions (TIP-01 price sheet)', () => {
  it('maps and sorts the spec tags byte-exact', () => {
    const options = getAccessOptions(SPEC_DETAILS_EVENT, i18n);

    expect(options).toEqual([
      {
        metric: 'milliseconds',
        step_size: 60000,
        step_purchase_limits: { min: 1, max: 0 },
        url: 'https://mint.minibits.cash/Bitcoin', // 100/(2||1)=50 sorts first
        asset_type: 'cashu',
        price: 100,
        unit: 'sat',
        min_steps: 2,
      },
      {
        metric: 'milliseconds',
        step_size: 60000,
        step_purchase_limits: { min: 1, max: 0 },
        url: 'https://mint.coinos.io',
        asset_type: 'cashu',
        price: 210,
        unit: 'sat',
        min_steps: 1,
      },
    ]);
  });

  it('reports TG004 when metric or step_size is missing', () => {
    const result = getAccessOptions(
      { kind: 10021, tags: [['step_size', '60000'], ['tips', '1']] },
      i18n,
    );

    expect(result).toEqual({
      status: 0,
      code: 'TG004',
      label: 'TG004_label',
      message: 'TG004_message',
    });
  });

  it('skips malformed price_per_step variants — leaving undefined holes (pinned defect)', () => {
    // Pinned AS-IS, not endorsed: the map callback `return;`s for a skipped
    // option, so the array keeps an `undefined` hole per skipped tag instead
    // of dropping it. Array#sort moves undefined to the end WITHOUT calling
    // the comparator (ES2019 sort), so valid options lead and the holes
    // trail. Consequences for the three consumers (Cashu/Lightning/Balance
    // all do `if (options.length) setSelectedMint(options[0])`): a trailing
    // hole reaches UnitInput's pricingInfo map, and — see the next vector —
    // an ALL-skipped array still has truthy length, so their empty-state
    // error path (CU001/LN001) never fires. Fixing the holes is a behavior
    // change for three consumers and belongs in its own PR.
    const event = {
      kind: 10021,
      tags: [
        ['metric', 'milliseconds'],
        ['step_size', '60000'],
        ['price_per_step', 'lightning', '100', 'sat', 'https://ln.example'], // non-cashu asset
        ['price_per_step', 'cashu', '0', 'sat', 'https://zero.example'], // falsy price
        ['price_per_step', 'cashu', 'abc', 'sat', 'https://nan.example'], // NaN price
        ['price_per_step', 'cashu', '100', 'sat', ''], // no mint url
        ['price_per_step', 'cashu', '100', 'sat', 'https://bad-min.example', 'abc'], // min_steps -> 0
      ],
    };

    const options = getAccessOptions(event, i18n);

    expect(options).toEqual([
      {
        metric: 'milliseconds',
        step_size: 60000,
        step_purchase_limits: { min: 1, max: 0 }, // absent tag -> defaults
        url: 'https://bad-min.example',
        asset_type: 'cashu',
        price: 100,
        unit: 'sat',
        min_steps: 0,
      },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('reports a TRUTHY length when every price option is skipped (pinned defect)', () => {
    // The sharpest edge of the holes above: with zero valid options the
    // array is all-undefined, `.length` equals the number of price tags, and
    // every consumer's `if (options.length)` gate passes with
    // `options[0] === undefined` selected as the mint.
    const event = {
      kind: 10021,
      tags: [
        ['metric', 'milliseconds'],
        ['step_size', '60000'],
        ['price_per_step', 'lightning', '100', 'sat', 'https://ln.example'],
        ['price_per_step', 'nwc', '100', 'msat', 'https://nwc.example'],
      ],
    };

    const options = getAccessOptions(event, i18n);

    expect(options.length).toBe(2);
    expect(options[0]).toBeUndefined();
  });

  it('defaults non-numeric step_purchase_limits to min 1 / max 0', () => {
    const event = {
      kind: 10021,
      tags: [
        ['metric', 'bytes'],
        ['step_size', '1000000'],
        ['step_purchase_limits', 'abc', 'def'],
      ],
    };

    expect(getAccessOptions(event, i18n)).toEqual([]);
  });

  it('returns [] when the event has no tags array', () => {
    expect(getAccessOptions(null, i18n)).toEqual([]);
    expect(getAccessOptions({ kind: 10021 }, i18n)).toEqual([]);
  });
});

describe('getClientMac (device-identifier guard)', () => {
  it('returns the MAC for a mac-typed device, trimmed', () => {
    expect(getClientMac({ type: 'mac', value: '  00:11:22:33:44:55\n' })).toBe(
      '00:11:22:33:44:55',
    );
  });

  it('returns an empty string for non-mac identifiers and bad values', () => {
    expect(getClientMac({ type: 'ip', value: '192.168.1.10' })).toBe('');
    expect(getClientMac({ type: 'mac', value: 42 })).toBe('');
    expect(getClientMac(null)).toBe('');
  });
});
