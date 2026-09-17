import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const adminDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PORT = process.env.ADMIN_TEST_PORT || '5199';
const BRAND = process.env.VITE_BRAND || 'tollgate';
const base = `/${BRAND}/`;

// Runs the admin board in VITE_MOCK mode (no router/ubus needed) and exercises
// the real Preact app end-to-end: auth gate, layout, routing.
export default defineConfig({
  testDir: fileURLToPath(new URL('tests', import.meta.url)),
  testMatch: '*.spec.mjs',
  timeout: 60000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${base}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npx vite --config ${adminDir}vite.config.mjs --port ${PORT} --strictPort`,
    cwd: repoRoot,
    env: { VITE_MOCK: 'true', VITE_BRAND: BRAND },
    url: `http://localhost:${PORT}${base}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
