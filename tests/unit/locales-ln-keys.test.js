import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import en from '../../public/locales/en.json';

// Bug B (B): the lightning error codes LN003 (invoice request failed) and LN004
// (invoice status fetch failed) are produced by src/helpers/lightning.js but the
// en.json catalog only defined LN001/LN002, so i18next rendered the literal
// "None" to the operator.
const REQUIRED_LN_KEYS = ['LN003_label', 'LN003_message', 'LN004_label', 'LN004_message'];

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// every code the portal can surface as a label/message pair
const sourceFiles = ['../../src/helpers/lightning.js', '../../src/components/Lightning.jsx'];

const referencedCodes = () => {
  const codes = new Set();
  for (const file of sourceFiles) {
    const source = readSource(file);
    for (const match of source.matchAll(/["'`]([A-Z]{2}\d{3})_(?:label|message)["'`]/g)) {
      codes.add(match[1]);
    }
    for (const match of source.matchAll(/code:\s*["'`]([A-Z]{2}\d{3})["'`]/g)) {
      codes.add(match[1]);
    }
  }
  return [...codes].sort();
};

describe('en.json lightning error keys', () => {
  it('defines the four LN003/LN004 label+message keys', () => {
    for (const key of REQUIRED_LN_KEYS) {
      expect(en[key], `${key} must be defined in public/locales/en.json`).toBeDefined();
      expect(typeof en[key]).toBe('string');
      expect(en[key].trim().length).toBeGreaterThan(0);
      // i18next renders the literal "None" when a key is missing
      expect(en[key]).not.toBe('None');
    }
  });

  it('defines LN003/LN004 with wording consistent with LN001/LN002', () => {
    expect(en.LN003_label).toBe('Failed to request invoice');
    expect(en.LN003_message).toMatch(/[Ll]ightning invoice/);
    expect(en.LN004_label).toBe('Failed to fetch invoice status');
    expect(en.LN004_message).toMatch(/[Ss]tatus/);
    // labels are short titles, messages are full sentences
    expect(en.LN003_label.length).toBeLessThan(en.LN003_message.length);
    expect(en.LN004_label.length).toBeLessThan(en.LN004_message.length);
    expect(en.LN004_message.endsWith('.')).toBe(true);
  });

  it('REGRESSION GUARD: every LN code used in the portal is defined in en.json', () => {
    const codes = referencedCodes();
    expect(codes.length).toBeGreaterThanOrEqual(4);
    const missing = codes.flatMap((code) =>
      [`${code}_label`, `${code}_message`].filter((key) => typeof en[key] !== 'string')
    );
    expect(missing).toEqual([]);
  });

  it('keeps public/locales/en.json valid JSON with the keys in LN order', () => {
    const parsed = JSON.parse(readSource('../../public/locales/en.json'));
    const lnKeys = Object.keys(parsed).filter((key) => key.startsWith('LN'));
    expect(lnKeys).toEqual([
      'LN001_label',
      'LN001_message',
      'LN002_label',
      'LN002_message',
      'LN003_label',
      'LN003_message',
      'LN004_label',
      'LN004_message',
    ]);
  });
});
