// Unit gate for src/helpers/money-path.js.
//
// The failure mode these tests exist for is a service worker that MANUFACTURES
// a paid state, or a cache layer that freezes an authority response. Both are
// silent: the app looks fine and the customer is told they have internet they
// do not have, or is charged twice. So the predicate is pinned in both
// directions — what must bypass, and what may be intercepted — because a
// one-directional assertion would pass against an implementation that bypasses
// everything and therefore also never works offline.
import { describe, it, expect } from 'vitest';
import {
  PRECACHE_ALLOWLIST,
  mustNotBeCached,
  shouldIntercept,
  isSafeToStore,
  newIdempotencyKey,
  paymentRequestHeaders,
  PAYMENT_IDEMPOTENCY_HEADER,
} from '../../src/helpers/money-path.js';

const req = (method, url) => ({ method, url });

describe('money-path: every non-GET bypasses the cache', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is never cacheable', (method) => {
    // The purchase itself is a POST. The Cache API would refuse to store it
    // anyway — but the danger is a handler ANSWERING it, which the Cache spec
    // does not prevent.
    expect(mustNotBeCached(req(method, 'http://192.168.1.1:2121/'))).toBe(true);
    expect(shouldIntercept(req(method, 'http://192.168.1.1:2121/'))).toBe(false);
  });

  it('an OPTIONS preflight bypasses', () => {
    expect(mustNotBeCached(req('OPTIONS', 'http://192.168.1.1:2121/'))).toBe(true);
  });
});

describe('money-path: authority endpoints bypass even as GET', () => {
  const authority = [
    'http://192.168.1.1:2121/balance',
    'http://192.168.1.1:2121/usage',
    'http://192.168.1.1:2121/whoami',
    'http://192.168.1.1:2121/ln-invoice',
    'http://192.168.1.1:2121/pay',
    'https://mint.example/v1/keysets',
    'https://mint.example/v1/checkstate',
    'https://mint.example/v1/melt/quote',
    'https://mint.example/v1/mint',
    'https://mint.example/v1/swap',
  ];

  it.each(authority)('%s must not be cached and must not be intercepted', (url) => {
    expect(mustNotBeCached(req('GET', url))).toBe(true);
    expect(shouldIntercept(req('GET', url))).toBe(false);
  });

  it('matching is case-insensitive and tolerant of a trailing segment', () => {
    expect(mustNotBeCached(req('GET', 'http://GW:2121/Balance'))).toBe(true);
    expect(mustNotBeCached(req('GET', 'https://mint.example/v1/keysets/abc123'))).toBe(true);
  });
});

describe('money-path: the app shell may be served from cache', () => {
  it('exactly the precache allow-list is interceptable', () => {
    for (const path of PRECACHE_ALLOWLIST) {
      const url = `http://192.168.1.1:2051${path}`;
      expect(shouldIntercept(req('GET', url)), `${path} should be interceptable`).toBe(true);
      expect(mustNotBeCached(req('GET', url)), `${path} should be cacheable`).toBe(false);
    }
  });

  it('the allow-list is a positive list, not a glob of the build output', () => {
    // A hashed bundle chunk is NOT in the allow-list; it belongs in a generated
    // list, and a blanket wildcard is how a money endpoint gets swept in.
    expect(mustNotBeCached(req('GET', 'http://192.168.1.1:2051/assets/index-YkGiQMp2.js'))).toBe(true);
  });

  it('an unknown path fails closed', () => {
    expect(mustNotBeCached(req('GET', 'http://192.168.1.1:2051/api/something-new'))).toBe(true);
  });
});

describe('money-path: unparseable input fails closed', () => {
  it('a missing request bypasses', () => {
    expect(mustNotBeCached(undefined)).toBe(true);
    expect(mustNotBeCached(null)).toBe(true);
  });

  it('an unparseable url bypasses', () => {
    expect(mustNotBeCached(req('GET', '::not a url::'))).toBe(true);
  });
});

describe('money-path: isSafeToStore refuses authority payloads', () => {
  it('refuses a balance/quote/invoice/state body', () => {
    expect(isSafeToStore('http://192.168.1.1:2051/balance', '{"remaining":540000}')).toBe(false);
    expect(isSafeToStore('http://192.168.1.1:2051/ln-invoice', '{"quote":"q","invoice":"lnbc1"}')).toBe(false);
    expect(isSafeToStore('http://192.168.1.1:2051/', '{"session_active":true}')).toBe(false);
  });

  it('refuses a non-allow-listed url regardless of body', () => {
    expect(isSafeToStore('http://192.168.1.1:2051/assets/app.js', 'body{}')).toBe(false);
  });

  it('allows an allow-listed url with no authority fields', () => {
    expect(isSafeToStore('http://192.168.1.1:2051/splash.html', '<html>shell</html>')).toBe(true);
  });
});

describe('money-path: the retry cannot double-charge', () => {
  it('keys are unique across calls', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
  });

  it('keys are device-bound when a mac is supplied', () => {
    const key = newIdempotencyKey({ mac: '00:11:22:33:44:55' });
    expect(key.startsWith('00:11:22:33:44:55:')).toBe(true);
    expect(key.split(':').pop()).toHaveLength(32); // 16 bytes hex
  });

  it('headers carry the key under the documented header name', () => {
    const headers = paymentRequestHeaders({ idempotencyKey: 'k1' });
    expect(headers[PAYMENT_IDEMPOTENCY_HEADER]).toBe('k1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('refuses to build headers without a key (a retry with no key is a double-charge)', () => {
    expect(() => paymentRequestHeaders({})).toThrow(/idempotency key/);
  });
});
