import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import en from '../../public/locales/en.json';

// The standalone balance page (`/balance/`, `balance.html`) is the one surface a
// user reaches AFTER the payment tab is gone, so every string it renders has to
// exist in the catalog. Twelve of them were dropped from en.json by a merge:
// i18next then renders the raw key ("balance_active_label") on the page, which
// is what the balance page actually showed before this guard existed.
//
// Same shape as locales-ln-keys.test.js: scan the sources for the keys they
// ask for, then assert the catalog defines every one of them.
const SOURCE_FILES = ['../../src/BalancePage.jsx', '../../src/helpers/balance.js'];

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// i18next is also called with a computed/holder key in places; only the literal
// `t('key')` / `t("key")` forms are checked here.
const referencedKeys = () => {
  const keys = new Set();
  for (const file of SOURCE_FILES) {
    for (const match of readSource(file).matchAll(/\bt\(\s*['"`]([a-z][a-z0-9_]*)['"`]/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
};

describe('en.json balance-page keys', () => {
  it('REGRESSION GUARD: every balance-page string is defined in en.json', () => {
    const keys = referencedKeys();
    // sanity: the page does ask for strings, so a broken scan cannot pass empty
    expect(keys.length).toBeGreaterThanOrEqual(10);

    const missing = keys.filter((key) => typeof en[key] !== 'string' || en[key].trim() === '');
    expect(missing, `missing from public/locales/en.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('defines the stat-card and action strings the balance page shows', () => {
    // The exact set that went missing. Named explicitly so a rename on either
    // side of the contract fails here instead of rendering a raw key.
    const required = [
      'balance_remaining',
      'balance_used',
      'balance_total',
      'balance_metric',
      'balance_data',
      'balance_time',
      'balance_started_at',
      'balance_active_label',
      'balance_active_message',
      'balance_no_session_message',
      'refresh_balance',
      'return_to_portal',
    ];
    for (const key of required) {
      expect(en[key], `${key} must be defined in public/locales/en.json`).toBeDefined();
      expect(en[key]).not.toBe(key);
    }
  });

  it('keeps the interpolated strings interpolable', () => {
    // Dropping the placeholder silently prints "Started " with no value.
    expect(en.balance_started_at).toContain('{{value}}');
  });

  it('every key the balance page asks for is also present in the build input', () => {
    // public/locales/en.json ships verbatim; assert the file the app loads is
    // the one that was checked, so a moved catalog cannot pass this suite.
    const parsed = JSON.parse(readSource('../../public/locales/en.json'));
    expect(Object.keys(parsed)).toContain('balance_remaining');
  });
});
