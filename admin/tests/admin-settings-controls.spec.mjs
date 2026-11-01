import { test, expect } from '@playwright/test';

// Intercept the existing mock boundary in the served module. Production code
// needs no test hooks, and these scenarios never contact a router.
async function openSettings(page, scenario = '') {
  await page.addInitScript(({ scenario }) => {
    window.settingsCalls = [];
    window.settingsScenario = scenario;
    window.settingsConfigReads = 0;
    window.settingsHostname = 'tollgate-gw1';
    window.__settingsRpc = async (object, method, params, base) => {
      const key = `${object}.${method}`;
      if (key === 'system.password_set') {
        window.settingsCalls.push({ key, username: params.username, length: params.password.length });
        await new Promise(resolve => setTimeout(resolve, 150));
        return {};
      }
      if (object === 'uci' && params.config === 'system') {
        window.settingsCalls.push({ key, section: params.section, values: params.values });
        if (method === 'get') return { values: { cfg000001: { '.type': 'system', '.name': 'cfg000001', hostname: window.settingsHostname } } };
        if (method === 'set') window.settingsHostname = params.values.hostname;
        return {};
      }
      if (key === 'tollgate.config_schema' && window.settingsScenario === 'schema-unavailable') throw new Error('Schema unavailable');
      if (key === 'tollgate.config_schema' && window.settingsScenario === 'legacy-minimum') {
        const result = structuredClone(await base(object, method, params));
        const mint = result.data.config.find(field => field.json_key === 'accepted_mints');
        mint.children = mint.children.filter(field => field.json_key !== 'purchase_min_steps');
        mint.children.push({ name: 'PurchaseMinSteps', json_key: 'purchase_min_steps', type: 'uint64', required: true, editable: true, min: 1 });
        return result;
      }
      if (key === 'tollgate.config_schema' && window.settingsScenario === 'nested-secret') {
        const result = structuredClone(await base(object, method, params));
        result.data.config.push({ name: 'Bonding', json_key: 'test_bonding', type: 'object', editable: true, children: [
          { name: 'Password', description: 'Bonding password', json_key: 'password', type: 'string', secret: true, required: false, editable: true },
        ] });
        return result;
      }
      if (key === 'tollgate.config_get') {
        window.settingsConfigReads++;
        if (window.settingsScenario === 'config-unavailable') return { success: false, error: 'Configuration unavailable' };
        const result = structuredClone(await base(object, method, params));
        if (window.settingsScenario === 'nested-secret') {
          result.data.config.test_bonding = { password: '' };
          result.data.secret_set['test_bonding.password'] = true;
        }
        if (window.settingsScenario === 'stale-mints' && window.settingsConfigReads > 2) result.data.config.accepted_mints[0].price_per_step = 99;
        return result;
      }
      if (key === 'tollgate.config_set' || key === 'tollgate.config_save') {
        const entry = { key, configKey: params.key };
        if (key === 'tollgate.config_save' && window.settingsScenario === 'nested-secret') entry.hasBondingSecret = !!JSON.parse(params.json).test_bonding?.password;
        window.settingsCalls.push(entry);
      }
      return base(object, method, params);
    };
  }, { scenario });
  await page.route('**/src/lib/ubus.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const original = 'return mockUbusCall(obj, method, params);';
    expect(body).toContain(original);
    await route.fulfill({ response, body: body.replace(original, 'return window.__settingsRpc(obj, method, params, mockUbusCall);') });
  });
  await page.goto('./?mockCredentialState=set#/settings');
}

const calls = page => page.evaluate(() => window.settingsCalls.filter(call => call.key !== 'uci.get'));

for (const scenario of ['schema-unavailable', 'config-unavailable']) {
  test(`${scenario} blocks editing and offers retry`, async ({ page }) => {
    await openSettings(page, scenario);
    await expect(page.getByRole('alert')).toContainText(/settings|configuration|schema/i);
    await expect(page.getByRole('button', { name: 'Save All Changes' })).toHaveCount(0);
    await page.evaluate(() => { window.settingsScenario = ''; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('#field-log_level')).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });
}

test('password changes enforce the shared policy and submit root once', async ({ page }) => {
  await openSettings(page);
  const password = page.getByLabel('New Password', { exact: true });
  const confirmation = page.getByLabel('Confirm Password', { exact: true });
  await password.fill('short');
  await confirmation.fill('short');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.getByText('Use at least 8 characters', { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await password.fill('fixture-value-123');
  await confirmation.fill('fixture-value-123');
  await page.getByRole('button', { name: 'Change', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByText(/Admin password saved/)).toBeVisible();
  expect(await calls(page)).toEqual([{ key: 'system.password_set', username: 'root', length: 17 }]);
  await expect(password).toHaveValue('');
  await expect(confirmation).toHaveValue('');
});

test('hostname saves resolve a fresh named UCI section and distinguish active state', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Hostname', { exact: true }).fill('venue-router');
  await page.getByRole('button', { name: 'Save hostname', exact: true }).click();
  await expect(page.getByText(/Hostname saved.*active hostname.*tollgate-gw1/i)).toBeVisible();
  const sent = await page.evaluate(() => window.settingsCalls);
  expect(sent.map(call => call.key)).toEqual(['uci.get', 'uci.get', 'uci.set', 'uci.commit', 'uci.get']);
  expect(sent[2]).toMatchObject({ section: 'cfg000001', values: { hostname: 'venue-router' } });
});

test('invalid schema fields never write configuration', async ({ page }) => {
  await openSettings(page);
  await page.locator('#field-margin').fill('2');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toHaveClass(/error-text/);
  expect(await calls(page)).toEqual([]);
});

test('a concurrent mint change blocks a wholesale save', async ({ page }) => {
  await openSettings(page, 'stale-mints');
  await page.getByLabel(/^Mint URL/).first().fill('https://mint.example.com');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toContainText(/changed elsewhere/i);
  expect(await calls(page)).toEqual([]);
});

test('untouched legacy mint limits do not block a valid sibling edit', async ({ page }) => {
  await openSettings(page, 'legacy-minimum');
  await page.getByLabel(/^Mint URL/).first().fill('https://mint.example.com');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toHaveClass(/success-text/);
  expect(await calls(page)).toEqual([{ key: 'tollgate.config_save' }]);
});

test('pricing describes the configured guest step and updates with drafts', async ({ page }) => {
  await openSettings(page);
  const summary = page.getByTestId('settings-pricing-summary');
  await expect(summary).toContainText('21 MiB');
  await expect(summary).toContainText('1 sats per step');
  await page.locator('#field-metric').selectOption('milliseconds');
  await page.locator('#field-step_size').fill('60000');
  await expect(summary).toContainText('60 seconds');
  expect(await calls(page)).toEqual([]);
});

test('nested secrets clear after saving and are not replayed by a later complex save', async ({ page }) => {
  await openSettings(page, 'nested-secret');
  const password = page.getByLabel('Bonding password', { exact: true });
  await password.fill('synthetic-bonding-value');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toHaveClass(/success-text/);
  await expect(password).toHaveValue('');
  await page.getByLabel(/^Mint URL/).first().fill('https://mint.example.com');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  expect((await calls(page)).map(call => call.hasBondingSecret)).toEqual([true, false]);
});

test('save results remain visible and point to Maintenance for apply timing', async ({ page }) => {
  await openSettings(page);
  await page.locator('#field-log_level').selectOption('warn');
  await page.getByRole('button', { name: 'Save All Changes' }).click();
  await expect(page.locator('#schema-message')).toContainText('log_level');
  await page.waitForTimeout(3200);
  await expect(page.locator('#schema-message')).toBeVisible();
  await expect(page.getByRole('link', { name: /Maintenance/ })).toHaveAttribute('href', '#/maintenance');
});
