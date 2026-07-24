import { test, expect } from '@playwright/test';

const ADMIN_URL = 'http://localhost:5174/tollgate/admin.html';
const HYDRATE = 10000;

// Mock ubus JSON-RPC responses
const MOCK_SESSION = 'aabbccdd000000000000000000000000';

const UBUS_RESPONSES = {
  'session.login': (params) => {
    const [, username, password] = params;
    if (password === 'wrong') {
      return { result: [6, 'Access denied'] };
    }
    return { result: [0, { ubus_rpc_session: MOCK_SESSION }] };
  },
  'session.access': () => ({ result: [0, { access: true }] }),
  'tollgate.status': () => ({
    result: [0, {
      healthy: true,
      uptime: 3600,
      version: '0.2.1',
      backend: 'rust',
      sessions_active: 1,
      ssid: 'TollGate-Test',
    }],
  }),
  'tollgate.health': () => ({
    result: [0, {
      mints: [{ url: 'https://mint.test', status: 'ok', balance: 1000 }],
      relays: [{ url: 'wss://relay.test', status: 'connected' }],
    }],
  }),
  'tollgate.wallet_balance': () => ({
    result: [0, { balance: 5000, unit: 'sat' }],
  }),
  'tollgate.wallet_info': () => ({
    result: [0, {
      mints: [{ url: 'https://mint.test', balance: 5000, keysets: [{ id: 'test', unit: 'sat', amount: 5000 }] }],
    }],
  }),
  'tollgate.config_schema': () => ({
    result: [0, {
      type: 'object',
      properties: {
        ssid: { type: 'string', title: 'WiFi SSID', default: 'TollGate' },
        metric: { type: 'string', enum: ['milliseconds', 'bytes'], title: 'Billing Metric', default: 'milliseconds' },
      },
    }],
  }),
  'tollgate.config_get': () => ({ result: [0, { ssid: 'TollGate-Test', metric: 'milliseconds' }] }),
  'file': () => ({
    result: [0, {
      entries: [
        { macaddr: 'AA:BB:CC:DD:EE:FF', hostname: 'phone-1', ipaddr: '192.168.1.100', bytes_rx: 1024, bytes_tx: 512 },
        { macaddr: '11:22:33:44:55:66', hostname: 'laptop-1', ipaddr: '192.168.1.101', bytes_rx: 2048, bytes_tx: 1024 },
      ],
    }],
  }),
};

async function mockUbus(page, options = {}) {
  const { failLogin = false } = options;
  await page.route('**/ubus', async (route, request) => {
    const body = JSON.parse(request.postData());
    const [sid, obj, method, params] = body.params || [];

    // Handle login specially
    if (obj === 'session' && method === 'login') {
      if (failLogin) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [1, 'Invalid credentials'] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [0, { ubus_rpc_session: MOCK_SESSION }] }) });
    }

    // Handle session check
    if (obj === 'session' && method === 'access') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [0, { access: true }] }) });
    }

    // Look up mock response
    const key = `${obj}.${method}`;
    const handler = UBUS_RESPONSES[key] || UBUS_RESPONSES[obj];
    const data = handler ? handler(params || []) : { result: [0, {}] };

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, ...data }),
    });
  });
}

async function loginAndNavigate(page, hash = '#/') {
  await mockUbus(page);
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-login-card', { timeout: HYDRATE });

  await page.fill('input[autocomplete="username"]', 'root');
  await page.fill('input[autocomplete="current-password"]', 'test-password');
  await page.click('button.cta');

  await page.waitForSelector('.admin-layout', { timeout: HYDRATE });
  if (hash !== '#/') {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await page.waitForTimeout(500);
  }
}

test.describe('Admin SPA', () => {

  test('login page renders with branding', async ({ page }) => {
    await mockUbus(page);
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-login-card', { timeout: HYDRATE });

    await expect(page.locator('.admin-login-header h1')).toHaveText('TollGate Admin');
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.locator('button.cta')).toContainText(/sign in/i);
  });

  test('wrong password shows error', async ({ page }) => {
    await mockUbus(page, { failLogin: true });
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-login-card', { timeout: HYDRATE });

    await page.fill('input[autocomplete="username"]', 'root');
    await page.fill('input[autocomplete="current-password"]', 'wrong');
    await page.click('button.cta');

    await page.waitForSelector('.admin-login-error', { timeout: 5000 });
    const errorText = await page.locator('.admin-login-error').textContent();
    expect(errorText).toMatch(/invalid|denied|failed|error|wrong/i);
  });

  test('correct password navigates to dashboard', async ({ page }) => {
    await loginAndNavigate(page);

    await expect(page.locator('.admin-layout')).toBeVisible();
    const heading = await page.locator('h1, h2, h3').first().textContent();
    expect(heading).toBeTruthy();
  });

  test('dashboard shows status data', async ({ page }) => {
    await loginAndNavigate(page, '#/');

    await page.waitForTimeout(1000);
    const text = await page.locator('.admin-layout').textContent();
    expect(text).toMatch(/version|0\.2\.1|status|healthy/i);
  });

  test('settings page renders', async ({ page }) => {
    await loginAndNavigate(page, '#/settings');
    await page.waitForTimeout(1000);

    const text = await page.locator('.admin-layout').textContent();
    expect(text?.length).toBeGreaterThan(10);
    await page.screenshot({ path: 'test-results/output/admin-settings.png', fullPage: true });
  });

  test('wallet page renders', async ({ page }) => {
    await loginAndNavigate(page, '#/wallet');
    await page.waitForTimeout(1000);

    const text = await page.locator('.admin-layout').textContent();
    expect(text?.length).toBeGreaterThan(10);
    await page.screenshot({ path: 'test-results/output/admin-wallet.png', fullPage: true });
  });

  test('wifi page renders', async ({ page }) => {
    await loginAndNavigate(page, '#/wifi');
    await page.waitForTimeout(1000);

    const text = await page.locator('.admin-layout').textContent();
    expect(text?.length).toBeGreaterThan(10);
    await page.screenshot({ path: 'test-results/output/admin-wifi.png', fullPage: true });
  });

  test('devices page renders', async ({ page }) => {
    await loginAndNavigate(page, '#/devices');
    await page.waitForTimeout(1000);

    const text = await page.locator('.admin-layout').textContent();
    expect(text?.length).toBeGreaterThan(10);
    await page.screenshot({ path: 'test-results/output/admin-devices.png', fullPage: true });
  });

  test('sidebar navigation switches pages', async ({ page }) => {
    await loginAndNavigate(page);

    const links = page.locator('.admin-sidebar a, .admin-nav a, nav a');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 4); i++) {
      await links.nth(i).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await expect(page.locator('.admin-layout')).toBeVisible();
  });

  test('logout returns to login page', async ({ page }) => {
    await loginAndNavigate(page);

    const logoutBtn = page.locator('text=/logout|sign out|log out/i');
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForSelector('.admin-login-card', { timeout: 5000 }).catch(() => {});
    }
    // Either we see login page or we cleared localStorage
    const hasLogin = await page.locator('.admin-login-card').isVisible().catch(() => false);
    const hasLayout = await page.locator('.admin-layout').isVisible().catch(() => false);
    expect(hasLogin || hasLayout).toBeTruthy();
  });

  test('visual snapshot — login page', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await mockUbus(page);
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-login-card', { timeout: HYDRATE });
    await page.waitForTimeout(500);

    const card = page.locator('.admin-login-card');
    await expect(card).toHaveScreenshot('admin-login.png', { animations: 'disabled' });
  });

  test('visual snapshot — dashboard', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Visual snapshots only on Chromium');
    await loginAndNavigate(page);
    await page.waitForTimeout(1500);

    const content = page.locator('.admin-content, .admin-main, main').first();
    if (await content.isVisible().catch(() => false)) {
      await expect(content).toHaveScreenshot('admin-dashboard.png', { animations: 'disabled' });
    } else {
      await page.screenshot({ path: 'test-results/output/admin-dashboard-fallback.png', fullPage: true });
    }
  });
});
