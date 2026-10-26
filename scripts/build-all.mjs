#!/usr/bin/env node
// Build every app in this repo in one pass:
//   1. the React guest portal + balance page  -> build/
//   2. the Preact admin board                 -> build/admin/
//
// One build ships exactly one skin (the brand slot in admin/brand/). The
// default is the generic TollGate descriptor; a distribution operator supplies
// its own `admin/brand/<id>.json` + `admin/public/assets/brand/<id>/`, then
// builds with `VITE_BRAND=<id>`. The active descriptor drives the generated PWA
// manifest for the admin app, so a branded build ships its own name/theme and
// the icon slot always points at the resolved brand id.
//
// Resolution mirrors `admin/src/brand-core.ts` exactly (same id alphabet, same
// case-insensitive slot lookup, same loud fallback to the generic default), so
// the manifest can never disagree with what the admin app resolves at runtime.
// The id is normalized *before* it is used as a path component, so a path-ish
// `VITE_BRAND` cannot read a descriptor outside the slot.
//
// The script never hardcodes a company brand; it reads the descriptor slot.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_BRAND_ID,
  descriptorIdFromPath,
  isDescriptorFile,
  normalizeBrandId,
  validateDescriptor,
} from './brand-id.mjs';
import { applyGuestBranding, adminHTMLFrom, guestHTMLFrom, guestBalanceHTMLFrom, copyGuestBrandAssets, buildGuestRestore } from './guest-brand.mjs';
import { assertFeatures } from './check-features.mjs';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

const requestedRaw = process.env.VITE_BRAND || '';
const requested = normalizeBrandId(requestedRaw);
const base = process.env.VITE_BASE_PATH || '/';
if (base === '/admin' || base === '/admin/') {
  throw new Error(
    `VITE_BASE_PATH=${base} would put the admin base on the GUEST portal, whose assets live ` +
      `at / - the portal would render blank. The admin base is pinned to '/' inside this script; ` +
      `unset VITE_BASE_PATH.`,
  );
}

// The brand slot: `admin/brand/<id>.json`, one descriptor per skin.
const brandDir = path.join(repo, 'admin', 'brand');

function slotFiles() {
  try {
    // Same set the runtime glob (`brand/*.json`) sees — lowercase `.json` only.
    return readdirSync(brandDir).filter(isDescriptorFile);
  } catch {
    return [];
  }
}

function slotIds() {
  return slotFiles().map(descriptorIdFromPath).filter(Boolean).sort();
}

/** Case-insensitive descriptor lookup by normalized id, or null. */
function readDescriptor(id) {
  const wanted = normalizeBrandId(id);
  if (!wanted) return null;
  for (const name of slotFiles()) {
    if (descriptorIdFromPath(name) !== wanted) continue;
    const desc = JSON.parse(readFileSync(path.join(brandDir, name), 'utf8'));
    const declared = normalizeBrandId(desc.id);
    if (declared && declared !== wanted) {
      console.error(
        `[build-all] descriptor "${name}" declares id "${desc.id}" but its file name is "${wanted}".`,
      );
      process.exit(1);
    }
    try {
      // Fail here rather than emitting a manifest for a skin the app will
      // refuse to render (the runtime validates the same field set).
      validateDescriptor(desc, `[build-all] descriptor "${name}"`);
    } catch (err) {
      console.error(String(err.message));
      process.exit(1);
    }
    return { ...desc, id: wanted };
  }
  return null;
}

const desc = readDescriptor(requested) ?? readDescriptor(DEFAULT_BRAND_ID);
if (!desc) {
  console.error('[build-all] brand slot is empty: no descriptors in admin/brand/.');
  process.exit(1);
}

// The id the build actually ships: the bundled descriptor's normalized id. An
// unknown or unusable VITE_BRAND falls back loudly, exactly like the runtime.
const brand = desc.id;
if (brand !== requested) {
  console.warn(
    `[build-all] VITE_BRAND="${requestedRaw}" did not select a descriptor; ` +
      `building "${brand}". Bundled: ${slotIds().join(', ')}`,
  );
}

const name = desc.name;
const themeColor = desc.themeColor || '#FF6961';

const manifest = {
  name,
  short_name: name,
  description: `${name} Router Admin Dashboard`,
  start_url: base,
  display: 'standalone',
  background_color: '#111111',
  theme_color: themeColor,
  icons: [
    {
      src: `assets/brand/${brand}/icon-colour.png`,
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: `assets/brand/${brand}/icon-colour.png`,
      sizes: '512x512',
      type: 'image/png',
    },
  ],
};

// The admin PWA manifest is a TRACKED file that this build rewrites with brand wording for
// vite to consume. Snapshot it first and put it back in the `finally`, exactly like the
// guest files — otherwise a branded build leaves brand wording in the tree, and the next
// UNbranded build ships a brand nobody selected. That is the same cross-build leak the
// guest restore exists for; it was simply never applied to the admin half.
let restoreAdminManifest = null;
{
  const adminManifestPath = path.join(repo, 'admin/public/manifest.json');
  restoreAdminManifest = buildGuestRestore([adminManifestPath]);
}

mkdirSync(path.join(repo, 'admin/public'), { recursive: true });
writeFileSync(
  path.join(repo, 'admin/public/manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `[build-all] brand="${brand}" (name="${name}") base="${base}" -> admin/public/manifest.json`,
);

// The GUEST portal is the page a customer sees on the captive network, and it takes its
// wording from public/locales/<lng>.json and its PWA identity from public/manifest.json.
// Brand those from the SAME descriptor, so the admin board and the guest page cannot
// disagree about who is running the network.
//
// Owner-edit safety: a descriptor whose name is the generic default leaves the guest
// files exactly as shipped, and `applyGuestBranding` returns the inputs unchanged when
// there is nothing to apply - so an unbranded build writes back what it read.
// Only when the operator actually SELECTED a brand (VITE_BRAND was given). With no
// selection we fall back to the default descriptor for the ADMIN app, but the guest
// files must stay exactly as upstream ships them - they already ARE the generic build's
// asset, and rewriting them would change what every unbranded user sees.
let restoreGuestFiles = null;
try {
const stagedGuestFiles = requested ? [
  path.join(repo, 'public', 'manifest.json'),
  path.join(repo, 'public', 'locales', 'en.json'),
  path.join(repo, 'index.html'),
  path.join(repo, 'balance.html'), // separate html entry, separate hardcoded <title>
  path.join(repo, 'public', 'assets'), // copied brand logo dir (untracked) — swept too
] : [];
restoreGuestFiles = buildGuestRestore(stagedGuestFiles);
if (requested) {
  const manifestPath = path.join(repo, 'public', 'manifest.json');
  const localePath = path.join(repo, 'public', 'locales', 'en.json');
  const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const before = [readFileSync(manifestPath, 'utf8'), readFileSync(localePath, 'utf8')];
  const guest = applyGuestBranding(readJson(manifestPath), readJson(localePath), desc);
  const guestIndexPath = path.join(repo, 'index.html');
  const beforeIndex = readFileSync(guestIndexPath, 'utf8');
  const afterIndex = guestHTMLFrom(beforeIndex, desc);
  const after = [
    `${JSON.stringify(guest.manifest, null, 2)}\n`,
    `${JSON.stringify(guest.strings, null, 2)}\n`,
  ];
  // Write only what actually changed, so an explicitly-branded build that happens to
  // match the shipped values does not churn the files either.
  if (after[0] !== before[0]) writeFileSync(manifestPath, after[0]);
  if (after[1] !== before[1]) writeFileSync(localePath, after[1]);
  if (afterIndex !== beforeIndex) {
    writeFileSync(guestIndexPath, afterIndex);
    console.log(`[build-all] guest index.html <title> branded from the descriptor`);
  }
  // The balance page is a second html entry with its own hardcoded title. Branding only
  // the portal would leave a branded router showing upstream's name on the page a
  // customer opens to check their remaining time.
  const balancePath = path.join(repo, 'balance.html');
  const beforeBalance = readFileSync(balancePath, 'utf8');
  const afterBalance = guestBalanceHTMLFrom(beforeBalance, desc);
  if (afterBalance !== beforeBalance) {
    writeFileSync(balancePath, afterBalance);
    console.log(`[build-all] balance page <title> branded from the descriptor`);
  }
  // Guest logo slot: copy the brand's logo-white.png into the guest public tree so
  // the runtime can prefer it over the default static import. Mirrors the admin
  // icon shipping convention; absent asset -> nothing copied (default stays).
  const guestAssetsDir = path.join(repo, 'src', 'assets', 'brand', brand);
  if (copyGuestBrandAssets(path.join(repo, 'admin', 'public', 'assets', 'brand', brand), path.join(repo, 'public'), brand)) {
    console.log(`[build-all] guest logo asset installed from the brand slot`);
  }
  console.log(
    `[build-all] guest branding -> name="${guest.manifest.name}"` +
      (after[0] === before[0] && after[1] === before[1] ? ' (already up to date)' : ''),
  );
} else {
  console.log('[build-all] guest branding: not selected (VITE_BRAND unset) — guest files unchanged');
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (script, env = {}) =>
  execFileSync(npm, ['run', script], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

// Portal first: the React config's emptyOutDir wipes build/, so the admin
// output (build/admin) must be produced afterwards.
run('build:portal');
// BOTH apps are served from a docroot ROOT: the guest portal at /, and the admin board at
// the root of its OWN uhttpd (:8090, home=/www/<brand>) - admin/vite.config.mjs states that
// contract. So both bases are '/'. The admin base is pinned HERE rather than read from the
// environment, because one caller-supplied VITE_BASE_PATH feeding both builds is what let an
// /admin/ value reach the guest splash.html, where src="/admin/assets/..." 404s and the
// customer's portal renders BLANK (measured live: 0 mint buttons, no
// .tollgate-captive-portal-view, empty body).
// The admin board is served from TWO different roots depending on deployment: the root of
// its own uhttpd (:8090, home=/www/<brand>) and /admin/ beneath the captive portal
// (:2051/admin/). An absolute base cannot satisfy both, so emit RELATIVE asset paths
// (base './') - the browser resolves them against whichever URL served the page. Measured:
// base '/' 404s under :2051/admin/; base '/admin/' 404s on :8090.
run('build:admin', { VITE_BRAND: brand, VITE_BASE_PATH: './' });

// The admin app's <title> and theme-color are hard-coded literals in admin/index.html, so
// the brand slot alone left them saying "TollGate Admin" / #111. Rewrite them AFTER the
// build (the file is copied verbatim by vite), and only when a non-default brand is
// selected — adminHTMLFrom returns the page unchanged otherwise.
{
  const adminIndex = path.join(repo, 'build', 'admin', 'index.html');
  if (existsSync(adminIndex)) {
    const before = readFileSync(adminIndex, 'utf8');
    const after = adminHTMLFrom(before, desc);
    if (after !== before) {
      writeFileSync(adminIndex, after);
      console.log('[build-all] admin chrome branded from the descriptor');
    } else {
      console.log('[build-all] admin chrome unchanged (default brand)');
    }
  }
}

console.log('[build-all] done: build/ (portal + balance) and build/admin/');
} finally {
  // Cross-build leakage guard (cold-review HIGH): the branded build staged brand
  // wording into TRACKED files (public/manifest.json, public/locales/en.json,
  // index.html) for vite to consume. Restore their pristine bytes now — win, lose,
  // or crash — so the next UNbranded build can never ship a brand it never asked
  // for. The staged branding already lives on in build/.
  if (restoreGuestFiles) restoreGuestFiles();
  if (restoreAdminManifest) restoreAdminManifest();
  console.log('[build-all] tracked guest sources restored');
}

// The customer-facing features must survive everything above: the branding step rewrites
// index.html and balance.html, writes the manifest and locale strings, and restores the
// source files afterwards. Any of that going wrong drops a page a customer needs, and no
// other test can see it — the unit tests exercise the branding functions on fixtures, and
// the e2e suite does not currently run green on main. So the BUILD refuses to finish if a
// feature is missing, branded or not.
//
// DELIBERATELY AFTER THE finally. An earlier draft called process.exit(1) from inside the
// try, which SKIPS `finally` — leaving brand wording staged in tracked files. That is the
// cross-build leak the finally exists to prevent, and it made the next unbranded build
// ship a brand nobody selected. Restore first, then judge: build/ is not touched by the
// restore, so checking here is equally valid and cannot leak.
{
  let featureChecks;
  try {
    featureChecks = assertFeatures(path.join(repo, 'build'));
  } catch (err) {
    // A missing feature must read as a failed BUILD, not a stack trace: the operator
    // needs to know what shipped wrong, not where the throw happened.
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  for (const c of featureChecks) console.log(`[build-all] ok  ${c.id}: ${c.what}`);
}
