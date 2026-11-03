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

// The stub must export EVERY name src/components/Cashu.jsx imports from
// src/helpers/cashu.js. ESM is strict: one missing export aborts the whole
// module graph ("does not provide an export named 'X'"), the SPA never
// hydrates, and every test that waited on a selector times out — which is what
// took down all 10 setupMockBackend tests.
//
// Cashu.jsx imports five names:
//   validateToken, submitToken, canSubmitAnyway, mintUrlFromToken, findMintOption
// The original stub exported only three names — validateToken, submitToken and
// extractProofsFromToken. Of the five the component imports, that covered
// validateToken and submitToken; `canSubmitAnyway` (#55) was NOT present even
// though extractProofsFromToken was, and `mintUrlFromToken` + `findMintOption`
// arrived with #61. The stub was never updated to match the component's import
// list. (A cold review caught an earlier, inaccurate wording of this comment
// that claimed "the first three were stubbed" — the stub never carried
// canSubmitAnyway.)
//
// Semantics for the additions:
//   * canSubmitAnyway: the affordance is for a client-side decode refusal
//     (CU102). The stub's validateToken accepts every 'cashu…' token, so there
//     is never a decode refusal to hedge — false is the faithful answer.
//   * mintUrlFromToken / findMintOption: these drive auto-selecting the access
//     option a pasted note came from. The test token is an undecodable
//     placeholder, so returning null matches Cashu.jsx's documented
//     "undecodable / partial input: stay quiet and change nothing" path.
//
// SCOPE NOTE (raised by a cold review): because this stub is SHARED by every
// setupMockBackend test and now always returns null, no e2e test exercises the
// non-null auto-select path introduced in #61. That path IS covered — by
// tests/unit/cashu-auto-select-mint.test.jsx, which mocks nothing in
// src/helpers/cashu.js, uses two REAL decodable notes, and asserts the
// selection actually moves to the note's mint (including the unsupported-mint
// warning and the manual-override case). E2E here deliberately keeps the
// deterministic placeholder token, so the two suites together cover both
// branches rather than this one silently covering neither.
const CASHU_HELPER_STUB = `
export const validateToken = (token, mint, i18n) => {
  if (!token || typeof token !== 'string' || !token.startsWith('cashu')) {
    return { status: 0, code: 'CU101', label: 'Invalid', message: 'bad token' };
  }
  return { status: 1, value: { amount: 420, unit: 'sat', isValid: true, hasProofs: true, proofCount: 1 } };
};
export const submitToken = async () => ({ status: 1, label: 'ok', message: 'ok' });
export const canSubmitAnyway = () => false;
export const extractProofsFromToken = () => [];
export const mintUrlFromToken = () => null;
export const findMintOption = () => null;
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
      if (path === '/ln-invoice') {
        // capability probe is a GET without a quote; a real purchase is a POST
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 1,
              quote: 'test-quote',
              invoice: 'lnbc1mockinvoice',
              mint_url: 'https://mint.minibits.cash/Bitcoin',
              amount: 210,
              expiry: 0,
              state: 'UNPAID',
            }),
          });
        }
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ status: 0, error: 'quote is required' }),
        });
      }
    }

    return route.continue();
  });
}
