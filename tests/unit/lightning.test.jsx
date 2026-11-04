// Behavioural tests for src/components/Lightning.jsx — the Lightning payment
// method. Baseline coverage on this file was 7.11%: only the module scope was
// ever loaded. Every flow below is driven through the rendered DOM.
//
// Child components and the network helpers are doubled: the subject is the
// component's own state machine (access options -> amount -> invoice ->
// status poll -> access granted -> buy more time), not the children's markup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

const details = {
  detailsEvent: {
    kind: 10021,
    tags: [
      ['metric', 'milliseconds'],
      ['step_size', '600000'],
      ['step_purchase_limits', '1', '0'],
      ['price_per_step', 'cashu', '210', 'sat', 'https://mint.example.com', '1'],
      ['price_per_step', 'cashu', '420', 'sat', 'https://mint2.example.com', '2'],
    ],
  },
  deviceInfo: { type: 'mac', value: '00:11:22:33:44:55' },
};

// Children: rendered as identifiable stubs so the assertions can name them.
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({
  default: () => null,
}));
vi.mock('../../src/components/DeviceInfo.jsx', () => ({
  default: ({ tollgateDetails }) => (
    <span data-testid="device-info">{tollgateDetails?.deviceInfo?.value ?? 'none'}</span>
  ),
}));
vi.mock('../../src/components/Status.jsx', () => ({
  Error: ({ label, code, message }) => (
    <div data-testid="status-error" data-code={code}>
      {label}|{message}
    </div>
  ),
}));
vi.mock('../../src/components/Icon.jsx', () => ({
  CancelIcon: () => <span data-testid="cancel-icon" />,
}));
vi.mock('../../src/App.jsx', () => ({
  Processing: ({ label }) => <div data-testid="processing">{label}</div>,
  AccessGranted: ({ allocation, onRenew }) => (
    <div data-testid="access-granted">
      {allocation}
      <button data-testid="renew" onClick={onRenew}>
        renew
      </button>
    </div>
  ),
  AccessOptions: ({ pricingInfo, selectedMint, setSelectedMint }) => (
    <div data-testid="access-options" data-selected={selectedMint?.url ?? ''}>
      {pricingInfo.map((mint) => (
        <button key={mint.url} data-mint={mint.url} onClick={() => setSelectedMint(mint)}>
          {mint.url}
        </button>
      ))}
    </div>
  ),
  default: () => null,
}));

// The lightning helpers are the network boundary; each test sets the answer.
const requestInvoice = vi.fn();
const getInvoiceStatus = vi.fn();
vi.mock('../../src/helpers/lightning.js', () => ({
  requestInvoice: (...args) => requestInvoice(...args),
  getInvoiceStatus: (...args) => getInvoiceStatus(...args),
}));

// createQr paints ~35 KB of SVG; one fixed string is enough to assert the
// invoice anchor carries the QR markup.
vi.mock('../../src/helpers/qr-code.js', () => ({
  createQr: (text) => `<svg data-invoice="${text}"></svg>`,
}));

const copyTextToClipboard = vi.fn(async () => {});
vi.mock('../../src/helpers/clipboard.js', () => ({
  copyTextToClipboard: (...args) => copyTextToClipboard(...args),
}));

const Lightning = (await import('../../src/components/Lightning.jsx')).default;

const INVOICE = {
  status: 1,
  quote: 'quote-1',
  invoice: 'lnbc2100n1testinvoice',
  mintUrl: 'https://mint.example.com',
  amount: 210,
  expiry: 600,
  state: 'unpaid',
};

const renderLightning = (tollgateDetails = details) =>
  render(<Lightning tollgateDetails={tollgateDetails} />);

beforeEach(() => {
  requestInvoice.mockResolvedValue(INVOICE);
  getInvoiceStatus.mockResolvedValue({ status: 1.0 ? 1 : 0, accessGranted: false });
  copyTextToClipboard.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Lightning — access options', () => {
  it('lists the advertised mints and preselects the best one', () => {
    renderLightning();
    const options = screen.getByTestId('access-options');
    // getAccessOptions sorts by price/min_steps: 210/1 before 420/2
    expect(options.getAttribute('data-selected')).toBe('https://mint.example.com');
    const buttons = [...options.querySelectorAll('button')].map((b) =>
      b.getAttribute('data-mint')
    );
    expect(buttons).toEqual([
      'https://mint.example.com',
      'https://mint2.example.com',
    ]);
  });

  it('seeds the amount input with the selected mint price', () => {
    renderLightning();
    const input = document.getElementById('lightning-unit-amount');
    expect(input.value).toBe('210');
  });

  it.fails('offers no purchase path when the pricing event carries no usable option', () => {
    // Characterisation, not endorsement — and now expressed as a FAILING
    // expectation so it is not a contract against the fix.
    //
    // getAccessOptions() answers an ERROR OBJECT (TG004) rather than [] here,
    // so the component's `options.length` check is undefined and it does set
    // its LN001 error — which the amount effect then clears, because there is
    // no amount and no mint to validate. What the operator is left with is a
    // permanently DISABLED purchase button and no error at all: a dead end
    // with no explanation.
    //
    // The assertion below is therefore the CORRECT behaviour (an explanation is
    // shown). It fails today; a fix makes it pass and the `.fails` can be
    // dropped. Fixing product code is out of scope for this card.
    renderLightning({
      detailsEvent: { kind: 10021, tags: [['metric', 'milliseconds']] },
      deviceInfo: { type: 'mac', value: 'aa' },
    });
    expect(screen.queryByTestId('access-options')).toBeNull();
    const cta = screen.getByRole('button', { name: /purchase/ });
    expect(cta.disabled).toBe(true);
    // the point: the user is TOLD why there is nothing to buy
    expect(screen.getByTestId('status-error')).toBeTruthy();
  });

  it('shows the purchase CTA once an amount is valid', () => {
    renderLightning();
    const cta = screen.getByRole('button', { name: /purchase/ });
    expect(cta.disabled).toBe(false);
    // Renders the filled label with the price and the allocation
    expect(cta.innerHTML).toContain('purchase_filled');
  });

  it('renders the device info in the footer', () => {
    renderLightning();
    expect(screen.getByTestId('device-info').textContent).toBe('00:11:22:33:44:55');
  });
});

describe('Lightning — amount validation', () => {
  it('flags an amount below the mint price and disables the CTA', () => {
    renderLightning();
    const input = document.getElementById('lightning-unit-amount');
    fireEvent.change(input, { target: { value: '100' } });

    const error = screen.getByTestId('status-error');
    expect(error.getAttribute('data-code')).toBe('LN002');
    const disabled = screen.getAllByRole('button', { name: /purchase/ })[0];
    expect(disabled.disabled).toBe(true);
  });

  it('clears the error once the amount is back above the price', () => {
    renderLightning();
    const input = document.getElementById('lightning-unit-amount');
    fireEvent.change(input, { target: { value: '100' } });
    expect(screen.getByTestId('status-error')).toBeTruthy();

    fireEvent.change(input, { target: { value: '420' } });
    expect(screen.queryByTestId('status-error')).toBeNull();
  });

  it('accepts only positive numbers and clears the field on 0 or text', () => {
    renderLightning();
    const input = document.getElementById('lightning-unit-amount');

    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '630' } });
    expect(input.value).toBe('630');

    // Backspacing to empty keeps the field empty.
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
  });

  it('the +/- buttons step the amount by the mint price', () => {
    renderLightning();
    const input = document.getElementById('lightning-unit-amount');
    const [minus, plus] = screen.getAllByRole('button', { name: /^(–|\+)$/ });

    fireEvent.click(plus);
    expect(input.value).toBe('420');

    fireEvent.click(minus);
    expect(input.value).toBe('210');
  });

  it('the minus button is disabled at the minimum step', () => {
    renderLightning();
    const minus = screen.getByRole('button', { name: '–' });
    expect(minus.disabled).toBe(true);
  });
});

describe('Lightning — invoice flow', () => {
  it('requests an invoice for the selected amount and mint, carrying the MAC', async () => {
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    expect(screen.getByTestId('processing')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('processing')).toBeTruthy());
    await waitFor(() => expect(requestInvoice).toHaveBeenCalledTimes(1));

    const [amount, mintUrl, , deviceInfo] = requestInvoice.mock.calls[0];
    expect(amount).toBe(210);
    expect(mintUrl).toBe('https://mint.example.com');
    expect(deviceInfo).toEqual({ type: 'mac', value: '00:11:22:33:44:55' });
  });

  it('shows the invoice QR, the open-wallet link and the copy action', async () => {
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    await waitFor(() => expect(screen.getByText(/lightning_open_wallet/)).toBeTruthy());

    const anchors = [...document.querySelectorAll('a')];
    const wallet = anchors.find((a) => a.textContent.includes('lightning_open_wallet'));
    expect(wallet.getAttribute('href')).toBe(`lightning:${INVOICE.invoice}`);
    const qrAnchor = document.querySelector('.tollgate-captive-portal-method-invoice-svg');
    expect(qrAnchor.innerHTML).toContain(`data-invoice="${INVOICE.invoice}"`);

    fireEvent.click(screen.getByRole('button', { name: 'clipboard_copy' }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledTimes(1));
    expect(copyTextToClipboard.mock.calls[0][1]).toBe(INVOICE.invoice);
  });

  it('cancelling the invoice returns to the amount input', async () => {
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));
    // The input is already gone while `processing` is true, so wait for the
    // invoice step itself, not for the absence of the input.
    await waitFor(() =>
      expect(document.querySelector('.tollgate-captive-portal-method-invoice')).toBeTruthy()
    );

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() =>
      expect(document.getElementById('lightning-unit-amount')).toBeTruthy()
    );
    expect(document.querySelector('.tollgate-captive-portal-method-invoice')).toBeNull();
  });

  it('surfaces the backend refusal as the LN003 error', async () => {
    requestInvoice.mockResolvedValue({
      status: 0,
      code: 'LN003',
      label: 'LN003_label',
      message: 'invoice request failed',
    });
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    await waitFor(() => {
      const error = screen.getByTestId('status-error');
      expect(error.getAttribute('data-code')).toBe('LN003');
      expect(error.textContent).toContain('invoice request failed');
    });
    // Still on the input step, not on a broken invoice step.
    expect(document.getElementById('lightning-unit-amount')).toBeTruthy();
  });

  it('polls the invoice status and grants access when the backend says so', async () => {
    getInvoiceStatus.mockResolvedValue({ status: 1, accessGranted: true });
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    await waitFor(() => expect(screen.getByTestId('access-granted')).toBeTruthy(), {
      timeout: 3000,
    });
    expect(getInvoiceStatus).toHaveBeenCalled();
    const [quote, , deviceInfo] = getInvoiceStatus.mock.calls[0];
    expect(quote).toBe('quote-1');
    expect(deviceInfo).toEqual({ type: 'mac', value: '00:11:22:33:44:55' });
    expect(screen.getByTestId('access-granted').textContent).toContain('minute');
  });

  it('keeps polling while access is not granted, then stops once it is', async () => {
    let calls = 0;
    getInvoiceStatus.mockImplementation(async () => {
      calls += 1;
      return { status: 1, accessGranted: calls >= 2 };
    });
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    // The component polls on a real 2 s interval, so this test necessarily runs
    // longer than vitest's 5 s default: the first poll is immediate, the grant
    // lands on the second.
    await waitFor(() => expect(screen.getByTestId('access-granted')).toBeTruthy(), {
      timeout: 8000,
    });
    const settled = getInvoiceStatus.mock.calls.length;
    expect(settled).toBeGreaterThanOrEqual(2);
    // One interval period later, no further poll may have happened.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(getInvoiceStatus.mock.calls.length).toBe(settled);
  }, 20000);

  it('surfaces a status-poll failure as an error', async () => {
    getInvoiceStatus.mockResolvedValue({
      status: 0,
      code: 'LN004',
      label: 'LN004_label',
      message: 'status failed',
    });
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));

    await waitFor(() => {
      const error = screen.getByTestId('status-error');
      expect(error.getAttribute('data-code')).toBe('LN004');
    }, { timeout: 3000 });
  });

  it('"buy more time" returns to the empty amount input without leaving the page', async () => {
    getInvoiceStatus.mockResolvedValue({ status: 1, accessGranted: true });
    renderLightning();
    fireEvent.click(screen.getByRole('button', { name: /purchase/ }));
    await waitFor(() => expect(screen.getByTestId('access-granted')).toBeTruthy(), {
      timeout: 3000,
    });

    fireEvent.click(screen.getByTestId('renew'));

    await waitFor(() => {
      const input = document.getElementById('lightning-unit-amount');
      expect(input).toBeTruthy();
      expect(input.value).toBe('');
    });
    expect(screen.queryByTestId('access-granted')).toBeNull();
  });

  it('switching the mint re-seeds the amount and its allocation', () => {
    renderLightning();
    fireEvent.click(
      screen.getByTestId('access-options').querySelector('[data-mint="https://mint2.example.com"]')
    );

    const input = document.getElementById('lightning-unit-amount');
    expect(input.value).toBe('420');
    // 420 sats at 420 sats per 2 steps of 10 min = 10 min
    const cta = screen.getByRole('button', { name: /purchase/ });
    expect(cta.innerHTML).toContain('purchase_filled');
  });
});
