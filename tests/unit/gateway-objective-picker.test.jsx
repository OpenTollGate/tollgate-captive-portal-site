import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import en from '../../public/locales/en.json';
import { parseObjectivesPayload, objectiveLabelKey } from '../../src/helpers/objectives.js';

// The picker is gated on a capability statement the backend does not serve yet.
// These tests pin the three behaviours that make that gating honest:
//
//   (a) no endpoint (404)            -> nothing renders at all
//   (b) allow_change:"never"         -> options visible but disabled, with the
//                                       next-session sentence explaining why
//   (c) an active session           -> the next-session copy and the
//                                       "Use for next session" CTA are present,
//                                       and the word "switch" never appears
//
// react-i18next is mocked globally in src/test/setup.js so `t(key)` returns the
// key itself. That makes the assertions check the KEY the component asks for,
// which is exactly the contract: if the component asked for a key the catalog
// does not define, the last test here fails.

const VALID_BODY = {
  enabled: true,
  allow_change: 'next_session',
  current: 'balanced',
  objectives: [
    { id: 'minimize_cost', label: 'Cheapest', summary: 'One line, lowest price' },
    { id: 'maximize_speed', label: 'Fastest', summary: 'One line, highest rate' },
    { id: 'balanced', label: 'Balanced' },
  ],
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const notFound = () => ({
  ok: false,
  status: 404,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON at position 0');
  },
});

// import after the global i18n mock (setupFiles) is in place
const { default: GatewayObjectivePicker, ctaState } = await import(
  '../../src/components/GatewayObjectivePicker.jsx'
);

// jsdom has no fetch by default in this vitest version; the component takes the
// fetch implementation as a prop, so no global stub is needed — but the portal
// itself calls globalThis.fetch, so keep it out of the way.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in unit tests'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GatewayObjectivePicker — hidden unless the backend serves the capability', () => {
  it('(a) renders nothing when GET /api/multi_wan/objectives 404s', async () => {
    const fetchImpl = vi.fn(async () => notFound());
    const { container } = render(<GatewayObjectivePicker fetchImpl={fetchImpl} />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    // give the resolved promise a turn to commit any (wrong) state
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('gateway-objectives')).toBeNull();
    expect(screen.queryByTestId('gateway-objectives-submit')).toBeNull();
  });

  it('renders nothing on a transport error / timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const { container } = render(<GatewayObjectivePicker fetchImpl={fetchImpl} />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the body is enabled:false', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ enabled: false, allow_change: 'next_session', current: 'balanced', objectives: [] }),
    );
    const { container } = render(<GatewayObjectivePicker fetchImpl={fetchImpl} />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the body is malformed', async () => {
    const malformed = [
      null,
      'nope',
      [],
      // current names an objective that is not offered
      { ...VALID_BODY, current: 'cost' },
      // the mode is not a statement this UI understands
      { ...VALID_BODY, allow_change: 'always' },
      // objectives missing / empty
      { ...VALID_BODY, objectives: [] },
      // an entry with no id
      { ...VALID_BODY, objectives: [{ label: 'No id' }] },
      // duplicated id
      { ...VALID_BODY, objectives: [VALID_BODY.objectives[0], VALID_BODY.objectives[0]] },
    ];

    for (const body of malformed) {
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      const { container, unmount } = render(<GatewayObjectivePicker fetchImpl={fetchImpl} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      await waitFor(() => expect(container.innerHTML).toBe(''));
      expect(container.innerHTML, `body ${JSON.stringify(body)} must render nothing`).toBe('');
      unmount();
    }
  });
});

describe('GatewayObjectivePicker — allow_change:"never"', () => {
  it('(b) shows the options disabled and explains that it applies next session', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...VALID_BODY, allow_change: 'never' }),
    );
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} />);

    const section = await screen.findByTestId('gateway-objectives');
    expect(section).toHaveAttribute('data-locked', 'true');

    // every option is visible (never a hidden control) but not selectable
    for (const id of ['minimize_cost', 'maximize_speed', 'balanced']) {
      const row = screen.getByTestId(`gateway-objective-${id}`);
      expect(row).toBeInTheDocument();
      const radio = row.querySelector('input[type="radio"]');
      expect(radio).toBeDisabled();
    }

    // the fieldset is disabled too, so the browser blocks the whole group
    const fieldset = section.querySelector('fieldset');
    expect(fieldset).toBeDisabled();

    // ...and the buyer is told why, in the next-session sentence. The sentence
    // lives in the note: a disabled CTA must stay a short label, not carry a
    // paragraph of explanation as its own text.
    expect(screen.getByTestId('gateway-applies-next-session')).toHaveTextContent(
      'gateway.applies_next_session',
    );
    // the submit is inert rather than absent
    const submit = screen.getByTestId('gateway-objectives-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('gateway.choice_locked');
  });

  it('does not call the write route while locked', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...VALID_BODY, allow_change: 'never' }));
    const submitImpl = vi.fn();
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} submitImpl={submitImpl} />);

    await screen.findByTestId('gateway-objectives');
    fireEvent.click(screen.getByTestId('gateway-objective-minimize_cost'));
    fireEvent.click(screen.getByTestId('gateway-objectives-submit'));

    expect(submitImpl).not.toHaveBeenCalled();
    // only the capability read happened
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('GatewayObjectivePicker — active session copy', () => {
  it('(c) says the change applies to the next session and never promises a switch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY));
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} sessionActive />);

    await screen.findByTestId('gateway-objectives');
    // the sentence is on screen before any interaction, because a session runs
    expect(screen.getByTestId('gateway-applies-next-session')).toHaveTextContent(
      'gateway.applies_next_session',
    );

    // select a DIFFERENT objective -> the CTA must be the honest next-session one
    fireEvent.click(screen.getByTestId('gateway-objective-maximize_speed'));
    const submit = screen.getByTestId('gateway-objectives-submit');
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveTextContent('gateway.use_for_next_session');

    // the forbidden promise
    expect(screen.queryByText(/switch now/i)).toBeNull();
    expect(submit.textContent.toLowerCase()).not.toContain('switch');
  });

  it('renders no CTA at all while the current objective is selected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY));
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} sessionActive />);

    await screen.findByTestId('gateway-objectives');
    // nothing to apply: no dead button next to the option already marked current
    expect(screen.queryByTestId('gateway-objectives-submit')).toBeNull();
    // ...but the current objective is still named, and the timing is still stated
    expect(screen.getByTestId('gateway-objective-balanced')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('gateway-applies-next-session')).toHaveTextContent(
      'gateway.applies_next_session',
    );

    // staging a change brings the CTA back
    fireEvent.click(screen.getByTestId('gateway-objective-maximize_speed'));
    expect(screen.getByTestId('gateway-objectives-submit')).toHaveTextContent(
      'gateway.use_for_next_session',
    );
  });

  it('stores the pick for the next session and reports exactly that', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY));
    // the write route answers 204: a stored choice, nothing to say but "next session"
    const submitImpl = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} submitImpl={submitImpl} sessionActive />);

    await screen.findByTestId('gateway-objectives');
    fireEvent.click(screen.getByTestId('gateway-objective-minimize_cost'));
    fireEvent.click(screen.getByTestId('gateway-objectives-submit'));

    await waitFor(() => expect(submitImpl).toHaveBeenCalled());
    // submitImpl is the fetch seam: it receives (url, init), not the id
    const [url, init] = submitImpl.mock.calls[0];
    expect(url).toContain('/api/multi_wan/objectives');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ objective: 'minimize_cost' });
    expect(await screen.findByTestId('gateway-objectives-stored')).toHaveTextContent(
      'gateway.applies_next_session',
    );
  });

  it('says the choice is unavailable when the write route is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY));
    // a read-only backend: the GET answers but POST is 404
    const submitImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }));
    render(<GatewayObjectivePicker fetchImpl={fetchImpl} submitImpl={submitImpl} />);

    await screen.findByTestId('gateway-objectives');
    fireEvent.click(screen.getByTestId('gateway-objective-minimize_cost'));
    fireEvent.click(screen.getByTestId('gateway-objectives-submit'));

    expect(await screen.findByTestId('gateway-objectives-unsupported')).toHaveTextContent(
      'gateway.unavailable',
    );
    // no false success
    expect(screen.queryByTestId('gateway-objectives-stored')).toBeNull();
  });
});

describe('ctaState', () => {
  const t = (key) => key;

  it('hides the CTA on the current objective — no dead control', () => {
    expect(ctaState({ selected: 'balanced', current: 'balanced', allowChange: 'next_session', t }))
      .toEqual({ label: 'gateway.current', disabled: true, hidden: true });
  });

  it('offers the next-session label for a change, active session or not', () => {
    expect(ctaState({ selected: 'minimize_cost', current: 'balanced', allowChange: 'next_session', t }))
      .toEqual({ label: 'gateway.use_for_next_session', disabled: false, hidden: false });
  });

  it('is inert when the router forbids a change', () => {
    expect(ctaState({ selected: 'minimize_cost', current: 'balanced', allowChange: 'never', t }))
      .toEqual({ label: 'gateway.choice_locked', disabled: true, hidden: false });
  });
});

describe('objective helpers', () => {
  it('accepts the documented payload', () => {
    const parsed = parseObjectivesPayload(VALID_BODY);
    expect(parsed).not.toBeNull();
    expect(parsed.current).toBe('balanced');
    expect(parsed.allowChange).toBe('next_session');
    expect(parsed.objectives.map((o) => o.id)).toEqual([
      'minimize_cost',
      'maximize_speed',
      'balanced',
    ]);
    expect(parsed.objectives[2].summary).toBeNull();
  });

  it('maps both id spellings the backend may use onto catalog copy', () => {
    expect(objectiveLabelKey('minimize_cost')).toBe('gateway.objective.minimize_cost');
    expect(objectiveLabelKey('cost')).toBe('gateway.objective.minimize_cost');
    expect(objectiveLabelKey('maximize_speed')).toBe('gateway.objective.maximize_speed');
    expect(objectiveLabelKey('speed')).toBe('gateway.objective.maximize_speed');
    expect(objectiveLabelKey('balanced')).toBe('gateway.objective.balanced');
    expect(objectiveLabelKey('something_else')).toBeNull();
  });
});

describe('catalog coverage', () => {
  // The picker asks for these via t(); a missing key renders the raw key on the
  // page. Same shape as tests/unit/locales-ln-keys.test.js.
  const REQUIRED = [
    'gateway.choose.title',
    'gateway.choose.subtitle',
    'gateway.objective.minimize_cost',
    'gateway.objective.maximize_speed',
    'gateway.objective.balanced',
    'gateway.applies_next_session',
    'gateway.current',
    'gateway.unavailable',
    'gateway.choice_locked',
    'gateway.use_for_next_session',
  ];

  it('defines every gateway key the picker uses', () => {
    for (const key of REQUIRED) {
      expect(typeof en[key], `${key} missing from public/locales/en.json`).toBe('string');
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(en[key]).not.toBe(key);
    }
  });

  it('never tells the buyer the switch happens now', () => {
    for (const key of REQUIRED) {
      expect(en[key].toLowerCase()).not.toContain('switch now');
    }
    expect(en['gateway.use_for_next_session']).toBe('Use for next session');
    expect(en['gateway.applies_next_session']).toMatch(/next session/i);
  });
});
