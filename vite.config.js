import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from 'fs';
import path from 'path';

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
            else if (relPath === 'index.html' || relPath === 'balance.html' || relPath === '404.html') manifest.assets.html.push(relPath);
            else if (relPath.endsWith('manifest.json')) manifest.assets.manifest.push(relPath);
          }
        }
      }
      walk(buildDir);
      const outPath = path.join(buildDir, 'asset-manifest.json');
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
      console.log('asset-manifest.json generated.');
    }
  };
}

const app = process.env.VITE_APP || 'portal';

const configs = {
  portal: {
    plugins: [react(), generateAssetManifestPlugin()],
    base: '/',
    build: {
      outDir: 'build',
      rollupOptions: {
        input: {
          portal: path.resolve(__dirname, 'index.html'),
          balance: path.resolve(__dirname, 'balance.html'),
        },
      },
    },
  },
  admin: {
    plugins: [react()],
    base: '/tollgate/',
    build: {
      outDir: 'dist/admin',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          admin: path.resolve(__dirname, 'admin.html'),
        },
      },
    },
  },
};

export default defineConfig(configs[app] || configs.portal);
