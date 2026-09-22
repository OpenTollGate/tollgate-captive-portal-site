import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORTAL_TEST_PORT || '5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results/output',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Chromium-backed mobile device on purpose. `devices['iPhone 14']`
      // defaults to WebKit, which needs a second browser download and made
      // this project unrunnable with the chromium-only install documented in
      // README/CI (`npx playwright install --with-deps chromium`).
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // The portal is a Vite dev server. Declaring it here makes `npm run test:e2e`
  // self-contained instead of silently failing with ERR_CONNECTION_REFUSED when
  // nobody started `npm run dev` first. reuseExistingServer keeps the CI job
  // (which launches `npm run dev &` itself) working unchanged.
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
    timeout: 10000,
  },
});
