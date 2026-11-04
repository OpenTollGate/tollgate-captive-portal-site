// Tests for src/App.jsx — the portal's own shell component.
//
// This file exists because a cold reviewer on PR #100 caught the coverage
// `include` globs missing it: src/App.jsx is 491 lines of real logic (the
// initial backend fetch, the retry interval, the Lightning capability gate, the
// session-expiry heartbeat, the buy-more-time path, the live-usage bar and the
// mint option list) that sat at 0% because it lives at src/ root rather than
// under src/components/. Excluding it by omission inflated the headline number;
// widening the globs instead is why coverage is now honest and LOWER.
//
// Two components here are already covered by their own regression file
// (AccessGranted by access-granted-duration-spacing.test.jsx, the tab gate by
// gateway-objective-picker's sibling). The tests below cover the rest: the
// shell's fetch/retry state machine, the presentational pieces, and the
// AccessGranted heartbeat which decides whether a user is told their session
// expired.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// The global react-i18next mock in src/test/setup.js hard-codes `ready: true`,
// which makes App's `if (ready)` guard unobservable. This file needs to drive
// that flag, so it supplies its own double; it must be hoisted because vi.mock
// factories are lifted above imports.
const i18nState = vi.hoisted(() => ({ ready: true }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
    ready: i18nState.ready,
  }),
  // the real Trans interpolates the translation; rendering the key keeps the
  // Footer assertion about App's own markup rather than about i18next
  Trans: ({ i18nKey }) => i18nKey,
}));

// LanguageSwitcher pulls in the real react-i18next init, which the global mock
// in src/test/setup.js does not provide. Same stub as the sibling regressions.
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({
  default: () => null,
  LanguageSwitcher: () => null,
}));

// The child portal surfaces are irrelevant to the shell's own logic and each
// has its own dedicated suite; stubbing them keeps this file's assertions about
// src/App.jsx and nothing else.
vi.mock('../../src/components/Background.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/DemoBanner.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/GatewayObjectivePicker.jsx', () => ({
  default: () => null,
}));

// The shell's whole job is to drive these two helpers, so they are the seam.
vi.mock('../../src/helpers/tollgate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchTollgateData: vi.fn(),
    getTollgateBaseUrl: vi.fn(() => 'http://gateway.test:2121'),
    getPortalBaseUrl: vi.fn(() => 'http://portal.test:2051'),
  };
});
vi.mock('../../src/helpers/lightning.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, probeLightningCapability: vi.fn() };
});

const { fetchTollgateData, getTollgateBaseUrl, getPortalBaseUrl } = await import(
  '../../src/helpers/tollgate.js'
);
const { probeLightningCapability } = await import('../../src/helpers/lightning.js');
const AppModule = await import('../../src/App.jsx');
const {
  App,
  Header,
  Loading,
  Processing,
  Footer,
  AccessOptions,
  AccessGranted,
} = AppModule;

const DETAILS_OK = {
  status: 1,
  value: {
    mac: 'aa:bb:cc:dd:ee:ff',
    access_options: [
      { url: 'https://mint.example', price: 2, unit: 'sat', metric: 'milliseconds', step_size: 60000, min_steps: 1 },
    ],
  },
};

beforeEach(() => {
  i18nState.ready = true;
  fetchTollgateData.mockReset();
  probeLightningCapability.mockReset();
  probeLightningCapability.mockResolvedValue({ supported: false });
  fetchTollgateData.mockResolvedValue(DETAILS_OK);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App — the shell state machine', () => {
  it('shows the loading state until the first backend fetch resolves', async () => {
    let release;
    fetchTollgateData.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<App />);

    expect(screen.getByText('loading')).toBeTruthy();

    await act(async () => {
      release(DETAILS_OK);
    });

    expect(screen.queryByText('loading')).toBeNull();
  });

  it('renders the backend error with its code and message when the fetch fails', async () => {
    fetchTollgateData.mockResolvedValue({
      status: 0,
      code: 'TG001',
      label: 'no_details',
      message: 'tollgate has no pricing event',
      isBackendNotice: true,
    });
    render(<App />);

    // Status.jsx renders the code as `#{code}` in its own element, and the
    // label separately, so match the container rather than the bare code.
    const code = await screen.findByText('#TG001');
    expect(code).toBeTruthy();
    expect(screen.getByText('no_details')).toBeTruthy();
    expect(screen.getByText('tollgate has no pricing event')).toBeTruthy();
  });

  it('starts retrying after a failed fetch and stops once a retry succeeds', async () => {
    vi.useFakeTimers();
    fetchTollgateData
      .mockResolvedValueOnce({ status: 0, code: 'TG002', label: 'x', message: 'down' })
      .mockResolvedValue(DETAILS_OK);

    render(<App />);

    // let the first fetch (a resolved promise) settle
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchTollgateData).toHaveBeenCalledTimes(1);

    // the retry interval is 5 s; one tick should produce exactly one more call
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(fetchTollgateData).toHaveBeenCalledTimes(2);

    // the successful retry cleared the interval, so no further calls
    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });
    expect(fetchTollgateData).toHaveBeenCalledTimes(2);

    // and the error view is GONE: the success branch must clear both flags, or
    // the user is left staring at a stale "retrying" error over a working portal
    expect(document.querySelector('.tollgate-captive-portal-error')).toBeNull();
    expect(document.querySelector('.tollgate-captive-portal-retrying')).toBeNull();
  });

  it('does not fetch until i18n reports ready', async () => {
    i18nState.ready = false;
    render(<App />);
    // ready:false leaves App in its loading state with no fetch issued
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchTollgateData).not.toHaveBeenCalled();
    expect(screen.getByText('loading')).toBeTruthy();

    i18nState.ready = true;
    cleanup();
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchTollgateData).toHaveBeenCalledTimes(1);
  });
});

describe('App — the Lightning tab gate', () => {
  it('offers the Lightning tab only when the capability probe confirms support', async () => {
    probeLightningCapability.mockResolvedValue({ supported: true });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    const tab = document.getElementById('tab-lightning');
    expect(tab).not.toBeNull();
    expect(tab.disabled).toBe(false);
  });

  it('disables the Lightning tab and says why when the probe says no', async () => {
    probeLightningCapability.mockResolvedValue({ supported: false });
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    const tab = document.getElementById('tab-lightning');
    expect(tab.disabled).toBe(true);
    expect(tab.textContent).toContain('lightning_unavailable');
  });

  it('keeps the Lightning tab disabled while the probe is still pending', () => {
    probeLightningCapability.mockReturnValue(new Promise(() => {}));
    render(<App />);
    // available is still null (not probed), so the gate must be closed
    expect(document.getElementById('tab-lightning').disabled).toBe(true);
  });
});

describe('presentational pieces', () => {
  it('Header renders the wordmark with a light-scheme variant', () => {
    render(<Header />);
    const img = document.querySelector('.tollgate-captive-portal-header img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('alt')).toBe('header_image_alt');
    expect(document.querySelector('source[media*="prefers-color-scheme"]')).not.toBeNull();
  });

  it('Loading renders a spinner and the loading label', () => {
    render(<Loading />);
    expect(document.querySelector('.spinner.big')).not.toBeNull();
    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('Processing falls back to the processing label for a missing or non-string label', () => {
    const { rerender } = render(<Processing />);
    expect(screen.getByText('processing')).toBeTruthy();

    rerender(<Processing label={42} />);
    expect(screen.getByText('processing')).toBeTruthy();

    rerender(<Processing label="" />);
    expect(screen.getByText('processing')).toBeTruthy();

    rerender(<Processing label="renewing" />);
    expect(screen.getByText('renewing')).toBeTruthy();
  });

  it('Footer renders the powered-by translation with a link component', () => {
    render(<Footer />);
    const footer = document.querySelector('.tollgate-captive-portal-footer');
    expect(footer).not.toBeNull();
    // the global i18n mock renders the key through <Trans>, so assert the
    // element exists rather than the translated text
    expect(footer.textContent.length).toBeGreaterThan(0);
  });
});

describe('AccessOptions — the mint chooser', () => {
  const i18n = (key) => key;
  const mints = [
    { url: 'https://mint.a', price: 2, unit: 'sat', metric: 'milliseconds', step_size: 60000, min_steps: 1 },
    { url: 'http://mint.b', price: 5, unit: 'sat', metric: 'milliseconds', step_size: 60000, min_steps: 2 },
  ];

  it('renders one button per mint with its price and stripped address', () => {
    render(<AccessOptions pricingInfo={mints} selectedMint={null} setSelectedMint={() => {}} />);
    const buttons = document.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('mint.a');
    expect(buttons[0].textContent).not.toContain('https://');
    expect(buttons[1].textContent).toContain('mint.b');
    expect(buttons[1].textContent).not.toContain('http://');
  });

  it('skips an option with no price or no url instead of rendering a broken row', () => {
    render(
      <AccessOptions
        pricingInfo={[mints[0], { url: 'https://mint.c' }, { price: 3 }]}
        selectedMint={null}
        setSelectedMint={() => {}}
      />
    );
    expect(document.querySelectorAll('button')).toHaveLength(1);
  });

  it('marks only the selected mint active, and tolerates a null selection', () => {
    const { rerender } = render(
      <AccessOptions pricingInfo={mints} selectedMint={null} setSelectedMint={() => {}} />
    );
    // a null selectedMint must not dereference — no option is active
    expect(document.querySelectorAll('button.cta.active')).toHaveLength(0);

    rerender(<AccessOptions pricingInfo={mints} selectedMint={mints[1]} setSelectedMint={() => {}} />);
    const active = document.querySelectorAll('button.cta.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('mint.b');
  });

  it('reports the chosen mint to its caller', () => {
    const setSelectedMint = vi.fn();
    render(
      <AccessOptions pricingInfo={mints} selectedMint={null} setSelectedMint={setSelectedMint} />
    );
    document.querySelectorAll('button')[1].click();
    expect(setSelectedMint).toHaveBeenCalledWith(mints[1]);
  });

  it('renders nothing for an empty pricing list', () => {
    render(<AccessOptions pricingInfo={[]} selectedMint={null} setSelectedMint={() => {}} />);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('AccessGranted — the session-expiry heartbeat', () => {
  const renderGranted = (props = {}) =>
    render(<AccessGranted allocation="21.00 MiB" metric="bytes" {...props} />);

  it('links to the standalone balance page on the portal origin, not the API port', () => {
    renderGranted();
    const link = document.querySelector('.tollgate-captive-portal-access-granted-balance-link');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('http://portal.test:2051/balance.html');
    expect(getPortalBaseUrl).toHaveBeenCalled();
  });

  it('polls /usage on the gateway base once the auth GET completes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url) =>
      Promise.resolve(
        String(url).endsWith('/usage')
          ? { ok: true, text: async () => '10/100' }
          : { ok: true }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    renderGranted();
    // the auth GET fires at 900 ms; the heartbeat interval is 30 s
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const usageCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/usage'));
    expect(usageCalls).toHaveLength(1);
    expect(String(usageCalls[0][0])).toBe('http://gateway.test:2121/usage');
    vi.unstubAllGlobals();
  });

  it('renders the live-usage bar from a valid used/total reading', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url) =>
      Promise.resolve(
        String(url).endsWith('/usage')
          ? { ok: true, text: async () => '25/100' }
          : { ok: true }
      )
    ));

    renderGranted();
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    const fill = document.querySelector('.tollgate-captive-portal-access-granted-usage-bar-fill');
    expect(fill).not.toBeNull();
    // 25 of 100 used => 75% remaining
    expect(fill.style.width).toBe('75%');
    expect(
      document.querySelector('.tollgate-captive-portal-access-granted-usage-text').textContent
    ).toContain('75 B');
    vi.unstubAllGlobals();
  });

  it('declares the session expired only after TWO definitive -1/-1 readings', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url) =>
      Promise.resolve(
        String(url).endsWith('/usage')
          ? { ok: true, text: async () => '-1/-1' }
          : { ok: true }
      )
    ));

    renderGranted();
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    // first reading: NOT enough to declare expiry
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('session-expired')).toBeNull();

    // second reading: definitive
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('session-expired')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('treats a transport error as indeterminate: a notice, never an expiry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url) =>
      String(url).endsWith('/usage')
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve({ ok: true })
    ));

    renderGranted();
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(screen.queryByTestId('session-expired')).toBeNull();
    expect(screen.getByTestId('usage-unreachable')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('an HTTP error is indeterminate too, not an expiry', async () => {
    vi.useFakeTimers();
    // A 503 response carries a BODY. Without the !resp.ok guard the heartbeat
    // would parse that body as usage data — so give it a body that IS a valid
    // usage reading, and assert the bar never appears. That makes the guard
    // load-bearing: removing it makes this test render a usage bar.
    vi.stubGlobal('fetch', vi.fn((url) =>
      String(url).endsWith('/usage')
        ? Promise.resolve({ ok: false, status: 503, text: async () => '1/100' })
        : Promise.resolve({ ok: true })
    ));

    renderGranted();
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('session-expired')).toBeNull();
    expect(screen.getByTestId('usage-unreachable')).toBeTruthy();
    // the error body was NOT used as a reading
    expect(
      document.querySelector('.tollgate-captive-portal-access-granted-usage-bar-fill')
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it('buy-more-time hands control back to the caller and clears the expired view', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url) =>
      Promise.resolve(
        String(url).endsWith('/usage')
          ? { ok: true, text: async () => '-1/-1' }
          : { ok: true }
      )
    ));
    const onRenew = vi.fn();

    renderGranted({ onRenew });
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(screen.getByTestId('session-expired')).toBeTruthy();

    await act(async () => {
      screen.getByTestId('buy-more-time').click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('session-expired')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('buy-more-time is safe with no onRenew callback supplied', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url) =>
      Promise.resolve(
        String(url).endsWith('/usage')
          ? { ok: true, text: async () => '-1/-1' }
          : { ok: true }
      )
    ));

    renderGranted();
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(() => {
      screen.getByTestId('buy-more-time').click();
    }).not.toThrow();
    vi.unstubAllGlobals();
  });
});
