import { test, expect } from '@playwright/test';

const card = page => page.getByTestId('internet-policy');
const internet = page => page.getByTestId('internet-connection');
const writes = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.mock.policy_writes') || '[]'));
async function open(page, mode = 'ethernet') {
  await page.goto(`./?mockInternet=wifi&mockPolicy=${mode}#/wifi`);
  await expect(card(page)).toBeVisible();
}

test('the applied Ethernet policy wins over the main Wi-Fi route observation', async ({ page }) => {
  await open(page);
  await expect(card(page)).toContainText('Preferred: Ethernet WAN');
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  await expect(card(page).getByTestId('policy-v4-backup')).toContainText('Ready');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Ethernet');
  expect(await writes(page)).toEqual([]);
});

test('failed Ethernet internet uses healthy venue Wi-Fi and explains fallback', async ({ page }) => {
  await open(page, 'wifi');
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Venue Wi-Fi');
  await expect(card(page).getByTestId('policy-v4-primary')).toContainText('Internet check failed');
  await expect(card(page)).toContainText('Using backup Wi-Fi');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Wi-Fi · UpstreamWiFi');
});

test('a carrier alone does not make backup ready when its bound HTTP check fails', async ({ page }) => {
  await open(page, 'backup-blocked');
  await expect(internet(page)).toContainText('Internet working');
  await expect(card(page).getByTestId('policy-v4-backup')).toContainText('Sign-in or blocked response');
  await expect(card(page).getByTestId('policy-v4-backup')).not.toContainText('Ready');
});

test('venue backup preparation explains the separate sign-in path without sending changes', async ({ page }) => {
  await open(page, 'backup-blocked');
  await card(page).getByText('Prepare Wi-Fi backup at a venue', { exact: true }).click();
  const help = card(page).locator('details');
  await expect(help).toContainText('disable automatic fallback and unplug the WAN cable');
  await expect(help).toContainText('using TollGate’s private Wi-Fi or management LAN for internet');
  await expect(help).toContainText('Reconnect the WAN cable');
  await expect(help).toContainText('working Ethernet does not sign in the Wi-Fi backup');
  expect(await writes(page)).toEqual([]);
});

test('checking and unavailable backup states never inherit the primary internet success', async ({ page }) => {
  await open(page, 'checking');
  await expect(card(page).getByTestId('policy-v4-backup')).toContainText('Checking');
  await expect(card(page).getByTestId('policy-v4-backup')).not.toContainText('Ready');
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=backup-unknown#/wifi'));
  await card(page).getByRole('button', { name: 'Refresh fallback status' }).click();
  await expect(card(page).getByTestId('policy-v4-backup')).toContainText('Unavailable');
});

test('IPv4 and IPv6 differences stay explicit rather than inventing a single source', async ({ page }) => {
  await open(page, 'split');
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  await expect(card(page).getByTestId('policy-ipv6-active')).toHaveText('Venue Wi-Fi');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Multiple uplinks');
});

test('the checked Ethernet-only IPv6 policy explains that Wi-Fi fallback uses IPv4', async ({ page }) => {
  await open(page, 'ipv4-backup');
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Venue Wi-Fi');
  await expect(card(page).getByTestId('policy-ipv6-active')).toHaveText('No healthy uplink');
  await expect(card(page).getByTestId('policy-v6-backup')).toContainText('Uses IPv4 backup');
  await expect(card(page)).toContainText('Wi-Fi fallback uses IPv4. IPv6 stays on checked Ethernet, or is unavailable.');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Wi-Fi · UpstreamWiFi (IPv4)');
});

test('a stopped engine cannot claim an applied path or ready backup', async ({ page }) => {
  await open(page, 'stopped');
  await expect(card(page)).toContainText('Fallback checks are not running');
  await expect(card(page)).toContainText('Disable automatic fallback, then review enabling it again');
  await expect(page.getByRole('button', { name: 'Resume automatic fallback', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disable automatic fallback', exact: true })).toBeEnabled();
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Not confirmed');
  await expect(card(page).getByTestId('policy-v4-backup')).not.toContainText('Ready');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Source not confirmed');
});

test('a successful status read preserves a router-reported profile issue and measured facts', async ({ page }) => {
  await open(page, 'profile-issue');
  await expect(card(page).getByRole('alert')).toContainText('Profile changed outside TollGate');
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  expect(await writes(page)).toEqual([]);
});

test('unsupported profile drift shows the actual recovery issue instead of an install instruction', async ({ page }) => {
  await open(page, 'unsupported-issue');
  await expect(card(page).getByRole('alert')).toContainText('Previous change is unconfirmed');
  await expect(card(page)).not.toContainText('Install the supported fallback engine');
  await expect(page.getByRole('button', { name: 'Enable automatic fallback', exact: true })).toBeDisabled();
  expect(await writes(page)).toEqual([]);
});

test('enabling requires review, cancellation is inert, and double confirmation sends one write', async ({ page }) => {
  await open(page, 'disabled');
  await page.getByRole('button', { name: 'Enable automatic fallback', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('public IP');
  await expect(page.getByRole('dialog')).toContainText('paid-session accounting');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button', { name: 'Enable automatic fallback', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm enable', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(card(page).getByRole('status')).toContainText('Automatic fallback enabled');
  expect(await writes(page)).toEqual([{ enabled: true }]);
});

test('disabling is separately reviewed and preserves no automatic retry', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Disable automatic fallback', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('previous connection priorities');
  await page.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await expect(card(page).getByRole('status')).toContainText('Automatic fallback disabled');
  expect(await writes(page)).toEqual([{ enabled: false }]);
});

test('an uncertain policy write blocks another until an explicit status refresh', async ({ page }) => {
  await open(page, 'uncertain');
  await page.getByRole('button', { name: 'Enable automatic fallback', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm enable', exact: true }).click();
  await expect(card(page).getByRole('alert')).toContainText('outcome is not confirmed');
  await expect(page.getByRole('button', { name: 'Enable automatic fallback', exact: true })).toBeDisabled();
  expect(await writes(page)).toEqual([{ enabled: true }]);
  await card(page).getByRole('button', { name: 'Refresh fallback status' }).click();
  await expect(page.getByRole('button', { name: 'Enable automatic fallback', exact: true })).toBeEnabled();
  expect(await writes(page)).toEqual([{ enabled: true }]);
});

test('a changed setting aborts before writing and requires a fresh review', async ({ page }) => {
  await open(page, 'conflict');
  await page.getByRole('button', { name: 'Enable automatic fallback', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm enable', exact: true }).click();
  await expect(card(page).getByRole('alert')).toContainText('changed elsewhere');
  expect(await writes(page)).toEqual([]);
});

test('a failed policy read clears an earlier claimed source', async ({ page }) => {
  await open(page);
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=unavailable#/wifi'));
  await card(page).getByRole('button', { name: 'Refresh fallback status' }).click();
  await expect(card(page)).toContainText('Fallback status unavailable');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Source not confirmed');
});

test('automatic refresh follows a real policy transition without sending mutations', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=wifi#/wifi'));
  await page.clock.fastForward(10000);
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Venue Wi-Fi');
  expect(await writes(page)).toEqual([]);
});

test('a slow read is not continually invalidated by the automatic refresh interval', async ({ page }) => {
  await page.clock.install();
  await page.goto('./?mockInternet=wifi&mockPolicy=ethernet&mockPolicyDelay=15000#/wifi');
  await expect(card(page)).toContainText('Checking fallback status');
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('tg.mock.policy_requests') || '0'))).toBe(1);
  await page.clock.fastForward(10000);
  await page.clock.fastForward(5000);
  await expect(card(page).getByTestId('policy-ipv4-active')).toHaveText('Ethernet WAN');
  expect(await writes(page)).toEqual([]);
});

test('a policy read timeout clears earlier readiness and source claims', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await expect(card(page).getByTestId('policy-v4-backup')).toContainText('Ready');
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=ethernet&mockPolicyDelay=25000#/wifi'));
  await card(page).getByRole('button', { name: 'Refresh fallback status' }).click();
  await page.clock.fastForward(20000);
  await expect(card(page)).toContainText('Fallback status unavailable');
  await expect(internet(page).locator('.stat-row').first()).toContainText('Source not confirmed');
});

test('leaving during the fresh preflight read cancels an unsent policy mutation', async ({ page }) => {
  await page.clock.install();
  await open(page, 'disabled');
  await page.getByRole('button', { name: 'Enable automatic fallback', exact: true }).click();
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=disabled&mockPolicyDelay=15000#/wifi'));
  await page.getByRole('button', { name: 'Confirm enable', exact: true }).click();
  await page.locator('.nav-item', { hasText: 'Settings' }).click();
  await expect(page.getByTestId('profit-share-editor')).toBeVisible();
  await page.clock.fastForward(15000);
  expect(await writes(page)).toEqual([]);
});

test('a review retains its original setting when a background refresh observes another admin change', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Disable automatic fallback', exact: true }).click();
  await page.evaluate(() => history.replaceState(null, '', '?mockInternet=wifi&mockPolicy=disabled#/wifi'));
  await page.clock.fastForward(10000);
  await page.getByRole('button', { name: 'Confirm disable', exact: true }).click();
  await expect(card(page).getByRole('alert')).toContainText('changed elsewhere');
  expect(await writes(page)).toEqual([]);
});

test('older plugins explain missing support and the policy card fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'old-plugin');
  await expect(card(page)).toContainText('Update the management plugin');
  await expect(page.getByRole('button', { name: 'Enable automatic fallback', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
