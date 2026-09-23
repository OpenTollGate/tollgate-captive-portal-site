// Renew-after-expiry: the portal must let an operator buy more time IN PAGE
// after their session ends — no Wi-Fi disconnect/reconnect, no page reload.
//
// Operator report (verbatim): after a session ends the portal shows
// "Session ended / Your internet access has expired. To get back online,
// disconnect from this Wi-Fi network and reconnect..." and the ONLY way to buy
// more time is to disconnect/reconnect. Reconnect is a workaround, not a
// protocol requirement: the portal's own comment (src/App.jsx heartbeat) says
// the /usage endpoint on :2121 stays reachable for UNAUTHENTICATED clients, so
// a blocked client can still reach the merchant API and the portal.
//
// TDD: written BEFORE the fix. (a), (b), (c-post-renewal) and (e) fail on the
// pre-fix tree; (c-on-expiry) and (d) are regression guards that pin the
// "do not weaken expiry detection" requirement and already hold.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { Cashu } from '../../src/components/Cashu.jsx';

// src/test/setup.js mocks react-i18next with `useTranslation: () => ({...})`,
// handing out a NEW `t` function on every render. Cashu's effects list `t` in
// their dependency arrays, so each render re-runs them, they set fresh object
// state and the component re-renders forever — the infinite render loop behind
// the hanging src/components/__tests__/Cashu.race.test.jsx (carded as
// t_2098c3cc). Rendering Cashu is only possible with a STABLE `t`, so this file
// installs its own identity-stable react-i18next mock.
vi.mock('react-i18next', () => {
  const i18n = { language: 'en' };
  const t = (key, opts) => (
    typeof opts === 'object' && opts !== null ? key + JSON.stringify(opts) : key
  );
  return {
    useTranslation: () => ({ t, i18n, ready: true }),
    Trans: ({ children }) => children,
  };
});

// The payment helpers need a real Cashu mint + a real token; the repo's own e2e
// suite stubs them the same way (tests/e2e/helpers/mock-backend.mjs) so the
// expiry/renewal flow can be driven without a mint.
vi.mock('../../src/helpers/cashu.js', () => ({
  validateToken: (token) => (
    token && token.startsWith('cashu')
      ? { status: 1, value: { amount: 420, unit: 'sat', isValid: true, hasProofs: true, proofCount: 1 } }
      : { status: 0, code: 'CU101', label: 'invalid', message: 'invalid token' }
  ),
  submitToken: async () => ({ status: 1, label: 'ok', message: 'ok' }),
  canSubmitAnyway: () => false,
  extractProofsFromToken: () => [],
}));

// no network: the mint's swap fee is skipped, exactly as in production when the
// mint is unreachable (getMintSwapFee status 0 => "no pre-check").
vi.mock('../../src/helpers/mint-fee.js', () => ({
  getMintSwapFee: async () => ({ status: 0 }),
}));

// LanguageSwitcher pulls in src/helpers/i18n.js, which initialises the real
// i18next instance — pointless for this test and incompatible with the
// react-i18next mock above (same reason Cashu.race.test.jsx stubs it).
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({
  default: () => null,
}));

const TOKEN = 'cashuBtest123MockTokenForRenewTest';
const USAGE_ACTIVE = '60000/600000';
const USAGE_EXPIRED = '-1/-1';
const POLL_MS = 30000;

const DETAILS = {
  detailsEvent: {
    kind: 10021,
    tags: [
      ['metric', 'milliseconds'],
      ['step_size', '600000'],
      ['step_purchase_limits', '1', '0'],
      ['price_per_step', 'cashu', '210', 'sat', 'https://mint.example.com', '1'],
    ],
  },
  deviceInfo: { type: 'mac', value: '00:11:22:33:44:55' },
};

let usageMode; // 'active' | 'expired' | 'unreachable'
let usageRequests; // every GET to :2121/usage
let fetchLog; // every fetch the portal made (method + url)

const installFetchStub = () => {
  usageRequests = [];
  fetchLog = [];
  global.fetch = vi.fn(async (url, options = {}) => {
    const href = String(url);
    const method = (options.method || 'GET').toUpperCase();
    fetchLog.push(`${method} ${href}`);

    if (href.includes('/usage')) {
      usageRequests.push(href);
      if (usageMode === 'unreachable') throw new TypeError('Failed to fetch');
      return {
        ok: true,
        status: 200,
        text: async () => (usageMode === 'expired' ? USAGE_EXPIRED : USAGE_ACTIVE),
        json: async () => ({}),
      };
    }

    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const advance = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const expiredView = () => document.querySelector('[data-testid="session-expired"]');
const buyMoreTimeButton = () => document.querySelector('[data-testid="buy-more-time"]');
const tokenInput = () => document.querySelector('#cashu-token');
const purchaseCta = () => document.querySelector('.tollgate-captive-portal-method-submit button.cta');
const cardTitle = () => document.querySelector('.tollgate-captive-portal-access-granted h2')?.textContent || null;

// (b) jsdom's Location.reload is an own, non-configurable property, so it cannot
// be spied on or stubbed. What IS observable is jsdom's navigation refusal:
// any real navigation attempt (reload/assign/replace/href write) is reported as
// "Not implemented: navigation to another Document" on the console. This
// detector is self-validating — it fires a REAL reload first and refuses to
// return a result unless it saw the signal, so "no navigation happened" can
// never be a vacuous pass.
const installNavigationDetector = () => {
  const lines = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    lines.push(args.map((a) => String(a)).join(' '));
  });
  const signalSeen = () => lines.some((line) => /not implemented.*navigation|navigation to another document/i.test(line));

  // positive control
  window.location.reload();
  const detectorWorks = signalSeen();
  lines.length = 0;

  return { lines, spy, detectorWorks, signalSeen };
};

// drive the real purchase flow (token -> purchase -> AccessGranted -> auth ->
// first heartbeat poll) so the code under test is reached exactly as in a browser
const purchaseUntilAccessGranted = async () => {
  render(<Cashu tollgateDetails={DETAILS} />);
  await flush();

  expect(tokenInput(), 'token input renders before purchase').toBeTruthy();
  fireEvent.change(tokenInput(), { target: { value: TOKEN } });
  await flush();

  expect(purchaseCta(), 'purchase CTA is available for a valid token').toBeTruthy();
  fireEvent.click(purchaseCta());
  await flush();

  expect(
    document.querySelector('.tollgate-captive-portal-access-granted'),
    'payment success renders the access-granted card',
  ).toBeTruthy();

  // AccessGranted completes captive-portal auth after 900ms; the heartbeat only
  // starts once authCompleted is set, and then polls every 30s
  await advance(1000);
  await advance(POLL_MS);

  expect(
    usageRequests.length,
    'heartbeat polls /usage once authCompleted is set',
  ).toBe(1);
};

const pollReadings = async (count) => {
  for (let i = 0; i < count; i++) await advance(POLL_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
  window.__INITIAL_TOKEN__ = undefined;
  usageMode = 'active';
  installFetchStub();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('expired session — in-page renewal (no reconnect, no reload)', () => {
  // (a)
  it('returns to the purchase UI via the "Buy more time" CTA after 2 consecutive -1/-1 readings', async () => {
    await purchaseUntilAccessGranted();

    usageMode = 'expired';
    await pollReadings(2);

    expect(cardTitle(), 'expired view is shown after 2 consecutive -1/-1 readings').toBe('session_expired_title');

    const cta = buyMoreTimeButton();
    expect(cta, 'expired view offers an in-page "Buy more time" CTA').toBeTruthy();

    fireEvent.click(cta);
    await flush();

    expect(expiredView(), 'the expired view is gone after renewal').toBeNull();
    expect(tokenInput(), 'the token/purchase UI is back without a reload').toBeTruthy();

    // the purchase flow is genuinely reachable again: a fresh token re-arms it
    fireEvent.change(tokenInput(), { target: { value: TOKEN } });
    await flush();
    expect(purchaseCta(), 'a new token can be purchased again in page').toBeTruthy();
  });

  // (b)
  it('renews with NO navigation/reload and NO network call for the state change', async () => {
    const detector = installNavigationDetector();
    expect(
      detector.detectorWorks,
      'positive control: a real reload is observable, so "no navigation" is not a vacuous assertion',
    ).toBe(true);

    const hrefBefore = window.location.href;
    const searchBefore = window.location.search;
    const hashBefore = window.location.hash;

    await purchaseUntilAccessGranted();

    usageMode = 'expired';
    await pollReadings(2);
    expect(cardTitle()).toBe('session_expired_title');

    const fetchCountBeforeRenew = fetchLog.length;
    detector.lines.length = 0;

    fireEvent.click(buyMoreTimeButton());
    await flush();

    expect(
      detector.signalSeen(),
      'no reload/navigation attempt while renewing in page',
    ).toBe(false);
    expect(window.location.href, 'location is untouched').toBe(hrefBefore);
    expect(window.location.search, 'no cache-busting/navigation query is added').toBe(searchBefore);
    expect(window.location.hash).toBe(hashBefore);
    expect(
      fetchLog.length,
      `the renewal needs no network call (new fetches: ${fetchLog.slice(fetchCountBeforeRenew).join(', ')})`,
    ).toBe(fetchCountBeforeRenew);
  });

  // (c) — the interval must not leak. Clearing on expiry already held pre-fix
  // (regression guard); carrying it across the RENEWAL did not.
  it('stops polling /usage after expiry and after the renewal', async () => {
    await purchaseUntilAccessGranted();

    usageMode = 'expired';
    await pollReadings(2);
    expect(cardTitle()).toBe('session_expired_title');

    const callsAtExpiry = usageRequests.length;
    await advance(POLL_MS * 4);
    expect(usageRequests.length, 'no /usage polling after expiry').toBe(callsAtExpiry);

    fireEvent.click(buyMoreTimeButton());
    await flush();

    const callsAfterRenew = usageRequests.length;
    await advance(POLL_MS * 4);
    expect(usageRequests.length, 'no /usage polling after renewing').toBe(callsAfterRenew);
  });

  // (d) — detection must not get twitchy
  it('does NOT flip on a single -1/-1 reading, and recovers when usage is healthy again', async () => {
    await purchaseUntilAccessGranted();

    usageMode = 'expired';
    await pollReadings(1);
    expect(expiredView(), 'one bad reading must not declare expiry').toBeNull();
    expect(cardTitle()).toBe('access_granted_title');

    // a single bad reading followed by good ones must reset the counter
    usageMode = 'active';
    await pollReadings(2);
    expect(expiredView(), 'healthy readings keep the session alive').toBeNull();
    expect(cardTitle()).toBe('access_granted_title');

    // and the definitive signal still expires the session afterwards
    usageMode = 'expired';
    await pollReadings(2);
    expect(cardTitle(), '2 consecutive -1/-1 readings still expire the session').toBe('session_expired_title');
  });

  // (e) — requirement 3: an unreachable merchant API is NOT an expired session
  it('does NOT declare expiry when the usage API is unreachable, and says so instead', async () => {
    await purchaseUntilAccessGranted();

    usageMode = 'unreachable';
    await pollReadings(2);

    expect(cardTitle(), 'an unreachable API must not declare expiry').toBe('access_granted_title');
    expect(
      document.querySelector('[data-testid="usage-unreachable"]'),
      'an unreachable usage API is surfaced to the operator',
    ).toBeTruthy();

    // and it recovers by itself once the API answers again
    usageMode = 'active';
    await advance(POLL_MS);
    expect(document.querySelector('[data-testid="usage-unreachable"]')).toBeNull();
    expect(cardTitle()).toBe('access_granted_title');
  });
});
