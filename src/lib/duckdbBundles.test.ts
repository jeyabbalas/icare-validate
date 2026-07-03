import { describe, expect, it } from 'vitest';
import { buildDuckdbBundles } from './duckdbBundles';

describe('buildDuckdbBundles', () => {
  it('builds origin-absolute bundle URLs under <origin><base>duckdb/', () => {
    // Absolute URLs are REQUIRED: data-table wraps mainWorker in a blob: worker that calls
    // importScripts(mainWorker), and a root-relative path can't resolve against a blob: base URL.
    const b = buildDuckdbBundles('/icare-validate/', 'https://jeyabbalas.github.io');
    expect(b.mvp.mainModule).toBe(
      'https://jeyabbalas.github.io/icare-validate/duckdb/duckdb-mvp.wasm',
    );
    expect(b.mvp.mainWorker).toBe(
      'https://jeyabbalas.github.io/icare-validate/duckdb/duckdb-browser-mvp.worker.js',
    );
    expect(b.eh?.mainModule).toBe(
      'https://jeyabbalas.github.io/icare-validate/duckdb/duckdb-eh.wasm',
    );
    expect(b.eh?.mainWorker).toBe(
      'https://jeyabbalas.github.io/icare-validate/duckdb/duckdb-browser-eh.worker.js',
    );
  });

  it('emits absolute (origin-qualified) URLs for every bundle file — see importScripts note above', () => {
    const b = buildDuckdbBundles('/icare-validate/', 'http://localhost:5174');
    for (const url of [b.mvp.mainModule, b.mvp.mainWorker, b.eh?.mainModule, b.eh?.mainWorker]) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it('falls back to base-relative URLs when no origin is given (SSR / no window)', () => {
    const b = buildDuckdbBundles('/icare-validate/');
    expect(b.mvp.mainWorker).toBe('/icare-validate/duckdb/duckdb-browser-mvp.worker.js');
    expect(b.eh?.mainModule).toBe('/icare-validate/duckdb/duckdb-eh.wasm');
  });

  it('respects the dev base "/"', () => {
    expect(buildDuckdbBundles('/', 'http://localhost:5174').eh?.mainModule).toBe(
      'http://localhost:5174/duckdb/duckdb-eh.wasm',
    );
  });

  it('omits the coi (threaded) bundle — no SharedArrayBuffer on GitHub Pages', () => {
    expect(
      buildDuckdbBundles('/icare-validate/', 'https://jeyabbalas.github.io'),
    ).not.toHaveProperty('coi');
  });
});
