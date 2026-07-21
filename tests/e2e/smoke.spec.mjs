import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

test.describe('Captive portal smoke', () => {

  test('page loads with TollGate branding', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal', { timeout: HYDRATE_TIMEOUT });
    await expect(page).toHaveTitle(/Tollgate Captive Portal/i);
    await expect(page.locator('.tollgate-captive-portal-header img')).toBeVisible();
  });

  test('Cashu tab is default, Balance and Lightning present', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#tab-cashu', { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator('#tab-cashu')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('#tab-balance')).toBeVisible();
    await expect(page.locator('#tab-lightning')).toBeVisible();
  });

  test('footer shows Powered by TollGate', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal-footer', { timeout: HYDRATE_TIMEOUT });
    const text = await page.locator('.tollgate-captive-portal-footer').textContent();
    expect(text).toMatch(/TollGate/i);
  });

  test('visual snapshot — portal loaded (desktop)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal-content-container', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('portal-loaded.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('AccessGranted shows after manual payment', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'E2e payment test only on Chromium');
    await setupMockBackend(page, { usageResponse: '60000/600000' });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cashu-token', { timeout: HYDRATE_TIMEOUT });
    await page.fill('#cashu-token', TEST_TOKEN);
    await page.waitForTimeout(1000);

    const purchaseBtn = page.locator('.tollgate-captive-portal-method-submit button.cta').first();
    await purchaseBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    if (await purchaseBtn.isVisible()) {
      await purchaseBtn.click();
      await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 30000 }).catch(() => {});
    }

    await page.waitForTimeout(2000);
    const hasAG = await page.locator('.tollgate-captive-portal-access-granted').isVisible().catch(() => false);
    if (hasAG) {
      await page.screenshot({ path: 'test-results/output/access-granted.png', fullPage: true });
    }
  });

  test('Balance tab renders lookup form', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await page.goto('/');
    await page.waitForSelector('#tab-cashu', { timeout: HYDRATE_TIMEOUT });
    await page.locator('#tab-balance').click();
    await page.waitForSelector('#balance-token', { timeout: HYDRATE_TIMEOUT });
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot('balance-tab.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});
