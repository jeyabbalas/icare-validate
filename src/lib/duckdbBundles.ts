// Base-relative URLs to the self-hosted DuckDB-WASM bundles vendored into public/duckdb/
// by `npm run vendor` (scripts/vendor-duckdb.mjs). Passed to @jeyabbalas/data-table via
// `bridgeOptions.duckdbBundles` so DuckDB loads locally instead of from the jsDelivr CDN —
// the app works fully offline. Only mvp + eh (no coi): GitHub Pages has no COOP/COEP, so no
// SharedArrayBuffer / cross-origin isolation, so the threaded coi bundle is unusable.
import type { DuckDBBundles } from '@duckdb/duckdb-wasm';

/** Build the DuckDB bundle URL set from a base path (e.g. `import.meta.env.BASE_URL`). */
export function buildDuckdbBundles(base: string): DuckDBBundles {
  const dir = `${base}duckdb/`;
  return {
    mvp: {
      mainModule: `${dir}duckdb-mvp.wasm`,
      mainWorker: `${dir}duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${dir}duckdb-eh.wasm`,
      mainWorker: `${dir}duckdb-browser-eh.worker.js`,
    },
  };
}

// `import.meta.env.BASE_URL` must appear LITERALLY so Vite statically inlines it
// ("/icare-validate/" in the GitHub Pages build, "/" in dev).
export const DUCKDB_BUNDLES: DuckDBBundles = buildDuckdbBundles(import.meta.env.BASE_URL);
