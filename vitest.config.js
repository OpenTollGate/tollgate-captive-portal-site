import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'tests/unit/**/*.test.{js,jsx}'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json'],
      // Measure the shipped tree, not the build scripts and test fixtures.
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/test/**',
        '**/*.test.{js,jsx}',
        'src/index.jsx',
        // Generated/vendored QR fallback: no first-party branch worth a unit
        // test, and it is exercised end-to-end by the QR rendering path.
        'src/helpers/qr-code.js',
      ],
      // ── Thresholds, and why they are SCOPED ──────────────────────────────
      //
      // The repo-wide statement number is ~30% and has been since long before
      // this work: whole subsystems (the admin routes, Lightning.jsx,
      // Background.jsx, ErrorBoundary.jsx) carry no unit tests at all. A
      // repo-wide 80% gate would therefore fail on code this change never
      // touches, and a gate that is red for reasons unrelated to the diff is
      // one people learn to ignore.
      //
      // So the gate is scoped to the surface this work owns, and enforces the
      // SAME 80% floor there. Raising the global floor is a separate job with
      // its own diff; it is not smuggled in here.
      thresholds: {
        'src/helpers/install-ux.js': { statements: 80, lines: 80 },
        'src/helpers/pwa-install.js': { statements: 80, lines: 80 },
        'src/helpers/sw-lifecycle.js': { statements: 80, lines: 80 },
        'src/helpers/sw-register.js': { statements: 80, lines: 80 },
        'src/components/InstallPanel.jsx': { statements: 80, lines: 80 },
      },
    },
  },
});
