// Capture the card's visual evidence. Not a gate — a screenshot producer.
//
// The card asks for:
//   "Offline proof: SW registered + a real offline reload screenshot/log"
//   "The iOS/Android install affordance captured"
//
// Both are proven as assertions in `offline-shell.spec.mjs`; this file exists so
// the SAME run also leaves image artifacts on the PR, because an assertion
// nobody can look at is weaker evidence than a picture of the thing. It writes
// to `test-results/evidence/`.
//
// It deliberately renders the panel with each variant FORCED via the
// `data-variant` render seam rather than pretending to be an iPhone — a WebKit
// run is a separate browser download and the panel's iOS copy is chosen from the
// user-agent string, which is not something a screenshot can verify anyway.
// What the screenshots are for is the LAYOUT and the COPY at phone width.
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveWebroot, SERVED_ENTRY_DOCUMENT } from './helpers/portal-origin-host.mjs';

const PORTAL_DIR = resolve(process.env.PORTAL_DIR || process.cwd());
const WEBROOT = resolve(process.env.PORTAL_WEBROOT_DIR || join(PORTAL_DIR, 'build'));
const HAVE_BUILD = existsSync(join(WEBROOT, SERVED_ENTRY_DOCUMENT));
const OUT = resolve(PORTAL_DIR, 'test-results', 'evidence');

test.describe('W1 — evidence capture', () => {
  test.skip(!HAVE_BUILD, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — run npm run build first`);

  test('capture the signpost on the router-shaped origin + the secure-origin install panel', async ({
    page,
    context,
  }) => {
    mkdirSync(OUT, { recursive: true });

    // ── 1. the router-shaped origin: the SIGNPOST ────────────────────────
    const { findLanAddress } = await import('./helpers/portal-origin-host.mjs');
    const lan = findLanAddress();

    if (lan) {
      const portalHost = await serveWebroot({ webroot: WEBROOT, host: lan });
      try {
        await page.goto(`${portalHost.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });
        await page.waitForSelector('[data-testid="install-panel"]', { timeout: 10000 });
        expect(
          await page.getAttribute('[data-testid="install-panel"]', 'data-variant')
        ).toBe('signpost');
        await page.screenshot({ path: join(OUT, '01-signpost-router-origin.png'), fullPage: false });
        console.log(`  wrote 01-signpost-router-origin.png (${portalHost.origin})`);
      } finally {
        await portalHost.close();
      }
    } else {
      console.log('  no non-loopback IPv4; skipped the signpost capture');
    }

    // ── 2. the secure origin: worker registered, panel upgradeable ───────
    const secureHost = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      await page.goto(`${secureHost.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });
      const reg = await page.evaluate(`(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, active: !!r.active };
      })()`);
      expect(reg.active).toBe(true);
      await page.waitForSelector('[data-testid="install-panel"]', { timeout: 10000 });

      const variant = await page.getAttribute('[data-testid="install-panel"]', 'data-variant');
      const capability = await page.getAttribute('[data-testid="install-panel"]', 'data-capability');
      console.log(`  secure origin: sw=${JSON.stringify(reg)} variant=${variant} capability=${capability}`);
      await page.screenshot({ path: join(OUT, '02-install-panel-secure-origin.png'), fullPage: false });
      console.log('  wrote 02-install-panel-secure-origin.png');

      // ── 3. the offline reload, captured while actually offline ─────────
      await context.setOffline(true);
      const res = await page.reload({ waitUntil: 'domcontentloaded' });
      expect(res.status()).toBe(200);

      // Wait for the shell to HYDRATE before the screenshot. `domcontentloaded`
      // fires while `#root` is still empty, so the previous capture produced a
      // blank white PNG — a file named "offline reload served from cache" that
      // showed nothing at all. The assertions below were passing the whole time;
      // only the picture was worthless. A human looking at the PR could not tell
      // an offline shell from a dead page.
      //
      // The reload is answered from the precached splash.html, which carries the
      // entry shell and re-fetches everything it shows. With the network cut
      // those fetches fail, so the app renders its error/degraded state — that
      // IS the honest offline picture, and it is the one worth shipping.
      await page.waitForSelector('#tollgate-captive-portal', { timeout: 15000 });
      // Let the app settle into that state rather than shooting it mid-paint.
      await page.waitForLoadState('networkidle').catch(() => {});

      await page.screenshot({ path: join(OUT, '03-offline-reload-served-from-cache.png'), fullPage: false });
      const shotText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 160);
      console.log(`  wrote 03-offline-reload-served-from-cache.png (status ${res.status()} with the network cut)`);
      console.log(`  offline page renders: "${shotText}"`);
      // A blank capture is not evidence. Fail the capture if the shell hydrated
      // to nothing, so this artifact cannot silently regress to a white PNG.
      expect(shotText.length, 'the offline shell must render text, not a blank page').toBeGreaterThan(20);

      // The worker's own report, written next to the screenshots: what cache
      // answered, and what the version handshake says.
      const report = await page.evaluate(`(async () => {
        const keys = await caches.keys();
        const name = keys.find((k) => k.startsWith('tollgate-shell-'));
        const c = name ? await caches.open(name) : null;
        const entries = c ? (await c.keys()).map((r) => new URL(r.url).pathname) : [];
        return { cacheNames: keys, answeringCache: name, entries, offline: !navigator.onLine };
      })()`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(OUT, '03-offline-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`  wrote 03-offline-proof.json: ${JSON.stringify(report)}`);

      await context.setOffline(false);

      // ── 4. the iOS and Android install affordances, CAPTURED ──────────
      //
      // The card requires "the iOS/Android install affordance captured". Until
      // now the platform wording was only asserted in
      // tests/unit/install-panel-signpost.test.jsx, so an artifact a human could
      // look at did not exist.
      //
      // The panel picks its copy from `navigator.userAgent` (manualHintKey()),
      // so the UA string is the exact INPUT the code branches on and overriding
      // it is emulating the real input, not faking an outcome. WebKit is not
      // installed here (chromium-only, as documented in README/CI), and the
      // layout at phone width is what these shots are for — the copy is the
      // assertion.
      for (const [name, ua, viewport, expected] of [
        [
          '04-install-affordance-ios',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          { width: 390, height: 844 },
          'Share button',
        ],
        [
          '05-install-affordance-android',
          'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          { width: 412, height: 915 },
          'browser menu',
        ],
      ]) {
        const browser = page.context().browser();
        const deviceCtx = await browser.newContext({ userAgent: ua, viewport });
        try {
          const p = await deviceCtx.newPage();
          await p.goto(`${secureHost.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });
          await p.waitForSelector('[data-testid="install-panel"]', { timeout: 15000 });
          const text = (await p.locator('[data-testid="install-panel"]').innerText()).replace(/\s+/g, ' ');
          // The assertion is why this is evidence rather than decoration: a
          // screenshot of the WRONG platform's instruction is worse than none.
          expect(text, `${name} must show the platform instruction`).toContain(expected);
          await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
          console.log(`  wrote ${name}.png — "${expected}"`);
        } finally {
          await deviceCtx.close();
        }
      }
    } finally {
      await secureHost.close();
    }
  });
});
