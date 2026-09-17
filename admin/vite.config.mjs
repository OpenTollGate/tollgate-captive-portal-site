import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const brand = process.env.VITE_BRAND || 'tollgate';

// Keep the static favicon reference brand-scoped so a net4sats build never
// even references the TollGate icon before JS runs (main.tsx also sets it at
// runtime). Brand isolation: one build ships one skin.
const brandFavicon = () => ({
  name: 'brand-favicon',
  transformIndexHtml(html) {
    return html.replace(
      /assets\/brand\/[^/]+\/icon-colour\.png/g,
      `assets/brand/${brand}/icon-colour.png`,
    );
  },
});

// The admin board is a second (Preact) app in this repo. It is served from a
// dedicated uhttpd instance on :8090 (home: /www, files at /www/<brand>), so the
// base path is brand-scoped: /tollgate/ by default, /net4sats/ for net4sats
// builds. Routing is hash-based, so it works under any subpath.
export default defineConfig({
  root: rootDir,
  base: process.env.VITE_BASE_PATH || `/${brand}/`,
  plugins: [brandFavicon(), preact()],
  build: {
    outDir: fileURLToPath(new URL('../build/admin', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
    },
  },
});
