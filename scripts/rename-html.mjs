#!/usr/bin/env node
// Post-build rename: the guest portal's root document ships as `splash.html`
// (nodogsplash's DEFAULT_SPLASHPAGE), not `index.html`.
//
// This has to edit `asset-manifest.json` too, and it must do so by ENTRY, not
// by substring: the manifest now also lists the canonical balance route
// `balance/index.html`, which an earlier global `.replace(/index\.html/g, ...)`
// silently rewrote to `balance/splash.html` — a path that never exists. Parse
// the JSON, map the exact top-level entry, write it back.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const buildDir = path.join(repo, 'build');
const indexHtml = path.join(buildDir, 'index.html');
const splashHtml = path.join(buildDir, 'splash.html');
const manifestPath = path.join(buildDir, 'asset-manifest.json');

renameSync(indexHtml, splashHtml);

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const html = manifest?.assets?.html;
  if (Array.isArray(html)) {
    manifest.assets.html = html.map((entry) => (entry === 'index.html' ? 'splash.html' : entry));
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
