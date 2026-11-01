import { test, expect } from '@playwright/test';

// Exercise the shared renderer with supported schema shapes without depending
// on a router or enlarging the application-wide mock fixture.
async function mount(page, fields, values, secretSet = {}) {
  await page.goto('./?mockCredentialState=set#/settings');
  await page.getByTestId('profit-share-editor').waitFor();
  await page.evaluate(async ({ fields, values, secretSet }) => {
    const mainSource = await (await fetch('/src/main.tsx')).text();
    const dependencyUrl = name => mainSource.match(new RegExp('from\\s+[\"\']([^\"\']*/' + name + '\\.js[^\"\']*)[\"\']'))[1];
    const [{ h, render }, { useState }, { default: SchemaForm, validateSchemaFields }] = await Promise.all([
      import(dependencyUrl('preact')),
      import(dependencyUrl('preact_hooks')),
      import('/src/components/schema-form.tsx'),
    ]);
    const host = document.createElement('div');
    host.id = 'schema-fixture';
    document.body.replaceChildren(host);
    window.schemaFixture = { values, writes: [] };
    function Fixture() {
      const [draft, setDraft] = useState(values);
      const [message, setMessage] = useState('');
      return h('div', {}, [
        h(SchemaForm, {
          fields, values: draft, secretSet,
          onChange: (key, value) => {
            const next = { ...draft, [key]: value };
            window.schemaFixture.values = next;
            setDraft(next);
          },
        }),
        h('button', {
          onClick: () => {
            const error = validateSchemaFields(fields, draft, secretSet);
            if (error) setMessage(error);
            else { window.schemaFixture.writes.push(draft); setMessage('Saved'); }
          },
        }, 'Save fixture'),
        h('p', { role: 'status' }, message),
      ]);
    }
    render(h(Fixture, {}), host);
  }, { fields, values, secretSet });
}

const field = (json_key, type, extra = {}) => ({
  name: json_key, json_key, type, required: false, editable: true, ...extra,
});
const ignored = field('ignore_interfaces', 'array', {
  description: 'Ignored interfaces', children: [field('', 'string')],
});

test('string arrays edit strings and retain an explicit empty array', async ({ page }) => {
  await mount(page, [{ ...ignored, required: true }], { ignore_interfaces: ['lo'] });
  await expect(page.getByLabel('Ignored interfaces 1', { exact: true })).toHaveValue('lo');
  await page.getByLabel('Ignored interfaces 1', { exact: true }).fill('br-guest');
  await page.getByRole('button', { name: 'Add Ignored interfaces', exact: true }).click();
  await page.getByLabel('Ignored interfaces 2', { exact: true }).fill('tun0');
  expect(await page.evaluate(() => window.schemaFixture.values.ignore_interfaces)).toEqual(['br-guest', 'tun0']);
  await page.getByRole('button', { name: 'Remove Ignored interfaces 2', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Ignored interfaces 1', exact: true }).click();
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([{ ignore_interfaces: [] }]);
});

test('read-only containers disable descendant editing and list actions', async ({ page }) => {
  const readonly = field('mints', 'array', {
    editable: false,
    children: [field('url', 'string'), field('amount', 'uint64')],
  });
  await mount(page, [readonly, { ...ignored, editable: false }], {
    mints: [{ url: 'https://mint.example', amount: 1 }], ignore_interfaces: ['lo'],
  });
  for (const input of await page.locator('#schema-fixture input').all()) await expect(input).toBeDisabled();
  for (const button of await page.locator('#schema-fixture button').all()) {
    if (await button.textContent() !== 'Save fixture') await expect(button).toBeDisabled();
  }
});

test('nested fields have unique label targets for each row', async ({ page }) => {
  const mints = field('mints', 'array', { children: [field('url', 'string'), field('amount', 'uint64')] });
  await mount(page, [mints, field('enabled', 'bool')], {
    mints: [{ url: 'https://one.example', amount: 1 }, { url: 'https://two.example', amount: 2 }], enabled: true,
  });
  expect(await page.locator('input').evaluateAll(inputs => new Set(inputs.map(input => input.id)).size)).toBe(5);
  await expect(page.locator('#field-mints-0-url')).toHaveValue('https://one.example');
  await expect(page.locator('#field-mints-1-url')).toHaveValue('https://two.example');
  await expect(page.getByLabel('enabled', { exact: true })).toBeChecked();
  await page.locator('label[for="field-mints-1-url"]').click();
  await expect(page.locator('#field-mints-1-url')).toBeFocused();
});

test('fractional integers and required blanks block saves without truncation', async ({ page }) => {
  await mount(page, [field('count', 'uint64', { required: true, min: 1 }), field('title', 'string', { required: true })], { count: 2, title: 'A name' });
  await page.locator('#field-count').fill('1.5');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toContainText('whole number');
  expect(await page.evaluate(() => window.schemaFixture.values.count)).toBe(1.5);
  await page.locator('#field-count').fill('-1');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toContainText('at least');
  await page.locator('#field-count').fill('2');
  await page.locator('#field-title').fill('');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toContainText('required');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([]);
});

test('defaults and stored write-only secrets satisfy validation without exposing secrets', async ({ page }) => {
  await mount(page, [field('count', 'uint64', { required: true, default: 3 }), field('key', 'string', { required: true, secret: true })], {}, { key: true });
  await expect(page.locator('#field-key')).toHaveValue('');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([{}]);
});


test('containers without item or property metadata stay read-only and retain their structure', async ({ page }) => {
  const fields = [field('track_ips', 'array', { description: 'Track IPs' }), field('weight_override', 'object', { description: 'Weight overrides' })];
  const values = { track_ips: ['192.0.2.1', '198.51.100.1'], weight_override: { wired: 2, wifi: 1 } };
  await mount(page, fields, values);
  await expect(page.locator('#field-track_ips')).toHaveCount(0);
  await expect(page.locator('#field-weight_override')).toHaveCount(0);
  await expect(page.getByText('Track IPs (read-only)', { exact: true })).toBeVisible();
  await expect(page.getByText('Weight overrides (read-only)', { exact: true })).toBeVisible();
  await expect(page.getByText('This structured setting needs a dedicated editor. Its saved value is shown read-only.', { exact: true })).toHaveCount(2);
  expect(await page.locator('#schema-fixture pre').allTextContents()).toEqual([JSON.stringify(values.track_ips, null, 2), JSON.stringify(values.weight_override, null, 2)]);
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([values]);
});

test('one-field object lists remain objects when the child has a property key', async ({ page }) => {
  await mount(page, [field('uplinks', 'array', { children: [field('interface', 'string', { required: true })] })], { uplinks: [{ interface: 'wan' }] });
  await expect(page.locator('#field-uplinks-0-interface')).toHaveValue('wan');
  await page.locator('#field-uplinks-0-interface').fill('wwan');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([{ uplinks: [{ interface: 'wwan' }] }]);
});

test('duration fields display seconds and save numeric Go nanoseconds', async ({ page }) => {
  const fields = [field('upstream_detector', 'object', { children: [field('probe_timeout', 'duration', { description: 'Probe timeout', required: true, default: '10s' })] })];
  await mount(page, fields, { upstream_detector: { probe_timeout: 10000000000 } });
  const timeout = page.getByRole('spinbutton', { name: 'Probe timeout (seconds)', exact: true });
  await expect(timeout).toHaveValue('10');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([{ upstream_detector: { probe_timeout: 10000000000 } }]);
  await timeout.fill('2.5');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  expect(await page.evaluate(() => window.schemaFixture.writes.at(-1))).toEqual({ upstream_detector: { probe_timeout: 2500000000 } });
  await timeout.fill('0.000000001');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  expect(await page.evaluate(() => window.schemaFixture.writes.at(-1))).toEqual({ upstream_detector: { probe_timeout: 1 } });
});

test('Go duration defaults display without changing untouched configuration', async ({ page }) => {
  const fields = [field('compound', 'duration', { required: true, default: '1h2m3.004005006s' }), field('microseconds', 'duration', { required: true, default: '250µs' })];
  await mount(page, fields, {});
  await expect(page.getByRole('spinbutton', { name: 'compound (seconds)', exact: true })).toHaveValue('3723.004005006');
  await expect(page.getByRole('spinbutton', { name: 'microseconds (seconds)', exact: true })).toHaveValue('0.00025');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([{}]);
});

test('subnanosecond and unsafe duration drafts are rejected without rounding them into a save', async ({ page }) => {
  await mount(page, [field('timeout', 'duration', { required: true })], { timeout: 1000000000 });
  const timeout = page.getByRole('spinbutton', { name: 'timeout (seconds)', exact: true });
  await timeout.fill('0.0000000001');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toContainText('whole nanoseconds');
  await timeout.fill('9007199254740992');
  await page.getByRole('button', { name: 'Save fixture' }).click();
  await expect(page.getByRole('status')).toContainText('supported range');
  expect(await page.evaluate(() => window.schemaFixture.writes)).toEqual([]);
});
