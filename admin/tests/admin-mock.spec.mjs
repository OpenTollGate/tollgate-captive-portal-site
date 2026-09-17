import { test, expect } from '@playwright/test';

// The admin board with a mocked ubus layer (VITE_MOCK=true). Verifies the app
// boots, passes the auth gate, and renders the dashboard shell + navigation.
test.describe('admin board (mock ubus)', () => {
  test('boots, authenticates, and renders the dashboard shell', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('./');
    await page.waitForSelector('.app-header', { timeout: 30000 });

    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.app-nav')).toBeVisible();
    await expect(page.locator('.nav-item').first()).toBeVisible();

    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('default brand is TollGate', async ({ page }) => {
    await page.goto('./');
    await expect(page).toHaveTitle(/TollGate/i);
  });
});
