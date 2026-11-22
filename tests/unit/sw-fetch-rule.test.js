import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GATE (card t_98145b7d, W1) — the SERVED worker's fetch rule.
//
// `tests/unit/sw-lifecycle.test.js` pins the versioning and the no-skipWaiting
// contract by reading `public/sw.js` as text. This file does the same for the
// one rule that can break the PRODUCT rather than the install: WHICH requests
// the worker is allowed to handle.
//
// The defect this pins, found by the e2e suite rather than by any unit test:
// the worker tested only an authority DENY-list (`/balance`, `/usage`, `/pay`,
// the NUT endpoints, ...) and then intercepted everything else. So the portal's
// own price sheet — a plain `GET /` on the router's API origin — was re-issued
// FROM THE WORKER. A worker's cross-origin request is judged differently from
// the page's (CORS against the document origin, plus Chrome's Local Network
// Access permission, which a service worker only has if its origin was
// granted it), so the fetch that had worked on the page started failing, and
// the portal rendered "Failed to fetch TollGate details" — with the worker
// itself as the cause.
//
// The rule is therefore an ALLOW-list: the default is BYPASS, and caching is
// the exception. That is exactly `mustNotBeCached()` in
// `src/helpers/money-path.js`, and the two files had silently diverged.
//
// The worker is a classic script with no exports (so it can be registered
// without `{type:'module'}` support), so it cannot be imported and unit-tested
// directly. Instead the worker's own `mustNotBeCached` is EXTRACTED from the
// source and executed here — meaning these assertions run the shipped code, not
// a copy of it, and a regression in the file fails this suite.

const SRC = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

/** Pull a top-level `function <name>(...) { ... }` out of the worker source. */
function extractFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`public/sw.js has no function ${name}()`);
  let depth = 0;
  let i = SRC.indexOf('{', start);
  const bodyStart = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

/** The arrays the extracted functions close over. */
function extractArray(name) {
  const m = SRC.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`public/sw.js has no array ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return [${m[1]}];`)();
}

/** Execute the WORKER's own rule, wired to the WORKER's own constants. */
function workerRule() {
  const PRECACHE = extractArray('PRECACHE');
  const NEVER_CACHE = extractArray('NEVER_CACHE');
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'PRECACHE',
    'NEVER_CACHE',
    `${extractFunction('mustNotBeCached')}
     ${extractFunction('isPrecachedPath')}
     return mustNotBeCached;`
  );
  return factory(PRECACHE, NEVER_CACHE);
}

const mustNotBeCached = workerRule();

const req = (url, method = 'GET') => ({ url, method });

describe('public/sw.js — the fetch rule admits ONLY the app shell', () => {
  it('lets the shell assets through, so the offline reload still works', () => {
    for (const url of [
      'http://gw.example/splash.html',
      'http://gw.example/balance.html',
      'http://gw.example/manifest.json',
      'http://gw.example/logo192.png',
      'http://gw.example/logo512.png',
      'http://gw.example/logo-maskable-512.png',
      'http://gw.example/favicon.ico',
    ]) {
      expect(mustNotBeCached(req(url)), `${url} must be servable from the shell cache`).toBe(false);
    }
  });

  it('bypasses the router API — including the details fetch, which is a plain GET on "/"', () => {
    // THE regression. `/` is not on the deny-list, so a deny-list-only rule
    // intercepted it and the portal could no longer read its own price sheet.
    for (const url of [
      'http://192.168.1.1:2121/',
      'http://192.168.1.1:2121',
      'http://192.168.1.1:2121/api/multi_wan/objectives',
      'http://192.168.1.1:2121/balance',
      'http://192.168.1.1:2121/usage',
      'http://192.168.1.1:2121/whoami',
      'http://192.168.1.1:2121/ln-invoice',
      'http://mint.example/v1/keysets',
      'http://mint.example/v1/mint',
      'http://gw.example/some-future-endpoint',
    ]) {
      expect(mustNotBeCached(req(url)), `${url} must NEVER be answered by the worker`).toBe(true);
    }
  });

  it('bypasses every non-GET, including a purchase POST', () => {
    expect(mustNotBeCached(req('http://gw.example/splash.html', 'POST'))).toBe(true);
    expect(mustNotBeCached(req('http://gw.example/pay', 'POST'))).toBe(true);
  });

  it('fails CLOSED on a request it cannot parse', () => {
    expect(mustNotBeCached(null)).toBe(true);
    expect(mustNotBeCached({ method: 'GET', url: 'not a url' })).toBe(true);
  });

  it('does not match the shell allow-list by suffix', () => {
    // A naive endsWith('/splash.html') would also admit `/evil/splash.html`,
    // i.e. any other origin's copy of a shell asset.
    expect(mustNotBeCached(req('http://attacker.example/splash.html'))).toBe(false); // same path
    // ...but a DIFFERENT path ending in a shell name is not the shell.
    expect(mustNotBeCached(req('http://gw.example/api/splash.html'))).toBe(true);
  });
});

describe('public/sw.js — the allow-list match is CASE-SENSITIVE', () => {
  // Vite emits content hashes with uppercase letters (`portal-BJdlAeKP.js`).
  // The rule previously lowercased the pathname before comparing it to the
  // allow-list, so EVERY bundle missed, was bypassed into the network, and the
  // offline reload rendered a blank page — even though the assets were sitting
  // in the cache. Measured directly: the cache listed 13 entries and the reload
  // still failed with net::ERR_INTERNET_DISCONNECTED.
  it('admits a mixed-case hashed bundle that the build actually emits', () => {
    // The real regression: a Vite chunk named with UPPERCASE hash characters
    // must be servable. (The shape rule for .js/.css is case-insensitive on the
    // extension, so this asserts the behaviour that matters — the chunk is
    // admitted, not bypassed.)
    expect(
      mustNotBeCached(req('http://gw.example/assets/portal-BJdlAeKP.js')),
      'a mixed-case Vite chunk must be servable from the shell cache'
    ).toBe(false);
  });

  it('matches the literal allow-list entries case-sensitively', () => {
    // The documented icons/documents are compared EXACTLY. Lowercasing the
    // pathname before that comparison is the specific mistake that made the
    // hashed chunks miss, so pin the exact-match semantics for the literal list.
    const isPrecachedPath = new Function(
      'PRECACHE',
      `${extractFunction('isPrecachedPath')}
       return isPrecachedPath;`
    )(extractArray('PRECACHE'));

    expect(isPrecachedPath('/logo192.png'), 'exact case matches').toBe(true);
    expect(isPrecachedPath('/LOGO192.PNG'), 'wrong case does not match the literal list').toBe(false);
    expect(isPrecachedPath('/Splash.html'), 'wrong case does not match the literal list').toBe(false);
  });

  it('does not lowercase the pathname before the allow-list check', () => {
    // Pin the implementation detail that caused it: a `.toLowerCase()` on the
    // pathname inside mustNotBeCached re-introduces the bug for any hashed
    // asset. Scoped to THAT function — the fetch handler legitimately lowercases
    // for its own dispatch, and matching the whole file would be a false alarm.
    const fn = extractFunction('mustNotBeCached');
    expect(fn).not.toMatch(/\.pathname\.toLowerCase\(\)/);
    // It may still lowercase into a SEPARATE variable for the authority list.
    expect(fn).toMatch(/var lower = pathname\.toLowerCase\(\)/);
  });
});

describe('public/sw.js — the rule agrees with the tested money-path predicate', () => {
  it('matches src/helpers/money-path.js on the money endpoints and the shell', async () => {
    const { mustNotBeCached: moduleRule } = await import('../../src/helpers/money-path.js');
    const cases = [
      'http://gw.example/splash.html',
      'http://gw.example/balance.html',
      'http://gw.example/manifest.json',
      'http://gw.example/logo192.png',
      'http://gw.example/logo512.png',
      'http://gw.example/favicon.ico',
      'http://gw.example/404.html',
      'http://gw.example/',
      'http://gw.example/api/multi_wan/objectives',
      'http://192.168.1.1:2121/balance',
      'http://192.168.1.1:2121/usage',
      'http://192.168.1.1:2121/whoami',
      'http://192.168.1.1:2121/pay',
      'http://192.168.1.1:2121/ln-invoice',
      'http://mint.example/v1/keys',
      'http://mint.example/v1/swap',
    ];
    const disagreements = cases.filter(
      (url) => mustNotBeCached(req(url)) !== moduleRule(req(url))
    );
    expect(disagreements, 'the worker and the tested predicate must not diverge').toEqual([]);
  });
});
