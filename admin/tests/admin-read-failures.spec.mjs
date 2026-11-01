import { test, expect } from '@playwright/test';

// Inject failures into this page's served mock module, keeping shared fixtures
// unchanged while exercising the real route components and refresh handlers.
async function reads(page, states = {}) {
  await page.addInitScript(value => sessionStorage.setItem('tg.test.reads', JSON.stringify(value)), states);
  await page.route('**/src/lib/ubus.mock.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('function mockUbusCall(');
    await route.fulfill({ response, body: body.replace(/(function mockUbusCall\([\s\S]*?\) \{)/, '$1' + `
  const testReadKey = obj + '.' + method;
  const state = JSON.parse(sessionStorage.getItem('tg.test.reads') || '{}')[testReadKey];
  if (state === 'reject') return Promise.reject(new Error('read connection lost'));
  if (state === 'refuse') return Promise.resolve({ success: false, error: 'service unavailable' });
  if (state === 'malformed') return Promise.resolve({ success: true, data: {} });
  if (state === 'empty-file') return Promise.resolve({ data: '' });
  if (state === 'empty-leases') return Promise.resolve({ device: {} });
  if (state === 'canonical-balance') return Promise.resolve({ success: true, data: { balance_sats: 2468 } });
  if (state === 'partial-status') return Promise.resolve({ success: true, data: { running: true } });
  if (state === 'zero-wallet') return Promise.resolve({ success: true, data: { total_balance: 0, mint_balances: {} } });
  if (state === 'degraded') return Promise.resolve({ success: true, data: {
    running: true, config_ok: true, wallet_ok: true, network_ok: false,
    wallet_degraded: true, wallet_reason: 'No reachable mints', uptime: '1m', version: 'test'
  } });
`) });
  });
}

const setReads = (page, states) => page.evaluate(value => sessionStorage.setItem('tg.test.reads', JSON.stringify(value)), states);
const card = (page, title) => page.locator('.card').filter({ has: page.locator('.card-title', { hasText: new RegExp(`^${title}$`) }) });

for (const failure of ['reject', 'refuse', 'malformed']) {
  test(`Home clears stale service and wallet values after ${failure}`, async ({ page }) => {
    await reads(page);
    await page.clock.install();
    await page.goto('./');
    const service = card(page, 'Tollgate');
    const wallet = card(page, 'Wallet');
    await expect(service.getByText('Running', { exact: true })).toBeVisible();
    await expect(wallet.getByText('14,250 sats', { exact: true })).toBeVisible();
    await setReads(page, { 'tollgate.status': failure, 'tollgate.wallet_balance': failure });
    await page.clock.fastForward(10000);
    await expect(service).toContainText('TollGate status unavailable');
    await expect(service.getByText('Running', { exact: true })).toHaveCount(0);
    await expect(wallet).toContainText('Wallet balance unavailable');
    await expect(wallet.getByText('14,250 sats', { exact: true })).toHaveCount(0);
    // Home's other reads must not unmount or freeze the independent uplink card.
    await page.getByTestId('internet-connection').getByRole('button', { name: 'Check internet' }).click();
    await expect(page.getByTestId('internet-connection')).toContainText('Internet check unavailable');
  });

  test(`Wallet clears stale balances after ${failure} and recovers on refresh`, async ({ page }) => {
    await reads(page);
    await page.goto('./#/wallet');
    await expect(page.getByText('14,250 sats', { exact: true }).first()).toBeVisible();
    await setReads(page, { 'tollgate.wallet_info': failure });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Wallet balance unavailable');
    await expect(page.getByText('14,250 sats', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No funds in wallet', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Drain All Funds' })).toBeDisabled();
    await setReads(page, {});
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('14,250 sats', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('Home shows a degraded wallet reason instead of a healthy wallet badge', async ({ page }) => {
  await reads(page, { 'tollgate.status': 'degraded' });
  await page.goto('./');
  const service = card(page, 'Tollgate');
  await expect(service).toContainText('No reachable mints');
  await expect(service.locator('.stat-row').filter({ has: page.getByText('Wallet', { exact: true }) })).toContainText('Degraded');
});

test('Home reads the runtime wallet_balance balance_sats field', async ({ page }) => {
  await reads(page, { 'tollgate.wallet_balance': 'canonical-balance' });
  await page.goto('./');
  await expect(card(page, 'Wallet')).toContainText('2,468 sats');
});

test('Home does not present incomplete service health as a running service', async ({ page }) => {
  await reads(page, { 'tollgate.status': 'partial-status' });
  await page.goto('./');
  await expect(card(page, 'Tollgate')).toContainText('TollGate status unavailable');
  await expect(card(page, 'Tollgate').getByText('Running', { exact: true })).toHaveCount(0);
});

test('a failed initial Wallet read does not claim an empty wallet', async ({ page }) => {
  await reads(page, { 'tollgate.wallet_info': 'reject' });
  await page.goto('./#/wallet');
  await expect(page.getByRole('alert')).toContainText('Wallet balance unavailable');
  await expect(page.getByText('No funds in wallet', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 sats', { exact: true })).toHaveCount(0);
});

test('a confirmed zero Wallet balance still shows the empty wallet state', async ({ page }) => {
  await reads(page, { 'tollgate.wallet_info': 'zero-wallet' });
  await page.goto('./#/wallet');
  await expect(page.getByText('No funds in wallet', { exact: true })).toBeVisible();
  await expect(page.getByText('0 sats', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a failed balance refresh keeps already exported wallet tokens visible', async ({ page }) => {
  await reads(page);
  await page.goto('./#/wallet');
  await page.getByRole('button', { name: 'Drain All Funds' }).click();
  await page.getByRole('button', { name: 'Confirm Drain' }).click();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await setReads(page, { 'tollgate.wallet_info': 'reject' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Wallet balance unavailable');
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expect(page.locator('input[readonly]')).toHaveValue('cashuAeyJ0b2tlbiI6Im1vY2sifQ');
});

test('Devices clears stale clients when both read paths fail and can retry', async ({ page }) => {
  await reads(page);
  await page.clock.install();
  await page.goto('./#/devices');
  await expect(page.getByText('iPhone-15-Pro', { exact: true })).toBeVisible();
  await setReads(page, { 'file.read': 'reject', 'dhcp.ipv4leases': 'reject' });
  await page.clock.fastForward(10000);
  await expect(page.getByRole('alert')).toContainText('Device list unavailable');
  await expect(page.getByText('iPhone-15-Pro', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No connected devices found', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 connected', { exact: true })).toHaveCount(0);
  await setReads(page, {});
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('iPhone-15-Pro', { exact: true })).toBeVisible();
});

test('Devices treats malformed reads as unavailable rather than an empty list', async ({ page }) => {
  await reads(page, { 'file.read': 'malformed', 'dhcp.ipv4leases': 'malformed' });
  await page.goto('./#/devices');
  await expect(page.getByRole('alert')).toContainText('Device list unavailable');
  await expect(page.getByText('No connected devices found', { exact: true })).toHaveCount(0);
});

test('a valid empty leases file remains a confirmed empty device list', async ({ page }) => {
  await reads(page, { 'file.read': 'empty-file', 'dhcp.ipv4leases': 'reject' });
  await page.goto('./#/devices');
  await expect(page.getByText('No connected devices found', { exact: true })).toBeVisible();
  await expect(page.getByText('0 connected', { exact: true })).toBeVisible();
});

test('Devices can confirm an empty list through its fallback', async ({ page }) => {
  await reads(page, { 'file.read': 'reject', 'dhcp.ipv4leases': 'empty-leases' });
  await page.goto('./#/devices');
  await expect(page.getByText('No connected devices found', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
