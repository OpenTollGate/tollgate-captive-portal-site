import { mockUbusCall, mockLogin, mockSessionId, mockCredentialStatus } from './ubus.mock';
import { BRAND } from '../brand';

const MOCK = import.meta.env.VITE_MOCK === 'true';

export function isMock(): boolean {
  return MOCK;
}

const UBUS_URL = '/ubus';
const SESSION_KEY = BRAND.sessionKey;
const SESSION_USER = BRAND.sessionUser;

let sessionId: string = MOCK ? mockSessionId() : '00000000000000000000000000000000';

const saved = localStorage.getItem(SESSION_KEY);
if (saved) sessionId = saved;

let rpcId = 0;

const UBUS_ZERO = '00000000000000000000000000000000';

// ─── Router root credential state ────────────────────────────────────
//
// The :8090 board must NOT authenticate against a router whose root
// /etc/shadow hash is unset. rpcd's rpc_login_test_password()
// (rpcd/session.c) starts with `if (!hash || !*hash) return true;`, so on an
// empty hash session.login accepts ANY password — including "" — and the
// session it returns carries this board's ACL (file exec,
// system.password_set, wallet_drain_cashu). "I got a session" is therefore not
// evidence of anything while the hash is empty.
//
// So the board asks for the credential STATE first, through the rpcd plugin's
// `tollgate auth_status` method (callable pre-auth via the `unauthenticated`
// ACL group), and refuses to render a login form at all when it reports no
// usable credential.
//
// States: `set` (a real hash — only the real password matches), `locked`
// ('!'/'*' — nobody can authenticate by password), `empty` (any password,
// including "", authenticates), `unknown` (could not be determined: older
// package, no plugin, unreachable router).
export type CredentialState = 'set' | 'locked' | 'empty' | 'unknown';

export interface CredentialStatus {
  state: CredentialState;
  passwordSet: boolean;
  username: string;
}

function parseCredentialStatus(data: any): CredentialStatus {
  const raw = typeof data?.state === 'string' ? data.state.toLowerCase() : '';
  const state: CredentialState =
    raw === 'set' || raw === 'locked' || raw === 'empty' ? raw : 'unknown';
  return {
    state,
    // Be strict about the boolean: only an explicit true/1 counts as "set".
    passwordSet: data?.password_set === true || data?.password_set === 1,
    username: typeof data?.username === 'string' && data.username
      ? data.username
      : 'root',
  };
}

// A credential state we could not read must not be silently treated as safe,
// but it must not lock an owner out of a board that is probably fine either:
// `unknown` warns in the UI and the ROUTER-side plugin still refuses every
// privileged call while the hash is unset (defense in depth).
function unknownCredentialStatus(): CredentialStatus {
  return { state: 'unknown', passwordSet: false, username: 'root' };
}

// fetchCredentialStatus never throws.
export async function fetchCredentialStatus(): Promise<CredentialStatus> {
  if (MOCK) {
    return parseCredentialStatus(mockCredentialStatus());
  }
  try {
    const res = await fetch(UBUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'call',
        params: [UBUS_ZERO, 'tollgate', 'auth_status', {}],
      }),
    });
    const json = await res.json();
    if (json.error || !json.result || json.result[0] !== 0) {
      return unknownCredentialStatus();
    }
    return parseCredentialStatus(json.result[1]);
  } catch {
    return unknownCredentialStatus();
  }
}

// ubus status results we surface by name (rpcd returns these in result[0]).
const UBUS_STATUS: Record<number, string> = {
  2: 'not-found',
  3: 'not-found',
  4: 'no-data',
  5: 'invalid-argument',
  6: 'permission-denied',
};

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionId = UBUS_ZERO;
}

// probeSessionValid asks the daemon whether the current session can call
// session.access, WITHOUT throwing. Used to tell a genuinely dead session
// (rpcd -32002 that is not an ACL denial) from a plain access-denied, so we
// stop mislabeling permission errors as SESSION_EXPIRED.
async function probeSessionValid(): Promise<boolean> {
  if (MOCK) return true;
  if (sessionId === UBUS_ZERO) return false;
  try {
    const res = await fetch(UBUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'call',
        params: [
          sessionId,
          'session',
          'access',
          { scope: 'ubus', object: 'session', function: 'login' },
        ],
      }),
    });
    const json = await res.json();
    return !json.error && !!json.result && json.result[0] === 0;
  } catch {
    return false;
  }
}

export async function ubusCall(
  obj: string,
  method: string,
  params: Record<string, any> = {}
): Promise<any> {
  if (MOCK) {
    return mockUbusCall(obj, method, params);
  }

  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'call',
      params: [sessionId, obj, method, params],
    }),
  });
  const json = await res.json();
  if (json.error) {
    // rpcd returns -32002 ("access denied") for BOTH an invalid/expired
    // session and an ACL denial. Confirm with a session probe before
    // declaring the session dead; otherwise it is an access/permission error.
    if (json.error.code === -32002) {
      if (!(await probeSessionValid())) {
        clearSession();
        // Let the app redirect to login regardless of which route noticed.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tollgate:session-expired'));
        }
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error('ACCESS_DENIED');
    }
    throw new Error(`ubus error: ${json.error.message || 'unknown'}`);
  }
  if (!json.result) throw new Error('No result from ubus');
  if (json.result[0] !== 0) {
    // result codes are object-level errors (3 not-found, 5 invalid-arg,
    // 6 permission-denied). None of these mean the session expired.
    const code = json.result[0];
    throw new Error(
      `ubus error ${code}: ${json.result[1] || UBUS_STATUS[code] || 'unknown'}`
    );
  }
  return json.result[1];
}

export async function login(
  username: string,
  password: string
): Promise<any> {
  // A blank credential is NEVER sent. On a router whose root hash is unset an
  // empty password authenticates (rpcd returns true for any password against
  // an empty hash), so accepting one here would hand out a session that proves
  // nothing — exactly the state the board refuses to run against. The router
  // also rejects an empty password at `passwd`, so there is no legitimate case
  // for an empty one.
  if (!username.trim()) {
    throw new Error('Username is required');
  }
  if (password === '') {
    throw new Error(
      'Enter the router password — an empty password is not accepted'
    );
  }

  if (MOCK) {
    const data = await mockLogin(username, password);
    sessionId = data.ubus_rpc_session;
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.setItem(SESSION_USER, username);
    return data;
  }

  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'call',
      params: [
        '00000000000000000000000000000000',
        'session',
        'login',
        { username, password },
      ],
    }),
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error('Invalid username or password');
  }

  if (!json.result || json.result[0] !== 0) {
    throw new Error('Invalid username or password');
  }
  const data = json.result[1];
  sessionId = data.ubus_rpc_session;
  localStorage.setItem(SESSION_KEY, sessionId);
  localStorage.setItem(SESSION_USER, username);
  return data;
}

export function logout() {
  localStorage.removeItem(SESSION_USER);
  clearSession();
}

export async function checkSession(): Promise<boolean> {
  return probeSessionValid();
}

export function isLoggedIn(): boolean {
  return sessionId !== '00000000000000000000000000000000';
}

export function getSessionUser(): string {
  return localStorage.getItem(SESSION_USER) || (MOCK ? 'root' : '');
}
