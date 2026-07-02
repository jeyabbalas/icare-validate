// Client-side parsing + validation for the files a user (or an example) feeds the input builder.
//
// Two hard rules shape this module:
//  1. Nothing here ever touches the SDK. The raw File/Blob (or {url}) is what gets sent to
//     wasm-icare; these functions only produce *preview + validation metadata* for the UI.
//  2. Advisory-first. Only genuinely blocking problems (unparseable, missing required columns,
//     non-binary outcome) are `errors`; every soft heuristic is a `warning`, so a determined user
//     with an unusual-but-valid dataset is never hard-blocked.
//
// All functions are pure and async only because reading a File is async — no other side effects,
// which is what makes them straightforward to unit-test.

import { csvParse, tsvParse, type DSVRowArray } from 'd3-dsv';

/** Uniform result for the tabular validators. `ok === (errors.length === 0)`. */
export interface IngestResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  meta: {
    headers: string[];
    nRows: number;
    badges?: string[];
  };
}

export interface ParsedTable {
  headers: string[];
  rows: DSVRowArray<string>;
}

/** Read a File's text and parse it as delimited data. Delimiter inferred from the file name. */
export async function readDelimited(file: File): Promise<ParsedTable> {
  const text = await file.text();
  const isTsv = /\.tsv$/i.test(file.name);
  const rows = isTsv ? tsvParse(text.trim()) : csvParse(text.trim());
  return { headers: rows.columns ?? [], rows };
}

// ---- helpers ---------------------------------------------------------------

/** A value that parses to a finite number. Empty/whitespace and non-numeric strings fail. */
function isFiniteNumeric(v: string | undefined): boolean {
  if (v == null) return false;
  const s = v.trim();
  if (s === '') return false;
  return Number.isFinite(Number(s));
}

/** Report at most `limit` example row numbers (1-based data rows) for an error message. */
function sampleRows(indices: number[], limit = 5): string {
  const shown = indices.slice(0, limit).map((i) => i + 1); // 1-based data-row numbers
  const more = indices.length > limit ? `, … (+${indices.length - limit} more)` : '';
  return `${shown.join(', ')}${more}`;
}

function baseResult(table: ParsedTable): IngestResult {
  return {
    ok: true,
    errors: [],
    warnings: [],
    meta: { headers: table.headers, nRows: table.rows.length },
  };
}

function finalize(result: IngestResult): IngestResult {
  result.ok = result.errors.length === 0;
  return result;
}

/** Guard shared by every tabular validator: at least one column and one data row. */
function requireNonEmpty(table: ParsedTable, result: IngestResult): boolean {
  if (table.headers.length === 0) {
    result.errors.push('No columns found — the file is empty or not valid delimited text.');
    return false;
  }
  if (table.rows.length === 0) {
    result.errors.push('No data rows found (header only).');
    return false;
  }
  return true;
}

// ---- study data ------------------------------------------------------------

const STUDY_REQUIRED = ['observed_outcome', 'study_entry_age', 'study_exit_age'] as const;
const STUDY_NUMERIC = ['study_entry_age', 'study_exit_age', 'observed_followup'] as const;

/**
 * Validate the top-level study/outcome table. Detects nested case-control designs via a
 * `sampling_weights` column and tags the result with an `'ncc'` badge.
 */
export async function validateStudyData(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);

  const headers = new Set(table.headers);

  const missing = STUDY_REQUIRED.filter((h) => !headers.has(h));
  if (missing.length) {
    result.errors.push(`Missing required column(s): ${missing.join(', ')}.`);
  }
  if (!headers.has('id')) {
    result.warnings.push('No `id` column — one will be assigned by row order.');
  }

  // observed_outcome must be binary {0,1} on every row.
  if (headers.has('observed_outcome')) {
    const bad: number[] = [];
    table.rows.forEach((row, i) => {
      const v = row.observed_outcome?.trim();
      if (v !== '0' && v !== '1') bad.push(i);
    });
    if (bad.length) {
      result.errors.push(
        `\`observed_outcome\` must be 0 or 1 — ${bad.length} row(s) are not (e.g. row ${sampleRows(bad)}).`,
      );
    }
  }

  // Numeric age columns must parse as finite numbers. `time_of_onset` is intentionally skipped
  // ("Inf" is a valid censored value in the fixtures).
  for (const col of STUDY_NUMERIC) {
    if (!headers.has(col)) continue;
    const bad: number[] = [];
    table.rows.forEach((row, i) => {
      if (!isFiniteNumeric(row[col])) bad.push(i);
    });
    if (bad.length) {
      result.errors.push(
        `\`${col}\` must be numeric — ${bad.length} row(s) are not (e.g. row ${sampleRows(bad)}).`,
      );
    }
  }

  // Soft sanity check: exit age should not precede entry age.
  if (headers.has('study_entry_age') && headers.has('study_exit_age')) {
    let violations = 0;
    table.rows.forEach((row) => {
      const entry = Number(row.study_entry_age);
      const exit = Number(row.study_exit_age);
      if (Number.isFinite(entry) && Number.isFinite(exit) && exit < entry) violations += 1;
    });
    if (violations) {
      result.warnings.push(
        `\`study_exit_age\` is below \`study_entry_age\` in ${violations} row(s).`,
      );
    }
  }

  // Nested case-control detection.
  if (headers.has('sampling_weights')) {
    result.meta.badges = ['ncc'];
    result.warnings.push(
      'Nested case-control design detected (`sampling_weights` present) — inverse-probability weighting will be applied.',
    );
  }

  return finalize(result);
}

// ---- age,rate tables (disease / competing incidence) -----------------------

/** Validate an `age,rate` incidence table (disease or competing). */
export async function validateRatesTable(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);

  const headers = new Set(table.headers);
  for (const col of ['age', 'rate'] as const) {
    if (!headers.has(col)) result.errors.push(`Missing required column \`${col}\`.`);
  }
  const extra = table.headers.filter((h) => h !== 'age' && h !== 'rate');
  if (extra.length) {
    result.warnings.push(`Unexpected extra column(s) will be ignored: ${extra.join(', ')}.`);
  }
  if (result.errors.length) return finalize(result);

  const badAge: number[] = [];
  const badRate: number[] = [];
  table.rows.forEach((row, i) => {
    const age = Number(row.age);
    const rate = Number(row.rate);
    if (!isFiniteNumeric(row.age) || age < 0) badAge.push(i);
    if (!isFiniteNumeric(row.rate) || rate < 0) badRate.push(i);
  });
  if (badAge.length) {
    result.errors.push(
      `\`age\` must be a non-negative number — ${badAge.length} bad row(s) (e.g. row ${sampleRows(badAge)}).`,
    );
  }
  if (badRate.length) {
    result.errors.push(
      `\`rate\` must be a non-negative number — ${badRate.length} bad row(s) (e.g. row ${sampleRows(badRate)}).`,
    );
  }

  return finalize(result);
}

// ---- reference / covariate tables (structural only) ------------------------

/** Validate the model reference dataset. Covariate semantics are model-specific, so this is structural. */
export async function validateReferenceDataset(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);
  if (new Set(table.headers).has('observed_outcome')) {
    result.warnings.push(
      'Reference dataset contains an `observed_outcome` column — usually reference data holds covariates only.',
    );
  }
  return finalize(result);
}

/** Validate the apply-covariate-profile table. Structural; an `id` column is recommended. */
export async function validateCovariateProfile(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);
  if (!new Set(table.headers).has('id')) {
    result.warnings.push('No `id` column — subjects will be matched to study rows by order.');
  }
  return finalize(result);
}

// ---- formula (.txt) --------------------------------------------------------

export interface FormulaResult {
  ok: boolean;
  text: string;
  errors: string[];
  warnings: string[];
}

/** Read a Patsy covariate formula file into a trimmed string. */
export async function readFormula(file: File): Promise<FormulaResult> {
  const raw = (await file.text()).trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw === '') {
    errors.push('Formula file is empty.');
  } else if (!/[C(]|\+|~/.test(raw)) {
    warnings.push('This does not look like a Patsy formula (no `C(...)`, `+`, or `~` found).');
  }
  return { ok: errors.length === 0, text: raw, errors, warnings };
}

// ---- log odds ratios (.json) -----------------------------------------------

export interface LogOddsResult {
  ok: boolean;
  map: Record<string, number>;
  errors: string[];
  warnings: string[];
}

/** Read the log-odds-ratios JSON into a flat `{ designMatrixColumn: beta }` record. */
export async function readLogOddsRatios(file: File): Promise<LogOddsResult> {
  const raw = await file.text();
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      map: {},
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      map: {},
      errors: [
        'Expected a JSON object mapping design-matrix column names to numeric coefficients.',
      ],
      warnings,
    };
  }

  const map: Record<string, number> = {};
  const nonNumeric: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      map[key] = value;
    } else {
      nonNumeric.push(key);
    }
  }

  if (Object.keys(map).length === 0) {
    errors.push('No numeric coefficients found.');
  }
  if (nonNumeric.length) {
    errors.push(
      `Non-numeric coefficient(s) for: ${nonNumeric.slice(0, 5).join(', ')}${
        nonNumeric.length > 5 ? ', …' : ''
      }.`,
    );
  }

  return { ok: errors.length === 0, map, errors, warnings };
}
