// Verify the REWORK findings against PAINTED pixels in a real browser.
//
// Round 1's lesson: a token gate cannot see `opacity`, and an attribute check
// cannot see which asset the browser picked. So this measures computed style
// from the live DOM in both schemes, and drives the real states:
//   - .btn-danger hover, with a REAL pointer hover (the finding 1 site)
//   - .ui-crosslink and .ui-crosslink-reason, in the states that render them
//   - .input focus-visible, to see the outline the fix added
//
// Usage: node docs/ui-mockups/theme/verify-rework.mjs   (servers on 5199, 5177)
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

// ── WCAG 2.1 arithmetic, independent of tools/contrast.py ───────────────
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function parse(rgb) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(rgb);
  if (!m) throw new Error(`not a colour: ${rgb}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
const relLum = ({ r, g, b }) =>
  0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
function ratio(fg, bg) {
  const a = relLum(fg), b = relLum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
// composite a translucent colour over an opaque ground, as the screen does
function over(fg, bg) {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}
const fmt = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

const fails = [];
const rows = [];
function check(scheme, what, fgRaw, bgRaw, need) {
  // bg may itself be translucent (a scrim); walk it back to the page ground
  const bg = bgRaw.a < 1 ? over(bgRaw, PAGE[scheme]) : bgRaw;
  const fg = over(fgRaw, bg);
  const r = ratio(fg, bg);
  const ok = r >= need;
  rows.push({ scheme, what, fg: fmt(fg), bg: fmt(bg), r: +r.toFixed(2), need, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} ${what.padEnd(38)} ${fmt(fg)} on ${fmt(bg)}  ${r.toFixed(2)}:1 (need ${need})`);
  if (!ok) fails.push(`${scheme} ${what}: ${r.toFixed(2)} < ${need}`);
}

const PAGE = {};  // filled per scheme with the body ground

const browser = await chromium.launch();

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://localhost:5199/#/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  PAGE[scheme] = parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  console.log(`\n=== admin / ${scheme} ===  page ${fmt(PAGE[scheme])}`);

  // ── finding 3: the focus indicator on a real :focus-visible ──────────
  // A field only exists on the login screen (VITE_MOCK=false) or on a form
  // route (VITE_MOCK=true pre-seeds a session). Navigate to whichever exists
  // rather than assuming, so both modes measure the same rule.
  if (!(await page.$('.input'))) {
    await page.goto('http://localhost:5199/#/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  }
  const focus = await page.evaluate(() => {
    const inp = document.querySelector('.input');
    if (!inp) return null;
    inp.focus();
    const cs = getComputedStyle(inp);
    return {
      outlineColor: cs.outlineColor,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      borderColor: cs.borderTopColor,
      bg: cs.backgroundColor,
      uaOutline: cs.outlineStyle !== 'none',
    };
  });
  if (!focus) {
    fails.push(`${scheme}: no .input reachable, focus ring unverified`);
  } else {
  check(scheme, 'focus ring vs its resting border', parse(focus.outlineColor), parse(focus.borderColor), 3.0);
  check(scheme, 'focus ring vs the field ground', parse(focus.outlineColor), parse(focus.bg), 3.0);
  console.log(`       outline: ${focus.outlineStyle} ${focus.outlineWidth} (a real ring, not just a border swap)`);
  if (!focus.uaOutline) fails.push(`${scheme}: no focus outline painted`);
  }

  // ── finding 2: the cross-link, measured where it actually renders ────
  // It lives in the authenticated layout (components/layout.tsx), not on the
  // login screen, so log in first. Mock creds: ubus.mock accepts anything.
  // `?mockUiLinks=none` renders the plain reason line instead of the anchor,
  // which is the second half of the pair.
  for (const variant of ['available', 'none']) {
    const q = variant === 'none' ? '?mockUiLinks=none' : '';
    await page.goto(`http://localhost:5199/${q}#/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    // VITE_MOCK=true seeds a session, so the board usually lands straight in
    // the layout. Only drive the form when it actually asks for credentials.
    if (await page.$('#password')) {
      await page.fill('#username', 'root');
      await page.fill('#password', 'a-real-password');
      await page.waitForTimeout(150);
      await page.click('.btn-primary');
      await page.waitForTimeout(1600);
    }

    const cross = await page.evaluate(() => {
      const el = document.querySelector('.ui-crosslink, .ui-crosslink-reason');
      if (!el) return null;
      const cs = getComputedStyle(el);
      // walk up for the first painted ground (the header is a translucent scrim)
      let g = el, bg = 'rgba(0, 0, 0, 0)';
      while (g && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(g).backgroundColor;
        g = g.parentElement;
      }
      return {
        cls: el.className,
        text: el.textContent.trim().slice(0, 40),
        color: cs.color,
        opacity: cs.opacity,
        bg,
      };
    });
    if (!cross) {
      // Not a silent skip: this state MUST render one of the two nodes.
      console.log(`       [${variant}] NO cross-link node rendered — harness is not reaching the layout`);
      fails.push(`${scheme}/${variant}: cross-link did not render, so its pair is unverified`);
      continue;
    }
    console.log(`       [${variant}] .${cross.cls}: "${cross.text}" (opacity ${cross.opacity}), ground ${cross.bg}`);
    check(scheme, `cross-link (${variant}) text`, parse(cross.color), parse(cross.bg), 4.5);
    if (Number(cross.opacity) < 1) {
      fails.push(`${scheme}: cross-link (${variant}) still multiplies by opacity ${cross.opacity}`);
    }
  }

  await ctx.close();
}

// ── finding 1: .btn-danger hover, real pointer, on a real page ────────
// The WiFi page's "Remove" confirmation. Rather than driving the whole
// remove flow, mount the exact markup the route renders and hover it.
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 700 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/#/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  PAGE[scheme] = parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

  // the exact class list from admin/src/routes/wifi.tsx:610
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'hover-probe';
    host.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999';
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger btn-sm';
    btn.textContent = 'Remove';
    host.appendChild(btn);
    document.body.appendChild(host);
  });
  const rest = await page.evaluate(() => {
    const b = document.querySelector('#hover-probe .btn-danger');
    const cs = getComputedStyle(b);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  await page.hover('#hover-probe .btn-danger');
  await page.waitForTimeout(350);
  const hovered = await page.evaluate(() => {
    const b = document.querySelector('#hover-probe .btn-danger');
    const cs = getComputedStyle(b);
    return { bg: cs.backgroundColor, fg: cs.color };
  });

  console.log(`\n=== danger button hover / ${scheme} ===`);
  check(scheme, 'danger REST label', parse(rest.fg), parse(rest.bg), 4.5);
  check(scheme, 'danger HOVER label', parse(hovered.fg), parse(hovered.bg), 4.5);
  const moved = rest.bg !== hovered.bg;
  console.log(`       fill changed on hover: ${moved} (${rest.bg} -> ${hovered.bg})`);
  if (!moved) fails.push(`${scheme}: hover did not change the danger fill`);

  await ctx.close();
}

// ── guest balance page: the opacity-paint sweep ───────────────────────
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1050 },
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  await setupMockBackend(page);
  await page.route('**/src/helpers/cashu.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: CASHU_STUB })
  );
  await page.goto('http://localhost:5177/balance.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  PAGE[scheme] = parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  console.log(`\n=== guest balance / ${scheme} ===  page ${fmt(PAGE[scheme])}`);

  const probes = await page.evaluate(() => {
    const out = [];
    for (const sel of ['.tollgate-captive-portal-balance-panel', '.status.success', '.status-info']) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      let g = el, bg = 'rgba(0, 0, 0, 0)';
      while (g && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(g).backgroundColor;
        g = g.parentElement;
      }
      out.push({ sel, color: cs.color, bg, opacity: cs.opacity, text: el.textContent.trim().slice(0, 30) });
    }
    return out;
  });
  for (const p of probes) {
    if (p.missing) { console.log(`       ${p.sel}: absent`); continue; }
    check(scheme, `guest ${p.sel} text`, parse(p.color), parse(p.bg), 4.5);
    if (Number(p.opacity) < 1) fails.push(`${scheme}: ${p.sel} still uses opacity ${p.opacity}`);
  }

  // placeholder: type nothing and read ::placeholder through a real field
  const ph = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder], input');
    if (!inp) return null;
    const cs = getComputedStyle(inp);
    const ps = getComputedStyle(inp, '::placeholder');
    return { color: ps.color, opacity: ps.opacity, fieldBg: cs.backgroundColor };
  });
  if (ph) {
    check(scheme, 'guest placeholder text', parse(ph.color), parse(ph.fieldBg), 4.5);
  }
  await ctx.close();
}

await browser.close();

const summary = rows.map((r) => `${r.scheme} ${r.what}: ${r.r}:1`).join('\n');
console.log(`\n${rows.length} painted pairs measured, ${fails.length} below threshold`);
if (fails.length) {
  console.error(`\nFAILURES:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('every measured painted pair clears its WCAG threshold');
