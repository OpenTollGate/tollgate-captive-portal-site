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
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_BRAND_ID,
  descriptorIdFromPath,
  isDescriptorFile,
  normalizeBrandId,
  validateDescriptor,
} from './brand-id.mjs';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

const requestedRaw = process.env.VITE_BRAND || '';
const requested = normalizeBrandId(requestedRaw);
const base = process.env.VITE_BASE_PATH || '/';

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

mkdirSync(path.join(repo, 'admin/public'), { recursive: true });
writeFileSync(
  path.join(repo, 'admin/public/manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `[build-all] brand="${brand}" (name="${name}") base="${base}" -> admin/public/manifest.json`,
);

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
run('build:admin', { VITE_BRAND: brand, VITE_BASE_PATH: base });

console.log('[build-all] done: build/ (portal + balance) and build/admin/');
