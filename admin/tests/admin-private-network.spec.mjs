import { test, expect } from '@playwright/test';
const writes = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.maintenance_writes') || '[]'));
async function open(page, mode = '') {
  await page.goto(`./?mockMaintenance=${mode}#/maintenance`);
  await expect(page.getByRole('heading', { name: 'Private management network' })).toBeVisible();
}
test('private metadata omits credentials and disabling needs a recovery route and review', async ({ page }) => {
  await open(page);
  await expect(page.getByText('10.9.8.1', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable private Wi-Fi', exact: true })).toBeDisabled();
  await page.getByLabel('I have a wired management connection').check();
  await page.getByRole('button', { name: 'Disable private Wi-Fi', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('venue and guest Wi-Fi');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await writes(page)).toEqual([]);
});
test('address pinning validates a usable /24 host and reviews the reconnect address', async ({ page }) => {
  await open(page);
  await page.getByText('Change the management address', { exact: true }).click();
  await page.getByLabel('New management address').fill('10.9.9.0/24');
  await page.getByLabel('I have a wired management connection').check();
  await expect(page.getByRole('button', { name: 'Review address change' })).toBeDisabled();
  await page.getByLabel('New management address').fill('10.9.9.1/16');
  await expect(page.getByRole('button', { name: 'Review address change' })).toBeDisabled();
  await page.getByLabel('New management address').fill('10.9.9.1/24');
  await page.getByRole('button', { name: 'Review address change' }).click();
  await expect(page.getByRole('dialog')).toContainText('10.9.9.1');
  await expect(page.getByRole('dialog')).toContainText('same subnet');
  await page.getByRole('button', { name: 'Confirm address change' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'reconnect' })).toBeVisible();
  expect(await writes(page)).toEqual([{ method: 'private_set_address', address: '10.9.9.1/24' }]);
  await expect(page.getByRole('button', { name: 'Review address change' })).toBeDisabled();
});
test('a lost private-network response remains uncertain without automatic retries', async ({ page }) => {
  await open(page, 'uncertain');
  await page.getByLabel('I have a wired management connection').check();
  await page.getByRole('button', { name: 'Disable private Wi-Fi', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm disable' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'outcome is not confirmed' })).toBeVisible();
  expect(await writes(page)).toEqual(['private_disable']);
  await expect(page.getByRole('button', { name: 'Disable private Wi-Fi', exact: true })).toBeDisabled();
});
