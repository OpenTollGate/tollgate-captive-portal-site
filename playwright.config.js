const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'video',
      testMatch: 'tests/video-walkthrough.spec.js',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        video: 'on',
      },
    },
  ],
  webServer: {
    command: 'VITE_MOCK=true npx vite',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
