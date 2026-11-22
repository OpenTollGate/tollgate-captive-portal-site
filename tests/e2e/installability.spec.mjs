// GATE (card t_d3ba0b44, WSEC) — the secure-context constraint, asserted in a
// real browser on the portal's ACTUAL origin shape, in both directions.
//
// This is the executable form of `~/reports/pwa-cashu/SPIKE-secure-context.md`
// and of ADR-delta D3 §3.2/§3.3. It exists because the repo's existing e2e
// rails cannot observe the defect: `playwright.config.js` gives every test
// `baseURL = http://localhost:5173`, and `localhost` is POTENTIALLY TRUSTWORTHY
// by spec (Secure Contexts §3.1 step 5), so it is the single address the
// constraint does not apply to. A green suite there says nothing about a
// captive portal, which is always `http://<router-lan-ip>:2051`.
//
// The spec therefore runs as a MATCHED PAIR whose only difference is the
// hostname in the URL:
//
//   NEGATIVE CONTROL  http://<lan-ip>:<port>/splash.html
//                     -> isSecureContext false, navigator.serviceWorker
//                        undefined, crypto.subtle undefined, caches undefined
//   WORKING PATH      http://127.0.0.1:<port>/splash.html
//                     -> isSecureContext true, the same APIs present
//
// `navigator.serviceWorker` being UNDEFINED (not a catchable SecurityError) is
// the whole reason this is a gate rather than a nicety: any
// `try { await navigator.serviceWorker.register(...) } catch {}` feature-detect
// CRASHES with `TypeError: Cannot read properties of undefined` instead of
// degrading, so the app must branch on `window.isSecureContext`.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SERVED_ENTRY_DOCUMENT,
  findLanAddress,
  resolveStartUrl,
  readManifest,
  serveWebroot,
  webrootHasDocument,
} from './helpers/portal-origin-host.mjs';

const PORTAL_DIR = resolve(process.env.PORTAL_DIR || process.cwd());
// The webroot the router actually serves. `public/` is the source tree and
// contains NO splash.html — the build renames build/index.html -> splash.html,
// and a real webroot is either `build/` (gh-pages, via `npm run build:portal`)
// or the module's staged `.../tollgate-captive-portal-site/` tree on the
// router. Default to a built tree when one exists, else public/ (where the
// manifest lives even before a build).
const WEBROOT = resolve(
  process.env.PORTAL_WEBROOT_DIR ||
    (existsSync(join(PORTAL_DIR, 'build', SERVED_ENTRY_DOCUMENT))
      ? join(PORTAL_DIR, 'build')
      : join(PORTAL_DIR, 'public'))
);

const LAN_HOST = findLanAddress();
const HAVE_WEBROOT = existsSync(join(WEBROOT, SERVED_ENTRY_DOCUMENT));

// Feature-detect probe run inside the page. Kept as a string so the SAME code
// path is measured on both origins.
const PROBE = `(() => ({
  isSecureContext: window.isSecureContext,
  hasServiceWorkerAPI: 'serviceWorker' in navigator,
  serviceWorkerType: typeof navigator.serviceWorker,
  hasCryptoSubtle: !!(window.crypto && window.crypto.subtle),
  hasCaches: 'caches' in window,
  hasGetRandomValues: !!(window.crypto && typeof window.crypto.getRandomValues === 'function'),
  hasStoragePersist: !!(navigator.storage && typeof navigator.storage.persist === 'function'),
  href: window.location.href,
}))()`;

/** What the app is contractually allowed to conclude from the probe above. */
function installCapability(probe) {
  return probe.isSecureContext && probe.hasServiceWorkerAPI;
}

test.describe('WSEC — the portal origin is not a secure context (negative control)', () => {
  test.skip(!HAVE_WEBROOT, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — build the portal first`);
  test.skip(!LAN_HOST, 'box has no non-loopback IPv4; the insecure origin cannot be reproduced here');

  test('on the router-shaped origin, every install/SW/crypto primitive is absent', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: LAN_HOST });
    try {
      const res = await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`);
      expect(res.status(), 'the gate serves the entry document').toBe(200);

      const measured = await page.evaluate(PROBE);

      console.log(`  [negative control] ${measured.href}`);
      console.log(`  ${JSON.stringify(measured)}`);

      expect(measured.href, 'we really are on the non-loopback LAN address').toContain(LAN_HOST);

      // The four measured facts from the spike, now enforced.
      expect(measured.isSecureContext, 'a bare LAN IP over http is NOT a secure context (spec §3.1 step 9)').toBe(false);
      expect(measured.hasServiceWorkerAPI, 'navigator.serviceWorker must not exist on this origin').toBe(false);
      expect(measured.serviceWorkerType, 'it is ABSENT, not a rejected/throwable object').toBe('undefined');
      expect(measured.hasCryptoSubtle, 'crypto.subtle is secure-context-gated').toBe(false);
      expect(measured.hasCaches, 'the Cache API is secure-context-gated').toBe(false);
      expect(measured.hasStoragePersist, 'navigator.storage.persist is secure-context-gated').toBe(false);

      // getRandomValues has no [SecureContext] gate — it survives, which is why
      // a NO-INSTALL paste fallback is possible on this origin.
      expect(measured.hasGetRandomValues, 'getRandomValues has no SecureContext gate').toBe(true);

      // What the app must conclude, and the exact wrong conclusion.
      expect(installCapability(measured), 'no install capability may be claimed here').toBe(false);
    } finally {
      await host.close();
    }
  });

  test('a try/catch feature-detect CRASHES instead of degrading (the documented trap)', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: LAN_HOST });
    try {
      await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`);

      // This is the bug the spike measured, pinned as a regression test. If a
      // future browser ever made serviceWorker present-but-throwing here, this
      // assertion flips and the guard in src/helpers/pwa-install.js may be
      // simplified — but the isSecureContext branch must stay.
      const outcome = await page.evaluate(`(async () => {
        try {
          await navigator.serviceWorker.register('/sw.js');
          return { kind: 'registered' };
        } catch (err) {
          return { kind: 'threw', name: err && err.name, message: String(err && err.message) };
        }
      })()`);

      console.log(`  try/catch outcome on insecure origin: ${JSON.stringify(outcome)}`);
      expect(outcome.kind, 'register() is unreachable — the property is undefined').toBe('threw');
      expect(outcome.name, 'NOT a SecurityError — a TypeError, so catch(SecurityError) misses it').toBe('TypeError');
      expect(outcome.message).toContain('undefined');
    } finally {
      await host.close();
    }
  });
});

test.describe('WSEC — the matched secure origin (the working path)', () => {
  test.skip(!HAVE_WEBROOT, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — build the portal first`);

  test('loopback is a secure context, so the same probe reports every primitive present', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      const res = await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`);
      expect(res.status()).toBe(200);

      const measured = await page.evaluate(PROBE);
      console.log(`  [working path] ${measured.href}`);
      console.log(`  ${JSON.stringify(measured)}`);

      expect(measured.href).toContain('127.0.0.1');
      expect(measured.isSecureContext, 'loopback IS potentially trustworthy (spec §3.1 step 4)').toBe(true);
      expect(measured.hasServiceWorkerAPI).toBe(true);
      expect(measured.hasCryptoSubtle).toBe(true);
      expect(measured.hasCaches).toBe(true);
      expect(installCapability(measured), 'install capability IS available on a secure origin').toBe(true);
    } finally {
      await host.close();
    }
  });
});

test.describe('WSEC — the shipped manifest is installable on the origin it is served from', () => {
  test.skip(!HAVE_WEBROOT, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — build the portal first`);

  test('start_url resolves to a document the served webroot actually contains', async ({ request }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    try {
      const listed = readManifest(WEBROOT);
      expect(listed.ok, `webroot manifest.json must parse: ${listed.raw ? '' : 'MISSING'}`).toBe(true);

      const resolved = resolveStartUrl(listed.manifest.start_url, `${host.origin}/manifest.json`);
      expect(resolved, 'start_url must be resolvable').not.toBeNull();

      console.log(`  manifest start_url=${JSON.stringify(listed.manifest.start_url)} -> ${resolved.href}`);
      console.log(`  served entry document present: ${webrootHasDocument(WEBROOT, resolved)}`);

      // THE defect: start_url "." resolves to a path with no document in the
      // served tree (the build renames index.html -> splash.html), so the
      // installed app opens a 404.
      expect(
        webrootHasDocument(WEBROOT, resolved),
        `start_url ${JSON.stringify(listed.manifest.start_url)} resolves to ${resolved.pathname}, ` +
          `which does not exist in the served webroot (expected .../${SERVED_ENTRY_DOCUMENT})`
      ).toBe(true);

      // And it must actually be reachable over the wire, not just on disk.
      const fetched = await request.get(resolved.href);
      expect(fetched.status(), `${resolved.pathname} must be served`).toBe(200);
    } finally {
      await host.close();
    }
  });

  test('the manifest declares the identity fields an installed app is keyed on', async () => {
    const listed = readManifest(WEBROOT);
    expect(listed.ok).toBe(true);
    const m = listed.manifest;

    // Without an explicit `id`, an installed app's identity is derived from
    // start_url — so every later start_url fix ORPHANS existing installs.
    expect(m.id, 'manifest must carry an explicit id').toBeTruthy();
    expect(m.scope, 'manifest must carry an explicit scope').toBeTruthy();
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(m.display);

    const sizes = (m.icons || []).map((i) => i.sizes);
    expect(sizes, 'a 192px icon is required for installability').toContain('192x192');
    expect(sizes, 'a 512px icon is required for installability').toContain('512x512');
    expect(
      (m.icons || []).some((i) => (i.purpose || 'any').split(/\s+/).includes('maskable')),
      'at least one maskable icon is required so Android does not letterbox the icon'
    ).toBe(true);

    // index.html sets theme-color #000000 on a dark UI; a white splash
    // background flashes before the app paints.
    expect(m.background_color, 'splash background must match the dark UI').not.toBe('#ffffff');
  });
});

test.describe('WSEC — the CSP must not block the wallet (ADR-delta §3.5)', () => {
  test('index.html connect-src covers https mint traffic', async ({ page }) => {
    const host = await serveWebroot({ webroot: PORTAL_DIR, host: '127.0.0.1', port: 0 });
    // Serve the SOURCE tree (index.html lives at the portal root, not in public/).
    try {
      await page.goto(`${host.origin}/index.html`, { waitUntil: 'domcontentloaded' });
    } catch {
      test.skip(true, 'index.html not servable from the portal root in this checkout');
    }
    try {
      const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
      expect(csp, 'index.html must declare a CSP').toBeTruthy();

      const connectSrc = (csp.match(/connect-src([^;]*)/i) || [, ''])[1].trim();
      console.log(`  connect-src: ${connectSrc}`);

      // CSP scheme-sources are scheme-exact: `http:` does NOT match `https:`.
      // The wallet's mint calls are https (mock backend + real mints), so
      // without an https source every mint call is silently blocked and
      // getMintSwapFee falls back to {status:0} — the CU110 fee guard then
      // never fires, which is the failure mode the file's own comment forbids.
      expect(
        /\bhttps:/.test(connectSrc) || /https:\/\//.test(connectSrc),
        `connect-src "${connectSrc}" cannot reach an https mint — add https: or an explicit mint origin`
      ).toBe(true);
    } finally {
      await host.close();
    }
  });

  test('balance.html — the second entry point — also carries a CSP', async ({ page }) => {
    const host = await serveWebroot({ webroot: PORTAL_DIR, host: '127.0.0.1' });
    try {
      await page.goto(`${host.origin}/balance.html`, { waitUntil: 'domcontentloaded' });
    } catch {
      test.skip(true, 'balance.html not servable from the portal root in this checkout');
    }
    try {
      const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
      // balance.html ships NO CSP today while index.html does — an inconsistent
      // security posture on the page that accepts a pasted token.
      expect(csp, 'balance.html must not be the one entry point without a CSP').toBeTruthy();
      const connectSrc = (csp.match(/connect-src([^;]*)/i) || [, ''])[1].trim();
      expect(/\bhttps:/.test(connectSrc) || /https:\/\//.test(connectSrc)).toBe(true);
    } finally {
      await host.close();
    }
  });
});
