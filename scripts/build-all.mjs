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
// The script never hardcodes a company brand; it reads the descriptor slot.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

const requested = (process.env.VITE_BRAND || '').trim().toLowerCase();
const brand = requested || 'tollgate';
const base = process.env.VITE_BASE_PATH || '/';

// Resolve the active descriptor directly from the brand slot. Mirrors
// admin/src/brand-core.ts so the generated manifest always agrees with what the
// admin app resolves at runtime (id, name, themeColor).
const brandDir = path.join(repo, 'admin', 'brand');
function readDescriptor(id) {
  const file = path.join(brandDir, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
const desc = readDescriptor(brand) ?? readDescriptor('tollgate');
if (!desc) {
  console.error('[build-all] brand slot is empty: no descriptors in admin/brand/.');
  process.exit(1);
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
      src: `assets/brand/${desc.id}/icon-colour.png`,
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: `assets/brand/${desc.id}/icon-colour.png`,
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
console.log(`[build-all] brand="${brand}" (name="${name}") base="${base}" -> admin/public/manifest.json`);

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
