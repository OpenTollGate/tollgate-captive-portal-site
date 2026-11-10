// Post-build guard: the customer-facing features must survive a build.
//
// WHY THIS EXISTS
//
//   The guest portal's branding step rewrites `index.html`, `balance.html`, the PWA
//   manifest and the locale strings, and it restores the source files afterwards. That
//   machinery is exactly the kind that can quietly drop a page: a missing entry in the
//   restore set, a renamed output, a bundle that stops being emitted. None of the
//   existing tests could see it — the unit tests exercise the branding functions on
//   fixtures, and the e2e suite does not currently run green on `main`, so it cannot
//   prove anything either way.
//
//   So the check runs against the BUILT OUTPUT, on every build, branded or not. A build
//   that loses a feature fails instead of shipping.
//
// WHAT IS ASSERTED
//
//   Four markers, each named after the thing a customer does:
//
//     lightning-invoice  the Lightning tab asks the backend for an invoice
//     paste-ecash        the Cashu tab has a field to paste an ecash token
//     balance-page       the standalone balance page renders
//     balance-copy       the balance page carries its own copy
//
//   Each marker is looked for in the bundle that must carry it — the balance markers in
//   the balance bundle, the portal markers in the portal bundle — so a marker that
//   migrated to the wrong page does not silently pass.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The features a customer must still be able to use, and where each must live.
 *
 * `where: 'portal'`  -> the guest portal bundle (index/portal assets + index.html)
 * `where: 'balance'` -> the standalone balance page (balance assets + balance.html)
 *
 * Keep the `what` text in customer terms: it is what appears in the failure message, and
 * a message that says "missing balance_page_title" tells nobody what broke.
 */
export const REQUIRED_FEATURES = [
  {
    id: 'lightning-invoice',
    what: 'the Lightning tab can request an invoice',
    marker: 'ln-invoice',
    where: 'portal',
  },
  {
    id: 'paste-ecash',
    what: 'the Cashu tab has a field to paste an ecash token',
    marker: 'cashu-token',
    where: 'portal',
  },
  {
    id: 'balance-page',
    what: 'the standalone balance page renders',
    marker: 'tollgate-captive-portal-balance-page',
    where: 'balance',
  },
  {
    id: 'balance-copy',
    what: 'the balance page carries its own copy',
    marker: 'balance_page_title',
    where: 'balance',
  },
];

/** Files a marker of the given `where` may legitimately appear in. */
function candidatesFor(buildDir, where) {
  const assetDir = path.join(buildDir, 'assets');
  let names = [];
  try {
    names = readdirSync(assetDir);
  } catch {
    return [];
  }
  const isBalance = (n) => n.startsWith('balance-');
  const files = names
    .filter((n) => /\.(js|css)$/.test(n))
    .filter((n) => (where === 'balance' ? isBalance(n) : !isBalance(n)))
    .map((n) => path.join(assetDir, n));

  // The html entries are part of the surface too: a marker inlined into a page counts.
  const html = where === 'balance' ? 'balance.html' : 'index.html';
  const htmlPath = path.join(buildDir, html);
  if (existsSync(htmlPath)) files.push(htmlPath);

  return files;
}

/**
 * Check a build directory for every required feature.
 *
 * @param {string} buildDir the built output directory (the one served to a customer)
 * @returns {{ok: boolean, checks: Array<{id: string, what: string, ok: boolean, searched: number}>}}
 */
export function checkFeatures(buildDir) {
  if (!buildDir || !existsSync(buildDir) || !statSync(buildDir).isDirectory()) {
    throw new Error(`check-features: not a build directory: ${buildDir}`);
  }

  const checks = REQUIRED_FEATURES.map((f) => {
    const files = candidatesFor(buildDir, f.where);
    let found = false;
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (text.includes(f.marker)) {
        found = true;
        break;
      }
    }
    return { id: f.id, what: f.what, where: f.where, marker: f.marker, ok: found, searched: files.length };
  });

  return { ok: checks.every((c) => c.ok), checks };
}

/** Throw with every missing feature listed, so one build reports all of them. */
export function assertFeatures(buildDir) {
  const { ok, checks } = checkFeatures(buildDir);
  if (ok) return checks;

  const missing = checks.filter((c) => !c.ok);
  const lines = missing.map(
    (c) => `  - ${c.id}: ${c.what}\n      marker "${c.marker}" not found in the ${c.where} bundle (searched ${c.searched} file(s))`
  );
  throw new Error(
    `check-features: ${missing.length} customer-facing feature(s) missing from the build\n${lines.join('\n')}\n` +
      `Build directory: ${buildDir}\n` +
      `This guard exists because branding rewrites and restores these files; a feature that\n` +
      `disappears here would reach a customer. Fix the build, do not delete the check.`
  );
}

// CLI: node scripts/check-features.mjs [buildDir]
if (import.meta.url === `file://${process.argv[1]}`) {
  const buildDir = process.argv[2] || path.join(process.cwd(), 'build');
  try {
    const checks = assertFeatures(buildDir);
    for (const c of checks) console.log(`ok   - ${c.id}: ${c.what}`);
    console.log(`\nPASS — ${checks.length} customer-facing feature(s) present in ${buildDir}`);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
