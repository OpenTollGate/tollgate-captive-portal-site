// Verifies the prehydrate script in index.html:
// 1. Reads ?token= from URL before SPA loads
// 2. Sets window.__INITIAL_TOKEN__
// 3. Strips token from address bar (security — bearer instrument)

import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

test.describe('Prehydrate — ?token= URL delivery', () => {

  test('token from URL triggers auto-submit → AccessGranted renders', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');
    await setupMockBackend(page);

    await page.goto(`/?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 30000 });

    const text = await page.locator('.tollgate-captive-portal-access-granted').textContent();
    expect(text).toMatch(/successful|access granted/i);
    console.log('  AccessGranted rendered from URL token auto-submit');
  });

  test('token is stripped from the URL after prehydrate', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');
    await setupMockBackend(page);

    await page.goto(`/?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 30000 });
    await page.waitForTimeout(500);

    const currentUrl = page.url();
    expect(currentUrl, 'URL should not contain token=').not.toContain('token=');
    expect(currentUrl, 'URL should not contain cashu').not.toContain('cashu');
    console.log(`  URL after strip: ${currentUrl}`);
  });

  test('window.__INITIAL_TOKEN__ is set by prehydrate script', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');
    await setupMockBackend(page);

    await page.goto(`/?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const tokenType = await page.evaluate(() => typeof window.__INITIAL_TOKEN__);
    expect(tokenType, 'window.__INITIAL_TOKEN__ should be set').toBe('string');
    console.log(`  window.__INITIAL_TOKEN__ type: ${tokenType}`);
  });
});
