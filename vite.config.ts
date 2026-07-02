import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site: https://jeyabbalas.github.io/icare-validate/
// Everything derives from this single sub-path. All runtime asset URLs in app code
// must be built from `import.meta.env.BASE_URL` (never a leading-"/" absolute path).
const REPO = 'icare-validate';
const base = `/${REPO}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'iCARE-validate',
        short_name: 'iCARE-validate',
        description: 'Client-side, offline validation of iCARE absolute-risk models.',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        scope: base,
        start_url: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // `csv,txt` are REQUIRED so the iCARE-Lit example fixtures are precached for offline use;
        // `wasm,data,whl,zip` cover the vendored Pyodide runtime.
        globPatterns: ['**/*.{js,css,html,mjs,wasm,data,whl,json,zip,csv,txt,svg,png}'],
        // Default is 2 MiB, which silently drops the large Pyodide assets AND (>=0.20.2) errors the build.
        maximumFileSizeToCacheInBytes: 150 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: {
    // The wasm-icare engine runs in a module worker (`new Worker(url, { type: 'module' })`).
    format: 'es',
  },
  optimizeDeps: {
    // Pyodide must not be esbuild-prebundled; excluding wasm-icare lets Vite see its real ESM + worker.
    exclude: ['pyodide', 'wasm-icare'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
