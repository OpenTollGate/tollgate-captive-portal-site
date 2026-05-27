import { execSync } from 'child_process';
import { rmSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

console.log('Building portal...');
execSync('npx vite build', { stdio: 'inherit', cwd: root, env: { ...process.env, VITE_APP: 'portal' } });

console.log('\nBuilding admin...');
execSync('npx vite build', { stdio: 'inherit', cwd: root, env: { ...process.env, VITE_APP: 'admin' } });

const distDir = resolve(root, 'dist');
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const portalBuild = resolve(root, 'build');
const distPortal = resolve(distDir, 'portal');
if (existsSync(portalBuild)) {
  console.log('\nCopying portal build to dist/portal/...');
  execSync(`cp -r ${portalBuild}/. ${distPortal}/`, { stdio: 'inherit' });
}

console.log('\nAll builds complete!');
console.log('  Portal: dist/portal/');
console.log('  Admin:  dist/admin/');
