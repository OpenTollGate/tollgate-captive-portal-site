// Shared mock-backend setup for Playwright e2e tests.
//
// Stubs @cashu/cashu-ts validateToken + submitToken so tests can reach
// AccessGranted without a real Cashu mint. Mocks backend endpoints on
// port 2121 (whoami, tollgate details, /usage, /balance).

const MOCK_TOLLGATE_DETAILS = {
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

const CASHU_HELPER_STUB = `
export const validateToken = (token, mint, i18n) => {
  if (!token || typeof token !== 'string' || !token.startsWith('cashu')) {
    return { status: 0, code: 'CU101', label: 'Invalid', message: 'bad token' };
  }
  return { status: 1, value: { amount: 420, unit: 'sat', isValid: true, hasProofs: true, proofCount: 1 } };
};
export const submitToken = async () => ({ status: 1, label: 'ok', message: 'ok' });
export const extractProofsFromToken = () => [];
`;

export const TEST_TOKEN = 'cashuBtest123MockTokenForE2E';

export async function setupMockBackend(page, options = {}) {
  const {
    usageResponse = '60000/600000',
    usageExpired = false,
    usageHang = false,
    metricOverride = null,
  } = options;

  const details = metricOverride
    ? { ...MOCK_TOLLGATE_DETAILS, tags: MOCK_TOLLGATE_DETAILS.tags.map(t => t[0] === 'metric' ? ['metric', metricOverride] : t) }
    : MOCK_TOLLGATE_DETAILS;

  await page.route('**/*', async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/src/helpers/cashu.js') {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: CASHU_HELPER_STUB,
      });
    }

    if (url.port === '2121') {
      if (path === '/whoami') {
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'mac=00:11:22:33:44:55',
        });
      }
      if (path === '/' || path === '') {
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(details),
        });
      }
      if (path === '/usage') {
        if (usageHang) return;
        if (usageExpired) {
          return route.fulfill({
            status: 200,
            contentType: 'text/plain',
            body: '-1/-1',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: usageResponse,
        });
      }
      if (path === '/balance') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session_active: true,
            metric: 'milliseconds',
            remaining: 540000,
            usage: 60000,
            allotment: 600000,
            start_time: 1,
          }),
        });
      }
    }

    return route.continue();
  });
}
