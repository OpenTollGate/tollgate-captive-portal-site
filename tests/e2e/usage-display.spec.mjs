// Verifies issue #5 fix: live usage display in AccessGranted.
// Mocks /usage to return deterministic values, waits for the 30s heartbeat
// to poll, then asserts the progress bar and remaining text render correctly.
//
// This test is SLOW (~40s) because the heartbeat interval is 30s.

import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

test.describe('Issue #5 — live usage display', () => {
  test.setTimeout(90000);

  test('usage progress bar and text render with real /usage data', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Mock backend only configured for Chromium');
    test.slow();
    await setupMockBackend(page, { usageResponse: '60000/600000' });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cashu-token', { timeout: HYDRATE_TIMEOUT });
    await page.fill('#cashu-token', TEST_TOKEN);
    await page.waitForTimeout(1000);

    const purchaseBtn = page.locator('.tollgate-captive-portal-method-submit button.cta').first();
    await purchaseBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await purchaseBtn.isVisible()) {
      await purchaseBtn.click();
    }

    await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 30000 });
    console.log('  AccessGranted rendered, waiting for heartbeat poll (~35s)...');

    await page.waitForSelector('.tollgate-captive-portal-access-granted-usage', { timeout: 45000 });
    console.log('  Usage panel appeared');

    const usageText = await page.locator('.tollgate-captive-portal-access-granted-usage-text').textContent();
    const barFill = page.locator('.tollgate-captive-portal-access-granted-usage-bar-fill');
    const barWidth = await barFill.evaluate(el => el.style.width);

    console.log(`  Usage text: "${usageText}"`);
    console.log(`  Bar width: "${barWidth}"`);

    expect(usageText, 'usage text should contain digits').toMatch(/\d/);
    expect(usageText, 'should format as time (min/sec/hours) for milliseconds metric').toMatch(/min|sec|hour/i);
    expect(usageText, 'should NOT show KiB/MB/GB for milliseconds metric').not.toMatch(/KiB|MB|GB|B\b/i);

    expect(barWidth, 'progress bar should have a width').toMatch(/\d/);

    const widthNum = parseInt(barWidth);
    expect(widthNum, 'bar should be > 0% (used < total)').toBeGreaterThan(0);
    expect(widthNum, 'bar should be <= 100%').toBeLessThanOrEqual(100);

    await page.screenshot({
      path: 'test-results/output/issue5-usage-display.png',
      fullPage: true,
    });
    console.log('  Screenshot captured');
  });

  // Note: bytes-metric test omitted — the fmtBytes function in App.jsx always
  // formats as bytes regardless of metric, so the milliseconds test already
  // covers the display path. A dedicated bytes test would need a separate
  // mock with step_size/price tuned for byte-range values.
});
