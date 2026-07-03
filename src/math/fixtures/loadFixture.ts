import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ValidationResult } from '../../lib/icareTypes';

// Loads a golden fixture written by scripts/dump-calibration-fixtures.mjs and reverses its serialization:
// NaN / ±Infinity sentinel strings back to their float values, and the tagged `{ __cat__ }` object back to
// a CategoricalColumn (`codes` as Int32Array). Numeric columns come back as `number[]`, which the real
// normalizer's `asFloat64` coerces — so the parity test runs the genuine normalize → recompute path.

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function decode(v: Json): unknown {
  if (v === '__NaN__') return NaN;
  if (v === '__Inf__') return Infinity;
  if (v === '__NegInf__') return -Infinity;
  if (Array.isArray(v)) return v.map(decode);
  if (v !== null && typeof v === 'object') {
    if (v.__cat__ === true) {
      return { codes: Int32Array.from(v.codes as number[]), categories: v.categories };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = decode(v[k]);
    return out;
  }
  return v;
}

export type FixtureName = 'icare-lit-ge50' | 'bpc3-covariate';

export interface Fixture {
  result: ValidationResult; // enough of the shape for normalizeValidationResult + the parity assertions
  isNcc: boolean;
  numberOfPercentiles: number;
}

// Module-relative resolution is correct under the node test env, but vitest's jsdom env rewrites
// `import.meta.url` so that path misresolves — fall back to the repo root (where vitest always runs, and
// which the fixture-dump script likewise anchors on via `process.cwd()`).
function resolveFixture(name: FixtureName): string {
  const viaModule = fileURLToPath(new URL(`./${name}.json`, import.meta.url));
  if (existsSync(viaModule)) return viaModule;
  return path.join(process.cwd(), 'src', 'math', 'fixtures', `${name}.json`);
}

export function loadFixture(name: FixtureName): Fixture {
  const raw = decode(JSON.parse(readFileSync(resolveFixture(name), 'utf8')) as Json) as Record<
    string,
    unknown
  >;
  return {
    result: raw as unknown as ValidationResult,
    isNcc: raw.isNcc as boolean,
    numberOfPercentiles: raw.numberOfPercentiles as number,
  };
}
