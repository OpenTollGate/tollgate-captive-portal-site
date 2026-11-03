import { test, expect } from '@playwright/test';

const DASHBOARD = './?mockCredentialState=set#/dashboard';
const SETTINGS = './?mockCredentialState=set#/settings';

test.describe('admin board: language picker', () => {
  test('switches German and Arabic, persists the choice, and mirrors RTL', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(SETTINGS);
    await expect(page.locator('.lang-switcher select')).toBeVisible({ timeout: 30000 });

    await page.locator('.lang-switcher select').selectOption('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

    await page.locator('.lang-switcher select').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('.lang-switcher select')).toHaveValue('ar');
    expect(errors).toEqual([]);
  });

  test('the Cobrador welcome card is localized', async ({ page }) => {
    await page.goto(DASHBOARD);
    await expect(page.getByText('Welcome home, Cobrador!')).toBeVisible({ timeout: 30000 });
    await page.locator('.lang-switcher select').selectOption('de');
    await expect(page.getByText('Willkommen zu Hause, Cobrador!')).toBeVisible();
  });
});
