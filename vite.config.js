import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';

// The balance page keeps its original address (`balance.html`) and gains a
// canonical, memorable one: `/balance/`. A user who closes the portal tab can
// retype that without hunting for a link, and it is what the "view balance"
// button on the post-payment screen points at.
//
// `/balance/` has to work in three places:
//   * `vite dev` / `vite preview` — rewritten to the balance entry below.
//   * the built bundle served by uhttpd — emitted as `build/balance/index.html`
//     so uhttpd's stock index-file lookup resolves it with no extra
//     configuration (`/balance` without the slash is 302'd to `/balance/`
//     by uhttpd itself).
//   * `balance.html` keeps working unchanged, so old links, bookmarks and the
//     shipped asset manifest stay valid.
//
// The page itself is defined once (`balance.html` -> `src/balance.jsx`); this
// plugin only adds the second address, so the two cannot drift apart.
const BALANCE_ENTRY = '/balance.html';
const BALANCE_ROUTE_DIR = 'balance';

function balanceRoutePlugin() {
  // Shared by the dev and preview servers: `/balance` and `/balance/` are the
  // balance entry, query string preserved.
  const rewriteBalanceRoute = (req, _res, next) => {
    if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }
    const queryIndex = req.url.indexOf('?');
    const pathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : req.url.slice(queryIndex);
    if (pathname === '/balance' || pathname === '/balance/') {
      req.url = `${BALANCE_ENTRY}${query}`;
    }
    return next();
  };

  return {
    name: 'balance-route',
    configureServer(server) {
      server.middlewares.use(rewriteBalanceRoute);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteBalanceRoute);
    },
    // Runs before the asset-manifest plugin below (declaration order), so the
    // copied document is listed in the manifest.
    closeBundle() {
      const buildDir = path.resolve(__dirname, 'build');
      const source = path.join(buildDir, 'balance.html');
      if (!fs.existsSync(source)) {
        return;
      }
      const targetDir = path.join(buildDir, BALANCE_ROUTE_DIR);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(source, path.join(targetDir, 'index.html'));
    }
  };
}

function generateAssetManifestPlugin() {
  return {
    name: 'generate-asset-manifest',
    closeBundle: async () => {
      const buildDir = path.resolve(__dirname, 'build');
      const manifest = {
        assets: {
          js: [],
          css: [],
          images: [],
          locales: [],
          html: [],
          manifest: []
        }
      };
      function walk(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const relPath = path.relative(buildDir, fullPath).replace(/\\/g, '/');
          if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
          } else {
            if (relPath.endsWith('.js')) manifest.assets.js.push(relPath);
            else if (relPath.endsWith('.css')) manifest.assets.css.push(relPath);
            else if (relPath.match(/\.(png|jpe?g|svg|ico)$/i)) manifest.assets.images.push(relPath);
            else if (relPath.startsWith('locales/')) manifest.assets.locales.push(relPath);
            // `balance/index.html` is the canonical `/balance/` route: a real
            // document that ships, so it belongs next to the page it mirrors.
            else if (relPath === 'index.html' || relPath === 'balance.html' || relPath === 'balance/index.html' || relPath === '404.html') manifest.assets.html.push(relPath);
            else if (relPath.endsWith('manifest.json')) manifest.assets.manifest.push(relPath);
          }
        }
      }
      walk(buildDir);
      const outPath = path.join(buildDir, 'asset-manifest.json');
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
      // eslint-disable-next-line no-console
      console.log('asset-manifest.json generated.');
    }
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), balanceRoutePlugin(), generateAssetManifestPlugin()],
  build: {
    outDir: "build",
    rollupOptions: {
      input: {
        portal: path.resolve(__dirname, 'index.html'),
        balance: path.resolve(__dirname, BALANCE_ENTRY),
      },
    },
  },
});
