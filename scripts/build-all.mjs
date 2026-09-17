#!/usr/bin/env node
// Build every app in this repo in one pass:
//   1. the React guest portal + balance page  -> build/
//   2. the Preact admin board                 -> build/admin/
//
// One build ships exactly one brand. The default is TollGate; net4sats builds
// set VITE_BRAND=net4sats (and VITE_BASE_PATH=/net4sats/). The brand also drives
// the generated PWA manifest, so a TollGate build can never ship the net4sats
// skin and vice versa.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(scriptsDir, '..');

const brand = process.env.VITE_BRAND || 'tollgate';
const base = process.env.VITE_BASE_PATH || `/${brand}/`;

const name = brand === 'net4sats' ? 'net4sats' : 'TollGate';
const themeColor = brand === 'net4sats' ? '#111111' : '#FF6961';

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
console.log(`[build-all] brand=${brand} base=${base} -> admin/public/manifest.json`);

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
