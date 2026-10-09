// The forced password choice at first login.
//
// The module's packaging/files/etc/uci-defaults/99-tollgate-setup may have to
// MINT the router's root password (no controlling terminal at install time, so
// the operator can only choose one through the TOLLGATE_ADMIN_PASSWORD
// environment variable). When it mints one it records that FACT — never the
// value — in /etc/tollgate/admin-credential-provisional, and the marker's
// absence is the contract "the credential is the operator's own choice".
//
// Nothing consumed that marker before this change: a router whose password was
// printed once into a log (which the next full-setup run truncates) stayed on a
// generated credential forever. These tests pin the client half of the
// contract:
//
//   1. the pre-auth probe carries the marker state (`provisional`) alongside the
//      credential state, and a router that cannot answer is NEVER reported as
//      provisional — `unknown` is not the same as "present";
//   2. the forced-choice gate is a pure function of that state and it fails
//      CLOSED: while the marker stands the dashboard stays unreachable;
//   3. claiming the credential is ordered — the operator's password FIRST, the
//      marker SECOND — and a router that answers with the marker still present
//      raises instead of reporting success.
//
// Logic-level, no rendering: the forced screen is driven end-to-end in
// admin/tests/admin-provisional-password.spec.mjs against the real Preact app.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCredentialStatus,
  setRootPassword,
  claimAdminCredential,
} from '../../admin/src/lib/ubus';
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  PROVISIONAL_MARKER_PATH,
  requiresPasswordChoice,
  validatePasswordChoice,
} from '../../admin/src/lib/provisional';

function ubusReply(result) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
}

function bodyOf(fetchMock, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the provisional marker reaches the board', () => {
  it('is the path the module writes', () => {
    expect(PROVISIONAL_MARKER_PATH).toBe(
      '/etc/tollgate/admin-credential-provisional'
    );
  });

  it('reports provisional=true when the router answers with the marker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([
          0,
          { state: 'set', password_set: true, username: 'root', provisional: 1 },
        ])
      )
    );

    await expect(fetchCredentialStatus()).resolves.toMatchObject({
      state: 'set',
      passwordSet: true,
      provisional: true,
    });
  });

  it('reports provisional=false when the marker is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([
          0,
          { state: 'set', password_set: true, username: 'root', provisional: 0 },
        ])
      )
    );

    await expect(fetchCredentialStatus()).resolves.toMatchObject({
      provisional: false,
    });
  });

  it('never turns an unreadable router into a provisional one', async () => {
    // An older package has no plugin at all; an unreachable router answers
    // nothing. Neither is evidence that a generated credential is on the box,
    // and treating it as one would strand a correctly provisioned owner on the
    // forced-choice screen forever.
    for (const fetchMock of [
      vi.fn(async () => ubusReply([2, 'Object not found'])),
      vi.fn(async () => {
        throw new Error('network down');
      }),
    ]) {
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchCredentialStatus()).resolves.toMatchObject({
        state: 'unknown',
        provisional: false,
      });
    }
  });

  it('does not treat the string "1" as the marker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([0, { state: 'set', password_set: true, provisional: '1' }])
      )
    );

    await expect(fetchCredentialStatus()).resolves.toMatchObject({
      provisional: false,
    });
  });
});

describe('the forced-choice gate (pure)', () => {
  it('requires the choice exactly while the marker stands', () => {
    expect(requiresPasswordChoice({ provisional: true })).toBe(true);
    expect(requiresPasswordChoice({ provisional: false })).toBe(false);
  });

  it('treats a missing probe as "no forced choice", not as "forced"', () => {
    expect(requiresPasswordChoice(null)).toBe(false);
    expect(requiresPasswordChoice(undefined)).toBe(false);
    expect(requiresPasswordChoice({ state: 'unknown' })).toBe(false);
  });
});

describe('the new password policy', () => {
  const good = 'choosing-a-real-one';

  it('accepts a real, confirmed, long-enough password', () => {
    expect(validatePasswordChoice(good, good)).toBe('');
  });

  it('refuses an empty password', () => {
    expect(validatePasswordChoice('', '')).toMatch(/enter a new password/i);
  });

  it('refuses a whitespace-only password', () => {
    expect(validatePasswordChoice('   ', '   ')).toMatch(/password/i);
  });

  it('refuses a password shorter than the minimum', () => {
    const short = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);
    expect(validatePasswordChoice(short, short)).toMatch(/at least/i);
  });

  it('refuses a confirmation that does not match', () => {
    expect(validatePasswordChoice(good, `${good}!`)).toMatch(/do not match/i);
  });

  it('checks the password before the confirmation', () => {
    // An empty pair must read as "enter a new password", never as "mismatch".
    expect(validatePasswordChoice('', 'x')).toMatch(/enter a new password/i);
  });
});

describe('setting the operator’s own password', () => {
  it('is refused for a blank password without any ubus round trip', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(setRootPassword('')).rejects.toThrow(/password/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes through the router’s own system.password_set, for root', async () => {
    const fetchMock = vi.fn(async () => ubusReply([0, {}]));
    vi.stubGlobal('fetch', fetchMock);

    await setRootPassword('choosing-a-real-one');

    const body = bodyOf(fetchMock);
    expect(body.params[1]).toBe('system');
    expect(body.params[2]).toBe('password_set');
    expect(body.params[3]).toEqual({
      username: 'root',
      password: 'choosing-a-real-one',
    });
  });

  it('surfaces a router refusal instead of pretending it worked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ubusReply([6, 'Permission denied']))
    );

    await expect(setRootPassword('choosing-a-real-one')).rejects.toThrow();
  });
});

describe('claiming the credential drops the marker', () => {
  it('asks tollgate.admin_credential_claim', async () => {
    const fetchMock = vi.fn(async () =>
      ubusReply([0, { success: true, provisional: false }])
    );
    vi.stubGlobal('fetch', fetchMock);

    await claimAdminCredential();

    const body = bodyOf(fetchMock);
    expect(body.params[1]).toBe('tollgate');
    expect(body.params[2]).toBe('admin_credential_claim');
  });

  it('fails closed when the router answers with the marker still standing', async () => {
    // A router that did not actually drop the marker must not be reported as
    // "done": the operator would be walked to the dashboard and the next page
    // load would force the choice again (or, worse, never force it again).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([0, { success: true, provisional: true }])
      )
    );

    await expect(claimAdminCredential()).rejects.toThrow(/provisional/i);
  });

  it('fails closed when the router reports success:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([0, { success: false, error: 'marker is not removable' }])
      )
    );

    await expect(claimAdminCredential()).rejects.toThrow(/marker is not removable/);
  });
});
