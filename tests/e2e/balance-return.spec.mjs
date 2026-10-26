// Proof for the reported bug: "after paying and closing the tab the user cannot
// find the balance page again."
//
// The balance surface existed before, but its only address was a `target=_blank`
// link inside the post-payment screen. Close that tab and nothing re-advertises
// the page. This spec pins the fix end to end:
//
//   1. pay on the portal -> AccessGranted renders a link to the CANONICAL
//      `/balance/` route (not the old `/balance.html`);
//   2. close the tab -> a brand-new page (no carried-over state) opened at that
//      path still renders the balance;
//   3. `/balance` without the trailing slash and the legacy `/balance.html`
//      reach the same page, so old links and bookmarks keep working;
//   4. no client-side session is needed: the backend resolves the client from
//      the request socket (the DHCP-lease MAC), which is exactly why reopening a
//      bare URL works for a MAC-authenticated session.
//
// The mock backend answers `GET :2121/balance` with a fixed session, so a
// successful render here means the page read its data from the backend — not
// from anything the payment flow left behind in the browser.

import { test, expect } from '@playwright/test';
import { setupMockBackend, TEST_TOKEN } from './helpers/mock-backend.mjs';

const HYDRATE_TIMEOUT = 15000;

// The remaining balance the mock backend reports (540000 ms of a 600000 ms
// allotment, 60000 ms used) as the page formats it.
const MOCK_REMAINING = '9 min';

const BALANCE_PANEL = '.tollgate-captive-portal-balance-page';
const BALANCE_CARD = '.tollgate-captive-portal-balance-card';

// Pay on the portal and return the balance link's href.
async function payAndReadBalanceHref(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cashu-token', { timeout: HYDRATE_TIMEOUT });
  await page.fill('#cashu-token', TEST_TOKEN);
  await page.waitForTimeout(1000);

  const purchaseBtn = page.locator('.tollgate-captive-portal-method-submit button.cta').first();
  await purchaseBtn.waitFor({ state: 'visible', timeout: 10000 });
  await purchaseBtn.click();
  await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 30000 });

  const link = page.locator('.tollgate-captive-portal-access-granted-balance-link');
  await expect(link).toBeVisible();
  return link.getAttribute('href');
}

test.describe('Balance page stays reachable after the portal tab is closed', () => {
  test('pay -> close tab -> reopen the advertised path -> balance visible', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Payment flow is exercised on Chromium only');

    await setupMockBackend(page);
    const href = await payAndReadBalanceHref(page);

    // The link is absolute (`http://<gateway>:2051/balance/`) because the page
    // is served by the portal on its own port. Assert the canonical path, then
    // reopen it against the test origin so the same document is really loaded.
    expect(href).toMatch(/\/balance\/$/);
    expect(href).not.toMatch(/balance\.html/);

    const path = new URL(href).pathname;
    expect(path).toBe('/balance/');

    // Close the tab that the payment happened in — the whole point of the bug
    // report is that after this the user had no way back.
    await page.close();

    // A fresh page in a fresh context: nothing the portal stored (memory,
    // sessionStorage, an in-flight fetch) survives into it.
    const reopened = await context.browser().newContext();
    const fresh = await reopened.newPage();
    await setupMockBackend(fresh);

    await fresh.goto(path, { waitUntil: 'domcontentloaded' });
    await fresh.waitForSelector(BALANCE_PANEL, { timeout: HYDRATE_TIMEOUT });
    await expect(fresh.locator(BALANCE_CARD).first()).toBeVisible();
    await expect(fresh.locator('.tollgate-captive-portal-balance-page')).toContainText(MOCK_REMAINING);

    // The page must show real words, not i18n keys. A merge once dropped the
    // balance strings from en.json and i18next rendered "balance_active_label"
    // on this exact page — a reopened page is useless if its labels are keys.
    const reopenedText = await fresh.locator(BALANCE_PANEL).innerText();
    expect(reopenedText).not.toMatch(/\bbalance_[a-z_]+\b/);
    expect(reopenedText).toContain('Session active');

    await reopened.close();
  });

  test('`/balance` (no trailing slash) and `/balance.html` are the same page', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');

    await setupMockBackend(page);

    // A user retyping the address will not type the slash. uhttpd 302s
    // `/balance` -> `/balance/`; the dev/preview server rewrites it. Either way
    // the page must come up.
    await page.goto('/balance', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(BALANCE_PANEL, { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator(BALANCE_CARD).first()).toBeVisible();
    await expect(page.locator(BALANCE_PANEL)).toContainText(MOCK_REMAINING);

    // The legacy address must keep working for old links and bookmarks.
    await page.goto('/balance.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(BALANCE_PANEL, { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator(BALANCE_CARD).first()).toBeVisible();
    await expect(page.locator(BALANCE_PANEL)).toContainText(MOCK_REMAINING);
  });

  test('the balance page needs no token or cookie from the payment flow', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only');

    // Deliberately no payment first, no route install for the portal: only the
    // balance endpoint is mocked. A page that renders here is one that works
    // for a client identified purely by the socket (DHCP-lease MAC).
    await setupMockBackend(page);

    const context = page.context();
    expect(await context.cookies()).toHaveLength(0);

    await page.goto('/balance/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(BALANCE_PANEL, { timeout: HYDRATE_TIMEOUT });
    await expect(page.locator(BALANCE_CARD).first()).toBeVisible();

    // Still no cookies: the render cannot have depended on a set-cookie grant.
    expect(await context.cookies()).toHaveLength(0);
  });
});
