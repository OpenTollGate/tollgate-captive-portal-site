import { test, expect } from '@playwright/test';

// Operator-facing admin board features, driven through the real Preact app with
// the mock ubus layer (VITE_MOCK=true). The mock mirrors tollgate --json CLI
// response shapes and the rpcd ACL in openwrt/rpcd/tollgate_acl.json.
//
// Surface coverage:
//   - Wallet   : tollgate.wallet_info / wallet_fund / wallet_drain_cashu
//   - WiFi     : network.wireless status + tollgate.upstream_scan / _list / _connect
test.describe('admin wallet', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('./');
    await page.waitForSelector('.app-header', { timeout: 30000 });
    await page.locator('.nav-item', { hasText: 'Wallet' }).click();
    await page.waitForSelector('.card-title', { timeout: 15000 });
  });

  test('renders mint balance from wallet_info', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible();
    await expect(page.locator('.card-title', { hasText: 'Balance' })).toBeVisible();
    await expect(page.getByText('14,250 sats').first()).toBeVisible();
    await expect(
      page.getByText('https://testnut-compat.mints.orangesync.tech'),
    ).toBeVisible();
  });

  test('fund button is gated on a cashu token and reports the funded amount', async ({
    page,
  }) => {
    const fund = page.getByRole('button', { name: 'Fund', exact: true });
    await expect(fund).toBeDisabled();

    await page
      .getByPlaceholder('Paste Cashu token (cashuA…)')
      .fill('cashuAeyJ0b2tlbiI6W3siYW1vdW50IjoxMDB9XX0');
    await expect(fund).toBeEnabled();
    await fund.click();

    await expect(page.getByText('Funded with 100 sats')).toBeVisible({
      timeout: 15000,
    });
  });

  test('drain requires confirmation and returns Cashu tokens', async ({ page }) => {
    await page.getByRole('button', { name: 'Drain All Funds' }).click();
    await page.getByRole('button', { name: 'Confirm Drain' }).click();

    await expect(
      page.getByText('Drained 14250 sats from 1 mint(s)'),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  });
});

test.describe('admin wifi scanning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForSelector('.app-header', { timeout: 30000 });
    await page.locator('.nav-item', { hasText: 'WiFi' }).click();
    await page.waitForSelector('.card-title', { timeout: 15000 });
  });

  test('lists wireless radios and their SSIDs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'WiFi' })).toBeVisible();
    await expect(page.locator('.card-title', { hasText: 'radio0' })).toBeVisible();
    await expect(page.locator('.card-title', { hasText: 'radio1' })).toBeVisible();
    await expect(page.getByText('tollgate', { exact: true })).toBeVisible();
    await expect(page.getByText('tollgate-5g', { exact: true })).toBeVisible();
  });

  test('renders upstream_scan results strongest-signal first', async ({ page }) => {
    const ssids = page.locator('.scan-item .scan-item-ssid');
    await expect(ssids).toHaveCount(3, { timeout: 15000 });
    const rows = page.locator('.scan-item');
    await expect(rows.nth(0).locator('.scan-item-ssid')).toHaveText('UpstreamWiFi');
    await expect(rows.nth(1).locator('.scan-item-ssid')).toHaveText('NeighborNet');
    await expect(rows.nth(2).locator('.scan-item-ssid')).toHaveText('OpenNet');
    // -45 = Excellent, -72 / -80 = Weak (see signalQuality in src/routes/wifi.tsx).
    await expect(rows.nth(0).locator('.signal-strength')).toHaveText('Excellent');
    await expect(rows.nth(1).locator('.signal-strength')).toHaveText('Weak');
    await expect(rows.nth(2).locator('.signal-strength')).toHaveText('Weak');
  });

  test('shows the connected upstream from upstream_list', async ({ page }) => {
    const upstream = page.locator('.upstream-item');
    await expect(upstream).toHaveCount(1, { timeout: 15000 });
    await expect(upstream.locator('.scan-item-ssid')).toHaveText('UpstreamWiFi');
    await expect(upstream.getByText('ACTIVE')).toBeVisible();
  });

  test('connects to an open scanned network via upstream_connect', async ({ page }) => {
    const openRow = page.locator('.scan-item', { hasText: 'OpenNet' });
    await expect(openRow).toBeVisible({ timeout: 15000 });
    // First click expands the inline connect form; the second submits it.
    await openRow.getByRole('button', { name: 'Connect' }).click();
    await openRow.getByRole('button', { name: 'Connect' }).click();

    await expect(page.getByText('Connected successfully')).toBeVisible({
      timeout: 15000,
    });
  });
});
