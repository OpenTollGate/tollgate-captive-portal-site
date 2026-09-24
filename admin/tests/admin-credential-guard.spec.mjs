import { test, expect } from '@playwright/test';

// The :8090 admin board must REFUSE to authenticate against a router whose root
// /etc/shadow hash is unset. This is the state a fresh deploy used to be left
// in, and while it holds rpcd's session.login accepts ANY password — including
// an empty one — and hands back a session carrying this board's ACL (file exec,
// system.password_set, wallet_drain_cashu). So "the login worked" is not
// evidence of anything, and the board must not offer the form at all.
//
// Runs against the real Preact app in VITE_MOCK mode; the mock answers the
// `tollgate auth_status` probe with the state named by the `mockCredentialState`
// query parameter, which is how each router state is reproduced without a
// router.
test.describe('admin board: root credential guard', () => {
  test('refuses to sign in when the router has no root password', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('./?mockCredentialState=empty');

    const refusal = page.locator('#credential-refusal');
    await expect(refusal).toBeVisible({ timeout: 30000 });
    await expect(refusal).toHaveAttribute('data-credential-state', 'empty');
    await expect(refusal).toContainText('no root password set');
    await expect(refusal).toContainText('passwd root');

    // The form must be GONE — not merely disabled: no password field, no
    // submit button, so no click path can submit a blank credential.
    await expect(page.locator('#password')).toHaveCount(0);
    await expect(page.locator('#username')).toHaveCount(0);
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);

    // ...and the dashboard is NOT reached.
    await expect(page.locator('.app-header')).toHaveCount(0);

    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a provisioned router still auto-logs in (unchanged)', async ({
    page,
  }) => {
    await page.goto('./?mockCredentialState=set');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 30000 });
  });

  test('the login form refuses a blank credential', async ({ page }) => {
    // Force the login screen by clearing the mock session state: the mock
    // auto-login only succeeds for a provisioned router, so the unknown state
    // renders the form instead of the dashboard.
    await page.goto('./?mockCredentialState=unknown');

    const password = page.locator('#password');
    await expect(password).toBeVisible({ timeout: 30000 });

    // Submit is blocked while the credential is blank, and the reason is shown.
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.locator('#password-required-hint')).toBeVisible();

    // Typing one password character enables it again.
    await password.fill('x');
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await expect(page.locator('#password-required-hint')).toHaveCount(0);
  });

  test('a LOCKED root account is explained instead of reading as a wrong password', async ({
    page,
  }) => {
    // Locked ('!'/'*') is NOT credential-less: crypt() can never match a lock
    // sentinel, so the form is still offered — but the owner must not read the
    // failure as "wrong password".
    await page.goto('./?mockCredentialState=locked');

    const locked = page.locator('#credential-locked');
    await expect(locked).toBeVisible({ timeout: 30000 });
    await expect(locked).toHaveAttribute('data-credential-state', 'locked');
    await expect(locked).toContainText('locked');
    await expect(locked).toContainText('passwd root');

    // ...and the form IS offered, unlike the unset/empty case.
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#credential-refusal')).toHaveCount(0);
  });
});
