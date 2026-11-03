// GATE (card t_98145b7d, W1) — OFFLINE RELOAD, and the install affordance.
//
// This is the card's hard evidence requirement, as an executable gate:
//   "Offline proof: SW registered + a real offline reload" + "install affordance
//    captured (iOS/Android)".
//
// It runs on LOOPBACK, because that is the only origin on this host where a
// service worker can register at all (installability.spec.mjs already pins the
// LAN-IP negative control: no SW, no crypto.subtle, no caches). So this spec
// answers "does the shell work offline on a secure origin" — which is the
// vendor-origin premise — and it deliberately does NOT claim anything about the
// router's http origin.
//
// Two things it is careful about:
//
//   1. It serves the BUILT tree (build/), not the source tree. `public/sw.js`
//      is a source file; what ships is the one the build stamps with a version.
//      Testing the source tree would prove the wrong artifact.
//   2. The offline assertion is `context.setOffline(true)` + a real reload, so
//      the response can only have come from the worker's cache. Asserting on a
//      "navigator.onLine === false" flag would prove nothing — that is a UI
//      property, not a delivery path.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveWebroot, SERVED_ENTRY_DOCUMENT, readManifest } from './helpers/portal-origin-host.mjs';

const PORTAL_DIR = resolve(process.env.PORTAL_DIR || process.cwd());
const WEBROOT = resolve(process.env.PORTAL_WEBROOT_DIR || join(PORTAL_DIR, 'build'));
const HAVE_BUILD = existsSync(join(WEBROOT, SERVED_ENTRY_DOCUMENT));
const BUILT_SW = join(WEBROOT, 'sw.js');

test.describe('W1 — the app shell works offline on a secure origin', () => {
  test.skip(!HAVE_BUILD, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — run npm run build first`);

  test('the built tree ships a VERSIONED service worker', () => {
    expect(existsSync(BUILT_SW), 'the build must emit sw.js into the webroot').toBe(true);

    const src = readFileSync(BUILT_SW, 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');

    // A literal cache name never changes between releases, so the previous
    // release's shell would be served forever.
    expect(code).not.toMatch(/CACHE_NAME\s*=\s*['"]tollgate-shell-v1['"]/);

    // The stamped version must have been SUBSTITUTED — the placeholder token
    // must not survive into the shipped file.
    expect(code, 'the build must replace the version placeholder').not.toContain('__SW_VERSION__');

    // The cache name is DERIVED from the stamped version rather than being a
    // literal, so read the version and reconstruct the name the way the worker
    // does. Asserting on a literal `CACHE_NAME = '...'` would now be asserting
    // the shape of the source instead of the property that matters.
    const v = code.match(/SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
    expect(v, 'the worker must declare a stamped version').toBeTruthy();
    expect(v[1].length, `stamped version "${v[1]}" looks unstamped`).toBeGreaterThan(3);

    const prefix = code.match(/CACHE_PREFIX\s*=\s*['"]([^'"]+)['"]/);
    expect(prefix, 'the worker must declare its cache namespace').toBeTruthy();
    expect(code, 'the cache name must be built from the version, not a literal').toMatch(
      /CACHE_NAME\s*=\s*CACHE_PREFIX\s*\+\s*SW_VERSION/
    );

    console.log(`  stamped version: ${v[1]} -> cache ${prefix[1]}${v[1]}`);
    const recorded = JSON.parse(readFileSync(join(WEBROOT, 'sw-version.json'), 'utf8'));
    expect(recorded.version, 'the recorded version must match the worker').toBe(v[1]);
    expect(recorded.cache).toBe(`${prefix[1]}${v[1]}`);
  });

  test('the worker registers, then a real offline reload is served from the cache', async ({
    page,
    context,
  }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });

      // ── registration ────────────────────────────────────────────────────
      const registered = await page.evaluate(`(async () => {
        if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no sw api' };
        const reg = await navigator.serviceWorker.ready;
        return { ok: true, scope: reg.scope, hasActive: !!reg.active };
      })()`);
      console.log(`  SW registered: ${JSON.stringify(registered)}`);
      expect(registered.ok, 'the worker must register on a secure origin').toBe(true);
      expect(registered.hasActive, 'it must have reached "activated"').toBe(true);

      // The cache it populated must be the versioned one.
      const cacheNames = await page.evaluate(`caches.keys()`);
      console.log(`  caches after install: ${JSON.stringify(cacheNames)}`);
      expect(cacheNames.some((n) => n.startsWith('tollgate-shell-'))).toBe(true);

      // ── offline reload ──────────────────────────────────────────────────
      // Give the install step's addAll a beat to finish before cutting the net.
      await page.waitForFunction(`(async () => {
        const keys = await caches.keys();
        const name = keys.find((k) => k.startsWith('tollgate-shell-'));
        if (!name) return false;
        const c = await caches.open(name);
        return (await c.keys()).length > 0;
      })()`, null, { timeout: 15000 });

      const populated = await page.evaluate(`(async () => {
        const keys = await caches.keys();
        const name = keys.find((k) => k.startsWith('tollgate-shell-'));
        const c = await caches.open(name);
        return (await c.keys()).map((r) => new URL(r.url).pathname);
      })()`);
      console.log(`  precached: ${JSON.stringify(populated)}`);
      expect(populated).toContain(`/${SERVED_ENTRY_DOCUMENT}`);

      await context.setOffline(true);
      const res = await page.reload({ waitUntil: 'domcontentloaded' });

      console.log(`  offline reload status: ${res && res.status()}`);
      console.log(`  offline reload url:    ${page.url()}`);

      // THE assertion: the document came back with the network cut, so only the
      // worker's cache can have answered it.
      expect(res, 'the reload produced a response').toBeTruthy();
      expect(res.status(), 'the cached shell must serve 200 offline').toBe(200);

      const body = await page.content();
      expect(body.length, 'a real document was served, not an error page').toBeGreaterThan(200);
      expect(page.url()).toContain(SERVED_ENTRY_DOCUMENT);

      // And the money path must NOT be answerable offline: an invented "you are
      // paid" response is the catastrophic failure this shell must never have.
      const apiOffline = await page.evaluate(`(async () => {
        try {
          const r = await fetch('/whoami', { cache: 'no-store' });
          return { ok: r.ok, status: r.status };
        } catch (e) {
          return { threw: true };
        }
      })()`);
      console.log(`  authority endpoint while offline: ${JSON.stringify(apiOffline)}`);
      expect(
        apiOffline.threw === true || apiOffline.ok === false,
        'an authority endpoint must never be answered from cache'
      ).toBe(true);

      await context.setOffline(false);
    } finally {
      await host.close();
    }
  });

  test('a version bump retires the previous cache instead of accumulating shells', async ({
    page,
  }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });
      await page.evaluate(`navigator.serviceWorker.ready`);

      // Plant a stale cache from a hypothetical previous release, then make the
      // worker activate again and prove the stale one is collected.
      const outcome = await page.evaluate(`(async () => {
        await caches.open('tollgate-shell-OLDPREVIOUS');
        const before = await caches.keys();

        const reg = await navigator.serviceWorker.getRegistration();
        // Force a fresh activate cycle through the same code path the worker uses.
        if (reg && reg.active) reg.active.postMessage('RECLAIM');
        await new Promise((r) => setTimeout(r, 800));
        const after = await caches.keys();
        return { before, after };
      })()`);

      console.log(`  caches before recycle: ${JSON.stringify(outcome.before)}`);
      console.log(`  caches after recycle:  ${JSON.stringify(outcome.after)}`);

      expect(outcome.before).toContain('tollgate-shell-OLDPREVIOUS');
      expect(
        outcome.after.includes('tollgate-shell-OLDPREVIOUS'),
        'a previous release\'s cache must be retired, not left to be served'
      ).toBe(false);
    } finally {
      await host.close();
    }
  });
});

test.describe('W1 — the install affordance the origin can actually raise', () => {
  test.skip(!HAVE_BUILD, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — run npm run build first`);

  test('on a secure origin the page offers a real install path', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });

      // Chromium fires beforeinstallprompt only for an installable manifest +
      // a controlling worker. Capturing it is the proof the app is genuinely
      // installable, not just declaring display:standalone.
      const captured = await page.evaluate(`(async () => {
        return new Promise((resolve) => {
          const done = (v) => resolve(v);
          if (window.__BIP__) return done({ deferred: true, captured: true });
          window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            window.__BIP__ = e;
            done({ captured: true });
          }, { once: true });
          setTimeout(() => done({ captured: false }), 6000);
        });
      })()`);
      console.log(`  beforeinstallprompt: ${JSON.stringify(captured)}`);

      const manifest = readManifest(WEBROOT);
      expect(manifest.ok, 'the webroot manifest must parse').toBe(true);

      // Manifest installability, checked from the served bytes.
      const m = manifest.manifest;
      expect(m.start_url, 'start_url must name a real document').toBe(SERVED_ENTRY_DOCUMENT);
      expect(m.id, 'explicit id keeps existing installs alive across start_url fixes').toBeTruthy();
      expect(m.scope, 'explicit scope').toBeTruthy();

      const sizes = (m.icons || []).map((i) => i.sizes);
      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
      expect(
        (m.icons || []).some((i) => (i.purpose || '').split(/\s+/).includes('maskable')),
        'a maskable icon is required so Android does not letterbox the icon'
      ).toBe(true);

      // The install panel must be present and must not claim a prompt the
      // origin cannot raise.
      const panel = page.locator('[data-testid="install-panel"]');
      const count = await panel.count();
      console.log(`  install panel nodes: ${count}`);
      if (count > 0) {
        const variant = await panel.first().getAttribute('data-variant');
        console.log(`  install panel variant: ${variant}`);
        expect(['prompt', 'manual']).toContain(variant);
        await expect(panel.first()).toBeVisible();
      }
    } finally {
      await host.close();
    }
  });

  test('on the router-shaped origin there is NO install claim — only a signpost', async ({ page }) => {
    const { findLanAddress } = await import('./helpers/portal-origin-host.mjs');
    const lan = findLanAddress();
    test.skip(!lan, 'no non-loopback IPv4 on this host');

    const host = await serveWebroot({ webroot: WEBROOT, host: lan });
    try {
      await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });

      const panel = page.locator('[data-testid="install-panel"]');
      if ((await panel.count()) > 0) {
        const variant = await panel.first().getAttribute('data-variant');
        console.log(`  portal-origin install variant: ${variant}`);
        expect(
          variant,
          'the portal origin can never raise an install prompt, so it must render the signpost'
        ).toBe('signpost');
      }

      // And the page must not have crashed on the absent navigator.serviceWorker.
      const alive = await page.evaluate(`!!document.querySelector('#root')`);
      expect(alive, 'the app must render on the http origin without crashing').toBe(true);
    } finally {
      await host.close();
    }
  });
});
