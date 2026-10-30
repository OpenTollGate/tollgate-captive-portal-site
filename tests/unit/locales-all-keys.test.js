import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), 'public/locales');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const catalogues = Object.fromEntries(
  files.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]),
);

function placeholders(value) {
  return [...String(value).matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

describe('guest locale catalogues', () => {
  it('ships the 14 confirmed locales', () => {
    expect(Object.keys(catalogues).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'pt', 'ru', 'tr', 'vi', 'zh-Hans', 'zh-Hant'].sort(),
    );
  });

  it('has the same keys as English', () => {
    const reference = Object.keys(catalogues.en).sort();
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      expect(Object.keys(catalogue).sort(), tag).toEqual(reference);
    }
  });

  it('keeps every placeholder', () => {
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(placeholders(value), `${tag}:${key}`).toEqual(placeholders(catalogues.en[key]));
      }
    }
  });

  it('does not ship an empty translation', () => {
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(String(value).trim().length, `${tag}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});
