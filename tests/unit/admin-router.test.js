// Characterization tests for admin/src/lib/router.ts and admin/src/lib/paths.ts.
//
// The router is module-scoped state (a hash listener plus a listener set) that
// the board's pages subscribe to through useRoute(). The tests drive it through
// its public surface only: initRouter(), navigate(), getRoute() and a real
// preact component using useRoute() — written with h() so it needs no JSX
// runtime of its own, matching tests/unit/ui-cross-link.test.js.
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { navigate, getRoute, initRouter, useRoute } from '../../admin/src/lib/router.ts';
import { withBase, trimTrailingSlash } from '../../admin/src/lib/paths.ts';

afterEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  navigate('dashboard');
});

describe('router', () => {
  it('starts on the dashboard route', () => {
    initRouter();
    expect(getRoute()).toBe('dashboard');
  });

  it('resolves each documented hash to its route', () => {
    const cases = [
      ['#/', 'dashboard'],
      ['#/login', 'login'],
      ['#/wifi', 'wifi'],
      ['#/peering', 'peering'],
      ['#/devices', 'devices'],
      ['#/settings', 'settings'],
      ['#/wallet', 'wallet'],
    ];
    for (const [hash, route] of cases) {
      window.location.hash = hash;
      initRouter();
      expect(getRoute(), hash).toBe(route);
    }
  });

  it('falls back to the dashboard for an unknown hash', () => {
    window.location.hash = '#/no-such-page';
    initRouter();
    expect(getRoute()).toBe('dashboard');
  });

  it('navigate() writes the route back into the hash', () => {
    navigate('wallet');
    expect(window.location.hash).toBe('#/wallet');
    navigate('login');
    expect(window.location.hash).toBe('#/login');
  });

  it('a hashchange moves the route and re-renders a subscribed component', async () => {
    window.location.hash = '#/';
    initRouter();

    const seen = [];
    const Probe = () => {
      const route = useRoute();
      seen.push(route);
      return h('span', null, route);
    };
    const root = document.createElement('div');
    document.body.appendChild(root);

    // Mount inside act() so useRoute()'s subscription effect is FLUSHED before
    // the assertions, not merely scheduled. A bare render() only schedules the
    // effect and this file used to wait a fixed 20 ms for it; measured on this
    // host the effect lands anywhere up to ~35 ms under full-suite load, so the
    // fixed wait made the test flake (~2 in 5 coverage runs failed at
    // `expected ['dashboard'] to include 'devices'`). act() exits by flushing
    // pending effects synchronously, which removes the race rather than
    // widening the sleep.
    act(() => {
      render(h(Probe), root);
    });
    expect(seen).toContain('dashboard');

    // Now the listener is genuinely registered, so a hashchange must be seen.
    await act(async () => {
      window.location.hash = '#/devices';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(getRoute()).toBe('devices');
    expect(seen).toContain('devices');
    expect(root.textContent).toBe('devices');
  });

  it('a hashchange to the same route does not notify subscribers', async () => {
    window.location.hash = '#/wifi';
    initRouter();

    let renders = 0;
    const Probe = () => {
      renders += 1;
      return h('span', null, useRoute());
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Probe), root);
    const before = renders;

    await act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(renders).toBe(before);
  });

  it('a subscriber removed on unmount stops receiving notifications', async () => {
    window.location.hash = '#/';
    initRouter();
    const seen = [];
    const Probe = () => {
      seen.push(useRoute());
      return null;
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Probe), root);
    render(null, root);

    const count = seen.length;
    await act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(seen.length).toBe(count);
  });
});

describe('paths', () => {
  it('withBase() prefixes a path with the build base and does not double slashes', () => {
    // import.meta.env.BASE_URL is '/' under the default build base
    expect(withBase('wifi')).toBe('/wifi');
    expect(withBase('/wifi')).toBe('/wifi');
    expect(withBase('')).toBe('/');
  });

  it('trimTrailingSlash() removes one trailing slash but keeps the root', () => {
    expect(trimTrailingSlash('/wifi/')).toBe('/wifi');
    expect(trimTrailingSlash('/wifi')).toBe('/wifi');
    expect(trimTrailingSlash('/')).toBe('/');
    expect(trimTrailingSlash('')).toBe('');
    expect(trimTrailingSlash('/wifi//')).toBe('/wifi/');
  });
});
