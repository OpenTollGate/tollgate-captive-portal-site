import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { getEncodedToken } from '@cashu/cashu-ts';

// The mint swap-fee lookup fetches the mint's /v1/keysets over the network.
// These tests are about mint SELECTION, so stub it to "no pre-check".
vi.mock('../../src/helpers/mint-fee.js', () => ({
  getMintSwapFee: async () => ({ status: 0 }),
}));

// LanguageSwitcher pulls in the real i18next instance (src/helpers/i18n.js),
// which the shared setup mocks out — replace it like Cashu.race.test.jsx does.
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({ default: () => null }));

// The shared setup returns a FRESH `t` on every useTranslation() call, so any
// effect with `t` in its dependency list re-runs after every render. With a
// token that actually decodes (these tests) that ping-pongs state updates and
// hangs the test. Use a stable translation function / api object instead — this
// mirrors the real i18next instance, whose `t` is stable across renders.
vi.mock('react-i18next', () => {
  const t = (key, opts) =>
    typeof opts === 'object' && opts !== null ? key + JSON.stringify(opts) : key;
  const api = { t, i18n: { language: 'en' }, ready: true };
  return {
    useTranslation: () => api,
    Trans: ({ children }) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

import Cashu from '../../src/components/Cashu.jsx';
import en from '../../public/locales/en.json';

// Real coinos v4 note (same bytes as tests/unit/mint-fee.test.js and
// tests/unit/cashu-mint-url.test.js): mint https://mint.coinos.io.
const COINOS_TOKEN =
  "cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O";

// A second, DIFFERENT note from the same accepted mint (different amount, same
// mint) — used to prove the selection is re-derived when the note changes.
const COINOS_TOKEN_2 = getEncodedToken({
  mint: 'https://mint.coinos.io',
  unit: 'sat',
  proofs: [
    { amount: 420, id: '01182e5f5e35aecd', secret: 'coinos-fixture-2', C: `02${'b'.repeat(64)}` },
  ],
});

// A note from a mint the router below does NOT advertise.
const UNSUPPORTED_MINT = 'https://mint.cubabitcoin.org';
const UNSUPPORTED_TOKEN = getEncodedToken({
  mint: UNSUPPORTED_MINT,
  unit: 'sat',
  proofs: [
    { amount: 420, id: '01ad268c4d1f5826', secret: 'unsupported-fixture', C: `02${'a'.repeat(64)}` },
  ],
});

// Router advertisement: minibits is the CHEAPEST option, so it is the default
// selection (options are sorted by price per step). Auto-select must therefore
// move the selection to coinos when the coinos note is pasted — otherwise the
// assertion would pass on the default alone.
const TOLLGATE_DETAILS = {
  detailsEvent: {
    kind: 10021,
    pubkey: 'a'.repeat(64),
    tags: [
      ['metric', 'milliseconds'],
      ['step_size', '600000'],
      ['step_purchase_limits', '1', '0'],
      ['price_per_step', 'cashu', '210', 'sat', 'https://mint.coinos.io', '1'],
      ['price_per_step', 'cashu', '100', 'sat', 'https://mint.minibits.cash/Bitcoin', '1'],
    ],
  },
  deviceInfo: { type: 'mac', value: '00:11:22:33:44:55' },
};

// The option button rendered for a mint — identified by its stripped address.
const optionButton = (host) =>
  screen.getAllByRole('button').find((button) => button.textContent.includes(host));

const isActive = (host) => {
  const button = optionButton(host);
  return !!button && button.className.includes('active');
};

// paste/type into the token field (the same DOM node the portal uses)
const typeToken = (value) => {
  fireEvent.change(document.getElementById('cashu-token'), { target: { value } });
};

const renderCashu = async () => {
  render(<Cashu tollgateDetails={TOLLGATE_DETAILS} />);
  // the access-option list renders once the options effect has run
  await waitFor(() => expect(optionButton('mint.coinos.io')).toBeTruthy());
};

beforeEach(() => {
  window.__INITIAL_TOKEN__ = undefined;
});

afterEach(() => {
  cleanup();
  window.__INITIAL_TOKEN__ = undefined;
});

describe('Cashu purchase page — auto-select the mint from the note', () => {
  it('starts on the cheapest advertised option with no note pasted', async () => {
    await renderCashu();
    expect(isActive('mint.minibits.cash')).toBe(true);
    expect(isActive('mint.coinos.io')).toBe(false);
  });

  it('selects the coinos option from the pasted coinos note — with no click', async () => {
    await renderCashu();
    expect(isActive('mint.coinos.io')).toBe(false);

    typeToken(COINOS_TOKEN);

    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));
    expect(isActive('mint.minibits.cash')).toBe(false);
    // no unsupported-mint notice for a mint the router accepts
    expect(screen.queryByText(/unsupported_mint_notice/)).toBeNull();
  });

  it('auto-selects from a prehydrated ?token= note (TIP-03 URL delivery)', async () => {
    window.__INITIAL_TOKEN__ = COINOS_TOKEN;
    await renderCashu();
    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));
    expect(isActive('mint.minibits.cash')).toBe(false);
  });

  it('selects nothing and warns (naming the mint) when the note mint is not accepted', async () => {
    await renderCashu();

    typeToken(UNSUPPORTED_TOKEN);

    await waitFor(() => expect(screen.getByText(/unsupported_mint_notice/)).toBeTruthy());
    expect(screen.getByText(/unsupported_mint_notice/).textContent).toContain(UNSUPPORTED_MINT);
    // nothing is selected…
    expect(isActive('mint.coinos.io')).toBe(false);
    expect(isActive('mint.minibits.cash')).toBe(false);
    // …but every option is still offered, so the user can pick one
    expect(optionButton('mint.coinos.io')).toBeTruthy();
    expect(optionButton('mint.minibits.cash')).toBeTruthy();
  });

  it('lets a manual click override the auto-selection', async () => {
    await renderCashu();
    typeToken(COINOS_TOKEN);
    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));

    fireEvent.click(optionButton('mint.minibits.cash'));

    expect(isActive('mint.minibits.cash')).toBe(true);
    expect(isActive('mint.coinos.io')).toBe(false);
  });

  it('re-derives the selection when a new note arrives', async () => {
    await renderCashu();
    typeToken(COINOS_TOKEN);
    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));

    // a manual click wins…
    fireEvent.click(optionButton('mint.minibits.cash'));
    expect(isActive('mint.minibits.cash')).toBe(true);

    // …until a DIFFERENT note arrives, which is re-derived
    typeToken(COINOS_TOKEN_2);
    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));
    expect(isActive('mint.minibits.cash')).toBe(false);
  });

  it('stays quiet while the user is still typing a partial token', async () => {
    await renderCashu();

    typeToken('cashuB');
    typeToken('cashuBo2Ftdmh0dHBz');           // truncated mid-paste
    typeToken(COINOS_TOKEN.slice(0, 60));      // still truncated

    expect(screen.queryByText(/unsupported_mint_notice/)).toBeNull();
    // the selection is left exactly as it was — no churn
    expect(isActive('mint.minibits.cash')).toBe(true);
    expect(isActive('mint.coinos.io')).toBe(false);
  });

  it('clears the warning when the user replaces an unsupported note with a good one', async () => {
    await renderCashu();

    typeToken(UNSUPPORTED_TOKEN);
    await waitFor(() => expect(screen.getByText(/unsupported_mint_notice/)).toBeTruthy());

    typeToken(COINOS_TOKEN);

    await waitFor(() => expect(isActive('mint.coinos.io')).toBe(true));
    expect(screen.queryByText(/unsupported_mint_notice/)).toBeNull();
  });
});

// The notice text is part of the portal's translation catalog. i18next renders
// the literal key when a string is missing (the LN003/LN004 lesson), so guard
// the key exists and can name the offending mint.
describe('en.json unsupported-mint notice key', () => {
  it('defines unsupported_mint_notice with a {{mint}} placeholder', () => {
    expect(typeof en.unsupported_mint_notice).toBe('string');
    expect(en.unsupported_mint_notice.trim().length).toBeGreaterThan(0);
    expect(en.unsupported_mint_notice).toContain('{{mint}}');
  });
});
