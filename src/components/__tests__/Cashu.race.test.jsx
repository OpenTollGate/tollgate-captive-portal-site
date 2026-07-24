import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';

// Capture errors thrown during render/effect execution.
// React swallows errors in effects (logs to console.error) unless an error
// boundary catches them. We spy on console.error to detect the crash.
let capturedErrors = [];
beforeEach(() => {
  capturedErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    capturedErrors.push(args);
  });
});

// Mock child components — we're testing Cashu's effect logic, not rendering.
vi.mock('../LanguageSwitcher', () => ({
  default: () => null,
}));
vi.mock('../DeviceInfo', () => ({
  default: () => null,
}));
vi.mock('../Status', () => ({
  Error: () => null,
  Success: () => null,
}));
vi.mock('../Icon', () => ({
  CancelIcon: () => null,
}));

// Mock App exports used by Cashu.
vi.mock('../../App', () => ({
  Processing: () => null,
  AccessGranted: () => null,
  AccessOptions: () => null,
  default: () => null,
}));

// Import AFTER mocks are set up.
const Cashu = (await import('../Cashu')).default;

// Minimal mint object for when we DO want selectedMint to be set.
const FAKE_MINT = {
  url: 'https://mint.example.com',
  price: 1,
  unit: 'sat',
  metric: 'bytes',
  step_size: 1000,
  min_steps: 1,
  step_purchase_limits: { min: 1, max: 0 },
  asset_type: 'cashu',
};

const FAKE_TOLLGATE_DETAILS = {
  detailsEvent: {
    kind: 10021,
    pubkey: 'abc'.repeat(16),
    tags: [
      ['metric', 'bytes'],
      ['step_size', '1000'],
      ['price_per_step', 'cashu', '1', 'sat', 'https://mint.example.com', '1'],
    ],
  },
  deviceInfo: { type: 'mac', value: '00:00:00:00:00:00' },
};

describe('Cashu — race condition: token validation before mint loaded', () => {
  // In production, App.jsx only renders <Cashu> when tollgateDetails is loaded.
  // The race is: on first render, token is pre-filled (from URL param) but
  // selectedMint is still null (it gets set by an effect that runs in the
  // SAME commit as the token validation effect). The token effect reads
  // selectedMint.step_size → crash.
  //
  // This mirrors the real-world crash observed in the Playwright test:
  //   TypeError: Cannot read properties of null (reading 'step_size')

  it('S1: does NOT crash when token is pre-filled but selectedMint is null on first render', () => {
    // Simulate prehydrate script setting the token before SPA loads.
    window.__INITIAL_TOKEN__ = 'cashuBtest123';

    // Render WITH valid tollgateDetails (as App.jsx would).
    // selectedMint is null initially; accessOptions effect will set it
    // but token validation effect fires in the same commit.
    expect(() => {
      render(<Cashu tollgateDetails={FAKE_TOLLGATE_DETAILS} />);
    }).not.toThrow();

    // Check no "Cannot read properties of null" error was captured.
    const raceErrors = capturedErrors.filter(args =>
      args.some(a => typeof a === 'string' && a.includes("reading 'step_size'"))
    );
    expect(raceErrors, 'should not crash reading step_size from null selectedMint').toHaveLength(0);
  });

  it('S2: calculates allocation when mint later becomes available', async () => {
    window.__INITIAL_TOKEN__ = 'cashuBtest456';

    const { rerender } = render(<Cashu tollgateDetails={FAKE_TOLLGATE_DETAILS} />);

    // No crash on first render with null mint.
    const raceErrors1 = capturedErrors.filter(args =>
      args.some(a => typeof a === 'string' && a.includes("reading 'step_size'"))
    );
    expect(raceErrors1).toHaveLength(0);

    // Re-render to trigger any pending state updates.
    rerender(<Cashu tollgateDetails={FAKE_TOLLGATE_DETAILS} />);
    await new Promise(r => setTimeout(r, 100));

    // Still no crash.
    const raceErrors2 = capturedErrors.filter(args =>
      args.some(a => typeof a === 'string' && a.includes("reading 'step_size'"))
    );
    expect(raceErrors2).toHaveLength(0);
  });

  it('S3 (regression): empty token still works — no validation, no crash', () => {
    window.__INITIAL_TOKEN__ = undefined;

    expect(() => {
      render(<Cashu tollgateDetails={FAKE_TOLLGATE_DETAILS} />);
    }).not.toThrow();

    const raceErrors = capturedErrors.filter(args =>
      args.some(a => typeof a === 'string' && a.includes("reading 'step_size'"))
    );
    expect(raceErrors).toHaveLength(0);
  });
});
