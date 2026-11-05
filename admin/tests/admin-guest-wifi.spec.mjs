import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const scannerUrl = '/@fs' + createRequire(import.meta.url).resolve('qr-scanner/qr-scanner.min.js');
// Browser UI is real; RPC data is the existing synthetic mock, not router ACL proof.
for (const action of ['Refresh', 'Save']) test(`card invalidates on ${action}`, async ({ page }) => {
  await page.goto('./#/wifi');
  await page.getByRole('button', { name: 'Prepare guest card' }).click();
  const image = page.getByAltText('Scan to join guest Wi-Fi');
  await expect(image).toBeVisible();
  if (action === 'Save') {
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.locator('input[type=text]').fill('Changed Guest');
  }
  await page.evaluate(() => sessionStorage.setItem('tg.mock.guest_wifi', JSON.stringify({ '.type':'wifi-iface',mode:'ap',network:'lan',ssid:'Changed Guest',encryption:'none' })));
  await page.getByRole('button', { name: action, exact: true }).click();
  await expect(image).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Print guest card', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Prepare guest card' }).click();
  await expect(image).toBeVisible();
  const decoded = await image.evaluate(async (img, url) => (await import(url)).default.scanImage(img, {returnDetailedScanResult:true}), scannerUrl);
  expect(decoded.data).toBe('WIFI:T:nopass;S:Changed Guest;H:false;;');
});
test('Refresh discards a pending credential snapshot', async ({ page }) => {
  await page.route('**/src/lib/ubus.mock.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body.replace('export function mockUbusCall(', 'function originalMockUbusCall(') + `
export async function mockUbusCall(obj, method, params = {}) {
  const result = await originalMockUbusCall(obj, method, params);
  if (obj === 'uci' && method === 'get' && params.section === 'tollgate_2g_open' && !window.__heldGuest) {
    window.__heldGuest = true;
    await new Promise(resolve => window.__releaseGuest = resolve);
  }
  return result;
}` });
  });
  await page.goto('./#/wifi');
  await page.getByRole('button', {name:'Prepare guest card'}).click();
  await page.waitForFunction(() => !!window.__releaseGuest);
  await page.getByRole('button', {name:'Refresh',exact:true}).click();
  await page.evaluate(() => window.__releaseGuest());
  await expect(page.getByRole('button', {name:'Prepare guest card',exact:true})).toBeEnabled();
  await expect(page.getByAltText('Scan to join guest Wi-Fi')).toHaveCount(0);
});
test('guest QR roundtrip and print-only card', async ({ page }) => {
  await page.goto('./');
  await page.locator('.nav-item', { hasText: 'WiFi' }).click();
  await page.getByRole('button', { name: 'Prepare guest card' }).click();
  const image = page.getByAltText('Scan to join guest Wi-Fi');
  await expect(image).toBeVisible();
  const decoded = await image.evaluate(async (img, scannerUrl) => {
    const QrScanner = (await import(scannerUrl)).default;
    return QrScanner.scanImage(img, { returnDetailedScanResult: true });
  }, scannerUrl);
  expect(decoded.data).toBe('WIFI:T:nopass;S:Restaurant Guest;H:false;;');
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.getByRole('button', { name: 'Print guest card' }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(image).toBeVisible();
  await expect(page.locator('.app-header')).toBeHidden();
  await page.pdf({ path: 'test-results/guest-wifi-card.pdf', printBackground: true });
  // Decode the actual printed PDF, not the original on-screen SVG.
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1800', '-png', 'test-results/guest-wifi-card.pdf', 'test-results/guest-wifi-card-print']);
  const printedImage = 'data:image/png;base64,' + readFileSync('test-results/guest-wifi-card-print.png').toString('base64');
  const printed = await page.evaluate(async ({ scannerUrl, printedImage }) => {
    return (await import(scannerUrl)).default.scanImage(printedImage, { returnDetailedScanResult: true });
  }, { scannerUrl, printedImage });
  expect(printed.data).toBe(decoded.data);
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Hide guest card' }).click();
  await expect(image).toHaveCount(0);
});
test('WPA special characters decode and changing radio clears credentials', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('tg.mock.guest_wifi', JSON.stringify({ '.type':'wifi-iface', mode:'ap',network:'lan',ssid:'Café;:"',encryption:'psk2',key:'guest;password',hidden:'1' })));
  await page.goto('./#/wifi');
  await page.getByRole('button', { name:'Prepare guest card' }).click();
  const image = page.getByAltText('Scan to join guest Wi-Fi');
  await expect(image).toBeVisible();
  const decoded = await image.evaluate(async (img, scannerUrl) => (await import(scannerUrl)).default.scanImage(img, {returnDetailedScanResult:true}), scannerUrl);
  expect(decoded.data).toBe('WIFI:T:WPA;S:Café\\;\\:\\";P:guest\\;password;H:true;;');
  await page.getByLabel('Guest radio').selectOption('tollgate_5g_open');
  await expect(image).toHaveCount(0);
});
test('guest QR is inaccessible before authentication', async ({ page }) => {
  await page.goto('./?mockCredentialState=unknown#/wifi');
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare guest card' })).toHaveCount(0);
  await expect(page.getByAltText('Scan to join guest Wi-Fi')).toHaveCount(0);
});
test('session expiry removes an already prepared credential card', async ({ page }) => {
  await page.goto('./#/wifi');
  await page.getByRole('button', { name: 'Prepare guest card' }).click();
  await expect(page.getByAltText('Scan to join guest Wi-Fi')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('tollgate:session-expired')));
  await expect(page.getByAltText('Scan to join guest Wi-Fi')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare guest card' })).toHaveCount(0);
});
test('private and unsupported configuration never renders a QR', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('tg.mock.guest_wifi', JSON.stringify({ '.type':'wifi-iface',mode:'ap',network:'private',ssid:'Management',encryption:'psk2',key:'NEVER-PUBLISH' })));
  await page.goto('./#/wifi');
  await page.getByRole('button', { name:'Prepare guest card' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByAltText('Scan to join guest Wi-Fi')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('NEVER-PUBLISH');
});
