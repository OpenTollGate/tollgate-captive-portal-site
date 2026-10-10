import { test, expect } from '@playwright/test';

// The forced password choice at first login, end to end against the real Preact
// app in VITE_MOCK mode.
//
// The module's 99-tollgate-setup MINTS the admin credential when the operator
// did not supply TOLLGATE_ADMIN_PASSWORD at install time, and records that fact
// — never the value — in /etc/tollgate/admin-credential-provisional. The board
// consumes that marker: while it stands the dashboard must be UNREACHABLE until
// the owner chooses their own password, and the choice drops the marker.
//
// The mock reproduces the marker with the `mockProvisional=1` query parameter
// (exactly how `mockCredentialState` reproduces each root-credential state in
// admin-credential-guard.spec.mjs) and remembers the claim in sessionStorage, so
// a reload models the router on which the marker is now gone.
test.describe('admin board: forced password choice at first login', () => {
  test('the dashboard is unreachable while the credential is provisional', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('./?mockProvisional=1');

    const choice = page.locator('#provisional-password-choice');
    await expect(choice).toBeVisible({ timeout: 30000 });
    await expect(choice).toContainText(/choose/i);

    // No dashboard chrome, and none of the routes reach it: navigation is the
    // hash, so drive it the way a user would.
    await expect(page.locator('.app-header')).toHaveCount(0);
    for (const hash of ['#/', '#/wallet', '#/settings', '#/wifi']) {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      await expect(choice).toBeVisible();
      await expect(page.locator('.app-header')).toHaveCount(0);
    }

    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('the new password must be confirmed and long enough', async ({ page }) => {
    await page.goto('./?mockProvisional=1');
    await expect(page.locator('#new-password')).toBeVisible({ timeout: 30000 });

    // Too short.
    await page.locator('#new-password').fill('short');
    await page.locator('#confirm-password').fill('short');
    await page.locator('#provisional-password-choice button[type="submit"]').click();
    await expect(page.locator('#provisional-error')).toContainText(/at least/i);

    // Mismatch.
    await page.locator('#new-password').fill('a-good-enough-one');
    await page.locator('#confirm-password').fill('a-good-enough-two');
    await page.locator('#provisional-password-choice button[type="submit"]').click();
    await expect(page.locator('#provisional-error')).toContainText(/do not match/i);

    // Nothing was sent to the router for either attempt.
    const sent = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem('tg.mock.admin_password_set') || '[]')
    );
    expect(sent).toEqual([]);
    await expect(page.locator('.app-header')).toHaveCount(0);
  });

  test('choosing a password sets it on the router, drops the marker, opens the board', async ({
    page,
  }) => {
    const chosen = 'a-good-enough-one';
    await page.goto('./?mockProvisional=1');
    await expect(page.locator('#new-password')).toBeVisible({ timeout: 30000 });

    await page.locator('#new-password').fill(chosen);
    await page.locator('#confirm-password').fill(chosen);
    await page.locator('#provisional-password-choice button[type="submit"]').click();

    // The board opens.
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#provisional-password-choice')).toHaveCount(0);

    // The router got the password exactly once, and the marker was claimed
    // after it. Only lengths are recorded — the mock never keeps a value.
    const sent = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem('tg.mock.admin_password_set') || '[]')
    );
    expect(sent).toEqual([{ username: 'root', value_len: chosen.length }]);
    const claims = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem('tg.mock.credential_claim') || '[]')
    );
    expect(claims.length).toBe(1);

    // The password itself is nowhere in the rendered page.
    const html = await page.content();
    expect(html).not.toContain(chosen);

    // A reload models the router on which the marker is gone: no forced screen.
    await page.reload();
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#provisional-password-choice')).toHaveCount(0);
  });

  test('a claim the router refuses leaves the board closed (fail closed)', async ({
    page,
  }) => {
    // The password takes but the marker will not drop: the operator must not be
    // walked to a dashboard that the next load would gate again.
    await page.goto('./?mockProvisional=1&mockClaimFail=1');
    await expect(page.locator('#new-password')).toBeVisible({ timeout: 30000 });

    const chosen = 'a-good-enough-one';
    await page.locator('#new-password').fill(chosen);
    await page.locator('#confirm-password').fill(chosen);
    await page.locator('#provisional-password-choice button[type="submit"]').click();

    await expect(page.locator('#provisional-error')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.app-header')).toHaveCount(0);
    await expect(page.locator('#provisional-password-choice')).toBeVisible();
  });

  test('a router whose credential the operator chose is untouched', async ({ page }) => {
    // Regression guard: without the marker the board auto-logs in exactly as
    // before (admin/tests/admin-mock.spec.mjs pins the same shell).
    await page.goto('./');
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#provisional-password-choice')).toHaveCount(0);
  });
});
