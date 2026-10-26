// Assert the RENDERED colours of the real pages against the token values, for
// both schemes. This is the check that would have caught the "invisible on the
// light palette" class of bug that forced this change: it reads what the browser
// actually painted, per element, not what the stylesheet intended.
//
// Two states are asserted for the primary button, because they are different
// pairs and the disabled one is what a user sees FIRST: the login page opens
// with Sign In disabled (a blank password is refused), and opacity-based
// disabling had collapsed that pair to 2.29:1.
//
// The balance page renders src/components/Status.jsx (.status.success /
// .status-info). It does NOT render the older `.balance-display-header` — the
// previous version of this script queried that and then compared `null` against
// an expected colour, so it reported FAIL for a page that was painting
// correctly. Assertions here now name what is actually in the DOM.
//
// Usage: node verify-colors.mjs     (servers on :5199 and :5177)
import { chromium } from 'playwright';
import { setupMockBackend } from '../../../tests/e2e/helpers/mock-backend.mjs';

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

const EXPECT = {
  dark: {
    bg: 'rgb(20, 22, 29)', text: 'rgb(238, 241, 247)', accent: 'rgb(255, 105, 97)',
    onAccent: 'rgb(26, 17, 20)', surface: 'rgb(28, 31, 40)',
    success: 'rgb(122, 209, 154)', successTint: 'rgba(122, 209, 154, 0.16)',
    disabledBg: 'rgb(35, 39, 51)', disabledText: 'rgb(179, 188, 205)',
    borderControl: 'rgb(106, 117, 144)',
    card: 'rgb(35, 39, 51)',
    markAsset: '/assets/brand/tollgate/logo-white.png',
  },
  light: {
    bg: 'rgb(246, 247, 250)', text: 'rgb(18, 21, 28)', accent: 'rgb(194, 53, 45)',
    onAccent: 'rgb(255, 255, 255)', surface: 'rgb(255, 255, 255)',
    success: 'rgb(28, 107, 54)', successTint: 'rgba(28, 107, 54, 0.1)',
    disabledBg: 'rgb(238, 240, 246)', disabledText: 'rgb(93, 102, 122)',
    borderControl: 'rgb(118, 127, 146)',
    card: 'rgb(238, 240, 246)',
    markAsset: '/assets/brand/tollgate/logo-colour.png',
  },
};

const browser = await chromium.launch();
const fails = [];

function check(scheme, what, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${scheme} ${what}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) fails.push(`${scheme} ${what}: ${actual} != ${expected}`);
}

for (const scheme of ['dark', 'light']) {
  const e = EXPECT[scheme];

  // ── admin board ──────────────────────────────────────────────────────
  const actx = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: scheme });
  const ap = await actx.newPage();
  await ap.goto('http://localhost:5199/#/login', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(900);
  console.log(`\n=== admin / ${scheme} ===`);

  // DISABLED state — what the page OPENS in (blank password => disabled)
  const disabled = await ap.evaluate(() => {
    const btn = document.querySelector('.btn-primary');
    return {
      isDisabled: !!(btn && btn.disabled),
      bg: btn && getComputedStyle(btn).backgroundColor,
      text: btn && getComputedStyle(btn).color,
    };
  });
  check(scheme, 'submit disabled on load (blank password)', String(disabled.isDisabled), 'true');
  check(scheme, 'disabled button bg', disabled.bg, e.disabledBg);
  check(scheme, 'disabled button label', disabled.text, e.disabledText);

  // ENABLED state — type a password so the button becomes actionable
  await ap.fill('#password', 'a-real-password');
  await ap.waitForTimeout(350);
  const enabled = await ap.evaluate(() => {
    const body = getComputedStyle(document.body);
    const btn = document.querySelector('.btn-primary');
    const input = document.querySelector('.input');
    const picture = document.querySelector('.animate-in picture img');
    return {
      bg: body.backgroundColor,
      text: body.color,
      btnBg: btn && getComputedStyle(btn).backgroundColor,
      btnText: btn && getComputedStyle(btn).color,
      isDisabled: !!(btn && btn.disabled),
      border: input && getComputedStyle(input).borderTopColor,
      // currentSrc, not getAttribute('src'): with <picture> + <source media>,
      // the attribute always reports the <img> fallback, so asserting on it
      // would pass even when the wrong-luminance asset is the one displayed.
      markSrc: picture && picture.currentSrc,
    };
  });
  check(scheme, 'submit enabled after a password is typed', String(!enabled.isDisabled), 'true');
  check(scheme, 'body bg', enabled.bg, e.bg);
  check(scheme, 'body text', enabled.text, e.text);
  check(scheme, 'primary button bg (enabled)', enabled.btnBg, e.accent);
  check(scheme, 'primary button label (enabled)', enabled.btnText, e.onAccent);
  check(scheme, 'input border', enabled.border, e.borderControl);
  check(scheme, 'wordmark asset', (enabled.markSrc || '(none)').replace(/^https?:\/\/[^/]+/, ''), e.markAsset);
  await actx.close();

  // ── guest balance page ───────────────────────────────────────────────
  const gctx = await browser.newContext({ viewport: { width: 900, height: 1050 }, colorScheme: scheme });
  const gp = await gctx.newPage();
  await setupMockBackend(gp);
  await gp.route('**/src/helpers/cashu.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: CASHU_STUB })
  );
  await gp.goto('http://localhost:5177/balance.html', { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(2200);
  const guest = await gp.evaluate(() => {
    // Scope to the balance PANEL: .tollgate-captive-portal-view is the shared
    // page shell and the balance page also renders the portal's own screens,
    // so an unscoped query can match the wrong node (or nothing).
    const panel = document.querySelector('.tollgate-captive-portal-balance-panel');
    const status = panel && panel.querySelector('.status.success');
    const info = status && status.querySelector('.status-info');
    const card = document.querySelector('.tollgate-captive-portal-balance-card');
    return {
      panelFound: !!panel,
      panelBg: panel && getComputedStyle(panel).backgroundColor,
      statusBg: status && getComputedStyle(status).backgroundColor,
      statusBorder: status && getComputedStyle(status).borderTopColor,
      statusText: status && getComputedStyle(status).color,
      infoText: info && getComputedStyle(info).color,
      cardBg: card && getComputedStyle(card).backgroundColor,
      bodyText: (panel && panel.innerText) || '',
    };
  });
  console.log(`\n=== guest balance / ${scheme} ===`);
  check(scheme, 'balance panel rendered', String(guest.panelFound), 'true');
  check(scheme, 'success panel border', guest.statusBorder, e.success);
  check(scheme, 'success panel label', guest.statusText, e.success);
  check(scheme, 'success amount label', guest.infoText, e.success);
  check(scheme, 'balance card bg', guest.cardBg, e.card);

  // a raw key in the visible copy means i18n did not resolve. Assert the text
  // is non-empty FIRST, otherwise an empty page passes this check vacuously.
  const hasCopy = guest.bodyText.trim().length > 40;
  check(scheme, 'balance panel has readable copy', String(hasCopy), 'true');
  const rawKey = /\b(balance_[a-z_]+|refresh_balance|return_to_portal|scan_qr)\b/.exec(guest.bodyText);
  check(scheme, 'no raw i18n key in rendered text', rawKey ? `FOUND ${rawKey[0]}` : 'clean', 'clean');

  await gctx.close();
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} painted-colour mismatch(es):\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall painted colours match the tokens in both schemes, in both button states');
