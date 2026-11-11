import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const scannerUrl = '/@fs' + createRequire(import.meta.url).resolve('qr-scanner/qr-scanner.min.js');

// The print assertions inspect the ACTUAL Chromium PDF, which needs Poppler.
// Probe once and SKIP only the tests that need it: a missing prerequisite must
// never read as a product failure ("spawnSync pdfinfo ENOENT") and must never be
// counted as a pass. The 7 non-print tests still run.
function popplerMissing() {
  return ['pdfinfo', 'pdftotext', 'pdftoppm'].filter(tool => {
    try { execFileSync(tool, ['-v'], { stdio: 'ignore' }); return false; }
    catch (err) { return err.code === 'ENOENT'; }
  });
}
const MISSING_POPPLER = popplerMissing();
const NEED_POPPLER = MISSING_POPPLER.length
  ? `Print verification needs Poppler (missing: ${MISSING_POPPLER.join(', ')}); ` +
    'install poppler-utils (Debian/Ubuntu) or poppler (Homebrew). These assertions ' +
    'decode the rendered PDF, so they cannot run without it.'
  : '';
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
test('print media without a prepared card prints the page normally', async ({ page }) => {
  await page.goto('./#/wifi');
  await expect(page.getByRole('button', { name: 'Prepare guest card' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  // The print stylesheet must take over ONLY while a card is rendered; otherwise
  // a plain Ctrl+P on any other route would print a blank page.
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.app-header')).not.toHaveCSS('display', 'none');
  await page.emulateMedia({ media: 'screen' });
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
  test.skip(MISSING_POPPLER.length > 0, NEED_POPPLER);
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
for (const format of ['A4', 'Letter']) test(`Unicode card prints one ${format} page`, async ({ page }, testInfo) => {
  test.skip(MISSING_POPPLER.length > 0, NEED_POPPLER);
  await page.addInitScript(() => sessionStorage.setItem('tg.mock.guest_wifi', JSON.stringify({ '.type':'wifi-iface',mode:'ap',network:'lan',ssid:'Café;餐厅',encryption:'psk2',key:'guest;password',hidden:'1' })));
  await page.goto('./#/wifi');
  await page.getByRole('button', {name:'Prepare guest card'}).click();
  const image = page.getByAltText('Scan to join guest Wi-Fi');
  await expect(image).toBeVisible();
  const expected = await image.evaluate(async (img, url) => (await import(url)).default.scanImage(img, {returnDetailedScanResult:true}), scannerUrl);
  expect(expected.data).toBe('WIFI:T:WPA;S:Café\\;餐厅;P:guest\\;password;H:true;;');
  await page.evaluate(() => {
    document.body.append('OUTSIDE-SENTINEL');
    document.querySelector('.guest-wifi-controls').prepend('CONTROL-SENTINEL');
  });
  await page.emulateMedia({media:'print'});
  const pdf = testInfo.outputPath(`card-${format}.pdf`);
  await page.pdf({path:pdf, format, printBackground:true});
  const info = execFileSync('pdfinfo', [pdf], {encoding:'utf8'});
  expect(info).toMatch(/Pages:\s+1\b/);
  const dimensions = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/).slice(1).map(Number);
  const target = format === 'A4' ? [595.28, 841.89] : [612, 792];
  dimensions.forEach((n, i) => expect(Math.abs(n - target[i])).toBeLessThan(1));
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], {encoding:'utf8'});
  expect(text).toContain('Guest Wi-Fi');
  expect(text).toContain('Joining Wi-Fi does not include paid internet access.');
  expect(text).not.toMatch(/SENTINEL|Guest radio|Prepare guest card|Refresh|Save|Printing publishes/);
  const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], {encoding:'utf8'});
  for (const match of bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)) {
    const [x1,y1,x2,y2] = match.slice(1).map(Number);
    expect(x1).toBeGreaterThanOrEqual(20); expect(y1).toBeGreaterThanOrEqual(20);
    expect(x2).toBeLessThan(dimensions[0]-20); expect(y2).toBeLessThan(dimensions[1]-20);
  }
  const raster = testInfo.outputPath(`card-${format}`);
  execFileSync('pdftoppm', ['-singlefile','-scale-to','1800','-png',pdf,raster]);
  const printedImage = 'data:image/png;base64,' + readFileSync(raster+'.png').toString('base64');
  const printed = await page.evaluate(async ({scannerUrl,printedImage}) => (await import(scannerUrl)).default.scanImage(printedImage,{returnDetailedScanResult:true}), {scannerUrl,printedImage});
  expect(printed.data).toBe(expected.data);
  const qr = await image.boundingBox();
  expect(qr.width).toBeGreaterThanOrEqual(260); expect(qr.width).toBeLessThanOrEqual(340);
});
test('rendered QR keeps a 4-module quiet zone on every side', async ({ page }) => {
  await page.goto('./#/wifi');
  await page.getByRole('button', { name: 'Prepare guest card' }).click();
  const image = page.getByAltText('Scan to join guest Wi-Fi');
  await expect(image).toBeVisible();
  // Measure the QUIET ZONE from rendered PIXELS, not from encoder options and not
  // from SVG path text (the module path uses relative deltas, so its numbers are
  // not coordinates). A decoder can still succeed with a thin margin, so QR width
  // alone proves nothing. Scale: the SVG viewBox is modules + 2*margin, rendered
  // into `width`, so one module is width/viewBoxSize pixels.
  const zone = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="Scan to join guest Wi-Fi"]');
    const svg = decodeURIComponent(img.src.split(',').slice(1).join(','));
    const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (!vb) throw new Error('QR SVG has no viewBox');
    const viewBox = Number(vb[1]);
    // A QR is square, but do not ASSUME it: a non-square viewBox would mean the
    // per-axis module size differs and the margin math below would be wrong.
    if (Number(vb[2]) !== viewBox) throw new Error(`QR viewBox is not square: ${vb[1]}x${vb[2]}`);
    const px = await new Promise((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve(probe);
      probe.onerror = reject;
      probe.src = img.src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = px.naturalWidth; canvas.height = px.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(px, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Any non-white pixel belongs to a module (the QR is black on white).
        if (data[(y * width + x) * 4] < 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error('QR rendered no dark modules');
    return {
      modulePx: width / viewBox,
      left: minX, top: minY, right: width - 1 - maxX, bottom: height - 1 - maxY,
    };
  });
  // Require >= 4 modules of blank space on all four sides. Allow 1px of rounding.
  const minimum = 4 * zone.modulePx - 1;
  expect(zone.modulePx).toBeGreaterThan(1);
  expect(zone.left).toBeGreaterThanOrEqual(minimum);
  expect(zone.top).toBeGreaterThanOrEqual(minimum);
  expect(zone.right).toBeGreaterThanOrEqual(minimum);
  expect(zone.bottom).toBeGreaterThanOrEqual(minimum);
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
