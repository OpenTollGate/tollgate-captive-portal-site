// Behavioural tests for src/components/BalancePage.jsx — 0% on the baseline.
//
// The page is a read-only balance lookup: paste or scan a Cashu token, see the
// time/bytes it buys against the tollgate's advertised pricing, and (when the
// host passes onNavigate) hand off to the purchase flow. Nothing here talks to
// a network: the mint lookup is a real decode of a real token, and the two
// input helpers (clipboard, QR) are doubled so their own failures can be
// selected per test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

// A real 1-sat v4 (`cashuB`) note; validateToken decodes it for real.
const REAL_TOKEN =
  'cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O';

const details = {
  detailsEvent: {
    kind: 10021,
    tags: [
      ['metric', 'milliseconds'],
      ['step_size', '600000'],
      ['step_purchase_limits', '1', '0'],
      ['price_per_step', 'cashu', '1', 'sat', 'https://mint.coinos.io', '1'],
    ],
  },
  deviceInfo: { type: 'mac', value: '00:11:22:33:44:55' },
};

vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({ default: () => null }));
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
  SuccessIcon: () => <span data-testid="success-icon" />,
  CancelIcon: () => <span data-testid="cancel-icon" />,
}));

const requestPaste = vi.fn();
vi.mock('../../src/helpers/clipboard.js', () => ({
  requestPaste: (...args) => requestPaste(...args),
}));

const requestScanQr = vi.fn();
// hasCameraSupport() is re-read per render, so a test can flip it.
const cameraSupport = { value: false };
vi.mock('../../src/helpers/qr-code.js', () => ({
  requestScanQr: (...args) => requestScanQr(...args),
  hasCameraSupport: () => cameraSupport.value,
}));

const BalancePage = (await import('../../src/components/BalancePage.jsx')).default;

const tokenInput = () => document.getElementById('balance-token');
const renderPage = (props = {}) =>
  render(<BalancePage tollgateDetails={details} {...props} />);

beforeEach(() => {
  cameraSupport.value = false;
  requestPaste.mockReset();
  requestScanQr.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BalancePage — initial state', () => {
  it('starts empty with the rate line and no balance', () => {
    renderPage();
    expect(tokenInput().value).toBe('');
    const display = document.querySelector('.balance-display');
    expect(display.getAttribute('data-state')).toBe('empty');
    expect(display.textContent).toContain('—');
    expect(display.textContent).toContain('balance_empty');
    // 1 sat per step of 600000 ms = 10 minutes per sat
    expect(display.textContent).toContain('balance_rate');
  });

  it('renders the device info footer', () => {
    renderPage();
    expect(screen.getByTestId('device-info').textContent).toBe('00:11:22:33:44:55');
  });

  it('offers paste but NOT scan when the camera API is unavailable', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'paste' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'scan_qr' })).toBeNull();
  });

  it('offers scan when the camera API is available', () => {
    cameraSupport.value = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'scan_qr' })).toBeTruthy();
  });
});

describe('BalancePage — token lookup', () => {
  it('derives the balance for a real token', async () => {
    renderPage();
    fireEvent.change(tokenInput(), { target: { value: REAL_TOKEN } });

    await waitFor(() => {
      const display = document.querySelector('.balance-display');
      expect(display.getAttribute('data-state')).toBe('filled');
    });
    const display = document.querySelector('.balance-display');
    // 1 sat buys one 600 s step = 10 minutes
    expect(display.textContent).toContain('10 minute_plural');
    expect(display.textContent).toContain('balance_summary');
    expect(screen.queryByTestId('status-error')).toBeNull();
  });

  it('reports a malformed token and keeps the display empty', async () => {
    renderPage();
    fireEvent.change(tokenInput(), { target: { value: 'not-a-cashu-token' } });

    await waitFor(() => {
      expect(screen.getByTestId('status-error').getAttribute('data-code')).toBe('CU101');
    });
    expect(document.querySelector('.balance-display').getAttribute('data-state')).toBe('empty');
  });

  it('clears the balance when the token is emptied', async () => {
    renderPage();
    fireEvent.change(tokenInput(), { target: { value: REAL_TOKEN } });
    await waitFor(() =>
      expect(document.querySelector('.balance-display').getAttribute('data-state'))
        .toBe('filled')
    );

    fireEvent.change(tokenInput(), { target: { value: '' } });
    await waitFor(() => {
      expect(document.querySelector('.balance-display').getAttribute('data-state'))
        .toBe('empty');
      expect(screen.queryByTestId('status-error')).toBeNull();
    });
  });

  it('a non-empty token swaps the paste/scan actions for a clear button', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'paste' })).toBeTruthy();

    fireEvent.change(tokenInput(), { target: { value: REAL_TOKEN } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'paste' })).toBeNull());
    expect(screen.getByTestId('cancel-icon')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(tokenInput().value).toBe('');
  });

  it('renders no error when the pricing event advertises nothing usable', () => {
    // Characterisation: without a mint there is nothing to validate against,
    // so the page stays in its empty state (no crash, no error box).
    renderPage({
      tollgateDetails: { detailsEvent: { kind: 10021, tags: [] }, deviceInfo: { type: 'mac', value: 'aa' } },
    });
    expect(document.querySelector('.balance-display').getAttribute('data-state')).toBe('empty');
    expect(screen.queryByTestId('status-error')).toBeNull();
    expect(document.querySelector('.balance-display').textContent).not.toContain('balance_rate');
  });
});

describe('BalancePage — paste', () => {
  it('fills the token from a successful paste', async () => {
    requestPaste.mockResolvedValue({ status: 1, value: REAL_TOKEN });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'paste' }));

    await waitFor(() => expect(tokenInput().value).toBe(REAL_TOKEN));
    await waitFor(() =>
      expect(document.querySelector('.balance-display').getAttribute('data-state'))
        .toBe('filled')
    );
  });

  it('surfaces a paste refusal instead of filling the field', async () => {
    requestPaste.mockResolvedValue({
      status: 0,
      code: 'CB001',
      label: 'CB001_label',
      message: 'CB001_message',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'paste' }));

    await waitFor(() =>
      expect(screen.getByTestId('status-error').getAttribute('data-code')).toBe('CB001')
    );
    expect(tokenInput().value).toBe('');
  });
});

describe('BalancePage — scan', () => {
  it('fills the token from a successful scan', async () => {
    cameraSupport.value = true;
    requestScanQr.mockResolvedValue({ status: 1, value: REAL_TOKEN });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'scan_qr' }));

    await waitFor(() => expect(tokenInput().value).toBe(REAL_TOKEN));
  });

  it('shows the scanning state while a scan is in flight', async () => {
    cameraSupport.value = true;
    let release;
    requestScanQr.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'scan_qr' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'scanning' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'scanning' }).disabled).toBe(true);

    release({ status: 1, value: REAL_TOKEN });
    // A successful scan fills the field, which swaps the actions for the clear
    // button — so the observable end state is the token, not a re-armed button.
    await waitFor(() => expect(tokenInput().value).toBe(REAL_TOKEN));
    expect(screen.queryByRole('button', { name: 'scanning' })).toBeNull();
  });

  it('surfaces a scan failure that carries a code', async () => {
    cameraSupport.value = true;
    requestScanQr.mockResolvedValue({
      status: 0,
      code: 'QR003',
      label: 'QR003_label',
      message: 'QR003_message',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'scan_qr' }));

    await waitFor(() =>
      expect(screen.getByTestId('status-error').getAttribute('data-code')).toBe('QR003')
    );
  });

  it('a silent cancellation shows nothing and leaves the field empty', async () => {
    cameraSupport.value = true;
    requestScanQr.mockResolvedValue({ status: 0, code: 0 });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'scan_qr' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'scan_qr' })).toBeTruthy());
    expect(screen.queryByTestId('status-error')).toBeNull();
    expect(tokenInput().value).toBe('');
  });
});

describe('BalancePage — navigation', () => {
  it('renders no purchase link unless the host passes onNavigate', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'balance_go_purchase' })).toBeNull();
  });

  it('hands off to the cashu flow when onNavigate is supplied', () => {
    const onNavigate = vi.fn();
    renderPage({ onNavigate });
    fireEvent.click(screen.getByRole('button', { name: 'balance_go_purchase' }));
    expect(onNavigate).toHaveBeenCalledWith('cashu');
  });
});
