// Spot-probe the two surfaces the round-1 review never scored and that are
// visible in the AFTER captures: the credential banner on the login form
// (--text-dim on --warning-dim) and the guest footer line.
// Not a gate — just proof that nothing in frame is below AA.
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

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function parse(rgb) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(rgb);
  if (!m) throw new Error(`not a colour: ${rgb}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
const lum = ({ r, g, b }) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (f, b) => f.a >= 1 ? f : { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 };
const fmt = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

const fails = [];
function check(scheme, what, fgRaw, bgRaw, pageBg, need) {
  const bg0 = bgRaw.a < 1 ? over(bgRaw, pageBg) : bgRaw;
  const fg = over(fgRaw, bg0);
  const r = ratio(fg, bg0);
  const ok = r >= need;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} ${what.padEnd(34)} ${fmt(fg)} on ${fmt(bg0)}  ${r.toFixed(2)}:1 (need ${need})`);
  if (!ok) fails.push(`${scheme} ${what}: ${r.toFixed(2)} < ${need}`);
}

const browser = await chromium.launch();
for (const scheme of ['dark', 'light']) {
  const actx = await browser.newContext({ viewport: { width: 1000, height: 900 }, colorScheme: scheme });
  const ap = await actx.newPage();
  await ap.goto('http://localhost:5199/?mockCredentialState=locked#/login', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(900);
  const page = parse(await ap.evaluate(() => getComputedStyle(document.body).backgroundColor));
  console.log(`\n=== admin login banner / ${scheme} ===`);
  const banner = await ap.evaluate(() => {
    const el = document.querySelector('#credential-locked');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const strong = el.querySelector('strong');
    return {
      color: cs.color,
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      strongColor: strong && getComputedStyle(strong).color,
    };
  });
  if (!banner) { console.log('  (banner absent — is the mock in locked state?)'); fails.push(`${scheme}: banner not rendered`); }
  else {
    check(scheme, 'banner body text', parse(banner.color), parse(banner.bg), page, 4.5);
    check(scheme, 'banner <strong> text', parse(banner.strongColor || banner.color), parse(banner.bg), page, 4.5);
    check(scheme, 'banner border vs page (1.4.11)', parse(banner.border), page, page, 3.0);
  }
  await actx.close();

  const gctx = await browser.newContext({ viewport: { width: 900, height: 1050 }, colorScheme: scheme });
  const gp = await gctx.newPage();
  await setupMockBackend(gp);
  await gp.route('**/src/helpers/cashu.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: CASHU_STUB })
  );
  await gp.goto('http://localhost:5177/balance.html', { waitUntil: 'domcontentloaded' });
  await gp.waitForTimeout(2200);
  const gpage = parse(await gp.evaluate(() => getComputedStyle(document.body).backgroundColor));
  console.log(`\n=== guest balance chrome / ${scheme} ===`);
  const foot = await gp.evaluate(() => {
    // the last rendered line of copy in the balance panel
    const panel = document.querySelector('.tollgate-captive-portal-balance-panel');
    if (!panel) return null;
    const nodes = [...panel.querySelectorAll('p, span, small, div')].filter((n) => n.children.length === 0 && n.textContent.trim().length > 8);
    const pick = nodes[nodes.length - 1];
    if (!pick) return null;
    const cs = getComputedStyle(pick);
    let g = pick, bg = 'rgba(0, 0, 0, 0)';
    while (g && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(g).backgroundColor; g = g.parentElement; }
    return { text: pick.textContent.trim().slice(0, 44), color: cs.color, bg, cls: pick.className };
  });
  if (!foot) { console.log('  (no footer line found)'); fails.push(`${scheme}: guest footer not found`); }
  else {
    console.log(`       last copy: "${foot.text}" (.${foot.cls})`);
    check(scheme, 'guest last copy line', parse(foot.color), parse(foot.bg), gpage, 4.5);
  }
  await gctx.close();
}
await browser.close();
console.log(`\n${fails.length} below threshold`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
