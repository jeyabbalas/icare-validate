// URLs to the self-hosted DuckDB-WASM bundles vendored into public/duckdb/ by `npm run vendor`
// (scripts/vendor-duckdb.mjs). Passed to @jeyabbalas/data-table via `bridgeOptions.duckdbBundles` so
// DuckDB loads locally instead of from the jsDelivr CDN — the app works fully offline. Only mvp + eh
// (no coi): GitHub Pages has no COOP/COEP, so no SharedArrayBuffer / cross-origin isolation, so the
// threaded coi bundle is unusable.
import type { DuckDBBundles } from '@duckdb/duckdb-wasm';

/**
 * Build the DuckDB bundle URL set from a base path (e.g. `import.meta.env.BASE_URL`).
 *
 * The URLs MUST be origin-absolute (e.g. `https://host/icare-validate/duckdb/…`), which is why `origin`
 * is threaded through. @jeyabbalas/data-table boots the DuckDB engine as
 * `new Worker(URL.createObjectURL(new Blob([`importScripts("${mainWorker}")`])))`; inside that `blob:`
 * worker, `importScripts()` (and the subsequent `mainModule` wasm fetch) resolve their argument against
 * the worker's blob: base URL, whose path is opaque — so a ROOT-RELATIVE URL ("/icare-validate/duckdb/…")
 * throws "The URL … is invalid". Passing `origin` absolutizes the URLs and sidesteps that. When `origin`
 * is omitted (SSR / no `window`) we fall back to base-relative URLs; DuckDB never boots in that context,
 * so the difference is immaterial there.
 */
export function buildDuckdbBundles(base: string, origin?: string): DuckDBBundles {
  const dir = origin ? new URL(`${base}duckdb/`, origin).href : `${base}duckdb/`;
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

// `import.meta.env.BASE_URL` must appear LITERALLY so Vite statically inlines it ("/icare-validate/" in
// the GitHub Pages build, "/" in dev). Absolutized against the live origin so the DuckDB blob: worker can
// `importScripts()` the vendored engine (see buildDuckdbBundles above).
export const DUCKDB_BUNDLES: DuckDBBundles = buildDuckdbBundles(
  import.meta.env.BASE_URL,
  typeof window !== 'undefined' ? window.location.origin : undefined,
);
