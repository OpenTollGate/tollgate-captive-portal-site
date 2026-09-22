import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BRAND_ID,
  descriptorIdFromPath,
  isDescriptorFile,
  normalizeBrandId,
} from '../scripts/brand-id.mjs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const brandDir = fileURLToPath(new URL('brand/', import.meta.url));

// Resolve the brand the same way the app does at runtime
// (admin/src/brand-core.ts): normalize the id, then require it to be present in
// the slot, falling back to the generic default. Doing it here (instead of
// taking VITE_BRAND raw) keeps the static favicon reference from drifting from
// the skin the JS actually renders for a differently-cased unknown id.
function slotIds() {
  try {
    // Exactly what the runtime glob (`brand/*.json`) sees: regular files whose
    // name ends in lowercase `.json`. Without the filter this directory's own
    // README.md would register as a phantom brand id ("readme.md") that the
    // runtime can never resolve, re-introducing the favicon/skin drift this
    // config is here to prevent.
    return readdirSync(brandDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isDescriptorFile(entry.name))
      .map((entry) => descriptorIdFromPath(entry.name))
      .filter(Boolean);
  } catch {
    return [];
  }
}

const requestedRaw = process.env.VITE_BRAND || '';
const requested = normalizeBrandId(requestedRaw);
const bundled = slotIds();
const brand = requested && bundled.includes(requested) ? requested : DEFAULT_BRAND_ID;

if (requestedRaw.trim() && brand !== requested) {
  // eslint-disable-next-line no-console
  console.warn(
    `[brand] VITE_BRAND="${requestedRaw}" did not select a bundled descriptor; ` +
      `building "${brand}". Bundled: ${bundled.join(', ')}`,
  );
}

// Keep the static favicon reference brand-scoped so a build never even
// references another brand's icon before JS runs (main.tsx also sets it at
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

// The admin board is a second (Preact) app in this repo. It is served at the
// ROOT of its own uhttpd instance on :8090 (home: /www/<brand>, files at
// /www/<brand>), so the base path is always '/'. LuCI stays on :8080.
// Routing is hash-based.
export default defineConfig({
  root: rootDir,
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [brandFavicon(), preact()],
  build: {
    outDir: fileURLToPath(new URL('../build/admin', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
    },
  },
});
