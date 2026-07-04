import { csvFormat } from 'd3-dsv';
import { downloadBlob } from './figureExport';
import { PYICARE_VERSION } from './icareTypes';
import { decodeCategorical } from '../services/resultNormalizer';
import { computeCohortSummary, type CohortSummary } from './cohortSummary';
import { isDefaultRebin, type RebinState, type RunBinSpec } from '../state/rebinStore';
import type { RunProvenance } from '../state/resultsStore';
import type { NormalizedResult } from '../services/resultNormalizer';
import type { RecomputedCalibration } from '../math/calibrationMath';
import type {
  CategoricalColumn,
  ColumnarTableResult,
  GoodnessOfFitTest,
  ValidationResult,
} from './icareTypes';

// Phase 13 — the result *data* exporters (the figure exporters already live in figureExport.ts). Every
// function here is pure and returns a string, so they are unit-testable in the node env and are the same
// text that both the individual "Download …" buttons and the "Download all" ZIP emit.
//
// Two representations of calibration are exported, per the user's decision:
//  • the SDK's as-run table (`categorySpecificCalibration`, frozen at the run's default binning) — the
//    "official" validation numbers, always emitted; and
//  • the current on-screen view (`rc.bins` from the interactive re-binning) — WYSIWYG, and richer (it
//    carries bin edges + a degeneracy flag the SDK table lacks).
//
// NaN / ±Inf are MEANINGFUL in these frames (censored `time_of_onset = Inf`, `study_rate = NaN` where
// nobody is at risk, a degenerate bin's `expected_by_observed_ratio = NaN`). CSV cells encode them as the
// literal tokens `NaN` / `Inf` / `-Inf`, which BOTH pandas `read_csv` and R `read.csv` parse back to
// numeric non-finite values in an otherwise-numeric column — preserving meaning without an empty-cell
// ambiguity. (`JSON.stringify` instead coerces non-finite → `null`; the README notes the CSVs are
// authoritative for those.)

// ---- Cell encoding ---------------------------------------------------------

/** A numeric cell → a CSV token, preserving non-finite meaning (`NaN` / `Inf` / `-Inf`). */
export function encodeCell(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Inf';
  if (x === -Infinity) return '-Inf';
  return String(x);
}

/** A cell of unknown runtime type (numbers via {@link encodeCell}, strings verbatim, null → ""). */
function encodeAnyCell(v: unknown): string {
  if (typeof v === 'number') return encodeCell(v);
  if (v == null) return '';
  return String(v);
}

type ColumnValue = Float64Array | number[] | string[] | CategoricalColumn;

function isCategoricalCol(v: ColumnValue): v is CategoricalColumn {
  return typeof v === 'object' && v !== null && 'codes' in v && 'categories' in v;
}

function decodeColumn(col: ColumnValue, nRows: number): string[] {
  if (col instanceof Float64Array) return Array.from(col, encodeCell);
  if (isCategoricalCol(col)) return decodeCategorical(col).map((s) => s ?? '');
  if (Array.isArray(col)) return col.map(encodeAnyCell);
  return new Array<string>(nRows).fill('');
}

// ---- Columnar frame → CSV --------------------------------------------------

export interface DecodedFrame {
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * Transpose a `ColumnarTableResult` into header + string rows. Column order mirrors the normalizer's
 * fallback (`order` if present, else `Object.keys(columns)`) and is guarded BOTH ways — an `order` key
 * missing from `columns` is dropped, a `columns` key missing from `order` is appended — so a frame with
 * an empty `order` (which the SDK type permits) still exports every column instead of an empty CSV.
 */
export function columnarToRows(frame: ColumnarTableResult): DecodedFrame {
  const cols = frame.columns as Record<string, ColumnValue>;
  const primary = frame.order.length ? frame.order : Object.keys(cols);
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const k of primary) {
    if (k in cols && !seen.has(k)) {
      columns.push(k);
      seen.add(k);
    }
  }
  for (const k of Object.keys(cols)) {
    if (!seen.has(k)) {
      columns.push(k);
      seen.add(k);
    }
  }

  const decoded: Record<string, string[]> = {};
  for (const k of columns) decoded[k] = decodeColumn(cols[k], frame.nRows);

  const rows: Record<string, string>[] = [];
  for (let i = 0; i < frame.nRows; i += 1) {
    const row: Record<string, string> = {};
    for (const k of columns) row[k] = decoded[k][i] ?? '';
    rows.push(row);
  }
  return { columns, rows };
}

function frameCsv(frame: ColumnarTableResult): string {
  const { columns, rows } = columnarToRows(frame);
  return csvFormat(rows, columns);
}

/** Per-subject frame (all study columns + `risk_estimates`, `linear_predictors`, bin labels, …). */
export function studyDataCsv(result: ValidationResult): string {
  return frameCsv(result.studyData);
}

/** Age-specific incidence: `age`, `study_rate`, and `population_rate` when population rates were given. */
export function incidenceRatesCsv(result: ValidationResult): string {
  return frameCsv(result.incidenceRates);
}

/** The SDK's as-run per-bin calibration table (default binning), verbatim. */
export function sdkCalibrationCsv(result: ValidationResult): string {
  return frameCsv(result.categorySpecificCalibration);
}

// ---- Current-view calibration (recompute engine) ---------------------------

const CURRENT_CALIBRATION_COLUMNS = [
  'bin_index',
  'category',
  'lo',
  'hi',
  'n',
  'weight',
  'observed_absolute_risk',
  'predicted_absolute_risk',
  'variance_absolute_risk',
  'lower_ci_absolute_risk',
  'upper_ci_absolute_risk',
  'observed_relative_risk',
  'predicted_relative_risk',
  'lower_ci_relative_risk',
  'upper_ci_relative_risk',
  'expected_by_observed_ratio',
  'lower_ci_expected_by_observed_ratio',
  'upper_ci_expected_by_observed_ratio',
  'degenerate',
];

/**
 * The current on-screen bins (`rc.bins`) as CSV. `lo`/`hi` are in the binning scale's units — raw linear
 * predictor, or absolute-risk **proportion** (the UI shows percent) — see the README units key.
 */
export function currentCalibrationCsv(rc: RecomputedCalibration): string {
  const rows: Record<string, string>[] = rc.bins.map((b) => ({
    bin_index: String(b.index),
    category: b.label,
    lo: encodeCell(b.lo),
    hi: encodeCell(b.hi),
    n: String(b.n),
    weight: encodeCell(b.weight),
    observed_absolute_risk: encodeCell(b.observedAbsoluteRisk),
    predicted_absolute_risk: encodeCell(b.predictedAbsoluteRisk),
    variance_absolute_risk: encodeCell(b.varianceAbsoluteRisk),
    lower_ci_absolute_risk: encodeCell(b.lowerCiAbsoluteRisk),
    upper_ci_absolute_risk: encodeCell(b.upperCiAbsoluteRisk),
    observed_relative_risk: encodeCell(b.observedRelativeRisk),
    predicted_relative_risk: encodeCell(b.predictedRelativeRisk),
    lower_ci_relative_risk: encodeCell(b.lowerCiRelativeRisk),
    upper_ci_relative_risk: encodeCell(b.upperCiRelativeRisk),
    expected_by_observed_ratio: encodeCell(b.expectedByObservedRatio),
    lower_ci_expected_by_observed_ratio: encodeCell(b.lowerCiExpectedByObservedRatio),
    upper_ci_expected_by_observed_ratio: encodeCell(b.upperCiExpectedByObservedRatio),
    degenerate: b.degenerate ? 'true' : 'false',
  }));
  return csvFormat(rows, CURRENT_CALIBRATION_COLUMNS);
}

// ---- Reference distribution -------------------------------------------------

/** The reference population's `risk_score` / `absolute_risk` — or `null` when no reference was returned. */
export function referenceDistributionCsv(result: ValidationResult): string | null {
  const ref = result.reference;
  if (!ref) return null;
  const n = Math.max(ref.riskScore.length, ref.absoluteRisk.length);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      risk_score: encodeCell(ref.riskScore[i] ?? NaN),
      absolute_risk: encodeCell(ref.absoluteRisk[i] ?? NaN),
    });
  }
  return csvFormat(rows, ['risk_score', 'absolute_risk']);
}

// ---- Cohort summary --------------------------------------------------------

/** Cohort descriptives as a tidy `metric,value` table (weighted rows appended only for a NCC study). */
export function cohortSummaryCsv(s: CohortSummary): string {
  const rows: Record<string, string>[] = [
    { metric: 'n_subjects', value: String(s.nSubjects) },
    { metric: 'n_cases', value: encodeCell(s.nCases) },
    { metric: 'n_censored', value: encodeCell(s.nCensored) },
    { metric: 'n_event_free', value: encodeCell(s.nEventFree) },
    { metric: 'n_censored_after_horizon', value: encodeCell(s.nAfterHorizon) },
    { metric: 'case_fraction', value: encodeCell(s.caseFraction) },
    { metric: 'censored_fraction', value: encodeCell(s.censoredFraction) },
    { metric: 'person_years', value: encodeCell(s.personYears) },
    { metric: 'followup_mean', value: encodeCell(s.followupMean) },
    { metric: 'followup_min', value: encodeCell(s.followupMin) },
    { metric: 'followup_max', value: encodeCell(s.followupMax) },
    { metric: 'baseline_age_mean', value: encodeCell(s.baselineAgeMean) },
    { metric: 'baseline_age_min', value: encodeCell(s.baselineAgeMin) },
    { metric: 'baseline_age_max', value: encodeCell(s.baselineAgeMax) },
  ];
  if (s.weighted) {
    rows.push(
      { metric: 'effective_n', value: encodeCell(s.weighted.effectiveN) },
      { metric: 'effective_cases', value: encodeCell(s.weighted.effectiveCases) },
      { metric: 'effective_censored', value: encodeCell(s.weighted.effectiveCensored) },
      { metric: 'weighted_case_fraction', value: encodeCell(s.weighted.weightedCaseFraction) },
      { metric: 'weighted_followup_mean', value: encodeCell(s.weighted.followupMean) },
      { metric: 'weighted_baseline_age_mean', value: encodeCell(s.weighted.baselineAgeMean) },
    );
  }
  return csvFormat(rows, ['metric', 'value']);
}

export function cohortSummaryJson(s: CohortSummary): string {
  return JSON.stringify(s, null, 2);
}

// ---- Metrics JSON ----------------------------------------------------------

/** The live re-bin selection (display units), the subset of `rebinStore` the metrics/ZIP record. */
export type RebinSnapshot = Pick<
  RebinState,
  'scale' | 'method' | 'numberOfPercentiles' | 'cutpoints'
>;

function flattenSdkGof(g: GoodnessOfFitTest) {
  return {
    method: g.method,
    chiSquare: g.statistic.chiSquare,
    degreesOfFreedom: g.parameter.degreesOfFreedom,
    pValue: g.pValue,
  };
}

/**
 * Run reproducibility settings for the provenance block. py-icare imputes missing covariates/SNPs only on
 * the compute-risks path (Mode A) — `num_imputations` defaults to 5 when the user leaves it blank — so we
 * report the effective count and flag when the default was used; Mode B (precomputed risks) skips
 * imputation entirely, hence `imputations: null`.
 */
function runProvenanceBlock(p: RunProvenance | null) {
  if (!p) return null;
  const imputes = p.mode === 'A';
  return {
    mode: p.mode, // 'A' = model built from parameters; 'B' = precomputed risks supplied
    imputations: imputes ? p.numImputations ?? 5 : null,
    imputationsDefault: imputes && p.numImputations == null, // true → py-icare's built-in default (5) was used
    seed: p.seed, // seed for the imputation RNG (only affects Mode A runs with missing values)
  };
}

/**
 * The headline metrics as JSON, with provenance and TWO clearly-labelled blocks:
 *  • `sdkAsRun` — the binning-invariant scalars (AUC, Brier, overall E/O) + the SDK's default-binned GOF;
 *  • `currentView` — the interactive re-bin spec + the recomputed GOF that matches what's on screen.
 * `now` is injected so exports are deterministic in tests. Non-finite numbers become JSON `null`.
 */
export function metricsJson(
  result: ValidationResult,
  normalized: NormalizedResult,
  rc: RecomputedCalibration,
  rebin: RebinSnapshot,
  defaultSpec: RunBinSpec | null,
  provenance: RunProvenance | null,
  now: Date = new Date(),
): string {
  const payload = {
    app: 'iCARE-validate',
    exportedAt: now.toISOString(),
    pyicareVersion: PYICARE_VERSION,
    method: result.method,
    info: result.info,
    isNcc: normalized.isNcc,
    hasReference: Boolean(result.reference),
    run: runProvenanceBlock(provenance), // mode + imputation/seed reproducibility settings (null pre-run)
    sdkAsRun: {
      auc: result.auc,
      brierScore: result.brierScore,
      expectedByObservedRatio: result.expectedByObservedRatio, // binning-invariant, always the SDK scalar
      calibration: {
        absoluteRisk: flattenSdkGof(result.calibration.absoluteRisk),
        relativeRisk: flattenSdkGof(result.calibration.relativeRisk),
      },
      binning: {
        numberOfPercentiles: defaultSpec?.numberOfPercentiles ?? null,
        linearPredictorCutoffs: defaultSpec?.linearPredictorCutoffs ?? null,
      },
    },
    currentView: {
      binning: {
        scale: rebin.scale,
        method: rebin.method,
        numberOfPercentiles: rebin.numberOfPercentiles,
        cutpoints: rebin.cutpoints, // display units (percent on the absolute-risk scale)
        edges: rc.edges,
        nBins: rc.nBins,
        isDefaultRebin: isDefaultRebin({ ...rebin, defaultSpec }),
      },
      nExcluded: rc.nExcluded, // subjects dropped from the per-bin calibration (NaN/unbinnable score)
      absoluteRiskGof: rc.absoluteRiskGof, // flat GofResult incl. `defined` + variance
      relativeRiskGof: rc.relativeRiskGof,
      warnings: rc.warnings,
    },
  };
  return JSON.stringify(payload, null, 2);
}

// ---- Bundle of every data file ---------------------------------------------

/**
 * Every result data file as `{ bare-filename: text }`. The ZIP puts these under `data/`; the individual
 * download buttons use the bare filename directly. `reference-distribution.csv` is included only when a
 * reference distribution was returned.
 */
export function collectResultFiles(
  result: ValidationResult,
  normalized: NormalizedResult,
  rc: RecomputedCalibration,
  rebin: RebinSnapshot,
  defaultSpec: RunBinSpec | null,
  provenance: RunProvenance | null,
  now: Date = new Date(),
): Record<string, string> {
  const summary = computeCohortSummary(normalized.perSubject, normalized.isNcc);
  const files: Record<string, string> = {
    'metrics.json': metricsJson(result, normalized, rc, rebin, defaultSpec, provenance, now),
    'calibration-current-view.csv': currentCalibrationCsv(rc),
    'calibration-sdk-default.csv': sdkCalibrationCsv(result),
    'study-data.csv': studyDataCsv(result),
    'incidence-rates.csv': incidenceRatesCsv(result),
    'cohort-summary.csv': cohortSummaryCsv(summary),
    'cohort-summary.json': cohortSummaryJson(summary),
  };
  const refCsv = referenceDistributionCsv(result);
  if (refCsv !== null) files['reference-distribution.csv'] = refCsv;
  return files;
}

// ---- Single-file download --------------------------------------------------

export function mimeFor(filename: string): string {
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.csv')) return 'text/csv';
  return 'text/plain';
}

/** Trigger a browser download of `text` as `filename` (MIME inferred from the extension). */
export function downloadText(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: `${mimeFor(filename)};charset=utf-8` }), filename);
}

/** Slug for use in a download filename (lowercase alphanumerics + single dashes). */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'validation'
  );
}
