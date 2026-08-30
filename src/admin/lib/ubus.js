const UBUS_URL = '/ubus';
const SESSION_KEY = 'tollgate_admin_session';
const SESSION_USER = 'tollgate_admin_user';

let sessionId = '00000000000000000000000000000000';

const saved = localStorage.getItem(SESSION_KEY);
if (saved) sessionId = saved;

let rpcId = 0;

export async function ubusCall(obj, method, params = {}) {
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
  if (!json.result) throw new Error('No result from ubus');
  if (json.result[0] !== 0) {
    if (json.result[0] === 6) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_USER);
      sessionId = '00000000000000000000000000000000';
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(
      `ubus error ${json.result[0]}: ${json.result[1] || 'unknown'}`
    );
  }
  return json.result[1];
}

export async function login(username, password) {
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
  const json = await res.json();
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
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_USER);
  sessionId = '00000000000000000000000000000000';
}

export async function checkSession() {
  if (sessionId === '00000000000000000000000000000000') return false;
  try {
    await ubusCall('session', 'access', {
      scope: 'ubus',
      object: 'session',
      function: 'login',
    });
    return true;
  } catch {
    return false;
  }
}

export function isLoggedIn() {
  return sessionId !== '00000000000000000000000000000000';
}

export function getSessionUser() {
  return localStorage.getItem(SESSION_USER) || '';
}
