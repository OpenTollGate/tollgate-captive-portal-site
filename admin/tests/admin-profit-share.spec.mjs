import { test, expect } from '@playwright/test';

const open = async (page, mode = '') => {
  await page.goto(`./?mockProfit=${mode}#/settings`);
  await expect(page.getByTestId('profit-share-editor')).toBeVisible();
};
const writes = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.profit_writes') || '[]'));
const row = (page, name) => page.getByTestId(`payout-recipient-${name}`);

test('recipient addresses and exact shares are editable with no writes on load or drag', async ({ page }) => {
  await open(page);
  await expect(row(page, 'owner').getByLabel('Lightning address')).toHaveValue('owner@example.com');
  await row(page, 'owner').getByLabel('Share percentage').fill('70');
  await expect(page.getByText('Total: 90.00%', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review allocation' })).toBeDisabled();
  await row(page, 'treasury').getByLabel('Share percentage').fill('30');
  await row(page, 'owner').getByRole('slider').fill('60');
  await expect(page.getByText('Total: 100.00%', { exact: true })).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('a destination save changes exactly one public address after review', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await row(page, 'owner').getByRole('button', { name: 'Review destination' }).click();
  await expect(page.getByRole('dialog')).toContainText('replacement@example.com');
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Destination saved' })).toBeVisible();
  expect(await writes(page)).toEqual([{ method: 'config_set', key: 'identities.public_identities.0.lightning_address', value: 'replacement@example.com' }]);
});

test('mixed destination and allocation edits cannot be applied as a partial combined save', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await row(page, 'owner').getByLabel('Share percentage').fill('70');
  await row(page, 'treasury').getByLabel('Share percentage').fill('30');
  await expect(page.getByRole('button', { name: 'Review allocation' })).toBeDisabled();
  await expect(row(page, 'owner').getByRole('button', { name: 'Review destination' })).toBeDisabled();
  await expect(page.getByText(/Save or discard one kind of change/)).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('allocation review saves one complete allocation and leaves identities alone', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Share percentage').fill('75');
  await row(page, 'treasury').getByLabel('Share percentage').fill('25');
  await page.getByRole('button', { name: 'Review allocation' }).click();
  await expect(page.getByRole('dialog')).toContainText('owner@example.com');
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Allocation saved' })).toBeVisible();
  const calls = await writes(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('config_save');
  expect(calls[0].config.profit_share).toEqual([{ identity: 'owner', factor: 0.75 }, { identity: 'treasury', factor: 0.25 }]);
  expect(calls[0].config.upstream_wifi.manual_pause_seconds).toBe(120);
  expect(calls[0].config).not.toHaveProperty('identities');
});

test('restart explains the paid-session consequence and cancel does nothing', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Restart TollGate to apply' }).click();
  await expect(page.getByRole('dialog')).toContainText('Guests may need to pay again');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button', { name: 'Restart TollGate to apply' }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'TollGate is responding' })).toBeVisible();
  expect((await writes(page)).filter(call => call.method === 'service_restart')).toHaveLength(1);
});

test('a persistence failure with a changed readback is reported as uncertain without retry', async ({ page }) => {
  await open(page, 'address-uncertain');
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await row(page, 'owner').getByRole('button', { name: 'Review destination' }).click();
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not confirmed' })).toBeVisible();
  await expect(row(page, 'owner').getByLabel('Lightning address')).toHaveValue('replacement@example.com');
  expect(await writes(page)).toHaveLength(1);
});

test('a stale destination aborts before writing to a changed identity list', async ({ page }) => {
  await open(page, 'address-conflict');
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await row(page, 'owner').getByRole('button', { name: 'Review destination' }).click();
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('an ambiguous restart is never automatically repeated', async ({ page }) => {
  await open(page, 'restart-uncertain');
  await page.getByRole('button', { name: 'Restart TollGate to apply' }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Restart outcome is not confirmed' })).toBeVisible();
  expect((await writes(page)).filter(call => call.method === 'service_restart')).toHaveLength(1);
});

test('an older management plugin disables restart with useful guidance', async ({ page }) => {
  await open(page, 'old-plugin');
  await expect(page.getByRole('button', { name: 'Restart TollGate to apply' })).toBeDisabled();
  await expect(page.getByText(/management plugin does not support/)).toBeVisible();
});

test('destination edits are saved one at a time instead of discarding another draft', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await expect(row(page, 'treasury').getByLabel('Lightning address')).toBeDisabled();
  await page.getByRole('button', { name: 'Discard destination edits' }).click();
  await expect(row(page, 'treasury').getByLabel('Lightning address')).toBeEnabled();
  expect(await writes(page)).toEqual([]);
});

test('checking service status after an ambiguous restart does not repeat it', async ({ page }) => {
  await open(page, 'restart-uncertain');
  await page.getByRole('button', { name: 'Restart TollGate to apply' }).click();
  await page.getByRole('button', { name: 'Confirm restart', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Restart outcome is not confirmed');
  await page.getByRole('button', { name: 'Check service status' }).click();
  await expect(page.getByRole('status')).toContainText('does not confirm a previous restart');
  await expect(page.getByRole('button', { name: 'Restart TollGate to apply' })).toBeEnabled();
  expect((await writes(page)).filter(call => call.method === 'service_restart')).toHaveLength(1);
});

test('removing an allocation keeps its identity and the owner cannot be removed', async ({ page }) => {
  await open(page);
  await expect(row(page, 'owner').getByRole('button', { name: 'Remove from allocation' })).toHaveCount(0);
  await row(page, 'treasury').getByRole('button', { name: 'Remove from allocation' }).click();
  await row(page, 'owner').getByLabel('Share percentage').fill('100');
  await page.getByRole('button', { name: 'Review allocation' }).click();
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Allocation saved');
  await expect(page.getByLabel('Add an existing recipient').locator('option', { hasText: 'treasury' })).toHaveCount(1);
  expect((await writes(page)).every(call => call.method === 'config_save')).toBe(true);
});

test('a later generic settings save preserves the separately saved allocation', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Share percentage').fill('75');
  await row(page, 'treasury').getByLabel('Share percentage').fill('25');
  await page.getByRole('button', { name: 'Review allocation' }).click();
  await page.getByRole('button', { name: 'Save allocation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Allocation saved');
  await page.locator('#field-accepted_mints-0-url').first().fill('https://mint.example.com');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toContainText('Configuration saved');
  const last = (await writes(page)).at(-1);
  expect(last.config.profit_share).toEqual([{ identity: 'owner', factor: 0.75 }, { identity: 'treasury', factor: 0.25 }]);
});

test('the editor is usable on a phone and an invalid address cannot be saved', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await row(page, 'owner').getByLabel('Lightning address').fill('not-an-address');
  await expect(row(page, 'owner').getByRole('button', { name: 'Review destination' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await writes(page)).toEqual([]);
});

test('two immediate confirmation clicks cannot submit the same action twice', async ({ page }) => {
  await open(page);
  await row(page, 'owner').getByLabel('Lightning address').fill('replacement@example.com');
  await row(page, 'owner').getByRole('button', { name: 'Review destination' }).click();
  await page.getByRole('button', { name: 'Save destination', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByRole('status')).toContainText('Destination saved');
  expect(await writes(page)).toHaveLength(1);
});
