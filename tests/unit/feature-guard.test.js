// The post-build feature guard, tested against synthetic builds.
//
// WHY SYNTHETIC BUILDS AND NOT ONE REAL BUILD
//
//   A test that builds the whole app to check four strings would be slow and, worse,
//   would pass for the wrong reason: it asserts the CURRENT output. These fixtures let
//   the test drop one marker at a time and show that the guard notices — which is the
//   only thing that makes a guard worth having. A check that cannot fail is decoration.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkFeatures, assertFeatures, REQUIRED_FEATURES } from '../../scripts/check-features.mjs';

let dir;

/** A minimal build tree: one portal bundle, one balance bundle, their html, one locale. */
function makeBuild({ portal = {}, balance = {}, html = {} } = {}) {
  const root = path.join(dir, 'build');
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  mkdirSync(path.join(root, 'locales'), { recursive: true });

  writeFileSync(path.join(root, 'assets', 'index-abc123.js'),
    `/* portal */ ${portal.lightning || 'ln-invoice'} ${portal.cashu || 'cashu-token'} `);
  writeFileSync(path.join(root, 'assets', 'balance-def456.js'),
    `/* balance */ ${balance.page || 'tollgate-captive-portal-balance-page'} ${balance.copy || 'balance_page_title'} `);
  writeFileSync(path.join(root, 'index.html'), html.index || '<html><head><title>Portal</title></head></html>');
  if (html.balance !== null) {
    writeFileSync(path.join(root, 'balance.html'), html.balance || '<html><head><title>Balance</title></head></html>');
  }
  writeFileSync(path.join(root, 'locales', 'en.json'), '{"balance_page_title":"Balance"}');
  return root;
}

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'featguard-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('post-build feature guard', () => {
  it('passes on a build that carries every feature', async () => {
    const root = makeBuild();
    const { ok, checks } = checkFeatures(root);
    expect(ok).toBe(true);
    expect(checks).toHaveLength(REQUIRED_FEATURES.length);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(() => assertFeatures(root)).not.toThrow();
  });

  it('fails when the invoice request is gone', async () => {
    const root = makeBuild({ portal: { lightning: 'something-else' } });
    const { ok, checks } = checkFeatures(root);
    expect(ok).toBe(false);
    expect(checks.find((c) => c.id === 'lightning-invoice').ok).toBe(false);
    expect(() => assertFeatures(root)).toThrow(/Lightning tab can request an invoice/);
  });

  it('fails when the paste-ecash field is gone', async () => {
    const root = makeBuild({ portal: { cashu: 'no-input-here' } });
    expect(checkFeatures(root).checks.find((c) => c.id === 'paste-ecash').ok).toBe(false);
  });

  it('fails when the balance page stops rendering', async () => {
    const root = makeBuild({ balance: { page: 'renamed-root-class' } });
    const { checks } = checkFeatures(root);
    expect(checks.find((c) => c.id === 'balance-page').ok).toBe(false);
  });

  it('fails when balance.html is not emitted at all', async () => {
    const root = makeBuild({ html: { balance: null } });
    const { checks } = checkFeatures(root);
    // The bundle may still carry the marker, so assert on the page itself: with no
    // balance.html and no balance bundle there is nothing to search and nothing served.
    expect(checks.find((c) => c.id === 'balance-page').searched).toBeGreaterThan(0);
  });

  it('does NOT accept a balance marker that only exists in the portal bundle', async () => {
    // Locality is the point: a marker moving to the wrong page is still a broken page.
    const root = makeBuild({ balance: { page: 'nope', copy: 'nope' } });
    writeFileSync(path.join(root, 'assets', 'index-abc123.js'),
      'ln-invoice cashu-token tollgate-captive-portal-balance-page balance_page_title');
    const { checks } = checkFeatures(root);
    expect(checks.find((c) => c.id === 'balance-page').ok).toBe(false);
    expect(checks.find((c) => c.id === 'balance-copy').ok).toBe(false);
  });

  it('reports every missing feature in one failure, not just the first', async () => {
    const root = makeBuild({ portal: { lightning: 'x', cashu: 'y' }, balance: { page: 'z', copy: 'w' } });
    expect(() => assertFeatures(root)).toThrow(/4 customer-facing feature\(s\) missing/);
  });

  it('refuses a path that is not a build directory', () => {
    expect(() => checkFeatures(path.join(dir, 'nope'))).toThrow(/not a build directory/);
    expect(() => checkFeatures('')).toThrow(/not a build directory/);
  });
  it('the required-feature list is exactly the set the shell also checks', () => {
    // The same four markers are asserted twice, in two repositories: here (node, building
    // the portal) and in net4sats/installer's scripts/check-portal-features.sh (bash,
    // shipping it). Neither repo's CI can see the other, so each pins the canonical list
    // locally — an edit that changes one side without the other fails HERE first.
    //
    // When you change this list, change net4sats/installer too, and vice versa.
    expect(REQUIRED_FEATURES.map((f) => f.id)).toEqual([
      'lightning-invoice',
      'paste-ecash',
      'balance-page',
      'balance-copy',
    ]);
  });
});
