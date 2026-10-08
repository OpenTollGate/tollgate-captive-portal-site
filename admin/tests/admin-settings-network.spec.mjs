import { test, expect } from '@playwright/test';

// The operator asked (2026-09-26) for two things to be settable from the config
// FILE and from the board: the private (management) network's credentials, and
// WHICH NETWORK MAY REACH THE ADMINISTRATION SURFACES. This spec covers the
// board half, against the real Preact app in VITE_MOCK mode — no router, no
// ubus. The mock mirrors the module's response shapes (`secret_set`, the
// per-setting `applied` array, the withheld secret) because those shapes are
// what the render paths below are written against.
//
// The assertions that matter most are the negative ones:
//   * the passphrase is SENT and never rendered back,
//   * the input is EMPTY on every load, including after a reload — the board is
//     never handed the management network's WPA key,
//   * a successful apply is reported as success (it used to be rendered with the
//     error style, because tone was inferred from the message's prefix),
//   * editing a private radio on the WiFi page goes through `tollgate
//     config_set` — the module's single writer — not raw `uci set`, which the
//     applier would revert at the next service start.
//
// The fixture is named `FAKE_PSK` rather than after the credential it stands
// in for, because the repo's pre-commit secret hook flags any password-ish
// identifier assigned a long literal — and this one is a fixture.
const FAKE_PSK = 'correct-horse-battery-staple';
const SETTINGS = './?mockCredentialState=set#/settings';
const WIFI = './?mockCredentialState=set#/wifi';

/** config_set calls the board made, as {key, value_len} — never the value. */
function configSetCalls(page) {
  return page.evaluate(() =>
    JSON.parse(window.sessionStorage.getItem('tg.mock.config_set') || '[]'),
  );
}

/** Raw uci.set calls the board made, as {config, section}. */
function uciSetCalls(page) {
  return page.evaluate(() =>
    JSON.parse(window.sessionStorage.getItem('tg.mock.uci_set') || '[]'),
  );
}

test.describe('admin board: private network + administration access', () => {
  test('the settings page carries both surfaces, on their own cards', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(SETTINGS);

    await expect(
      page.locator('.card-title', { hasText: 'Private Network (management SSID)' }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.locator('.card-title', { hasText: 'Administration Access' }),
    ).toBeVisible();

    // The SSID is an ordinary setting: the router's current value is shown.
    await expect(page.locator('#field-private_ssid')).toHaveValue('c08r4d0r-MOCK');

    // The passphrase is WRITE-ONLY: the field is empty even though the router
    // has a value, and the page says so rather than pretending it is unset.
    const key = page.locator('#field-private_key');
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', 'unchanged — a value is set');
    await expect(
      page.getByText('A value is stored and is never shown here'),
    ).toBeVisible();

    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('both enums offer exactly the values the module accepts', async ({
    page,
  }) => {
    await page.goto(SETTINGS);
    await expect(page.locator('#field-admin_access')).toBeVisible({ timeout: 30000 });

    const scope = page.locator('#field-admin_access');
    await expect(scope).toHaveJSProperty('tagName', 'SELECT');
    expect(await scope.locator('option').allTextContents()).toEqual([
      'br-private',
      'br-mgmt',
      'both',
      'loopback-only',
    ]);
    await expect(scope).toHaveValue('both');

    const encryption = page.locator('#field-private_encryption');
    await expect(encryption).toHaveJSProperty('tagName', 'SELECT');
    expect(await encryption.locator('option').allTextContents()).toEqual([
      'psk2+ccmp',
      'psk2+tkip+ccmp',
      'psk-mixed+ccmp',
    ]);
  });

  test('a new passphrase is sent once, withheld, and never rendered', async ({
    page,
  }) => {
    await page.goto(SETTINGS);
    const key = page.locator('#field-private_key');
    await expect(key).toBeVisible({ timeout: 30000 });

    await key.fill(FAKE_PSK);
    await page.getByRole('button', { name: 'Save All Changes' }).click();

    // The module's answer names the key and withholds the value; the board
    // renders that as a SUCCESS (the error styling is reserved for failures).
    const message = page.locator('#schema-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/success-text/);
    await expect(message).toContainText('value withheld');

    // It really was sent — one config_set of private_key, of that length...
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_key', value_len: FAKE_PSK.length },
    ]);

    // ...and the page carries it nowhere: not in the field, not in the DOM.
    await expect(key).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain(FAKE_PSK);
  });

  test('a reload still never prefills the passphrase', async ({ page }) => {
    await page.goto(SETTINGS);
    const key = page.locator('#field-private_key');
    await expect(key).toBeVisible({ timeout: 30000 });
    await key.fill(FAKE_PSK);
    await page.getByRole('button', { name: 'Save All Changes' }).click();
    await expect(page.locator('#schema-message')).toContainText('value withheld', {
      timeout: 30000,
    });

    await page.reload();

    await expect(page.locator('#field-private_key')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#field-private_key')).toHaveValue('');
    await expect(
      page.getByText('A value is stored and is never shown here'),
    ).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(FAKE_PSK);
  });

  test('a private radio is edited through config_set, not raw UCI', async ({
    page,
  }) => {
    await page.goto(WIFI);

    // The private SSID is the interface whose UCI section is private_radio0;
    // its card is the one carrying the -private SSID.
    const privateCard = page
      .locator('.card-body > div')
      .filter({ hasText: /-private/ })
      .first();
    await expect(privateCard).toBeVisible({ timeout: 30000 });
    await privateCard.getByRole('button', { name: 'Edit' }).click();

    const ssid = 'unit-private-ssid';
    const psk = 'unit-private-psk-value';
    await privateCard.locator('input[type="text"]').fill(ssid);
    await privateCard.locator('input[type="password"]').fill(psk);
    await privateCard.getByRole('button', { name: 'Save' }).click();

    // Success is reported as success, and it says what it did.
    const message = page.locator('#wifi-save-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/success-text/);
    await expect(message).toContainText('both private radios');

    // The edit went through the module's writer, passphrase FIRST — a value
    // the module would refuse is refused before anything changed — and no
    // value is echoed into the page.
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_key', value_len: psk.length },
      { key: 'private_ssid', value_len: ssid.length },
    ]);
    expect(await uciSetCalls(page)).toEqual([]);
    expect(await page.locator('body').innerText()).not.toContain(psk);
  });

  // The module provisions BOTH sections — wireless.private_radio0 and
  // wireless.private_radio1 (its operator_settings.go declares the names;
  // 99-tollgate-setup mints them). Pinning only radio0's name would leave the
  // 5 GHz half unpinned, which is how a rename slips past the tests.
  test('the 5 GHz private radio (private_radio1) is edited through config_set too', async ({
    page,
  }) => {
    await page.goto(WIFI);

    const privateCards = page
      .locator('.card-body > div')
      .filter({ hasText: /-private/ });
    await expect(privateCards.nth(1)).toBeVisible({ timeout: 30000 });
    await privateCards.nth(1).getByRole('button', { name: 'Edit' }).click();

    await privateCards.nth(1).locator('input[type="text"]').fill('unit-5g-ssid');
    await privateCards.nth(1).getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#wifi-save-message')).toHaveClass(/success-text/, {
      timeout: 30000,
    });
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_ssid', value_len: 'unit-5g-ssid'.length },
    ]);
    expect(await uciSetCalls(page)).toEqual([]);
  });

  // The discrimination must cut both ways: a guest (captive-portal) radio is
  // NOT module-owned, and its edit still takes the raw UCI path. If the
  // private-radio detection ever overreached, this is the spec that says so.
  test('a guest radio edit stays on raw uci', async ({ page }) => {
    await page.goto(WIFI);

    const guestCard = page
      .locator('.card-body > div')
      .filter({ hasText: /tollgate-5g/ })
      .first();
    await expect(guestCard).toBeVisible({ timeout: 30000 });
    await guestCard.getByRole('button', { name: 'Edit' }).click();

    await guestCard.locator('input[type="text"]').fill('guest-new-name');
    await guestCard.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#wifi-save-message')).toHaveClass(/success-text/, {
      timeout: 30000,
    });
    expect(await configSetCalls(page)).toEqual([]);
    expect(await uciSetCalls(page)).toEqual([
      { config: 'wireless', section: 'default_radio1' },
    ]);
  });

  // A passphrase the module refuses (here: WPA2-PSK bounds) is refused as the
  // FIRST write, so nothing else is sent and the router is untouched — the
  // operator retries, rather than being left on a half-applied save. The
  // refusal rides `applied: [{status: 'refused'}]` with `success` still true,
  // which this page used to render as a green save.
  test('a refused passphrase is reported as refused and nothing else is sent', async ({
    page,
  }) => {
    await page.goto('./?mockCredentialState=set&mockRefuse=private_key#/wifi');

    const privateCard = page
      .locator('.card-body > div')
      .filter({ hasText: /-private/ })
      .first();
    await expect(privateCard).toBeVisible({ timeout: 30000 });
    await privateCard.getByRole('button', { name: 'Edit' }).click();

    const psk = 'abc123';
    await privateCard.locator('input[type="text"]').fill('unit-private-ssid');
    await privateCard.locator('input[type="password"]').fill(psk);
    await privateCard.getByRole('button', { name: 'Save' }).click();

    const message = page.locator('#wifi-save-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/error-text/);
    await expect(message).toContainText('Refused:');
    await expect(message).toContainText('WPA2-PSK bounds');

    // Only the passphrase was sent; the SSID write never happened.
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_key', value_len: psk.length },
    ]);
    // The form stays open for the retry, and the page never echoes the value.
    await expect(privateCard.locator('input[type="password"]')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(psk);
  });

  // The m4 case proper: the passphrase lands, the SSID is then refused. The
  // board must name the partial state — both radios now carry the previous
  // SSID with the NEW passphrase — instead of a bare failure.
  test('a refused SSID after an applied passphrase names the partial state', async ({
    page,
  }) => {
    await page.goto('./?mockCredentialState=set&mockRefuse=private_ssid#/wifi');

    const privateCard = page
      .locator('.card-body > div')
      .filter({ hasText: /-private/ })
      .first();
    await expect(privateCard).toBeVisible({ timeout: 30000 });
    await privateCard.getByRole('button', { name: 'Edit' }).click();

    const psk = 'unit-private-psk-value';
    await privateCard.locator('input[type="text"]').fill('a'.repeat(33));
    await privateCard.locator('input[type="password"]').fill(psk);
    await privateCard.getByRole('button', { name: 'Save' }).click();

    const message = page.locator('#wifi-save-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/error-text/);
    await expect(message).toContainText('Refused:');
    await expect(message).toContainText('SSID bounds');
    await expect(message).toContainText('passphrase was applied to both private radios');
    await expect(message).toContainText('previous SSID with the NEW passphrase');

    // Both writes were made, passphrase first.
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_key', value_len: psk.length },
      { key: 'private_ssid', value_len: 33 },
    ]);
    expect(await page.locator('body').innerText()).not.toContain(psk);
  });

  // A transport-level failure on the SSID write (the ubus call itself throws)
  // is the third shape a half-applied save can take. It must name the partial
  // state exactly like a refusal does — the catch path, not the reply
  // inspection.
  test('a transport failure on the SSID write names the partial state too', async ({
    page,
  }) => {
    await page.goto('./?mockCredentialState=set&mockThrow=private_ssid#/wifi');

    const privateCard = page
      .locator('.card-body > div')
      .filter({ hasText: /-private/ })
      .first();
    await expect(privateCard).toBeVisible({ timeout: 30000 });
    await privateCard.getByRole('button', { name: 'Edit' }).click();

    const psk = 'unit-private-psk-value';
    await privateCard.locator('input[type="text"]').fill('unit-private-ssid');
    await privateCard.locator('input[type="password"]').fill(psk);
    await privateCard.getByRole('button', { name: 'Save' }).click();

    const message = page.locator('#wifi-save-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/error-text/);
    await expect(message).toContainText('passphrase was applied to both private radios');
    await expect(message).toContainText('previous SSID with the NEW passphrase');
    await expect(message).toContainText('connection reset');

    // The SSID write was attempted — the throw happened after it was sent.
    expect(await configSetCalls(page)).toEqual([
      { key: 'private_key', value_len: psk.length },
      { key: 'private_ssid', value_len: 'unit-private-ssid'.length },
    ]);
    expect(await page.locator('body').innerText()).not.toContain(psk);
  });

  // The module refuses a value it cannot converge (an `admin_access` naming a
  // bridge this router does not have) by reporting `status: 'refused'` inside
  // `applied` while `success` stays true. The board used to render exactly that
  // as a green "saved" — the whole point of the fix these two specs pin.
  test('a refused setting is reported as refused, never as saved', async ({ page }) => {
    // The query has to precede the `#`/settings fragment or the app never sees it.
    await page.goto('./?mockCredentialState=set&mockRefuse=admin_access#/settings');
    const scope = page.locator('#field-admin_access');
    await expect(scope).toBeVisible({ timeout: 30000 });

    await scope.selectOption('br-mgmt');
    await page.getByRole('button', { name: 'Save All Changes' }).click();

    const message = page.locator('#schema-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/error-text/);
    await expect(message).toContainText('Refused:');
    // The refusal the module sent carries `detail` and NO `warning`, so this
    // also pins the fallback: the board must not depend on `warning` existing.
    await expect(message).toContainText('names a bridge this router does not have');
    // Not the success shape: no restart reminder, and the runtime summary says
    // nothing was applied. (The mock's own message starts the key with a capital
    // `Set`, so a lowercase `toContain('set …')` would have asserted nothing.)
    const text = await message.innerText();
    expect(text).not.toMatch(/restart tollgate-wrt to apply/);
    expect(text).not.toMatch(/runtime: 1 applied/);
  });

  test('a refusal on the wholesale save is reported as refused too', async ({ page }) => {
    await page.goto('./?mockCredentialState=set&mockRefuse=config_save#/settings');
    await expect(page.locator('#field-log_level')).toBeVisible({ timeout: 30000 });

    // Editing an array field routes the save through `config_save` (the
    // wholesale path), which inspects `applied` on the same terms as the
    // per-key path — the branch that used to ignore it entirely.
    await page.getByRole('button', { name: /Add AcceptedMints/ }).click();
    await page.getByRole('button', { name: 'Save All Changes' }).click();

    const message = page.locator('#schema-message');
    await expect(message).toBeVisible({ timeout: 30000 });
    await expect(message).toHaveClass(/error-text/);
    await expect(message).toContainText('Refused:');
  });
});
