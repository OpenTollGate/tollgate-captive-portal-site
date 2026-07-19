import { execSync } from 'child_process';
import { rmSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const distDir = resolve(root, 'dist');
const buildDir = resolve(root, 'build');
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

console.log('Building portal...');
execSync('npx vite build', { stdio: 'inherit', cwd: root, env: { ...process.env, VITE_APP: 'portal' } });
const distPortal = resolve(distDir, 'portal');
mkdirSync(distPortal, { recursive: true });
execSync(`cp -r ${buildDir}/. ${distPortal}/`, { stdio: 'inherit' });
console.log('  Portal: dist/portal/');

console.log('\nBuilding admin...');
if (existsSync(buildDir)) rmSync(buildDir, { recursive: true, force: true });
execSync('npx vite build', { stdio: 'inherit', cwd: root, env: { ...process.env, VITE_APP: 'admin' } });
console.log('  Admin:  dist/admin/ (vite outputs directly)');

console.log('\nAll builds complete!');
console.log('  Portal: dist/portal/');
console.log('  Admin:  dist/admin/');
