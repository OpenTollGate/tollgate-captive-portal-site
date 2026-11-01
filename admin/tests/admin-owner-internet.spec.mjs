import { test, expect } from '@playwright/test';

const wifi = (scenario = 'wifi') => `./?mockInternet=${scenario}#/wifi`;
const internet = (page) => page.getByTestId('internet-connection');

test('Home leads directly to venue Wi-Fi setup', async ({ page }) => {
  await page.goto('./?mockInternet=wifi');
  await expect(internet(page)).toContainText('Internet working');
  await expect(internet(page)).toContainText('UpstreamWiFi');
  await page.getByRole('button', { name: 'Connect to venue Wi-Fi' }).click();
  await expect(page).toHaveURL(/#\/wifi$/);
  await expect(page.getByText('Available Networks', { exact: true })).toBeVisible();
});

test('internet setup comes before collapsed radio settings on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(wifi());
  await expect(internet(page)).toBeVisible();
  const advanced = page.locator('details', { hasText: 'Advanced Wi-Fi settings' });
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(page.locator('.card-title', { hasText: 'radio0' })).not.toBeVisible();
  await advanced.locator('summary').click();
  await expect(page.locator('.card-title', { hasText: 'radio0' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Wi-Fi internet is healthy without a wired WAN and shows its band', async ({ page }) => {
  await page.goto(wifi());
  await expect(internet(page)).toContainText('Internet working');
  await expect(internet(page)).toContainText('Wi-Fi · UpstreamWiFi');
  await expect(internet(page)).toContainText('192.0.2.10');
  await expect(page.locator('.scan-item', { hasText: 'UpstreamWiFi' })).toContainText('2.4 GHz');
  await expect(page.locator('.scan-item', { hasText: 'OpenNet' })).toContainText('5 GHz');
});

test('a failed probe offers conditional venue-login guidance without claiming detection', async ({ page }) => {
  await page.goto(wifi('offline'));
  await expect(internet(page)).toContainText('Internet not confirmed');
  await expect(internet(page)).toContainText('If the venue requires a browser sign-in');
  await expect(internet(page)).not.toContainText('Internet working');
  await expect(internet(page)).not.toContainText('Venue login detected');
});

test('an unavailable status check stays unknown', async ({ page }) => {
  await page.goto(wifi('unknown'));
  await expect(internet(page)).toContainText('Internet check unavailable');
  await expect(internet(page)).not.toContainText('Internet working');
});

test('the active route determines the source when wired and Wi-Fi are both configured', async ({ page }) => {
  await page.goto(wifi('wired'));
  await expect(internet(page)).toContainText('Ethernet');
  await expect(internet(page)).not.toContainText('Wi-Fi · UpstreamWiFi');
});

test('a secured join clears the password and keeps its result visible', async ({ page }) => {
  await page.goto(wifi());
  const row = page.locator('.scan-item', { hasText: 'NeighborNet' });
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  const password = row.getByLabel('Wi-Fi password');
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('test-venue-passphrase');
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Wi-Fi joined: NeighborNet' })).toBeVisible();
  await expect(internet(page)).toContainText('Wi-Fi · NeighborNet');
  await expect(page.getByText('test-venue-passphrase', { exact: false })).toHaveCount(0);
  await expect(password).toHaveCount(0);
  // A result must not disappear before the owner can read it.
  await page.clock.install();
  await page.clock.fastForward(4000);
  await expect(page.getByRole('status').filter({ hasText: 'Wi-Fi joined: NeighborNet' })).toBeVisible();
});

test('a failed join keeps the form and the existing connection visible', async ({ page }) => {
  await page.goto(wifi('join-failed'));
  const row = page.locator('.scan-item', { hasText: 'NeighborNet' });
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await row.getByLabel('Wi-Fi password').fill('test-venue-passphrase');
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not join this network' })).toBeVisible();
  await expect(row.getByLabel('Wi-Fi password')).toBeVisible();
  await expect(internet(page)).toContainText('UpstreamWiFi');
});

test('a new internet check hides the previous success until the result arrives', async ({ page }) => {
  await page.goto(wifi());
  await expect(internet(page)).toContainText('Internet working');
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=offline&mockStatusDelay=500#/wifi'));
  await internet(page).getByRole('button', { name: 'Check internet' }).click();
  await expect(internet(page)).toContainText('Checking internet');
  await expect(internet(page)).not.toContainText('Internet working');
  await expect(internet(page)).toContainText('Internet not confirmed');
});

test('equally preferred default routes do not invent a single internet source', async ({ page }) => {
  await page.goto(wifi('equal-routes'));
  await expect(internet(page)).toContainText('Multiple uplinks');
  await expect(internet(page)).not.toContainText('Wi-Fi · UpstreamWiFi');
});

test('the router’s own guest hotspot cannot be selected as its internet source', async ({ page }) => {
  await page.goto(wifi('self-scan'));
  await expect(page.locator('.scan-item .scan-item-ssid')).toHaveCount(3);
  await expect(page.locator('.scan-item', { hasText: 'tollgate-5g' })).toHaveCount(0);
});
