// Tests for the remaining small portal components: Background (the animated
// canvas particle field), ErrorBoundary (the crash surface), LanguageSwitcher,
// DemoBanner, Status (Error/Success) and the Icon set.
//
// Background is the interesting one: it paints on a <canvas> from a
// requestAnimationFrame loop, so jsdom's 2d context is doubled and every
// drawing call is recorded. That makes the component's real behaviour —
// particle count, the neighbour lines, the resize handling, the cleanup —
// assertable without a GPU.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import 'react';

// ── canvas 2d context double ──────────────────────────────────────────
const ctxCalls = [];
const createContext2d = () => ({
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  clearRect: (...a) => ctxCalls.push(['clearRect', ...a]),
  beginPath: () => ctxCalls.push(['beginPath']),
  arc: (...a) => ctxCalls.push(['arc', ...a]),
  fill: () => ctxCalls.push(['fill']),
  moveTo: (...a) => ctxCalls.push(['moveTo', ...a]),
  lineTo: (...a) => ctxCalls.push(['lineTo', ...a]),
  stroke: () => ctxCalls.push(['stroke']),
});

// LanguageSwitcher imports src/helpers/i18n.js, which initialises a REAL
// i18next instance at import time — incompatible with the setup file's
// react-i18next mock (it has no initReactI18next). lib/i18n.js is covered by
// its own file (tests/unit/portal-i18n.test.js), so here it is doubled.
vi.mock('../../src/helpers/i18n.js', () => ({
  supportedLanguages: ['en', 'de', 'zh-Hans'],
  languageNames: { en: 'English', de: 'Deutsch', 'zh-Hans': '简体中文' },
  getAvailableLanguages: () => ['en', 'de', 'zh-Hans'],
  isRTL: () => false,
  default: {},
}));

const Background = (await import('../../src/components/Background.jsx')).default;
const { ErrorBoundary } = await import('../../src/components/ErrorBoundary.jsx');
const LanguageSwitcher = (await import('../../src/components/LanguageSwitcher.jsx')).default;
const DemoBanner = (await import('../../src/components/DemoBanner.jsx')).default;
const { Error: StatusError, Success: StatusSuccess } = await import(
  '../../src/components/Status.jsx'
);
const icons = await import('../../src/components/Icon.jsx');
const DeviceInfo = (await import('../../src/components/DeviceInfo.jsx')).default;

let rafCallbacks;
let originalRaf;
let originalCancelRaf;

// Background's Particle constructor draws its position, size, speed and colour
// from Math.random(), and which branches of update()/the link pass run depends
// on those draws. Unseeded, the file's v8 BRANCH count moved run to run
// (measured: 15, 16, 17 and 18 of 19 across four runs) which in turn made the
// whole-suite branch total wobble and would one day trip the 80% floor for no
// code reason. A deterministic PRNG makes every draw reproducible, so the
// branch coverage is a property of the test, not of the scheduler.
const seededRandom = () => {
  let seed = 0x2f6e2b1;
  return () => {
    // xorshift32, then normalise to [0, 1)
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0x100000000;
  };
};

beforeEach(() => {
  ctxCalls.length = 0;
  rafCallbacks = [];
  vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  originalRaf = window.requestAnimationFrame;
  originalCancelRaf = window.cancelAnimationFrame;
  // A queue instead of a real frame loop: the test drives frames explicitly,
  // so an unbounded rAF would not spin the event loop forever. stubGlobal is
  // required — a bare assignment to window.requestAnimationFrame does not
  // replace the global binding jsdom's `requestAnimationFrame(animate)` call
  // resolves to.
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => createContext2d());
  // A deterministic window size keeps the particle count stable.
  Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 320, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const runFrame = () => {
  const pending = rafCallbacks;
  rafCallbacks = [];
  pending.forEach((cb) => cb(0));
};

describe('Background', () => {
  it('renders a single canvas', () => {
    const { container } = render(<Background />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(container.querySelector('canvas').className).toBe(
      'tollgate-captive-portal-background'
    );
  });

  it('sizes the canvas to the viewport and paints particles after the resize debounce', () => {
    vi.useFakeTimers();
    const { container } = render(<Background />);
    const canvas = container.querySelector('canvas');

    // The particle field is built 200 ms after mount (the resize debounce).
    vi.advanceTimersByTime(250);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(320);

    // jsdom drives real animation frames off the fake timers, so how MANY
    // frames run inside one advance is not fixed. The invariant that is: each
    // frame draws exactly one arc+fill per particle, and (320 + 320) / 16 = 40
    // particles, so every observed count is a whole multiple of 40.
    const arcs = ctxCalls.filter((c) => c[0] === 'arc');
    const fills = ctxCalls.filter((c) => c[0] === 'fill');
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.length % 40).toBe(0);
    expect(fills.length).toBe(arcs.length);

    // Every arc is drawn at a particle position with a positive radius.
    for (const [, x, y, size] of arcs) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }

    // Each frame first clears the whole canvas. The first frames can run before
    // the debounced resize lands, so they clear jsdom's default 300x150 surface;
    // once sized, every clear covers the full 320x320 viewport.
    const clears = ctxCalls.filter((c) => c[0] === 'clearRect');
    expect(clears.length).toBeGreaterThan(0);
    for (const [, x, y, w, h] of clears) {
      expect([x, y]).toEqual([0, 0]);
      expect([300, 320]).toContain(w);
      expect([150, 320]).toContain(h);
    }
    expect(clears).toContainEqual(['clearRect', 0, 0, 320, 320]);
  });

  it('draws the neighbour lines between particles once they have converged', () => {
    vi.useFakeTimers();
    // A tiny canvas collapses every particle into (almost) the same pixel, so
    // every pair is inside the 100 px link radius and the line pass must run.
    Object.defineProperty(window, 'innerWidth', { value: 16, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 16, configurable: true });
    const { container } = render(<Background />);
    const canvas = container.querySelector('canvas');
    vi.advanceTimersByTime(250);

    expect(canvas.width).toBe(16);
    expect(ctxCalls.filter((c) => c[0] === 'moveTo').length).toBeGreaterThan(0);
    expect(ctxCalls.filter((c) => c[0] === 'lineTo').length).toBeGreaterThan(0);
    expect(ctxCalls.filter((c) => c[0] === 'stroke').length).toBeGreaterThan(0);
    // A line is stroked between two distinct particle positions.
    const [mx, my] = ctxCalls.find((c) => c[0] === 'moveTo').slice(1);
    const [lx, ly] = ctxCalls.find((c) => c[0] === 'lineTo').slice(1);
    expect(Number.isFinite(mx) && Number.isFinite(my)).toBe(true);
    expect(Number.isFinite(lx) && Number.isFinite(ly)).toBe(true);
  });

  it('re-initialises its particle field on resize', () => {
    vi.useFakeTimers();
    const { container } = render(<Background />);
    const canvas = container.querySelector('canvas');
    vi.advanceTimersByTime(250);
    expect(canvas.width).toBe(320);

    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    vi.advanceTimersByTime(250);

    expect(canvas.width).toBe(640);
    ctxCalls.length = 0;
    vi.advanceTimersByTime(100);
    // (640 + 320) / 16 = 60 particles per frame.
    const arcs = ctxCalls.filter((c) => c[0] === 'arc').length;
    expect(arcs).toBeGreaterThan(0);
    expect(arcs % 60).toBe(0);
  });

  it('drops its resize listener on unmount', () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Background />);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('ErrorBoundary', () => {
  const Boom = () => {
    throw new Error('kaboom');
  };

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>healthy</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  it('renders the crash page instead of the broken subtree', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Reloading usually fixes it/)).toBeTruthy();
    // The message is surfaced in the details, not swallowed.
    expect(screen.getByText('kaboom')).toBeTruthy();
  });

  it('reloads the portal from the crash page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, reload };
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reload Portal' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      window.location = original;
    }
  });

  it('logs the caught error for the operator', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'ErrorBoundary caught:',
      expect.any(Error),
      expect.anything()
    );
  });
});

describe('LanguageSwitcher', () => {
  it('lists the available languages and selects the active one', () => {
    render(<LanguageSwitcher />);
    const select = document.getElementById('tollgate-i18n');
    expect(select).toBeTruthy();
    expect(select.getAttribute('aria-label')).toBe('Language');
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(['en', 'de', 'zh-Hans']);
    // The setup file's i18n mock reports 'en'
    expect(select.value).toBe('en');
  });

  it('shows each language in its own script', () => {
    render(<LanguageSwitcher />);
    const byValue = Object.fromEntries(
      [...document.getElementById('tollgate-i18n').options].map((o) => [o.value, o.textContent])
    );
    expect(byValue['zh-Hans']).toBe('简体中文');
    expect(byValue.de).toBe('Deutsch');
  });

  it('asks i18n to change language on selection', async () => {
    const { useTranslation } = await import('react-i18next');
    const i18n = useTranslation().i18n;
    i18n.changeLanguage = vi.fn();

    render(<LanguageSwitcher />);
    fireEvent.change(document.getElementById('tollgate-i18n'), {
      target: { value: 'de' },
    });
    expect(i18n.changeLanguage).toHaveBeenCalledWith('de');
  });
});

describe('DemoBanner', () => {
  it('renders nothing outside demo mode', () => {
    const { container } = render(<DemoBanner />);
    // VITE_MOCK is unset in the unit run, so the banner must not paint.
    expect(container.querySelector('.demo-banner')).toBeNull();
  });
});

describe('Status', () => {
  it('Error renders label, code and message', () => {
    render(<StatusError label="Nope" code="X1" message="It failed" />);
    expect(screen.getByText('Nope')).toBeTruthy();
    expect(screen.getByText('#X1')).toBeTruthy();
    expect(screen.getByText('It failed')).toBeTruthy();
  });

  it('Error omits the optional code and message when absent', () => {
    const { container } = render(<StatusError label="Nope" />);
    expect(container.querySelector('.status-code')).toBeNull();
    expect(container.querySelector('.status-content')).toBeNull();
    expect(container.querySelector('.status.error')).toBeTruthy();
  });

  it('Success renders info and an HTML message', () => {
    const { container } = render(
      <StatusSuccess
        label="Yay"
        info="1 sat"
        message="<strong>granted</strong>"
      />
    );
    expect(screen.getByText('Yay')).toBeTruthy();
    expect(screen.getByText('1 sat')).toBeTruthy();
    // The message is documented as allowed to carry markup.
    expect(container.querySelector('.status-message strong').textContent).toBe('granted');
  });

  it('Success omits the optional parts when absent', () => {
    const { container } = render(<StatusSuccess label="Yay" />);
    expect(container.querySelector('.status-info')).toBeNull();
    expect(container.querySelector('.status-content')).toBeNull();
    expect(container.querySelector('.status.success')).toBeTruthy();
  });
});

describe('Icon', () => {
  it('every icon is an SVG that carries a path or a shape', () => {
    const names = Object.keys(icons);
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const name of names) {
      const Icon = icons[name];
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, name).toBeTruthy();
      expect(svg.getAttribute('viewBox'), name).toBeTruthy();
      expect(svg.querySelectorAll('path, circle').length, name).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('DeviceInfo', () => {
  it('renders the resolved MAC', () => {
    render(<DeviceInfo tollgateDetails={{ deviceInfo: { type: 'mac', value: 'aa:bb' } }} />);
    expect(screen.getByText(/aa:bb/)).toBeTruthy();
  });

  it('renders nothing when /whoami returned no device info', () => {
    const { container } = render(<DeviceInfo tollgateDetails={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('falls back to placeholders for an unknown identifier type', () => {
    render(<DeviceInfo tollgateDetails={{ deviceInfo: { type: 'ip', value: '10.0.0.5' } }} />);
    expect(screen.getByText(/unkonw_type: 10\.0\.0\.5/)).toBeTruthy();
  });
});
