import { test, expect } from '@playwright/test';

const PEERING = './?mockCredentialState=set#/peering';

test.describe('admin board: peering', () => {
  test('renders current peer, SAT session, nearby peers and known peers', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(PEERING);
    await expect(page.getByRole('heading', { name: 'Cobrador Island' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Operators meet, peer, and stack SATs.')).toBeVisible();
    await expect(page.locator('.card-title').filter({ hasText: /^Current peer$/ })).toBeVisible();
    await expect(page.getByText('UpstreamWiFi').first()).toBeVisible();
    await expect(page.getByText('2 sats')).toBeVisible();
    await expect(page.locator('.card-title').filter({ hasText: /^Nearby Cobradors$/ })).toBeVisible();
    await expect(page.locator('.card', { hasText: 'Nearby Cobradors' }).getByText('!TollGate-AB12')).toBeVisible();
    await expect(page.locator('.card-title').filter({ hasText: /^Known peers$/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('peers with a TollGate and toggles discovery + SAT stacking', async ({ page }) => {
    await page.goto(PEERING);
    await page.waitForSelector('.card-title', { timeout: 30000 });

    const peerCard = page.locator('.peer-row', { hasText: '!TollGate-CD34' }).first();
    await peerCard.getByRole('button', { name: 'Peer with this gateway' }).click();
    await peerCard.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Peered with !TollGate-CD34')).toBeVisible();

    const toggles = page.locator('.toggle-row input');
    await expect(toggles.nth(0)).toBeChecked();
    await expect(toggles.nth(1)).toBeChecked();
    await toggles.nth(0).click();
    await toggles.nth(1).click();

    const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.config_set') || '[]'));
    expect(calls.some((c) => c.key === 'upstream_wifi.vendor_ie_discovery')).toBe(true);
    expect(calls.some((c) => c.key === 'reseller_mode')).toBe(true);
  });

  test('stop peering asks for fallback confirmation', async ({ page }) => {
    await page.goto(PEERING);
    await page.getByRole('button', { name: 'Stop peering' }).click({ timeout: 30000 });
    await expect(page.getByText(/best known non-TollGate upstream/)).toBeVisible();
    await page.getByRole('button', { name: 'Stop and fall back' }).click();
    await expect(page.getByText(/Stopped peering/)).toBeVisible();
  });

  test('lists other upstream networks strongest-signal first', async ({ page }) => {
    await page.goto(PEERING);
    await page.waitForSelector('.card-title', { timeout: 30000 });

    const other = page.locator('.card', { hasText: 'Other upstream WiFi' });
    const rows = other.locator('.peer-row');
    await expect(rows).toHaveCount(3, { timeout: 15000 });
    await expect(rows.nth(0).locator('.scan-item-ssid')).toHaveText('UpstreamWiFi');
    await expect(rows.nth(1).locator('.scan-item-ssid')).toHaveText('NeighborNet');
    await expect(rows.nth(2).locator('.scan-item-ssid')).toHaveText('OpenNet');
    // -45 = Excellent, -72 / -80 = Weak (see signalQuality in peering.tsx).
    await expect(rows.nth(0).locator('.signal-strength')).toHaveText('Excellent');
    await expect(rows.nth(1).locator('.signal-strength')).toHaveText('Weak');
    await expect(rows.nth(2).locator('.signal-strength')).toHaveText('Weak');
  });

  test('connects to an open scanned network via upstream_connect', async ({ page }) => {
    await page.goto(PEERING);
    await page.waitForSelector('.card-title', { timeout: 30000 });

    const other = page.locator('.card', { hasText: 'Other upstream WiFi' });
    const openRow = other.locator('.peer-row', { hasText: 'OpenNet' });
    await expect(openRow).toBeVisible({ timeout: 15000 });
    // First click expands the inline connect form; the second submits it.
    await openRow.getByRole('button', { name: 'Use as upstream' }).click();
    await openRow.getByRole('button', { name: 'Connect' }).click();

    await expect(page.getByText("Peered with OpenNet")).toBeVisible({
      timeout: 15000,
    });
  });
});
