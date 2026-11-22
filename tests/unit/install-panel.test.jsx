// GATE (card t_98145b7d, W1) — the panel's RENDER contract.
//
// helpers/install-ux.test.js pins the decisions; this pins what actually
// reaches the DOM, because the failure mode that matters is a UI that CLAIMS an
// affordance the origin cannot provide. Specifically:
//
//   * on the portal origin (no secure context) the panel must render the
//     SIGNPOST variant and must NOT render an install button;
//   * the panel must survive `navigator.serviceWorker` being ABSENT (the
//     measured portal condition) instead of crashing the whole payment page;
//   * dismissing it must remove it.
//
// NOTE ON THE FIXTURE: these cases MUTATE the real `window.isSecureContext` /
// `navigator` rather than `vi.stubGlobal`-ing a fake `window`. React DOM holds a
// live reference to the global document; replacing `window` wholesale makes
// React's `instanceof` checks fail with "Right-hand side of 'instanceof' is not
// an object". The repo's other component test (Cashu.race.test.jsx) mutates the
// real globals for the same reason.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import InstallPanel from '../../src/components/InstallPanel.jsx';

/**
 * Snapshot the properties these cases mutate, so each case starts from the
 * pristine jsdom object. Mutating the real `window`/`navigator` is necessary
 * (React DOM holds a live reference to the global document), but leaving the
 * mutations in place leaks `serviceWorker` from one case into the next — which
 * is exactly how the "secure origin" case initially reported `prompt` instead
 * of `manual`.
 */
const SNAPSHOT = {
  windowProps: {},
  navigatorProps: {},
};

function snapshotProps(target, store, names) {
  for (const name of names) {
    store[name] = Object.getOwnPropertyDescriptor(target, name);
  }
}

function restoreProps(target, store) {
  for (const [name, descriptor] of Object.entries(store)) {
    if (descriptor) {
      Object.defineProperty(target, name, descriptor);
    } else {
      delete target[name];
    }
  }
}

const WINDOW_PROPS = ['isSecureContext', 'location', 'matchMedia'];
const NAVIGATOR_PROPS = ['serviceWorker', 'userAgent'];

beforeEach(() => {
  snapshotProps(window, SNAPSHOT.windowProps, WINDOW_PROPS);
  snapshotProps(navigator, SNAPSHOT.navigatorProps, NAVIGATOR_PROPS);
  delete navigator.serviceWorker;

  // A clean "first visit" store for every case.
  const store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  });
});

afterEach(() => {
  cleanup();
  restoreProps(window, SNAPSHOT.windowProps);
  restoreProps(navigator, SNAPSHOT.navigatorProps);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The measured portal condition: not secure, and no serviceWorker property. */
function portalOrigin(search = '?gw=192.168.1.1&port=2121') {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  // ABSENT, not a throwing object — the whole point of the guard.
  delete navigator.serviceWorker;
}

/** A secure origin with a registering worker. */
function secureOrigin() {
  const registration = {
    scope: '/',
    active: { state: 'activated', postMessage: vi.fn() },
    waiting: null,
    installing: null,
    update: vi.fn(() => Promise.resolve()),
  };
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, search: '' } });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(() => Promise.resolve(registration)),
      getRegistration: vi.fn(() => Promise.resolve(registration)),
      addEventListener: vi.fn(),
      controller: registration.active,
    },
  });
  return registration;
}

describe('InstallPanel: the captive-portal origin', () => {
  it('renders the SIGNPOST variant', () => {
    portalOrigin();
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').getAttribute('data-variant')).toBe('signpost');
  });

  it('renders NO install button — the origin cannot raise a prompt', () => {
    portalOrigin();
    render(<InstallPanel />);
    expect(screen.queryByRole('button', { name: /add to home screen/i })).toBeNull();
  });

  it('does not crash on the absent navigator.serviceWorker', () => {
    portalOrigin();
    expect(() => render(<InstallPanel />)).not.toThrow();
  });

  it('warns that the connection is not encrypted', () => {
    portalOrigin();
    render(<InstallPanel />);
    // The i18n setup mock returns raw KEYS (see src/test/setup.js), so the
    // assertion is against the keys this panel must render, not against prose.
    // What matters is that the low-security notice is actually mounted on the
    // insecure origin — a portal that asks for nothing sensitive still must say
    // the connection is unencrypted.
    const text = screen.getByTestId('install-panel').textContent;
    expect(text).toContain('low_security_notice_title');
    expect(text).toContain('low_security_notice_body');
  });
});

describe('InstallPanel: a secure origin', () => {
  it('renders the "manual" variant when no beforeinstallprompt has fired', () => {
    secureOrigin();
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').getAttribute('data-variant')).toBe('manual');
  });
  it('does not claim an install button before the platform raises the prompt', () => {
    secureOrigin();
    render(<InstallPanel />);
    // The panel is "manual" here, so no button may be offered.
    expect(screen.queryByRole('button', { name: /add to home screen/i })).toBeNull();
  });
});

describe('InstallPanel: dismissal', () => {
  it('removes the panel and remembers the dismissal', () => {
    portalOrigin('');
    render(<InstallPanel />);
    const panel = screen.getByTestId('install-panel');
    const dismiss = panel.querySelector('.install-panel__dismiss');
    expect(dismiss).toBeTruthy();

    fireEvent.click(dismiss);
    expect(screen.queryByTestId('install-panel')).toBeNull();
    expect(localStorage.getItem('tollgate.install.dismissed')).toBe('1');
  });

  it('does not render at all when previously dismissed', () => {
    localStorage.setItem('tollgate.install.dismissed', '1');
    portalOrigin('');
    render(<InstallPanel />);
    expect(screen.queryByTestId('install-panel')).toBeNull();
  });
});
