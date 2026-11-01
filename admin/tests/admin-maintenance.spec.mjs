import { test, expect } from '@playwright/test';

const writes = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.maintenance_writes') || '[]'));
const open = async (page, mode = '') => {
  await page.goto(`./?mockMaintenance=${mode}#/maintenance`);
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
};

test('maintenance shows diagnostic facts and advanced router workflows without mutations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByText('Responding', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open advanced router settings →' })).toHaveAttribute('href', /https:/);
  await expect(page.getByText(/Firmware, backups and reboot/)).toBeVisible();
  await expect(page.getByText(/running payout allocation is not reported/)).toBeVisible();
  expect(await writes(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('stop is reviewed, cancel is inert, and one confirmation sends one fixed command', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Stop TollGate', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Guests may need to pay again');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button', { name: 'Stop TollGate', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stop command completed' })).toBeVisible();
  expect(await writes(page)).toEqual(['service_stop']);
  await expect(page.getByText('Not responding', { exact: true })).toBeVisible();
  await page.getByLabel('I have a wired management connection').check();
  await expect(page.getByRole('button', { name: 'Enable private Wi-Fi', exact: true })).toBeDisabled();
  await expect(page.getByText(/Start TollGate before changing/)).toBeVisible();
  await page.getByRole('button', { name: 'Start TollGate', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm start', exact: true }).click();
  await expect(page.getByText('Responding', { exact: true })).toBeVisible();
});

test('uncertain service changes are never retried automatically or treated as confirmed', async ({ page }) => {
  await open(page, 'uncertain');
  await page.getByRole('button', { name: 'Restart TollGate', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'outcome is not confirmed' })).toBeVisible();
  expect(await writes(page)).toEqual(['service_restart']);
  await expect(page.getByRole('button', { name: 'Restart TollGate', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh diagnostics', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restart TollGate', exact: true })).toBeEnabled();
  expect(await writes(page)).toEqual(['service_restart']);
});

test('structured service refusal remains a failure even when transport succeeds', async ({ page }) => {
  await open(page, 'refused');
  await page.getByRole('button', { name: 'Restart TollGate', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'outcome is not confirmed' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Restart command completed' })).toHaveCount(0);
  expect(await writes(page)).toEqual(['service_restart']);
});

test('older plugins show the missing capability without offering nonfunctional actions', async ({ page }) => {
  await open(page, 'old-plugin');
  await expect(page.getByRole('button', { name: 'Start TollGate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop TollGate', exact: true })).toBeDisabled();
  await expect(page.getByText(/management plugin needs an update/)).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('immediate repeated confirmation cannot send duplicate service actions', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Restart TollGate', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByRole('status').filter({ hasText: 'Restart command completed' })).toBeVisible();
  expect(await writes(page)).toEqual(['service_restart']);
});
