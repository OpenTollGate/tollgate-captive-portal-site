// Capture the REAL admin board and guest balance page, before vs after the
// retheme, from the live dev servers — not from the mockups.
//
// Usage:  node capture.mjs <outDir> <label>
//   label = "before" | "after"
//
// Both servers must already be running in THIS worktree:
//   :5199  admin (VITE_MOCK=1 vite --config admin/vite.config.mjs)
//   :5177  guest portal + balance.html
//
// Two environment facts this harness has to work around, both pre-existing and
// unrelated to theming (recorded here so the next person does not re-discover
// them):
//
//  1. `prefers-color-scheme` cannot be set from CSS, so the light palette is
//     captured with Playwright's colorScheme context option.
//  2. The committed e2e cashu stub (`tests/e2e/helpers/mock-backend.mjs`) does
//     not export five names `src/components/Cashu.jsx` imports, so the guest
//     module graph throws and /balance.html renders blank. Playwright routes are
//     LIFO, so this harness supplies a complete stub itself instead of editing
//     the helper inside a theme change.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { setupMockBackend } from '../../../tests/e2e/helpers/mock-backend.mjs';

const OUT = process.argv[2] || '/tmp/theme-shots';
const LABEL = process.argv[3] || 'after';
mkdirSync(OUT, { recursive: true });

const CASHU_STUB = `
export const validateToken = (token) =>
  token ? { status: 1, value: { amount: 420, unit: 'sat', isValid: true, hasProofs: true, proofCount: 1 } }
        : { status: 0, code: 'CU101', label: 'Invalid', message: 'bad token' };
export const submitToken = async () => ({ status: 1, label: 'ok', message: 'ok' });
export const extractProofsFromToken = () => [];
export const canSubmitAnyway = () => false;
export const mintUrlFromToken = () => null;
export const findMintOption = () => null;
export const normalizeMintUrl = (url) => (typeof url === 'string' ? url.trim().replace(/\\/+$/, '') : '');
`;

const browser = await chromium.launch();
const results = [];

// ── admin board ────────────────────────────────────────────────────────
// NOTE on the login screen: with VITE_MOCK=true and a `set` credential the
// board AUTO-LOGS-IN (main.tsx: a mock build models a provisioned router), so
// navigating to #/login lands on the dashboard — an earlier version of this
// harness shot that redirect and saved it as "admin-login", i.e. the label was
// wrong and the disabled Sign In button it was supposed to evidence was never
// in frame. `?mockCredentialState=locked` is the mock's own affordance for a
// router nobody can password-authenticate against: the board keeps the form up
// (login.tsx renders the locked banner and the form together), which is exactly
// the state whose disabled button the report is about.
async function admin(scheme, route, name, query = '') {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:5199/${query}#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${LABEL}-admin-${name}-${scheme}.png`, fullPage: true });
  // sample what actually painted, so the PNG is not the only evidence
  const painted = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const login = document.querySelector('#password');
    const btn = document.querySelector('.btn-primary');
    return {
      bg: cs.backgroundColor,
      text: cs.color,
      // which screen did we actually get?
      screen: login ? 'login-form' : (document.querySelector('.ui-crosslink, .header-brand') ? 'layout' : 'unknown'),
      btnBg: btn && getComputedStyle(btn).backgroundColor,
      btnText: btn && getComputedStyle(btn).color,
      btnDisabled: btn ? btn.disabled : null,
      wordmark: (() => {
        const img = document.querySelector('.animate-in picture img, .header-brand picture img');
        return img ? img.currentSrc : null;
      })(),
    };
  });
  await ctx.close();
  // a mislabelled shot is worse than no shot: assert the screen matches the label
  if (name === 'login' && painted.screen !== 'login-form') {
    errs.push(`expected the login FORM, got "${painted.screen}" — the label would lie`);
  }
  if (name === 'devices' && painted.screen !== 'layout') {
    errs.push(`expected the authenticated LAYOUT, got "${painted.screen}"`);
  }
  results.push({ name: `admin-${name}-${scheme}`, painted, errs });
}

// ── guest balance page ─────────────────────────────────────────────────
async function guest(scheme, path, name, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await setupMockBackend(page);
  await page.route('**/src/helpers/cashu.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: CASHU_STUB })
  );
  await page.goto(`http://localhost:5177${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/${LABEL}-${name}-${scheme}.png`, fullPage: true, animations: 'disabled' });
  const painted = await page.evaluate(() => {
    const root = document.getElementById('root');
    const card = document.querySelector('.tollgate-captive-portal-balance-card');
    const view = document.querySelector('.tollgate-captive-portal-view');
    return {
      mounted: !!root && root.children.length > 0,
      bg: view && getComputedStyle(view).backgroundColor,
      card: card && getComputedStyle(card).backgroundColor,
    };
  });
  await ctx.close();
  results.push({ name: `${name}-${scheme}`, painted, errs });
}

for (const scheme of ['dark', 'light']) {
  await admin(scheme, 'login', 'login', '?mockCredentialState=locked');
  await admin(scheme, 'devices', 'devices');
  await guest(scheme, '/balance.html', 'balance-desktop', { width: 900, height: 1050 });
  await guest(scheme, '/balance.html', 'balance-mobile', { width: 390, height: 844 });
  await guest(scheme, '/', 'portal-desktop', { width: 900, height: 1050 });
}

await browser.close();

for (const r of results) {
  console.log(JSON.stringify(r));
}
const blank = results.filter((r) => r.painted.mounted === false);
if (blank.length) {
  console.error(`BLANK RENDER: ${blank.map((b) => b.name).join(', ')}`);
}
// A harness error is a failed capture: a wrong screen under a right-looking
// filename is how "evidence" stops being evidence.
const errored = results.filter((r) => r.errs.length);
for (const r of errored) {
  console.error(`HARNESS ERROR ${r.name}: ${r.errs.join(' | ')}`);
}
if (blank.length || errored.length) process.exit(1);

