import { describe, expect, it } from 'vitest';
import { buildDuckdbBundles } from './duckdbBundles';

describe('buildDuckdbBundles', () => {
  it('builds base-relative bundle URLs under <base>/duckdb/', () => {
    const b = buildDuckdbBundles('/icare-validate/');
    expect(b.mvp.mainModule).toBe('/icare-validate/duckdb/duckdb-mvp.wasm');
    expect(b.mvp.mainWorker).toBe('/icare-validate/duckdb/duckdb-browser-mvp.worker.js');
    expect(b.eh?.mainModule).toBe('/icare-validate/duckdb/duckdb-eh.wasm');
    expect(b.eh?.mainWorker).toBe('/icare-validate/duckdb/duckdb-browser-eh.worker.js');
  });

  it('omits the coi (threaded) bundle — no SharedArrayBuffer on GitHub Pages', () => {
    expect(buildDuckdbBundles('/icare-validate/')).not.toHaveProperty('coi');
  });

  it('respects the dev base "/"', () => {
    expect(buildDuckdbBundles('/').eh?.mainModule).toBe('/duckdb/duckdb-eh.wasm');
  });
});
