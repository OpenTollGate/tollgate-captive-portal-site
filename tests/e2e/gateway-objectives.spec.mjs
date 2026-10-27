import { test, expect } from '@playwright/test';

// The gateway-objective picker is gated on a capability the backend does not
// serve yet. The unit tests stub `t()` and the fetch seam; this spec drives the
// REAL app in a browser so it also proves what the buyer actually reads:
//
//   1. no endpoint          -> the section is absent from the DOM entirely
//   2. next_session served  -> real catalog copy renders, CTA is honest
//   3. allow_change:never   -> options rendered disabled + the reason is shown
//
// Assertions are on the catalog's own English strings, not on data-testid alone,
// because a raw i18next key leaking to the page is exactly the bug this guards.
//
// NOTE: this spec deliberately does NOT use tests/e2e/helpers/mock-backend.mjs.
// That helper's casu stub still exports the old helper surface (it no longer
// provides `canSubmitAnyway`, which src/components/Cashu.jsx imports), so every
// spec built on it dies with a module SyntaxError before the portal hydrates.
// The picker needs none of the payment flow — only the two endpoints the portal
// fetches to become visible — so it stubs those two and nothing else.

const OBJECTIVES_PATH = '**/api/multi_wan/objectives';

const DETAILS = {
  kind: 10021,
  id: '0'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 0,
  tags: [
    ['metric', 'milliseconds'],
    ['step_size', '600000'],
    ['step_purchase_limits', '1', '0'],
    ['price_per_step', 'cashu', '210', 'sat', 'https://mint.minibits.cash', 1],
  ],
  content: '',
  sig: 'b'.repeat(128),
};

const CAPABILITY = {
  enabled: true,
  allow_change: 'next_session',
  current: 'balanced',
  objectives: [
    { id: 'minimize_cost', label: 'Cheapest', summary: 'One line, lowest price' },
    { id: 'maximize_speed', label: 'Fastest', summary: 'One line, highest rate' },
    { id: 'balanced', label: 'Balanced' },
  ],
};

// Serve exactly the two merchant-API calls the portal makes on load. Everything
// on :2121 that is not stubbed here 404s, which is the honest answer for a
// router build that has no such route.
const stubMerchantApi = async (page) => {
  await page.route('**/*', async (route, request) => {
    const url = new URL(request.url());
    if (url.port !== '2121') return route.continue();

    if (url.pathname === '/whoami') {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'mac=00:11:22:33:44:55',
      });
    }
    if (url.pathname === '/' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAILS),
      });
    }
    // /ln-invoice capability probe: 404 => lightning tab disabled, which is
    // unrelated to the picker and keeps this spec focused.
    return route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'not found',
    });
  });
};

// The portal mounts the picker only after its own details fetch leaves the
// loading state, so wait for the tabs before judging the picker.
const waitForPortal = async (page) => {
  await page.waitForSelector('.tollgate-captive-portal-content-container', {
    timeout: 15000,
  });
  await page.waitForSelector('#tab-cashu', { timeout: 15000 });
};

test.describe('gateway objective picker — capability gating', () => {
  test('stays hidden when the router has no objectives endpoint (404)', async ({ page }) => {
    await stubMerchantApi(page);
    // no OBJECTIVES_PATH route: it 404s via the catch-all above
    await page.goto('/');
    await waitForPortal(page);

    // give the 4s probe room to resolve, then be sure nothing appeared
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('gateway-objectives')).toHaveCount(0);
    await expect(page.locator('.tollgate-captive-portal-objectives')).toHaveCount(0);
    // no dead text either
    await expect(page.getByText('Choose your gateway')).toHaveCount(0);
  });

  test('renders the real copy when the endpoint serves next_session', async ({ page }) => {
    await stubMerchantApi(page);
    await page.route(OBJECTIVES_PATH, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CAPABILITY),
      }),
    );

    await page.goto('/');
    await waitForPortal(page);

    const section = page.getByTestId('gateway-objectives');
    await expect(section).toBeVisible();

    // real catalog strings, not raw keys
    await expect(section.getByText('Choose your gateway')).toBeVisible();
    await expect(
      section.getByText('How your traffic leaves the internet for this session.'),
    ).toBeVisible();
    await expect(section.getByText('Minimize cost')).toBeVisible();
    await expect(section.getByText('Maximize speed')).toBeVisible();
    await expect(section.getByText('Balanced')).toBeVisible();

    // the current objective is named, and no CTA exists until a change is staged
    await expect(section.locator('.tollgate-captive-portal-objectives-option-current')).toHaveText(
      '· Current gateway',
    );
    await expect(page.getByTestId('gateway-objectives-submit')).toHaveCount(0);

    // stage a different objective
    await page.getByTestId('gateway-objective-minimize_cost').click();
    const submit = page.getByTestId('gateway-objectives-submit');
    await expect(submit).toBeEnabled();

    // the honest label. "Switch now" must not exist anywhere on the page.
    await expect(submit).toHaveText('Use for next session');
    await expect(page.getByTestId('gateway-applies-next-session')).toHaveText(
      'Applies to your next session. Your current session keeps its current gateway until it ends.',
    );
    await expect(page.getByText(/switch now/i)).toHaveCount(0);
  });

  test('shows the options disabled — never hidden — when allow_change is never', async ({ page }) => {
    await stubMerchantApi(page);
    await page.route(OBJECTIVES_PATH, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...CAPABILITY, allow_change: 'never' }),
      }),
    );

    await page.goto('/');
    await waitForPortal(page);

    const section = page.getByTestId('gateway-objectives');
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-locked', 'true');

    // every option is on screen and not selectable
    for (const id of ['minimize_cost', 'maximize_speed', 'balanced']) {
      const row = page.getByTestId(`gateway-objective-${id}`);
      await expect(row).toBeVisible();
      await expect(row.locator('input[type="radio"]')).toBeDisabled();
    }

    // and the buyer is told why — the sentence lives in the note, not in the
    // button (a disabled CTA stays a short label)
    await expect(page.getByTestId('gateway-applies-next-session')).toHaveText(
      'Applies to your next session. Your current session keeps its current gateway until it ends.',
    );
    await expect(page.getByTestId('gateway-objectives-submit')).toBeDisabled();
    await expect(page.getByTestId('gateway-objectives-submit')).toHaveText(
      'Locked by this router',
    );
  });
});
