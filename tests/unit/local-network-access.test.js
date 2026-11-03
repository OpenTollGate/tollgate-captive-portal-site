// Unit gate for src/helpers/local-network-access.js.
//
// This module encodes a set of naming traps that were measured on Chrome 156 and
// are cheap to get wrong in a way nothing else catches:
//
//   - the web PermissionName is KEBAB-case (`local-network-access`); the
//     camelCase spelling is REJECTED as an invalid enum value;
//   - the error is reported as a CORS failure, so a pure "is it CORS?" check
//     sends an implementer chasing headers forever;
//   - an unsupported descriptor must NOT read as "denied", or every browser
//     that predates LNA loses working router calls.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LNA_PERMISSION_NAME,
  canReachRouter,
  hasLocalNetworkAccessGate,
  isPrivateOrLoopbackTarget,
  looksLikeLocalNetworkDenial,
  queryAllLocalNetworkStates,
  queryLocalNetworkAccessState,
} from '../../src/helpers/local-network-access.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stub navigator.permissions.query to answer per-descriptor. */
function stubPermissions(map) {
  const queries = [];
  vi.stubGlobal('navigator', {
    permissions: {
      query: (desc) => {
        queries.push(desc.name);
        if (Object.prototype.hasOwnProperty.call(map, desc.name)) {
          return Promise.resolve({ state: map[desc.name], name: desc.name });
        }
        return Promise.reject(
          new TypeError(`'${desc.name}' is not a valid enum value of type PermissionName.`)
        );
      },
    },
  });
  return queries;
}

describe('LNA: the permission name is kebab-case', () => {
  it('uses the kebab-case web name, never camelCase', () => {
    expect(LNA_PERMISSION_NAME).toBe('local-network-access');
    expect(LNA_PERMISSION_NAME).not.toMatch(/[A-Z]/);
  });

  it('reports the state for the kebab-case descriptor', async () => {
    stubPermissions({ 'local-network-access': 'granted' });
    await expect(queryLocalNetworkAccessState()).resolves.toBe('granted');
  });

  it("the camelCase spelling is rejected by the browser, and we surface 'unknown' not 'denied'", async () => {
    // Reproduces the measured rejection: the descriptor simply is not in the enum.
    stubPermissions({}); // every query rejects
    await expect(queryLocalNetworkAccessState()).resolves.toBe('unknown');
  });
});

describe('LNA: an unqueried gate must never read as denial', () => {
  it('returns unknown with no Permissions API (pre-LNA browser)', async () => {
    vi.stubGlobal('navigator', {});
    expect(hasLocalNetworkAccessGate()).toBe(false);
    await expect(queryLocalNetworkAccessState()).resolves.toBe('unknown');
    // A browser with no gate needs no grant, so the router must stay reachable.
    await expect(canReachRouter()).resolves.toBe(true);
  });

  it('canReachRouter is true on prompt — the FETCH raises the prompt, not the query', async () => {
    stubPermissions({ 'local-network-access': 'prompt' });
    await expect(canReachRouter()).resolves.toBe(true);
  });

  it('canReachRouter is false only on an explicit denial', async () => {
    stubPermissions({ 'local-network-access': 'denied' });
    await expect(canReachRouter()).resolves.toBe(false);
  });

  it('survives a permissions.query that throws synchronously', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: () => {
          throw new Error('boom');
        },
      },
    });
    await expect(queryLocalNetworkAccessState()).resolves.toBe('unknown');
    expect(() => hasLocalNetworkAccessGate()).not.toThrow();
  });
});

describe('LNA: queryAllLocalNetworkStates is diagnostic, not fatal', () => {
  it('reports each descriptor including its error', async () => {
    stubPermissions({ 'local-network-access': 'prompt', 'loopback-network': 'granted' });
    const all = await queryAllLocalNetworkStates();
    expect(all['local-network-access']).toBe('prompt');
    expect(all['loopback-network']).toBe('granted');
    expect(all['local-network']).toMatch(/^error: /);
  });
});

describe('LNA: private / loopback address detection', () => {
  it.each([
    'http://192.168.1.1:2121/',
    'http://192.168.2.20:8018/api.json',
    'http://10.0.0.1/',
    'http://172.16.5.4/',
    'http://172.31.255.255/',
    'http://127.0.0.1:5173/',
    'http://169.254.1.1/',
    'http://[::1]:2121/',
    'http://[fe80::1]/',
    'http://router.local/',
  ])('%s is local', (url) => {
    expect(isPrivateOrLoopbackTarget(url)).toBe(true);
  });

  it.each([
    'https://portal.orangesync.tech/',
    'https://[2a01:599:11d:2324:5276:afff:fe2f:33ed]:8444/',
    'http://172.32.0.1/',
    'http://172.15.0.1/',
    'http://8.8.8.8/',
    'http://example.com/',
    'not a url',
  ])('%s is NOT local', (url) => {
    expect(isPrivateOrLoopbackTarget(url)).toBe(false);
  });
});

describe('LNA: the denial is CORS-SHAPED, and the heuristic must not over-claim', () => {
  it('flags a private target that failed with a network error while not granted', () => {
    expect(
      looksLikeLocalNetworkDenial({
        targetUrl: 'http://192.168.1.1:2121/ln-invoice',
        permissionState: 'prompt',
        error: { message: 'Failed to fetch' },
      })
    ).toBe(true);
  });

  it('does NOT flag it once the permission is granted (then it is a genuine CORS bug)', () => {
    expect(
      looksLikeLocalNetworkDenial({
        targetUrl: 'http://192.168.1.1:2121/ln-invoice',
        permissionState: 'granted',
        error: { message: 'Failed to fetch' },
      })
    ).toBe(false);
  });

  it('does NOT flag a public target — a different gate applies there', () => {
    expect(
      looksLikeLocalNetworkDenial({
        targetUrl: 'https://portal.orangesync.tech/api',
        permissionState: 'prompt',
        error: { message: 'Failed to fetch' },
      })
    ).toBe(false);
  });

  it('does NOT flag an unrelated error (e.g. a 500 surfaced as a thrown error)', () => {
    expect(
      looksLikeLocalNetworkDenial({
        targetUrl: 'http://192.168.1.1:2121/ln-invoice',
        permissionState: 'prompt',
        error: { message: 'HTTP 500 Internal Server Error' },
      })
    ).toBe(false);
  });

  it('handles a null/absent error without throwing', () => {
    expect(() =>
      looksLikeLocalNetworkDenial({ targetUrl: 'http://10.0.0.1/', permissionState: 'prompt' })
    ).not.toThrow();
    expect(looksLikeLocalNetworkDenial()).toBe(false);
  });
});
