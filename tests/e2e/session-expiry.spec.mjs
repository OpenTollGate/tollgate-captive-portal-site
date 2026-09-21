// Verifies session expiry regression:
// When /usage returns -1/-1 for 2 consecutive polls (60s),
// AccessGranted switches to SessionExpired view.
//
// This test is VERY SLOW (~75s) due to the 30s heartbeat interval.

import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

test.describe('Session expiry regression', () => {
  test.setTimeout(120000);

  test('SessionExpired view renders after 2 consecutive -1/-1 polls', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');
    test.slow();

    await setupMockBackend(page, { usageExpired: true });

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
    console.log('  AccessGranted rendered. Waiting for 2 heartbeat polls (~65s)...');

    await page.waitForFunction(
      () => {
        const h2 = document.querySelector('.tollgate-captive-portal-access-granted h2');
        if (!h2) return false;
        const text = h2.textContent.toLowerCase();
        return text.includes('session') || text.includes('expired') || text.includes('reconnect');
      },
      { timeout: 90000 },
    );

    const h2Text = await page.locator('.tollgate-captive-portal-access-granted h2').textContent();
    console.log(`  H2 text after polls: "${h2Text}"`);

    expect(h2Text, 'should show session-expired text after 2 failed polls')
      .toMatch(/session|expired|reconnect/i);

    await page.screenshot({
      path: 'test-results/output/session-expired.png',
      fullPage: true,
    });
    console.log('  Screenshot captured');
  });
});
