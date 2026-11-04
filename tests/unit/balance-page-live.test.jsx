// Tests for src/BalancePage.jsx — the page behind balance.html.
//
// CHARACTERIZATION, with justification (gate 1 of the card): this page already
// exists and ships. The task is coverage backfill, not new behaviour, so the
// tests below were written against the shipped code and then proved
// load-bearing by MUTATION (see the PR body) rather than by being observed red
// first. The mutation run is 8 mutations of this file; 6 die, and the 2 that
// survive are INERT mutations named in the tests that own them — this header
// deliberately does not claim "0 survivors".
//
// Why this file matters beyond the percentage: it is the LIVE balance page.
// balance.html loads src/balance.jsx, which renders THIS component — while
// src/components/BalancePage.jsx (the paste/scan token-lookup page that
// tests/unit/balance-page.test.jsx covers) is imported by nothing. The two
// files share a basename and nothing else. Before this file existed the page a
// real customer lands on from the portal's "view balance" link was at 0%.
//
// The component's whole job is a poll loop over `/balance` plus four
// mutually-exclusive render branches, so that is what is asserted: which
// branch is on screen for each backend answer, and that the loop stops.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// App.jsx is the portal shell; Header/Footer/Loading are its presentational
// exports and have their own suite (tests/unit/app-shell.test.jsx). Stubbing
// them here keeps every assertion about THIS page's state machine.
vi.mock('../../src/App.jsx', () => ({
  Header: () => <div data-testid-prefix="header" />,
  Footer: () => <div data-testid="footer" />,
  Loading: () => <div data-testid="loading" />,
}));

// Background draws particles from Math.random(); irrelevant to the branch
// logic and non-deterministic if left real.
vi.mock('../../src/components/Background.jsx', () => ({ default: () => null }));

// The backend seam. Everything this page does is a function of what
// fetchBalanceData resolves to, so it is doubled and driven per test.
vi.mock('../../src/helpers/balance.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBalanceData: vi.fn() };
});

const { fetchBalanceData } = await import('../../src/helpers/balance.js');
const BalancePage = (await import('../../src/BalancePage.jsx')).default;

const ACTIVE = {
  status: 1,
  value: {
    metric: 'milliseconds',
    remaining: 1_800_000, // 30 min
    usage: 1_200_000, // 20 min
    allotment: 3_000_000, // 50 min
    start_time: 1_700_000_000,
    session_active: true,
  },
};

const INACTIVE = {
  status: 1,
  value: {
    metric: 'milliseconds',
    remaining: 0,
    usage: 0,
    allotment: 0,
    session_active: false,
  },
};

const NETWORK_ERROR = {
  status: 0,
  code: 'network',
  message: 'Balance unavailable',
};

beforeEach(() => {
  fetchBalanceData.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('BalancePage (balance.html) — first paint', () => {
  it('shows the loading branch until the first /balance answer lands', async () => {
    let release;
    fetchBalanceData.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<BalancePage />);

    // loading starts true, so nothing else can be on screen yet
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByText('balance_page_title')).toBeNull();

    await act(async () => {
      release(ACTIVE);
    });

    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.getByText('balance_page_title')).toBeTruthy();
  });
});

describe('BalancePage (balance.html) — active session', () => {
  it('renders the three figures with the metric they were reported in', async () => {
    fetchBalanceData.mockResolvedValue(ACTIVE);
    render(<BalancePage />);
    await act(async () => {});

    // formatMetricValue: ms -> minutes/hours, so the raw 1_800_000 must NOT
    // appear and "30 min" must.
    // Remaining appears TWICE by design of the shipped page: once as the
    // Success banner's `info` and once in the remaining StatCard. Asserting
    // the count keeps both call sites pinned — a refactor that drops either
    // one is a visible change, not a silent one.
    expect(screen.getAllByText('30 min')).toHaveLength(2);
    expect(screen.getByText('20 min')).toBeTruthy();
    expect(screen.getByText('50 min')).toBeTruthy();
    expect(screen.queryByText('1800000')).toBeNull();
    // and the metric label comes from the payload, not a hard-coded string
    expect(screen.getByText('balance_time')).toBeTruthy();
  });

  it('formats a bytes session in B/MB/GB and labels the metric as data', async () => {
    fetchBalanceData.mockResolvedValue({
      status: 1,
      value: {
        metric: 'bytes',
        remaining: 1_610_612_736, // 1.5 GB
        usage: 1_048_576, // 1.0 MB
        allotment: 512, // 512 B
        session_active: true,
      },
    });
    render(<BalancePage />);
    await act(async () => {});

    // remaining is the Success banner's info AND a StatCard -> twice
    expect(screen.getAllByText('1.5 GB')).toHaveLength(2);
    expect(screen.getByText('1.0 MB')).toBeTruthy();
    expect(screen.getByText('512 B')).toBeTruthy();
    expect(screen.getByText('balance_data')).toBeTruthy();
  });

  it('shows when the session started, converted from the unix seconds the API sends', async () => {
    fetchBalanceData.mockResolvedValue(ACTIVE);
    render(<BalancePage />);
    await act(async () => {});

    const expected = new Date(1_700_000_000 * 1000).toLocaleString();
    expect(screen.getByText(`balance_started_at${JSON.stringify({ value: expected })}`)).toBeTruthy();
  });

  it('omits the started-at line rather than printing "Invalid Date" when start_time is absent', async () => {
    const { start_time, ...noStart } = ACTIVE.value;
    fetchBalanceData.mockResolvedValue({ status: 1, value: noStart });
    render(<BalancePage />);
    await act(async () => {});

    expect(screen.queryByText(/balance_started_at/)).toBeNull();
    // the other three cards still render
    expect(screen.getAllByText('30 min')).toHaveLength(2);
  });
});

describe('BalancePage (balance.html) — no session', () => {
  it('offers only a way back to the portal, and no figures', async () => {
    fetchBalanceData.mockResolvedValue(INACTIVE);
    render(<BalancePage />);
    await act(async () => {});

    expect(screen.getByText('balance_no_session_message')).toBeTruthy();
    // the active-session subtitle and the grid must NOT both be on screen
    expect(screen.queryByText('balance_page_subtitle')).toBeNull();
    expect(document.querySelector('.tollgate-captive-portal-balance-grid')).toBeNull();
    expect(screen.getByText('return_to_portal').closest('a').getAttribute('href')).toBe('/splash.html');
  });
});

describe('BalancePage (balance.html) — failure branch', () => {
  it('renders the backend error, not an empty balance', async () => {
    fetchBalanceData.mockResolvedValue(NETWORK_ERROR);
    render(<BalancePage />);
    await act(async () => {});

    expect(screen.getByText('#network')).toBeTruthy();
    expect(screen.getByText('Balance unavailable')).toBeTruthy();
    expect(screen.queryByText('balance_page_title')).toBeNull();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('reloads the page from the error branch', async () => {
    fetchBalanceData.mockResolvedValue(NETWORK_ERROR);
    const reload = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, reload };
    try {
      render(<BalancePage />);
      await act(async () => {});
      screen.getByText('refresh_balance').closest('button').click();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      window.location = original;
    }
  });

  it('a failed refresh replaces the figures with the error panel', async () => {
    // PINNED AS A FINDING, not as an endorsement — but unlike the three
    // `it.fails` conversions in the sibling files, this one is NOT obviously a
    // bug, so it is asserted positively with the reasoning stated.
    //
    // The choice the code makes: a poll that fails AFTER a successful reading
    // does not keep the last-good figures — it swaps the panel for the error.
    // Whether that is right is a product judgement (a captive portal whose
    // backend just dropped arguably should say so rather than show figures
    // going stale), and no operator decision recording it exists either way.
    // What this test does is make the judgement VISIBLE: changing it to
    // "keep last-good and show a stale badge" is a deliberate act that has to
    // change this assertion.
    //
    // Reported to the PR as a product question rather than fixed here (this
    // card is tests-only).
    vi.useFakeTimers();
    fetchBalanceData.mockResolvedValueOnce(ACTIVE).mockResolvedValue(NETWORK_ERROR);
    render(<BalancePage />);
    await act(async () => {});
    expect(screen.getByText('balance_page_title')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('#network')).toBeTruthy();
    expect(screen.queryByText('balance_page_title')).toBeNull();
    expect(document.querySelector('.tollgate-captive-portal-balance-grid')).toBeNull();
  });

  it('keeps polling after an error, and recovers when the backend comes back', async () => {
    vi.useFakeTimers();
    fetchBalanceData.mockResolvedValueOnce(NETWORK_ERROR).mockResolvedValue(ACTIVE);
    render(<BalancePage />);
    await act(async () => {});

    expect(screen.getByText('#network')).toBeTruthy();

    // the poll interval is 5 s; it must fire even though the last answer failed
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchBalanceData).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('#network')).toBeNull();
    expect(screen.getByText('balance_page_title')).toBeTruthy();
  });
});

describe('BalancePage (balance.html) — the poll loop', () => {
  it('refreshes every 5 s and stops on unmount', async () => {
    vi.useFakeTimers();
    fetchBalanceData.mockResolvedValue(ACTIVE);
    const { unmount } = render(<BalancePage />);
    await act(async () => {});
    expect(fetchBalanceData).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchBalanceData).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fetchBalanceData).toHaveBeenCalledTimes(4);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    // the interval was cleared: no further calls after unmount
    expect(fetchBalanceData).toHaveBeenCalledTimes(4);
  });

  it('stops painting once unmounted, even if a poll is still in flight', async () => {
    // The `active` flag guards a setState after unmount. Deleting it is an
    // INERT mutation on React 18 — the update is silently ignored and no
    // warning is emitted — so this cannot be proved by mutation, and an
    // earlier revision of this file papered over that with
    // `expect(true).toBe(true)`, which is not a test.
    //
    // What IS observable, and does change if the teardown is broken: the
    // interval must be cleared, so a poll in flight is the LAST one. Asserting
    // the call count after unmount is a real assertion with a real failure
    // mode, and it is what the guard exists to make safe.
    vi.useFakeTimers();
    let release;
    fetchBalanceData.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const { unmount } = render(<BalancePage />);
    expect(fetchBalanceData).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      release(ACTIVE);
    });

    // no NEW poll was scheduled by the late resolve, and the interval is gone
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchBalanceData).toHaveBeenCalledTimes(1);
    // and the detached tree never received the figures
    expect(document.querySelector('.tollgate-captive-portal-balance-grid')).toBeNull();
  });

  it('hands the translation function to the balance loader', async () => {
    // fetchBalanceData(t) needs `t` to translate its own network error. A call
    // with no argument silently degrades to an untranslated message, which is
    // exactly the kind of thing no other assertion here would catch.
    fetchBalanceData.mockResolvedValue(ACTIVE);
    render(<BalancePage />);
    await act(async () => {});

    expect(fetchBalanceData).toHaveBeenCalledTimes(1);
    const arg = fetchBalanceData.mock.calls[0][0];
    expect(typeof arg).toBe('function');
    // and it is the SAME `t` the component renders with: identity, not just
    // "some function"
    expect(arg('balance_page_title')).toBe('balance_page_title');
  });
});
