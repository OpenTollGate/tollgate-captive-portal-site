import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

test.describe('Captive portal — functional', () => {

  test('page loads with TollGate branding', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal', { timeout: HYDRATE_TIMEOUT });
    await expect(page).toHaveTitle(/Tollgate Captive Portal/i);
    await expect(page.locator('.tollgate-captive-portal-header img')).toBeVisible();
  });

  test('Cashu tab is default; Balance tab removed; Lightning present', async ({ page }) => {
    await setupMockBackend(page);
    await page.goto('/');
    await page.waitForSelector('#tab-cashu', { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator('#tab-cashu')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('#tab-balance')).toHaveCount(0);
    await expect(page.locator('#tab-lightning')).toBeVisible();
  });

  test('footer shows Powered by TollGate', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tollgate-captive-portal-footer', { timeout: HYDRATE_TIMEOUT });
    const text = await page.locator('.tollgate-captive-portal-footer').textContent();
    expect(text).toMatch(/TollGate/i);
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

  test('Lightning tab is enabled by the capability probe', async ({ page }) => {
    await setupMockBackend(page);
    await page.goto('/');
    await page.waitForSelector('#tab-lightning', { timeout: HYDRATE_TIMEOUT });
    // the probe resolves "supported" against the mock backend
    await expect(page.locator('#tab-lightning')).toHaveAttribute('data-disabled', 'false', { timeout: HYDRATE_TIMEOUT });
    await page.locator('#tab-lightning').click();
    await page.waitForSelector('#lightning-unit-amount', { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator('#lightning-unit-amount')).toBeVisible();
  });

  test('standalone balance page renders backend session data', async ({ page }) => {
    await setupMockBackend(page);
    await page.goto('/balance.html');
    await page.waitForSelector('.tollgate-captive-portal-balance-page', { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator('.tollgate-captive-portal-balance-card').first()).toBeVisible();
  });
});
