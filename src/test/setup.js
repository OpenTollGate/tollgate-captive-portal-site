import '@testing-library/jest-dom';

// ── localStorage guard (Node 26 + jsdom) ───────────────────────────────
//
// jsdom DOES implement localStorage (verified: a raw `new JSDOM(..., {url})`
// gives a working `window.localStorage` that round-trips setItem/getItem), and
// the jsdom environment vitest injects normally exposes it as a global. But
// Node 26 added an EXPERIMENTAL native `localStorage` global that is only
// functional when the process is started with `--localstorage-file`; without
// it the global resolves to `undefined` and emits
//
//   ExperimentalWarning: localStorage is not available because
//   --localstorage-file was not provided
//
// vitest's jsdom environment then hands that `undefined` through, so any test
// that touches localStorage dies at import time:
//
//   TypeError: Cannot read properties of undefined (reading 'getItem')
//     at admin/src/lib/ubus.ts:17  (module-scope read)
//
// CI pins node-version: 22 (.github/workflows/ci.yml), where no such native
// global exists and jsdom's own implementation is used — which is why
// tests/unit/admin-credential-guard.test.js and
// tests/unit/admin-provisional-credential.test.js are green there and red on a
// Node 26 workstation.
//
// Install a minimal in-memory Storage ONLY when the environment failed to
// provide a usable one. Guarded, so under CI's Node 22 (or any runtime that
// supplies the real implementation) this is a no-op and NOTHING changes.
const installLocalStorageIfMissing = () => {
  const existing = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined;
  if (existing && typeof existing.getItem === 'function') return;

  const store = new Map();
  const storage = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };

  for (const target of [globalThis, typeof window !== 'undefined' ? window : null]) {
    if (!target) continue;
    Object.defineProperty(target, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
};

installLocalStorageIfMissing();

// ⚠️ The returned object (and therefore `t`) MUST be identity-stable.
//
// Components here (e.g. src/components/Cashu.jsx:165 `[token, selectedMint, t]`)
// list `t` in their effect dependency arrays. A factory that builds a NEW `t`
// per `useTranslation()` call therefore changes a dependency on every render:
// the effect re-runs, sets fresh state, the component re-renders, and the loop
// never terminates. That is the infinite render loop that made
// `src/components/__tests__/Cashu.race.test.jsx` hang until the V8 heap was
// exhausted (site of the suite-wide "JavaScript heap out of memory" fatal,
// which killed the run before any summary printed).
//
// Create the API object ONCE at factory scope and return the same reference
// from every call. Two suites (tests/unit/renew-after-expiry.test.jsx,
// tests/unit/cashu-auto-select-mint.test.jsx) had each worked around this with
// their own stable local mock; fixing it here removes the footgun for every
// current and future suite instead of paying the workaround per file.
vi.mock('react-i18next', () => {
  const t = (key, opts) => {
    if (typeof opts === 'object' && opts !== null) {
      return key + JSON.stringify(opts);
    }
    return key;
  };
  const api = { t, i18n: { language: 'en' }, ready: true };
  return {
    useTranslation: () => api,
    Trans: ({ children }) => children,
  };
});
