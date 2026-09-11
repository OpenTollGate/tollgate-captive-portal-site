import { test, expect } from '@playwright/test';

const HYDRATE_TIMEOUT = 15000;

// Visual snapshot tests — informational in CI, mandatory locally.
// CI baselines may differ from local due to font rendering / antialiasing.
// Run `npm run test:visual` locally to update baselines.

test.describe('Captive portal — visual snapshots', () => {

  test('portal loaded', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal-content-container', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(2000);
    const container = page.locator('.tollgate-captive-portal-content-container');
    await expect(container).toHaveScreenshot('portal-loaded.png', {
      animations: 'disabled',
    });
  });

  test('balance tab', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await page.goto('/');
    await page.waitForSelector('#tab-cashu', { timeout: HYDRATE_TIMEOUT });
    await page.locator('#tab-balance').click();
    await page.waitForSelector('#balance-token', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(1000);
    const container = page.locator('.tollgate-captive-portal-content-container');
    await expect(container).toHaveScreenshot('balance-tab.png', {
      animations: 'disabled',
    });
  });
});
