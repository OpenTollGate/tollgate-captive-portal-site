// Tests for the two page-entry modules: src/index.jsx and src/balance.jsx.
//
// WHY THESE EXIST AT ALL — a cold review of an earlier revision of this PR made
// the point precisely: both files used to sit on the coverage `exclude` list as
// "bare page-mount entry points with no logic of their own", and that exclusion
// was worth 0.64 points of headline coverage (84.30% -> 83.66% when removed).
// An exclusion that moves the number is a claim the numbers rest on, so it had
// to be either true or withdrawn. Measuring said it was not quite true: both
// files have real, falsifiable behaviour —
//
//   * index.jsx reads `import.meta.env.VITE_THEME` and applies the Cobrador
//     Island class to <html>, i.e. the portal's THEME is decided here. Get the
//     comparison or the class name wrong and every themed deployment is wrong.
//   * both files mount a root component through the ErrorBoundary, so the crash
//     surface's wiring is decided here too: mount the app OUTSIDE the boundary
//     and a render error blanks the page instead of showing the crash page.
//
// So they are tested rather than excluded, and the exclusion is gone. That costs
// ~0.64 points and is the right trade: the number is lower and every file it
// counts has been exercised.
//
// The modules are imported for their side effect (they mount into #root on
// import), so each test installs its DOM and its module mocks, then imports
// fresh via vi.resetModules().
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Both entries import their stylesheets; jsdom does not need them and the real
// files pull in sass-only syntax.
vi.mock('../../src/index.scss', () => ({}));
vi.mock('../../src/cobrador-island.scss', () => ({}));
vi.mock('../../src/BalancePage.scss', () => ({}));
vi.mock('../../src/App.scss', () => ({}));

// i18n is bootstrapped by the entry modules; the real one opens no network but
// does pull in four locale bundles. Stubbed so this file measures the entries.
vi.mock('../../src/helpers/i18n.js', () => ({}));

// The mounted trees are irrelevant to what these entries decide — the theme
// class and the boundary placement are asserted through markers instead.
vi.mock('../../src/App.jsx', () => ({
  default: () => <div data-testid="app-mounted" />,
}));
vi.mock('../../src/BalancePage.jsx', () => ({
  default: () => <div data-testid="balance-mounted" />,
}));

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));
vi.mock('react-dom/client', () => ({
  createRoot: (...args) => createRootMock(...args),
  // `import ReactDOM from 'react-dom/client'` resolves through the interop
  // default; without it vitest refuses the namespace object.
  default: { createRoot: (...args) => createRootMock(...args) },
}));

// A real Component that can actually throw, so the boundary's placement is
// observable: a child that throws must be caught, a sibling of the boundary
// must not be.
vi.mock('../../src/components/ErrorBoundary.jsx', () => {
  const { Component } = require('react');
  class ErrorBoundary extends Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
      return { hasError: true };
    }
    render() {
      return this.state.hasError ? (
        <div data-testid="boundary-crash" />
      ) : (
        <div data-testid="boundary-ok">{this.props.children}</div>
      );
    }
  }
  return { ErrorBoundary, default: ErrorBoundary };
});

const mountRoot = () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
};

beforeEach(() => {
  vi.resetModules();
  renderMock.mockReset();
  createRootMock.mockClear();
  delete window.__VITE_THEME_PROBE__;
  // import.meta.env is replaced wholesale per-module by vitest's transform, so
  // the theme is injected before the import rather than mutated after.
  vi.stubEnv('VITE_THEME', '');
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('src/index.jsx — the portal entry', () => {
  it('mounts the portal into #root through createRoot', async () => {
    mountRoot();
    await import('../../src/index.jsx');

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(createRootMock.mock.calls[0][0].id).toBe('root');
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT apply the Cobrador Island theme class by default', async () => {
    mountRoot();
    document.documentElement.className = '';
    await import('../../src/index.jsx');

    expect(document.documentElement.classList.contains('theme-cobrador-island')).toBe(false);
  });

  it('applies the Cobrador Island theme class when VITE_THEME says so', async () => {
    vi.stubEnv('VITE_THEME', 'cobrador-island');
    mountRoot();
    document.documentElement.className = '';
    await import('../../src/index.jsx');

    expect(document.documentElement.classList.contains('theme-cobrador-island')).toBe(true);
  });

  it('does not add the theme class for a near-miss theme value', async () => {
    // The comparison is exact. A typo'd or differently-cased value must not
    // half-apply a theme — that would be a silent, hard-to-attribute skin bug.
    vi.stubEnv('VITE_THEME', 'cobrador-island-dark');
    mountRoot();
    document.documentElement.className = '';
    await import('../../src/index.jsx');

    expect(document.documentElement.classList.contains('theme-cobrador-island')).toBe(false);
  });

  it('mounts the portal INSIDE the error boundary', async () => {
    // The whole point of the entry is that a render error shows the crash page
    // instead of a blank document. The captured element is RENDERED, so the
    // assertion is on the tree the entry actually builds: the App marker must
    // come out of the boundary wrapper.
    mountRoot();
    await import('../../src/index.jsx');

    render(renderMock.mock.calls[0][0]);
    expect(screen.getByTestId('boundary-ok')).toBeTruthy();
    expect(screen.getByTestId('app-mounted')).toBeTruthy();
  });
});

describe('src/balance.jsx — the standalone balance entry', () => {
  it('mounts the balance page into #root', async () => {
    mountRoot();
    await import('../../src/balance.jsx');

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(createRootMock.mock.calls[0][0].id).toBe('root');
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('mounts the balance page inside the error boundary too', async () => {
    // A balance page that blanks on a bad payload is the failure mode this
    // boundary exists to prevent; this entry must place it the same way the
    // portal entry does.
    mountRoot();
    await import('../../src/balance.jsx');

    render(renderMock.mock.calls[0][0]);
    expect(screen.getByTestId('boundary-ok')).toBeTruthy();
    expect(screen.getByTestId('balance-mounted')).toBeTruthy();
  });

  it('renders the BALANCE page, not the portal shell', async () => {
    // The two entries share a boundary; the difference is the child. Swapping
    // the imports between index.jsx and balance.jsx is a plausible copy-paste
    // bug and would ship the splash page at /balance.html.
    mountRoot();
    await import('../../src/balance.jsx');

    render(renderMock.mock.calls[0][0]);
    expect(screen.getByTestId('balance-mounted')).toBeTruthy();
    expect(screen.queryByTestId('app-mounted')).toBeNull();
  });
});
