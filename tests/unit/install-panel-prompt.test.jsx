// GATE (card t_98145b7d, W1) — the PROMPT path of the install panel.
//
// `install-panel.test.jsx` pins the signpost (insecure origin) and the manual
// (secure origin, no prompt yet) variants, and dismissal. It deliberately does
// NOT cover the one path that actually installs: the `beforeinstallprompt`
// event arriving and the customer accepting. That gap matters because the CTA
// is the only control in this panel that performs an action — if its wiring
// breaks, the panel still renders and every other test still passes.
//
// What is pinned here:
//   1. before the event the panel offers MANUAL steps and no button;
//   2. when the platform raises `beforeinstallprompt`, the panel upgrades to a
//      real button and suppresses the browser's own mini-infobar;
//   3. pressing the button calls the platform prompt exactly once, and an
//      ACCEPTED outcome is remembered as a dismissal (so the panel does not
//      chase the customer after they installed);
//   4. a prompt that throws does not take the page down — the payment page must
//      survive a platform failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import InstallPanel from '../../src/components/InstallPanel.jsx';

const SNAPSHOT = { windowProps: {}, navigatorProps: {} };

function snapshotProps(target, store, names) {
  for (const name of names) {
    store[name] = Object.getOwnPropertyDescriptor(target, name);
  }
}

function restoreProps(target, store) {
  for (const [name, descriptor] of Object.entries(store)) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
  }
}

const WINDOW_PROPS = ['isSecureContext', 'location', 'matchMedia'];
const NAVIGATOR_PROPS = ['serviceWorker', 'userAgent'];

beforeEach(() => {
  snapshotProps(window, SNAPSHOT.windowProps, WINDOW_PROPS);
  snapshotProps(navigator, SNAPSHOT.navigatorProps, NAVIGATOR_PROPS);

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

/** A secure origin whose worker claims installability (variant `prompt`). */
function installableOrigin() {
  const registration = {
    scope: '/',
    active: { state: 'activated', postMessage: vi.fn() },
    waiting: null,
    installing: null,
    update: vi.fn(() => Promise.resolve()),
  };
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search: '' },
  });
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
}

/** Fire the platform's install event at the window, as Chromium would. */
function raiseInstallPrompt(outcome = 'accepted', { throws = false } = {}) {
  const event = new Event('beforeinstallprompt');
  event.preventDefault = vi.fn();
  event.prompt = vi.fn(() => {
    if (throws) throw new Error('platform prompt failed');
  });
  event.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('InstallPanel: the real install prompt', () => {
  it('offers manual steps, not a button, until the platform raises the event', () => {
    installableOrigin();
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').getAttribute('data-variant')).toBe('manual');
    expect(screen.queryByRole('button', { name: 'install_app_cta' })).toBeNull();
  });

  it('upgrades to a real install button once the event arrives, and suppresses the mini-infobar', () => {
    installableOrigin();
    render(<InstallPanel />);
    const event = raiseInstallPrompt();

    // The panel's own affordance is the single prompt: letting the browser's
    // info-bar through as well is how a customer dismisses both.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    const panel = screen.getByTestId('install-panel');
    expect(panel.getAttribute('data-variant')).toBe('prompt');
    // data-capability reports what the origin COULD do; data-variant what is
    // offered now. They agree exactly when the event has landed.
    expect(panel.getAttribute('data-capability')).toBe('prompt');
    expect(screen.getByRole('button', { name: 'install_app_cta' })).toBeTruthy();
  });

  it('calls the platform prompt once and remembers an accepted install', async () => {
    installableOrigin();
    render(<InstallPanel />);
    const event = raiseInstallPrompt('accepted');

    fireEvent.click(screen.getByRole('button', { name: 'install_app_cta' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    // Accepted = installed = the question is answered; asking again next visit
    // would be nagging about something already done.
    expect(localStorage.getItem('tollgate.install.dismissed')).toBe('1');
    expect(screen.queryByTestId('install-panel')).toBeNull();
  });

  it('treats a DISMISSED prompt as a decision that removes the button, not as a failure', async () => {
    installableOrigin();
    render(<InstallPanel />);
    const event = raiseInstallPrompt('dismissed');

    fireEvent.click(screen.getByRole('button', { name: 'install_app_cta' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    // The prompt is single-use: it cannot be replayed, so no dead button is
    // left behind. Declining install does NOT auto-dismiss the whole panel —
    // the manual steps stay available.
    expect(screen.queryByRole('button', { name: 'install_app_cta' })).toBeNull();
    expect(localStorage.getItem('tollgate.install.dismissed')).toBeNull();
  });

  it('survives a platform prompt that throws', async () => {
    installableOrigin();
    render(<InstallPanel />);
    raiseInstallPrompt('accepted', { throws: true });

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'install_app_cta' }))
    ).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    // A failed prompt must not leave the payment page in a broken state.
    expect(screen.queryByRole('button', { name: 'install_app_cta' })).toBeNull();
  });
});
