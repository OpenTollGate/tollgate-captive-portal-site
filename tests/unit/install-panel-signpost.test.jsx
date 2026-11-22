// GATE (card t_98145b7d, W1) — the SIGNPOST's deep-link and platform wording.
//
// The signpost is what a customer on the router's own `http://` origin actually
// sees, so its two remaining decisions are load-bearing:
//
//   1. the DEEP-LINK. The portal cannot install anything; the vendor HTTPS app
//      can. The link has to carry the gateway context (`?gw=&port=&mac=&nonce=`)
//      or the vendor app does not know which router (and which purchase nonce)
//      the customer arrived with — the customer then has to retype a LAN IP into
//      a phone, which is where the funnel dies.
//   2. a BROKEN vendor configuration must not become a dead link. The origin is
//      a build-time variable; a value that is not https cannot install an app,
//      so the signpost has to fall back to the manual steps instead of emitting
//      a link that leads somewhere the promise cannot be kept.
//
// `VENDOR_ORIGIN` is a module-level constant read from `import.meta.env`, so
// each case stubs the env and imports the component FRESH — stubbing after the
// import would test nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const SNAPSHOT = { windowProps: {}, navigatorProps: {} };

function snapshotProps(target, store, names) {
  for (const name of names) store[name] = Object.getOwnPropertyDescriptor(target, name);
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
});

afterEach(() => {
  cleanup();
  restoreProps(window, SNAPSHOT.windowProps);
  restoreProps(navigator, SNAPSHOT.navigatorProps);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** The measured portal condition, with a gateway query string. */
function portalOrigin(search) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  delete navigator.serviceWorker;
}

/** Import the panel with a given vendor origin baked in. */
async function panelWithVendorOrigin(origin) {
  vi.stubEnv('VITE_VENDOR_APP_ORIGIN', origin);
  vi.resetModules();
  const mod = await import('../../src/components/InstallPanel.jsx');
  return mod.default;
}

describe('InstallPanel: the signpost deep-link', () => {
  it('carries the gateway context into the vendor URL', async () => {
    portalOrigin('?gw=192.168.1.1&port=2121&mac=aa:bb:cc:dd:ee:ff&nonce=n0nce');
    const InstallPanel = await panelWithVendorOrigin('https://app.example');
    render(<InstallPanel />);

    const link = screen.getByRole('link', { name: 'install_app_cta' });
    const href = new URL(link.getAttribute('href'));
    expect(href.origin).toBe('https://app.example');
    expect(href.searchParams.get('gw')).toBe('192.168.1.1');
    expect(href.searchParams.get('port')).toBe('2121');
    expect(href.searchParams.get('mac')).toBe('aa:bb:cc:dd:ee:ff');
    expect(href.searchParams.get('nonce')).toBe('n0nce');
  });

  it('omits the link entirely when the vendor origin is not https', async () => {
    portalOrigin('?gw=192.168.1.1');
    // A plain-http vendor origin cannot install an app either, so the honest
    // move is the manual steps — not a link that repeats the same dead end.
    const InstallPanel = await panelWithVendorOrigin('http://app.example');
    render(<InstallPanel />);

    expect(screen.getByTestId('install-panel').getAttribute('data-variant')).toBe('signpost');
    expect(screen.queryByRole('link', { name: 'install_app_cta' })).toBeNull();
    expect(screen.getByTestId('install-panel').textContent).toContain(
      'install_signpost_manual_desktop'
    );
  });

  it('renders no link when no vendor origin is configured at all', async () => {
    portalOrigin('');
    const InstallPanel = await panelWithVendorOrigin('');
    render(<InstallPanel />);

    expect(screen.queryByRole('link', { name: 'install_app_cta' })).toBeNull();
  });
});

describe('InstallPanel: platform wording', () => {
  it('gives iOS customers the Share-sheet instruction', async () => {
    portalOrigin('');
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1',
    });
    const InstallPanel = await panelWithVendorOrigin('');
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').textContent).toContain(
      'install_signpost_manual_ios'
    );
  });

  it('gives Android customers the menu instruction', async () => {
    portalOrigin('');
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile',
    });
    const InstallPanel = await panelWithVendorOrigin('');
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').textContent).toContain(
      'install_signpost_manual_android'
    );
  });

  it('falls back to the desktop wording when the user agent cannot be read', async () => {
    portalOrigin('');
    // A UA getter that throws is the shape that would otherwise take the whole
    // panel down on the page that also carries the payment form.
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    const InstallPanel = await panelWithVendorOrigin('');
    render(<InstallPanel />);
    expect(screen.getByTestId('install-panel').textContent).toContain(
      'install_signpost_manual_desktop'
    );
  });
});
