// The PORTABLE negative control for the secure-context constraint.
//
// WHY THIS IS A SEPARATE FILE. `test.use({ launchOptions })` is only permitted at
// the top level of a spec file (Playwright refuses it inside a `describe`, because
// it forces a new worker). The assertions here need
// `--host-resolver-rules` to map a non-loopback HOSTNAME onto loopback, so the
// `test.use` has to be file-scoped — hence its own file rather than a block in
// `installability.spec.mjs`.
//
// WHY IT EXISTS AT ALL. `installability.spec.mjs` reproduces the constraint on a
// REAL non-loopback LAN address (the router's exact shape), but that test SKIPS on
// any host with no non-loopback IPv4 — a loopback-only container, for instance. A
// gate that can silently not-run is a weak gate, so this file reproduces the same
// negative control with NO interface requirement.
//
// It works because of the spike's most decisive single measurement: **trust follows
// the NAME, not the routing.**
//
//   `http://tgspike.example:8099/` — pinned to 127.0.0.1 in /etc/hosts —
//   measured `isSecureContext:false`.
//
// Secure Contexts §3.1 step 4 grants trust to the `127.0.0.0/8` *host*, and step 5
// to the `localhost` *name* (plus `*.localhost`). A bare `portal.tollgate.test`
// that resolves to loopback is neither, and the spec's closing note settles it:
// "neither origin's domain nor port has any effect". So this asserts an insecure
// origin while the bytes are served from loopback — which is also why it kills the
// "just give the router a hostname" proposal outright, including the mDNS `.local`
// variant.
//
// This file is the reason the gate cannot be reduced to "it passed on the CI
// runner", and the reason a loopback-only environment still exercises the defect.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SERVED_ENTRY_DOCUMENT,
  serveWebroot,
} from './helpers/portal-origin-host.mjs';

const PORTAL_DIR = resolve(process.env.PORTAL_DIR || process.cwd());
const WEBROOT = resolve(
  process.env.PORTAL_WEBROOT_DIR ||
    (existsSync(join(PORTAL_DIR, 'build', SERVED_ENTRY_DOCUMENT))
      ? join(PORTAL_DIR, 'build')
      : join(PORTAL_DIR, 'public'))
);

const HAVE_WEBROOT = existsSync(join(WEBROOT, SERVED_ENTRY_DOCUMENT));

// Mapped to loopback WITHOUT touching /etc/hosts.
const NON_LOOPBACK_NAME = 'portal.tollgate.test';
const LOCAL_NAME = 'tg.local';

test.use({
  launchOptions: {
    args: [`--host-resolver-rules=MAP ${NON_LOOPBACK_NAME} 127.0.0.1,MAP ${LOCAL_NAME} 127.0.0.1`],
  },
});

const PROBE = `(() => ({
  isSecureContext: window.isSecureContext,
  hasServiceWorkerAPI: 'serviceWorker' in navigator,
  serviceWorkerType: typeof navigator.serviceWorker,
  hasCryptoSubtle: !!(window.crypto && window.crypto.subtle),
  hasCaches: 'caches' in window,
  href: window.location.href,
}))()`;

test.describe('WSEC — a non-loopback hostname resolving to loopback is still insecure', () => {
  test.skip(!HAVE_WEBROOT, `no ${SERVED_ENTRY_DOCUMENT} in ${WEBROOT} — build the portal first`);

  test('portal.tollgate.test -> 127.0.0.1 is Not Trustworthy', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    const port = new URL(host.origin).port;
    try {
      const res = await page.goto(`http://${NON_LOOPBACK_NAME}:${port}/${SERVED_ENTRY_DOCUMENT}`);
      expect(res.status(), 'the mapped name must actually serve the document').toBe(200);

      const measured = await page.evaluate(PROBE);
      console.log(`  [portable negative control] ${measured.href}`);
      console.log(`  ${JSON.stringify(measured)}`);

      // Proves the mapping took effect. Without this, a resolver rule that
      // silently did nothing would let the test pass on 127.0.0.1 — where the
      // origin IS secure — and the assertion below would fail for the wrong
      // reason. This line is what makes the test non-vacuous.
      expect(measured.href, 'we must really be on the mapped non-loopback hostname').toContain(
        NON_LOOPBACK_NAME
      );

      // ...and yet it is insecure.
      expect(
        measured.isSecureContext,
        'a DNS name resolving to loopback is NOT potentially trustworthy (spec §3.1 step 9)'
      ).toBe(false);
      expect(measured.hasServiceWorkerAPI, 'no SW API on this origin').toBe(false);
      expect(measured.serviceWorkerType, 'absent, not a throwing object').toBe('undefined');
      expect(measured.hasCryptoSubtle).toBe(false);
      expect(measured.hasCaches).toBe(false);
    } finally {
      await host.close();
    }
  });

  test('the mDNS-style .local name is equally insecure', async ({ page }) => {
    const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
    const port = new URL(host.origin).port;
    try {
      await page.goto(`http://${LOCAL_NAME}:${port}/${SERVED_ENTRY_DOCUMENT}`);
      const measured = await page.evaluate(PROBE);
      console.log(
        `  [.local name] ${JSON.stringify({
          href: measured.href,
          isSecureContext: measured.isSecureContext,
        })}`
      );

      expect(measured.href).toContain(LOCAL_NAME);
      // Kills "give the router an mDNS name" as a workaround.
      expect(measured.isSecureContext, '.local is not a trustworthy name').toBe(false);
      expect(measured.hasServiceWorkerAPI).toBe(false);
    } finally {
      await host.close();
    }
  });
});
