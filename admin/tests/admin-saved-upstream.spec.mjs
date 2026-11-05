import { test, expect } from '@playwright/test';

const url = (mode = '') => `./?mockCredentialState=set&mockSavedReconnect=${mode}#/peering`;
const calls = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.upstream_connect') || '[]'));
const saved = (page) => page.locator('.card', { has: page.locator('.card-title', { hasText: /^Saved upstream WiFi$/ }) });

test('saved reconnect reviews the interruption and submits only the SSID', async ({ page }) => {
  await page.goto(url());
  await saved(page).getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(saved(page).getByText(/briefly interrupt internet/)).toBeVisible();
  await expect(saved(page).locator('input[type="password"]')).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  await saved(page).getByRole('button', { name: 'Reconnect now' }).click();
  await expect(page.getByText('Reconnected to UpstreamWiFi')).toBeVisible();
  expect(await calls(page)).toEqual([{ ssid: 'UpstreamWiFi', keys: ['ssid'] }]);
});

test('cancel sends no reconnect request', async ({ page }) => {
  await page.goto(url());
  await saved(page).getByRole('button', { name: 'Reconnect', exact: true }).click();
  await saved(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(saved(page).getByRole('button', { name: 'Reconnect now' })).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});

for (const mode of ['legacy', 'unsupported', 'string']) {
  test(`no saved action without explicit boolean capability: ${mode}`, async ({ page }) => {
    await page.goto(url(mode));
    await expect(saved(page).getByText('UpstreamWiFi')).toBeVisible();
    await expect(saved(page).getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });
}

for (const mode of ['failure', 'transport']) {
  test(`failed reconnect remains visible without retry: ${mode}`, async ({ page }) => {
    await page.goto(url(mode));
    await saved(page).getByRole('button', { name: 'Reconnect', exact: true }).click();
    await saved(page).getByRole('button', { name: 'Reconnect now' }).click();
    await expect(page.locator('.error-text')).toContainText('fixture reconnect failure');
    await expect(saved(page).getByRole('button', { name: 'Reconnect now' })).toBeEnabled();
    await expect(page.getByText('Reconnected to UpstreamWiFi')).toHaveCount(0);
    expect(await calls(page)).toHaveLength(1);
  });
}

test('repeated submission while pending sends one request', async ({ page }) => {
  await page.goto(url('slow'));
  await saved(page).getByRole('button', { name: 'Reconnect', exact: true }).click();
  await saved(page).getByRole('button', { name: 'Reconnect now' }).evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByText('Reconnected to UpstreamWiFi')).toBeVisible();
  expect(await calls(page)).toHaveLength(1);
});
