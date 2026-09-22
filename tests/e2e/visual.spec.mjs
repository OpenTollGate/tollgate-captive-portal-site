import { test, expect } from '@playwright/test';
import { setupMockBackend } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

// Visual snapshot tests — informational in CI, mandatory locally.
// CI baselines may differ from local due to font rendering / antialiasing.
// Run `npm run test:visual` locally to update baselines.
//
// Baselines are committed for the `desktop` project only (their file names end
// in `-desktop-linux.png`), so the `mobile` project is skipped here.

test.describe('Captive portal — visual snapshots', () => {

  test('portal loaded', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    test.skip(testInfo.project.name !== 'desktop', 'Baselines are committed for the desktop project only');
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal-content-container', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(2000);
    const container = page.locator('.tollgate-captive-portal-content-container');
    await expect(container).toHaveScreenshot('portal-loaded.png', {
      animations: 'disabled',
    });
  });

  test('standalone balance page', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    test.skip(testInfo.project.name !== 'desktop', 'Baselines are committed for the desktop project only');
    // The guest portal no longer has an in-app Balance tab — the balance page is
    // the standalone `balance.html` entry point. Snapshot that, with the mock
    // backend so the rendered values are deterministic.
    await setupMockBackend(page);
    await page.goto('/balance.html');
    await page.waitForSelector('.tollgate-captive-portal-balance-page', { timeout: HYDRATE_TIMEOUT });
    await page.waitForSelector('.tollgate-captive-portal-balance-card', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(1000);
    const container = page.locator('.tollgate-captive-portal-balance-page');
    await expect(container).toHaveScreenshot('balance-page.png', {
      animations: 'disabled',
    });
  });
});
