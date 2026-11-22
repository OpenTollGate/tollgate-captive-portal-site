// Measure the install panel's real layout geometry in Chromium.
//
// Written because the evidence screenshots showed copy wrapping at roughly one
// word per line inside a wide, mostly-empty card. That is a layout bug that no
// assertion in `offline-shell.spec.mjs` would catch — those tests assert
// behaviour, and the panel behaves perfectly while looking broken. So this
// prints the numbers instead of opinions.
import { chromium } from '@playwright/test';
import { resolve, join } from 'node:path';
import { serveWebroot, SERVED_ENTRY_DOCUMENT } from './helpers/portal-origin-host.mjs';

const WEBROOT = resolve(process.env.PORTAL_WEBROOT_DIR || join(process.cwd(), 'build'));

const host = await serveWebroot({ webroot: WEBROOT, host: '127.0.0.1' });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.goto(`${host.origin}/${SERVED_ENTRY_DOCUMENT}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="install-panel"]', { timeout: 10000 });

  const report = await page.evaluate(`(() => {
    const q = (sel) => document.querySelector(sel);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        display: cs.display,
        flex: cs.flex,
        width: cs.width,
        maxWidth: cs.maxWidth,
        padding: cs.padding,
        position: cs.position,
        float: cs.float,
      };
    };
    const panel = q('[data-testid="install-panel"]');
    const body = q('.install-panel__body');
    const title = q('.install-panel__title');
    const text = q('.install-panel__text');
    const dismiss = q('.install-panel__dismiss');
    const container = q('.tollgate-captive-portal-content-container');
    const content = q('.tollgate-captive-portal-content');

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      container: box(container),
      content: box(content),
      panel: box(panel),
      body: box(body),
      title: box(title),
      text: box(text),
      dismiss: box(dismiss),
      // Character-level wrapping evidence: how many visual lines the body text
      // occupies, and the widest word's width as a fraction of the text column.
      titleLines: title ? Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) : null,
      textLines: text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)) : null,
      childRects: panel ? Array.from(panel.children).map((c) => ({ cls: c.className, ...box(c) })) : [],
    };
  })()`);

  console.log(JSON.stringify(report, null, 2));

  // ── the actual regression gate ───────────────────────────────────────────
  // The bug this file was written for: the global `button:not([id*=tab])`
  // rule gave the dismiss button `width:100%`, `flex:0 0 auto` refused to
  // shrink it, and the text column collapsed to 0px — copy wrapped one word
  // per line inside a card that was mostly empty. Geometry is the only thing
  // that catches it, so refuse to exit 0 if it comes back.
  const fail = [];
  if (!report.panel) fail.push('install panel did not render');
  else {
    if (report.body.w < 200) fail.push(`body column collapsed to ${report.body.w}px (want >= 200)`);
    if (report.body.w < report.panel.w * 0.7) {
      fail.push(`body is only ${Math.round((report.body.w / report.panel.w) * 100)}% of panel width`);
    }
    if (report.dismiss.w > 140) fail.push(`dismiss button is ${report.dismiss.w}px wide (want <= 140, sized to label)`);
    if (report.titleLines > 3) fail.push(`title wrapped to ${report.titleLines} lines (want <= 3)`);
    if (report.textLines > 10) fail.push(`body copy wrapped to ${report.textLines} lines (want <= 10)`);
    // Nothing may overflow the viewport horizontally on a phone.
    if (report.panel.x + report.panel.w > report.viewport.w + 1) {
      fail.push(`panel overflows the viewport: ${report.panel.x + report.panel.w} > ${report.viewport.w}`);
    }
  }

  if (fail.length) {
    console.error('\nLAYOUT REGRESSION:');
    for (const f of fail) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nlayout OK: body ${report.body.w}px of ${report.panel.w}px panel, ` +
        `title ${report.titleLines} lines, copy ${report.textLines} lines, ` +
        `dismiss ${report.dismiss.w}px`
    );
  }
} finally {
  await browser.close();
  await host.close();
}
