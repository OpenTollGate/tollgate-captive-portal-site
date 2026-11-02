import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), 'admin/src/locales');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const catalogues = Object.fromEntries(
  files.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]),
);

describe('admin locale catalogues', () => {
  it('ships the 14 confirmed locales', () => {
    expect(Object.keys(catalogues).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'pt', 'ru', 'tr', 'vi', 'zh-Hans', 'zh-Hant'].sort(),
    );
  });

  it('has the same source keys as English', () => {
    const reference = Object.keys(catalogues.en).sort();
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      expect(Object.keys(catalogue).sort(), tag).toEqual(reference);
    }
  });

  it('has no empty translation or unresolved placeholder token', () => {
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(String(value).trim().length, `${tag}:${key}`).toBeGreaterThan(0);
        expect(String(value), `${tag}:${key}`).not.toMatch(/__PH\d+__|__COBRADOR__|__TOLLGATE__/);
      }
    }
  });

  it('keeps Cobrador untranslated', () => {
    for (const [tag, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue)) {
        if (key.includes('Cobrador')) {
          expect(String(value), `${tag}:${key}`).toContain('Cobrador');
        }
      }
    }
  });
});
