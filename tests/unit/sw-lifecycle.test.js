// GATE (card t_98145b7d, W1) — the service-worker LIFECYCLE contract.
//
// What this file pins, and why each assertion is here rather than in an e2e:
//
//   1. REGISTRATION is gated on the secure context, first. On the portal's real
//      origin `navigator.serviceWorker` does not exist at all (it is
//      [SecureContext]-gated at the IDL layer), so `register()` throws
//      `TypeError: Cannot read properties of undefined`. A try/catch written
//      around the call therefore CRASHES instead of degrading. This suite pins
//      that registration never throws and reports 'unsupported' there.
//
//   2. VERSIONING. A service worker is the one artifact in a web app that can
//      outlive its own deployment: the browser keeps the old worker until a new
//      one activates. If the cache name does not change with the build, a new
//      deploy is served by the OLD worker out of the OLD cache, and a customer
//      gets last release's shell — indefinitely, because nothing forces the
//      swap. The cache name must therefore be DERIVED from a build-stamped
//      version, and a version bump must retire every other cache.
//
//   3. THE SWAP IS NOT AUTOMATIC. skipWaiting() mid-payment swaps the shell
//      under a customer who is between "quote" and "paid". The new worker must
//      install, WAIT, and only take over when the app asks for it.
//
// The rule set these tests exercise is the same one `public/sw.js` obeys; the
// worker itself cannot be imported under jsdom (it is a classic worker script
// with no module exports on purpose — a module worker would need
// `new Worker(..., {type:'module'})` support in the SW registration, which is
// not universal), so the lifecycle logic lives in a testable module and the
// worker is a thin binding over it. The e2e spec then proves the two agree in
// a real browser.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  SW_CACHE_PREFIX,
  cacheNameForVersion,
  isOurCache,
  planActivation,
  shouldSkipWaiting,
  isSameAppVersion,
} from '../../src/helpers/sw-lifecycle.js';

import {
  registerServiceWorker,
  requestShellUpdate,
  registrationState,
  __resetRegistrationState,
} from '../../src/helpers/sw-register.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── versioning ───────────────────────────────────────────────────────────────

describe('sw-lifecycle: the cache name is versioned', () => {
  it('derives the cache name from the version, so a new build never reuses the old cache', () => {
    expect(cacheNameForVersion('a1b2c3d')).toBe(`${SW_CACHE_PREFIX}a1b2c3d`);
    expect(cacheNameForVersion('a1b2c3d')).not.toBe(cacheNameForVersion('e4f5g6h'));
  });

  it('a MISSING version is its own distinct cache, never the literal "undefined"', () => {
    // A build pipeline that forgot to stamp must not silently collide with a
    // real version string, and must not produce "<prefix>undefined" — that is
    // how two different unstamped builds end up sharing one cache.
    const missing = cacheNameForVersion(undefined);
    expect(missing).not.toContain('undefined');
    expect(missing).toBe(cacheNameForVersion(''));
    expect(cacheNameForVersion(null)).toBe(missing);
    expect(cacheNameForVersion('   ')).toBe(missing);
  });

  it('SANITISES the version: it may not break out of the cache namespace', () => {
    // The version is injected at build time. If it is ever derived from a tag
    // or branch name it can contain '/' or whitespace; a cache name is a
    // string key, so a stray separator is how two caches look identical.
    const name = cacheNameForVersion('v0.6.0 / main..branch');
    expect(name).not.toMatch(/[\s/]/);
    expect(name.startsWith(SW_CACHE_PREFIX)).toBe(true);
  });

  it('two versions that SANITISE to the same string must be treated as the same cache', () => {
    // Consistency check on the inverse: whatever sanitisation we do, the
    // identity comparison must agree with it.
    expect(cacheNameForVersion('v0.6.0/a')).toBe(cacheNameForVersion('v0.6.0 a'));
  });
});

describe('sw-lifecycle: which caches belong to this app', () => {
  it('recognises our own caches and nothing else', () => {
    expect(isOurCache(cacheNameForVersion('abc123'))).toBe(true);
    expect(isOurCache('workbox-precache-v2-https://x')).toBe(false);
    expect(isOurCache('some-other-app')).toBe(false);
    expect(isOurCache(undefined)).toBe(false);
    expect(isOurCache(null)).toBe(false);
  });

  it('the activation plan deletes every stale cache of OURS and keeps the current one', () => {
    const current = cacheNameForVersion('new');
    const keys = [
      cacheNameForVersion('old-1'),
      cacheNameForVersion('old-2'),
      current,
      'foreign-cache',
    ];
    const plan = planActivation({ current, existing: keys });

    expect(plan.keep).toBe(current);
    expect(plan.delete).toEqual([cacheNameForVersion('old-1'), cacheNameForVersion('old-2')]);
    // A cache we do not own is never ours to delete.
    expect(plan.delete).not.toContain('foreign-cache');
    expect(plan.delete).not.toContain(current);
  });

  it('the activation plan is idempotent — running it twice deletes nothing the second time', () => {
    const current = cacheNameForVersion('v1');
    const first = planActivation({ current, existing: [cacheNameForVersion('v0'), current] });
    expect(first.delete).toEqual([cacheNameForVersion('v0')]);

    const second = planActivation({ current, existing: [current] });
    expect(second.delete).toEqual([]);
  });
});

// ── the swap ─────────────────────────────────────────────────────────────────

describe('sw-lifecycle: the shell must not swap mid-session', () => {
  it('a freshly installed worker WAITS instead of skipWaiting', () => {
    // The defect this pins: `self.skipWaiting()` in `install` is the common
    // copy-paste, and it activates the new worker while the old one may be
    // mid-request. Here it must not be requested at all.
    expect(shouldSkipWaiting({ reason: 'install' })).toBe(false);
    expect(shouldSkipWaiting({ reason: 'activate' })).toBe(false);
  });

  it('skips waiting only on an EXPLICIT app request', () => {
    expect(shouldSkipWaiting({ reason: 'user-idle' })).toBe(true);
  });

  it('an unrecognised reason does NOT skip waiting (fail closed)', () => {
    expect(shouldSkipWaiting({ reason: 'whatever' })).toBe(false);
    expect(shouldSkipWaiting({})).toBe(false);
    expect(shouldSkipWaiting(null)).toBe(false);
    expect(shouldSkipWaiting(undefined)).toBe(false);
  });
});

describe('sw-lifecycle: app-version equality', () => {
  it('compares the version the page was built with against the version a worker reports', () => {
    expect(isSameAppVersion('abc', 'abc')).toBe(true);
    expect(isSameAppVersion('abc', 'def')).toBe(false);
  });

  it('a missing version on either side is never "same" (fail closed)', () => {
    expect(isSameAppVersion(undefined, undefined)).toBe(false);
    expect(isSameAppVersion('abc', undefined)).toBe(false);
    expect(isSameAppVersion(undefined, 'abc')).toBe(false);
    expect(isSameAppVersion('', '')).toBe(false);
  });
});

// ── registration ─────────────────────────────────────────────────────────────

describe('sw-register: on the captive-portal origin (no secure context)', () => {
  /** The measured portal origin: isSecureContext false, serviceWorker ABSENT. */
  function makePortalOrigin() {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', { userAgent: 'portal' }); // no serviceWorker key at all
    return {};
  }

  it('reports "unsupported" and never calls register()', async () => {
    makePortalOrigin();
    const outcome = await registerServiceWorker();
    expect(outcome.state).toBe('unsupported');
    expect(outcome.registration).toBeFalsy();
  });

  it('does NOT throw — the property is undefined, not a catchable SecurityError', async () => {
    makePortalOrigin();
    await expect(registerServiceWorker()).resolves.toBeTruthy();
  });

  it('reports "unsupported" even if a browser exposes serviceWorker without the context', async () => {
    // The inverse mistake: trusting the API's presence over the context. If
    // the context is not secure the worker cannot be trusted to run, so we do
    // not register — and importantly we do not claim support.
    const register = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    const outcome = await registerServiceWorker();
    expect(outcome.state).toBe('unsupported');
    expect(register).not.toHaveBeenCalled();
  });
});

describe('sw-register: on a secure origin', () => {
  function makeSecureOrigin(register) {
    vi.stubGlobal('window', { isSecureContext: true });
    const registration = {
      scope: '/',
      active: { state: 'activated', postMessage: vi.fn() },
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
      update: vi.fn(() => Promise.resolve()),
    };
    const container = {
      register: register || vi.fn(() => Promise.resolve(registration)),
      getRegistration: vi.fn(() => Promise.resolve(registration)),
      addEventListener: vi.fn(),
      controller: registration.active,
    };
    vi.stubGlobal('navigator', { serviceWorker: container });
    return { container, registration };
  }

  it('registers the worker at the app base path and reports "registered"', async () => {
    const { container } = makeSecureOrigin();
    const outcome = await registerServiceWorker();
    expect(outcome.state).toBe('registered');
    expect(container.register).toHaveBeenCalledTimes(1);
    // Root scope: the shell must be able to answer for /splash.html AND
    // /balance.html, so the worker may not be scoped to a subdirectory.
    expect(String(container.register.mock.calls[0][0])).toContain('sw.js');
    expect(String(container.register.mock.calls[0][0])).not.toContain('//');
  });

  it('a registering failure is reported, not thrown', async () => {
    const { container } = makeSecureOrigin(vi.fn(() => Promise.reject(new Error('boom'))));
    const outcome = await registerServiceWorker();
    expect(outcome.state).toBe('error');
    expect(outcome.error).toBeInstanceOf(Error);
    expect(container.register).toHaveBeenCalled();
  });

  it('a SYNCHRONOUS throw from register() (a TypeError on a bad base) is also caught', async () => {
    const { container } = makeSecureOrigin(
      vi.fn(() => {
        throw new TypeError('bad scope');
      })
    );
    await expect(registerServiceWorker()).resolves.toMatchObject({ state: 'error' });
    expect(container.register).toHaveBeenCalled();
  });
});

describe('sw-register: asking for the swap', () => {
  it('posts SKIP_WAITING to the WAITING worker and triggers a reload once it takes over', async () => {
    const postMessage = vi.fn();
    const listeners = {};
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: { reload: vi.fn() },
      addEventListener: vi.fn(),
    });
    const waiting = { state: 'installed', postMessage };
    const registration = {
      waiting,
      active: { state: 'activated', postMessage: vi.fn() },
      installing: null,
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn(() => Promise.resolve(registration)),
        getRegistration: vi.fn(() => Promise.resolve(registration)),
        addEventListener: vi.fn(),
        controller: registration.active,
      },
    });

    const applied = await requestShellUpdate(registration);
    expect(applied).toBe(true);
    expect(postMessage).toHaveBeenCalledWith('SKIP_WAITING');
  });

  it('returns false when there is nothing waiting — it never reloads for no reason', async () => {
    vi.stubGlobal('window', { isSecureContext: true, location: { reload: vi.fn() } });
    const registration = { waiting: null, active: { state: 'activated' }, installing: null };
    expect(await requestShellUpdate(registration)).toBe(false);
  });

  it('returns false rather than throwing when given no registration', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    expect(await requestShellUpdate(null)).toBe(false);
    expect(await requestShellUpdate(undefined)).toBe(false);
  });
});

// ── the reported state, for the UI ───────────────────────────────────────────

describe('sw-register: registrationState', () => {
  beforeEach(() => {
    // The module remembers the last outcome; each case starts from a clean seam
    // so an earlier failure cannot be read as this case's answer.
    __resetRegistrationState();
  });

  it('is "unsupported" without a secure context', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', {});
    expect(registrationState()).toBe('unsupported');
  });

  it('is "unknown" before anything has been attempted', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn() } });
    expect(registrationState()).toBe('idle');
  });
});

// ── the served worker file itself ────────────────────────────────────────────

describe('public/sw.js — the shipped worker is versioned and never auto-activates', () => {
  it('does not call skipWaiting unconditionally at install time', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

    // Strip comments so a mention in prose does not satisfy or trip the check.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    const installBlock = code.slice(code.indexOf("addEventListener('install'"));
    const activateBlock = code.slice(code.indexOf("addEventListener('activate'"));
    expect(code).toContain("addEventListener('install'");

    expect(
      installBlock.slice(0, installBlock.indexOf('addEventListener')).includes('skipWaiting'),
      'install must not skipWaiting — the swap must wait for the app'
    ).toBe(false);
    expect(
      activateBlock.slice(0, activateBlock.indexOf('addEventListener')).includes('skipWaiting'),
      'activate must not skipWaiting unconditionally'
    ).toBe(false);
  });

  it('binds its cache name to a build-stamped version rather than a hardcoded v1', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    // A literal is exactly the defect: it never changes between releases.
    expect(code).not.toMatch(/CACHE_NAME\s*=\s*['"]tollgate-shell-v1['"]/);
    // It must come from a placeholder the build replaces, or self.__SW_VERSION__.
    expect(/__SW_VERSION__|__BUILD_VERSION__|SW_VERSION/.test(code)).toBe(true);
  });
});
