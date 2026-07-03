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

/** Per-column numeric summary, gathered in a single pass, for cross-file / value-range checks. */
export interface ColumnNumericSummary {
  numeric: number; // cells that parse to a finite number
  missing: number; // empty cells
  total: number;
  min: number | null;
  max: number | null;
}

/**
 * Lightweight numeric summaries carried on a slot's parse metadata so cross-file checks (rate age
 * coverage, profile row parity, Mode-B risk range) need no second file read. UI-only, never sent to
 * the SDK.
 */
export interface ParseStats {
  columns?: Record<string, ColumnNumericSummary>; // study: per-column summary
  nCases?: number; // study: Σ observed_outcome
  ageMin?: number; // study: min(study_entry_age); rates: min plotted age
  ageMax?: number; // study: max(study_exit_age); rates: max plotted age
  rateAges?: number[]; // rates: sorted unique ages with a present rate (bands expanded per-year)
}

/** Uniform result for the tabular validators. `ok === (errors.length === 0)`. */
export interface IngestResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  meta: {
    headers: string[];
    nRows: number;
    badges?: string[];
    stats?: ParseStats;
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

// py-icare's `_set_study_data` requires all four of these columns and rejects missing values in any
// of them. `time_of_onset` is validated separately (below) because it accepts `Inf` for censored
// controls, which is not a finite number.
const STUDY_REQUIRED = [
  'observed_outcome',
  'study_entry_age',
  'study_exit_age',
  'time_of_onset',
] as const;
const STUDY_NUMERIC = ['study_entry_age', 'study_exit_age', 'observed_followup'] as const;
const INFINITY_RE = /^[+-]?(inf|infinity)$/i;

/**
 * A valid `time_of_onset` cell: non-empty and either finite-numeric or an infinity literal. py-icare
 * casts this column with `float(...)` (so `Inf`/`Infinity`/`-inf` are accepted for censored controls)
 * and rejects NaN/missing values in the mandatory columns — so an empty cell is a blocking error.
 */
function isTimeOfOnset(v: string | undefined): boolean {
  const s = v?.trim() ?? '';
  return s !== '' && (isFiniteNumeric(s) || INFINITY_RE.test(s));
}

/**
 * Numeric summaries for the study table (single pass): per-column min/max/missing/numeric counts, the
 * case count (Σ observed_outcome), and the age span (min entry age → max exit age). These feed the
 * cross-file rate-coverage check and the Mode-B predicted-risk range check without a second read.
 */
function computeStudyStats(table: ParsedTable): ParseStats {
  const columns: Record<string, ColumnNumericSummary> = {};
  for (const h of table.headers) {
    columns[h] = { numeric: 0, missing: 0, total: table.rows.length, min: null, max: null };
  }
  let nCases = 0;
  for (const row of table.rows) {
    for (const h of table.headers) {
      const s = row[h]?.trim() ?? '';
      const col = columns[h];
      if (s === '') {
        col.missing += 1;
        continue;
      }
      const n = Number(s);
      if (Number.isFinite(n)) {
        col.numeric += 1;
        col.min = col.min == null ? n : Math.min(col.min, n);
        col.max = col.max == null ? n : Math.max(col.max, n);
      }
    }
    if (row.observed_outcome?.trim() === '1') nCases += 1;
  }
  return {
    columns,
    nCases,
    ageMin: columns['study_entry_age']?.min ?? undefined,
    ageMax: columns['study_exit_age']?.max ?? undefined,
  };
}

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

  // Numeric age columns must parse as finite numbers. `time_of_onset` is checked separately below
  // (it also accepts `Inf` for censored controls).
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

  // time_of_onset must be present and non-empty on every row (py-icare rejects NaN in the mandatory
  // columns) and either a finite number or an infinity literal (censored controls are `±Inf`).
  if (headers.has('time_of_onset')) {
    const bad: number[] = [];
    table.rows.forEach((row, i) => {
      if (!isTimeOfOnset(row.time_of_onset)) bad.push(i);
    });
    if (bad.length) {
      result.errors.push(
        `\`time_of_onset\` must be a number or \`Inf\` on every row — ${bad.length} row(s) are empty or invalid (e.g. row ${sampleRows(bad)}).`,
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
    // py-icare computes frequency = 1 / sampling_weights, so weights must be positive and finite.
    const badWeights: number[] = [];
    table.rows.forEach((row, i) => {
      const w = Number(row.sampling_weights);
      if (!isFiniteNumeric(row.sampling_weights) || w <= 0) badWeights.push(i);
    });
    if (badWeights.length) {
      result.warnings.push(
        `\`sampling_weights\` should be a positive number — ${badWeights.length} row(s) are not (e.g. row ${sampleRows(badWeights)}).`,
      );
    }
  }

  result.meta.stats = computeStudyStats(table);
  return finalize(result);
}

// ---- incidence-rate tables (disease / competing) ---------------------------

/**
 * Validate an incidence-rate table (disease or competing). py-icare accepts two layouts, so we detect
 * by header and dispatch:
 *   • `age,rate` — one hazard per integer age.
 *   • `start_age,end_age,rate` — half-open age bands `[start_age, end_age)`. py-icare's `format_rates`
 *     expands each band to per-year by DIVIDING the rate across the years it spans.
 */
export async function validateRatesTable(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);

  const headers = new Set(table.headers);
  const isBand = headers.has('start_age') && headers.has('end_age') && headers.has('rate');
  const isPoint = headers.has('age') && headers.has('rate');

  if (isBand) return validateRatesBand(table, result);
  if (isPoint) return validateRatesPoint(table, result);

  // Neither schema — name both. Keep the word `rate` in the message (a required column in each, and
  // what existing callers/tests key on).
  result.errors.push(
    'Rate table must have columns `age`, `rate` (per single age) or `start_age`, `end_age`, `rate` (age bands).',
  );
  return finalize(result);
}

/** `age,rate`: one hazard per integer age; a blank rate is a tolerated gap, not an error. */
function validateRatesPoint(table: ParsedTable, result: IngestResult): IngestResult {
  const extra = table.headers.filter((h) => h !== 'age' && h !== 'rate');
  if (extra.length) {
    result.warnings.push(`Unexpected extra column(s) will be ignored: ${extra.join(', ')}.`);
  }

  const badAge: number[] = [];
  const badRate: number[] = [];
  const gtOne: number[] = [];
  const coveredAges: number[] = [];
  table.rows.forEach((row, i) => {
    const ageOk = isFiniteNumeric(row.age) && Number(row.age) >= 0;
    if (!ageOk) badAge.push(i);
    // A rate may be blank: py-icare tolerates missing rates for ages outside the study span (it only
    // requires coverage *across* that span, checked cross-file). A present rate must be non-negative.
    const rateStr = row.rate?.trim() ?? '';
    if (rateStr === '') return;
    if (!isFiniteNumeric(rateStr) || Number(rateStr) < 0) {
      badRate.push(i);
    } else {
      if (Number(rateStr) > 1) gtOne.push(i); // py-icare treats rates as probabilities in [0, 1]
      if (ageOk) coveredAges.push(Number(row.age));
    }
  });
  if (badAge.length) {
    result.errors.push(
      `\`age\` must be a non-negative number — ${badAge.length} bad row(s) (e.g. row ${sampleRows(badAge)}).`,
    );
  }
  if (badRate.length) {
    result.errors.push(
      `\`rate\` must be a non-negative number where present — ${badRate.length} bad row(s) (e.g. row ${sampleRows(badRate)}).`,
    );
  }
  if (gtOne.length) {
    result.warnings.push(
      `\`rate\` is a probability in [0, 1]; ${gtOne.length} row(s) exceed 1 (e.g. row ${sampleRows(gtOne)}).`,
    );
  }

  // Ages with a valid, present rate — the cross-file coverage check treats a blank-rate age as not
  // covered, matching py-icare's pd.isna handling.
  const covered = Array.from(new Set(coveredAges)).sort((a, b) => a - b);
  result.meta.stats = covered.length
    ? { rateAges: covered, ageMin: covered[0], ageMax: covered[covered.length - 1] }
    : { rateAges: covered };
  return finalize(result);
}

/**
 * `start_age,end_age,rate`: half-open age bands `[start_age, end_age)`. py-icare requires integer ages,
 * a probability rate in [0, 1], and contiguous bands. We check contiguity per row (stricter than
 * py-icare's summed check, which lets an offsetting gap+overlap slip through).
 */
function validateRatesBand(table: ParsedTable, result: IngestResult): IngestResult {
  const extra = table.headers.filter(
    (h) => h !== 'start_age' && h !== 'end_age' && h !== 'rate',
  );
  if (extra.length) {
    result.warnings.push(`Unexpected extra column(s) will be ignored: ${extra.join(', ')}.`);
  }

  const badAge: number[] = []; // non-integer, negative, or end_age ≤ start_age
  const badRate: number[] = []; // blank / non-numeric / outside [0, 1] (a band needs a present rate)
  const bands: { start: number; end: number }[] = [];
  table.rows.forEach((row, i) => {
    const start = Number(row.start_age?.trim());
    const end = Number(row.end_age?.trim());
    const ageOk =
      isFiniteNumeric(row.start_age) &&
      isFiniteNumeric(row.end_age) &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start;
    if (!ageOk) badAge.push(i);

    const rateStr = row.rate?.trim() ?? '';
    const rate = Number(rateStr);
    const rateOk = isFiniteNumeric(rateStr) && rate >= 0 && rate <= 1;
    if (!rateOk) badRate.push(i);

    if (ageOk && rateOk) bands.push({ start, end });
  });
  if (badAge.length) {
    result.errors.push(
      `\`start_age\`/\`end_age\` must be integers with end_age > start_age — ${badAge.length} bad row(s) (e.g. row ${sampleRows(badAge)}).`,
    );
  }
  if (badRate.length) {
    result.errors.push(
      `\`rate\` must be a probability in [0, 1] — ${badRate.length} bad row(s) (e.g. row ${sampleRows(badRate)}).`,
    );
  }
  if (result.errors.length) return finalize(result);

  // Contiguity: sorted by start_age, each band must begin exactly where the previous one ended.
  const sorted = [...bands].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].start !== sorted[k - 1].end) {
      result.errors.push(
        `Age bands must be contiguous (no gaps or overlaps): a band starts at ${sorted[k].start} but the previous band ends at ${sorted[k - 1].end}.`,
      );
      break;
    }
  }
  if (result.errors.length) return finalize(result);

  // Expand each half-open [start, end) band to its covered integer ages (matching py-icare's per-year
  // expansion) so cross-file coverage and the shared x-domain see the real span.
  const covered = new Set<number>();
  for (const b of sorted) for (let a = b.start; a < b.end; a++) covered.add(a);
  const rateAges = Array.from(covered).sort((a, b) => a - b);

  result.meta.badges = ['age bands'];
  result.meta.stats = sorted.length
    ? { rateAges, ageMin: sorted[0].start, ageMax: sorted[sorted.length - 1].end }
    : { rateAges };
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

// ---- SNP info --------------------------------------------------------------

/**
 * Validate the SNP info table. py-icare's `check_snp_info` requires the three named columns (a
 * blocking error); we additionally warn when a frequency falls outside [0, 1] or an odds ratio is
 * non-positive.
 */
export async function validateSnpInfo(file: File): Promise<IngestResult> {
  const table = await readDelimited(file);
  const result = baseResult(table);
  if (!requireNonEmpty(table, result)) return finalize(result);

  const headers = new Set(table.headers);
  const required = ['snp_name', 'snp_odds_ratio', 'snp_freq'] as const;
  const missing = required.filter((h) => !headers.has(h));
  if (missing.length) {
    result.errors.push(
      `Missing required SNP column(s): ${missing.join(', ')} (expected snp_name, snp_odds_ratio, snp_freq).`,
    );
    return finalize(result);
  }

  const badFreq: number[] = [];
  const badOr: number[] = [];
  table.rows.forEach((row, i) => {
    const freq = Number(row.snp_freq);
    const or = Number(row.snp_odds_ratio);
    if (!isFiniteNumeric(row.snp_freq) || freq < 0 || freq > 1) badFreq.push(i);
    if (!isFiniteNumeric(row.snp_odds_ratio) || or <= 0) badOr.push(i);
  });
  if (badFreq.length) {
    result.warnings.push(
      `\`snp_freq\` should be a frequency in [0, 1] — ${badFreq.length} row(s) are not (e.g. row ${sampleRows(badFreq)}).`,
    );
  }
  if (badOr.length) {
    result.warnings.push(
      `\`snp_odds_ratio\` should be a positive number — ${badOr.length} row(s) are not (e.g. row ${sampleRows(badOr)}).`,
    );
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

// ---- numeric vector (reference risks) --------------------------------------

export interface NumericVectorResult {
  ok: boolean;
  values: number[];
  errors: string[];
  warnings: string[];
}

/**
 * Read a file of numbers into a `number[]`. Unlike the tabular slots (whose raw Blob is what reaches
 * the SDK), the reference-risk arrays are typed as `number[]` in the SDK options, so they must be
 * parsed client-side. Accepts a JSON array, a one-column CSV (a leading header token is tolerated),
 * or whitespace/comma/newline-separated numbers. Any non-numeric token is a blocking error.
 */
export async function readNumericVector(file: File): Promise<NumericVectorResult> {
  const raw = (await file.text()).trim();
  const warnings: string[] = [];
  if (raw === '') {
    return { ok: false, values: [], errors: ['File is empty.'], warnings };
  }

  let tokens: string[];
  if (raw[0] === '[' || raw[0] === '{') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, values: [], errors: [`Invalid JSON: ${msg}`], warnings };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, values: [], errors: ['Expected a JSON array of numbers.'], warnings };
    }
    tokens = parsed.map((v) => String(v));
  } else {
    tokens = raw.split(/[\s,]+/).filter((t) => t !== '');
    // Tolerate a single non-numeric header token (e.g. a column name) at the start.
    if (tokens.length > 1 && !isFiniteNumeric(tokens[0]) && tokens.slice(1).every(isFiniteNumeric)) {
      warnings.push(`Ignoring header token \`${tokens[0]}\`.`);
      tokens = tokens.slice(1);
    }
  }

  const values: number[] = [];
  const bad: string[] = [];
  for (const t of tokens) {
    if (isFiniteNumeric(t)) values.push(Number(t));
    else bad.push(t);
  }

  const errors: string[] = [];
  if (bad.length) {
    errors.push(
      `Expected only numbers — found non-numeric value(s): ${bad.slice(0, 5).join(', ')}${
        bad.length > 5 ? ', …' : ''
      }.`,
    );
  } else if (values.length === 0) {
    errors.push('No numeric values found.');
  }

  return { ok: errors.length === 0, values, errors, warnings };
}

// ---- uniform slot adapter --------------------------------------------------
//
// The input builder stores one uniform preview/validation shape per file slot, regardless of
// whether the file is a table, a formula, or a JSON map. `ingestByKind` maps each input kind to
// the right validator above and normalizes its result into `ParseMeta`.

/** Which validator to run for a given file slot. */
export type SlotKind =
  | 'study'
  | 'rates'
  | 'reference'
  | 'covariate'
  | 'formula'
  | 'logOddsRatios'
  | 'snpInfo';

/** Uniform preview + validation metadata stored on a file slot. UI-only — never sent to the SDK. */
export interface ParseMeta {
  headers: string[];
  nRows: number;
  errors: string[];
  warnings: string[];
  badges?: string[];
  /** Short human summary for non-tabular inputs (formula excerpt, coefficient count). */
  preview?: string;
  /** Numeric summaries (study: per-column + age span; rates: ages present) for cross-file checks. */
  stats?: ParseStats;
}

function excerpt(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Run the validator matching `kind` and normalize it to a `ParseMeta`. */
export async function ingestByKind(kind: SlotKind, file: File): Promise<ParseMeta> {
  switch (kind) {
    case 'study':
      return toMeta(await validateStudyData(file));
    case 'rates':
      return toMeta(await validateRatesTable(file));
    case 'reference':
      return toMeta(await validateReferenceDataset(file));
    case 'covariate':
      return toMeta(await validateCovariateProfile(file));
    case 'snpInfo':
      return toMeta(await validateSnpInfo(file));
    case 'formula': {
      const r = await readFormula(file);
      return {
        headers: [],
        nRows: 0,
        errors: r.errors,
        warnings: r.warnings,
        preview: r.text ? excerpt(r.text) : undefined,
      };
    }
    case 'logOddsRatios': {
      const r = await readLogOddsRatios(file);
      const n = Object.keys(r.map).length;
      return {
        headers: [],
        nRows: n,
        errors: r.errors,
        warnings: r.warnings,
        preview: n ? `${n} coefficient${n === 1 ? '' : 's'}` : undefined,
      };
    }
  }
}

function toMeta(r: IngestResult): ParseMeta {
  return {
    headers: r.meta.headers,
    nRows: r.meta.nRows,
    errors: r.errors,
    warnings: r.warnings,
    badges: r.meta.badges,
    stats: r.meta.stats,
  };
}
