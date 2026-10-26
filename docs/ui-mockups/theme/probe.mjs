import { chromium } from 'playwright';
import { setupMockBackend } from '../../../tests/e2e/helpers/mock-backend.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}\n${(e.stack||'').split('\n').slice(0,4).join('\n')}`));
page.on('requestfailed', (r) => logs.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`));
await setupMockBackend(page);
await page.goto('http://localhost:5177/balance.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const html = await page.evaluate(() => document.body.innerHTML.slice(0, 1500));
console.log(logs.filter((l) => !l.startsWith('debug')).join('\n'));
console.log('--- BODY ---');
console.log(html);
await browser.close();
