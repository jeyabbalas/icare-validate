import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site: https://jeyabbalas.github.io/icare-validate/
// Everything derives from this single sub-path. All runtime asset URLs in app code
// must be built from `import.meta.env.BASE_URL` (never a leading-"/" absolute path).
const REPO = 'icare-validate';
const base = `/${REPO}/`;

// @jeyabbalas/data-table always builds a CodeMirror-based editor chunk for its raw-SQL filter +
// derived-column UI. We keep those features disabled (see DataTablePanel) and never load that chunk,
// so instead of installing the 7 optional @codemirror/@lezer peers just to satisfy the build, we
// alias them to a no-op stub. To enable those features: remove these aliases, install the peers, and
// flip the expressionFilter / derivedColumns flags in DataTablePanel.
const codemirrorStub = fileURLToPath(new URL('./src/stubs/codemirror.ts', import.meta.url));
const CODEMIRROR_STUB_MODULES = [
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/lang-sql',
  '@codemirror/language',
  '@lezer/highlight',
];

export default defineConfig({
  base,
  resolve: {
    alias: Object.fromEntries(CODEMIRROR_STUB_MODULES.map((id) => [id, codemirrorStub])),
  },
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
        // `wasm,data,whl,zip` cover the vendored Pyodide runtime; `woff,woff2,ttf` cover KaTeX's fonts
        // (emitted by its bundled CSS) so offline math typesets with correct metrics, not fallbacks.
        globPatterns: ['**/*.{js,css,html,mjs,wasm,data,whl,json,zip,csv,txt,svg,png,woff,woff2,ttf}'],
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
    // Same reasoning for data-table + duckdb-wasm: keep their internal `new Worker(new URL(...))` and
    // WASM resolution intact so the self-hosted (offline) DuckDB bundles load correctly.
    exclude: ['pyodide', 'wasm-icare', '@jeyabbalas/data-table', '@duckdb/duckdb-wasm'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
