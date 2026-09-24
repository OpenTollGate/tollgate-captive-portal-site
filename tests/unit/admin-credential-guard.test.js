// The :8090 admin board must refuse to run against a router whose root
// credential is UNSET. rpcd's login check (rpcd/session.c,
// rpc_login_test_password) returns TRUE when root's /etc/shadow hash is empty,
// so on a fresh deploy `session.login` accepts ANY password — including "" —
// and hands back a session carrying this board's ACL (file exec,
// system.password_set, wallet_drain_cashu).
//
// These tests pin the two halves of the client-side contract:
//   1. a blank credential is never sent (no click path may obtain a session
//      that proves nothing);
//   2. the router's credential STATE is read pre-auth, and an unset state is
//      reported as `empty` (the value the login screen fails closed on).
//
// Logic-level, no rendering: the login screen's fail-closed screen is driven
// end-to-end in admin/tests/admin-credential-guard.spec.mjs against the real
// Preact app.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCredentialStatus,
  login,
} from '../../admin/src/lib/ubus';

// The pre-auth session id rpcd uses for a login attempt.
const UBUS_ZERO = '00000000000000000000000000000000';

function ubusReply(result) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('blank credentials are never submitted', () => {
  it('refuses an empty password without any ubus round trip', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login('root', '')).rejects.toThrow(/empty password/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty username without any ubus round trip', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(login('   ', 'hunter2')).rejects.toThrow(/username/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('credential state probe (pre-auth)', () => {
  it('asks tollgate.auth_status with the unauthenticated session', async () => {
    const fetchMock = vi.fn(async () =>
      ubusReply([0, { state: 'set', password_set: true, username: 'root' }])
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchCredentialStatus();

    expect(status).toEqual({
      state: 'set',
      passwordSet: true,
      username: 'root',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toEqual([UBUS_ZERO, 'tollgate', 'auth_status', {}]);
  });

  it.each([
    ['set', true],
    ['locked', false],
    ['empty', false],
  ])('reports %s as state=%s', async (state, passwordSet) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ubusReply([0, { state, password_set: passwordSet }]))
    );

    const status = await fetchCredentialStatus();

    expect(status.state).toBe(state);
    expect(status.passwordSet).toBe(passwordSet);
  });

  it('maps an unrecognised state to unknown, never to set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ubusReply([0, { state: 'something-new' }]))
    );

    const status = await fetchCredentialStatus();

    expect(status.state).toBe('unknown');
    expect(status.passwordSet).toBe(false);
  });

  it('is unknown (not "set") when the plugin is missing or denies access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ubusReply([2, 'Object not found']))
    );

    await expect(fetchCredentialStatus()).resolves.toMatchObject({
      state: 'unknown',
      passwordSet: false,
    });
  });

  it('is unknown when the router cannot be reached at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    await expect(fetchCredentialStatus()).resolves.toMatchObject({
      state: 'unknown',
      passwordSet: false,
    });
  });

  it('does not treat a string "true" as a set credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ubusReply([0, { state: 'set', password_set: 'true' }]))
    );

    const status = await fetchCredentialStatus();

    expect(status.passwordSet).toBe(false);
  });

  it('never reports a full hash or password field to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ubusReply([
          0,
          {
            state: 'set',
            password_set: true,
            username: 'root',
            hash: '$1$abc$def',
          },
        ])
      )
    );

    const status = await fetchCredentialStatus();

    expect(Object.keys(status).sort()).toEqual([
      'passwordSet',
      'state',
      'username',
    ]);
  });
});
