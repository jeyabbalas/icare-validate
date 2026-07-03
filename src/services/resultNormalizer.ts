import type {
  CategoricalColumn,
  ColumnarTableResult,
  ValidationResult,
} from '../lib/icareTypes';

// Phase 4: decode the SDK's `ColumnarTableResult` frames (whose column keys are py-icare's verbatim
// snake_case pandas names) into a typed, plot-ready shape the downstream phases (5–13) bind to.
//
// Two invariants pinned from the py-icare 1.3.0 source:
//  • The precomputed risk / linear-predictor columns are ALWAYS literally `risk_estimates` /
//    `linear_predictors` — even in Mode B, py-icare's stats hard-code those names (a run with other
//    names crashes upstream), so we read them unconditionally.
//  • NaN / inf are meaningful, not corruption: `time_of_onset` is `inf` for censored subjects, the
//    per-bin expected/observed ratio is NaN for degenerate bins, and `study_rate` is NaN where nobody is
//    at risk at an age. We preserve them; consumers clamp/skip when plotting.
//
// Every numeric column is coerced to `Float64Array` (integer columns arrive as `number[]`, and a column
// can flip int→float across runs) so consumers get one uniform type regardless of dtype.

// ---- Decoded shapes (the long-lived contract) ------------------------------

export interface PerSubject {
  n: number;
  /** From the study index; absent if the study CSV had no `id` column. */
  id?: number[] | string[];
  observedOutcome: Float64Array; // 0 / 1
  studyEntryAge: Float64Array;
  studyExitAge: Float64Array;
  timeOfOnset: Float64Array; // inf = censored (no onset within follow-up)
  observedFollowup: Float64Array;
  predictedRiskInterval: Float64Array;
  followup: Float64Array;
  riskEstimates: Float64Array; // canonical `risk_estimates`
  linearPredictors: Float64Array; // canonical `linear_predictors`
  linearPredictorsCategory: (string | null)[]; // decoded bin labels (interval strings); null = missing
  samplingWeights: Float64Array | null; // nested case-control only
  frequency: Float64Array | null; // 1 / sampling_weights; nested case-control only
}

export interface CategoryCalibration {
  category: string[]; // per-bin labels (interval strings), bin order
  nBins: number;
  observedAbsoluteRisk: Float64Array;
  predictedAbsoluteRisk: Float64Array;
  lowerCiAbsoluteRisk: Float64Array;
  upperCiAbsoluteRisk: Float64Array;
  observedRelativeRisk: Float64Array;
  predictedRelativeRisk: Float64Array;
  lowerCiRelativeRisk: Float64Array;
  upperCiRelativeRisk: Float64Array;
  expectedByObservedRatio: Float64Array; // NaN for degenerate bins
  lowerCiExpectedByObservedRatio: Float64Array;
  upperCiExpectedByObservedRatio: Float64Array;
}

export interface IncidenceRates {
  age: Float64Array;
  studyRate: Float64Array; // may contain NaN (ages with nobody at risk / outside the study span)
  populationRate: Float64Array | null; // present only when population disease rates were provided
}

export interface NormalizedResult {
  perSubject: PerSubject;
  categoryCalibration: CategoryCalibration;
  incidence: IncidenceRates;
  isNcc: boolean; // nested case-control (inverse-probability weighting throughout)
}

// ---- Column decoding helpers -----------------------------------------------

type ColumnValue = Float64Array | number[] | string[] | CategoricalColumn;

function isCategorical(v: ColumnValue | undefined): v is CategoricalColumn {
  return typeof v === 'object' && v !== null && 'codes' in v && 'categories' in v;
}

/** Decode a pandas Categorical's `{codes, categories}` into per-row labels; code `-1` → `null`. */
export function decodeCategorical(col: CategoricalColumn): (string | null)[] {
  const { codes, categories } = col;
  const out: (string | null)[] = new Array(codes.length);
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    out[i] = code >= 0 && code < categories.length ? categories[code] : null;
  }
  return out;
}

/** Copy an integer `number[]` into a `Float64Array`; pass a `Float64Array` through unchanged. */
export function asFloat64(values: Float64Array | number[]): Float64Array {
  return values instanceof Float64Array ? values : Float64Array.from(values);
}

function available(frame: ColumnarTableResult): string {
  const keys = frame.order.length ? frame.order : Object.keys(frame.columns);
  return keys.join(', ');
}

function requireNumeric(frame: ColumnarTableResult, key: string, ctx: string): Float64Array {
  const v = frame.columns[key];
  if (v === undefined) {
    throw new Error(`${ctx}: missing expected column "${key}". Available columns: ${available(frame)}.`);
  }
  if (isCategorical(v)) {
    throw new Error(`${ctx}: column "${key}" is categorical, expected a numeric column.`);
  }
  return asFloat64(v as Float64Array | number[]);
}

/** A frame-bound numeric getter, so the frame + context are named once for a group of columns. */
function numericGetter(frame: ColumnarTableResult, ctx: string) {
  return (key: string): Float64Array => requireNumeric(frame, key, ctx);
}

function optNumeric(frame: ColumnarTableResult, key: string): Float64Array | null {
  const v = frame.columns[key];
  if (v === undefined || isCategorical(v)) return null;
  return asFloat64(v as Float64Array | number[]);
}

function requireStrings(frame: ColumnarTableResult, key: string, ctx: string): string[] {
  const v = frame.columns[key];
  if (v === undefined) {
    throw new Error(`${ctx}: missing expected column "${key}". Available columns: ${available(frame)}.`);
  }
  if (isCategorical(v)) return decodeCategorical(v).map((s) => s ?? '');
  if (v instanceof Float64Array) return Array.from(v, (x) => String(x));
  return (v as (string | number)[]).map((x) => String(x));
}

function requireCategorical(
  frame: ColumnarTableResult,
  key: string,
  ctx: string,
): (string | null)[] {
  const v = frame.columns[key];
  if (v === undefined) {
    throw new Error(`${ctx}: missing expected column "${key}". Available columns: ${available(frame)}.`);
  }
  if (isCategorical(v)) return decodeCategorical(v);
  // Defensive: a categorical could conceivably arrive already flattened to labels.
  if (v instanceof Float64Array) return Array.from(v, (x) => String(x));
  return (v as (string | number)[]).map((x) => (x == null ? null : String(x)));
}

function optId(frame: ColumnarTableResult): number[] | string[] | undefined {
  const v = frame.columns['id'];
  if (v === undefined || isCategorical(v)) return undefined;
  if (v instanceof Float64Array) return Array.from(v);
  return v as number[] | string[];
}

// ---- Top-level normalizer --------------------------------------------------

const RISK_COLUMN = 'risk_estimates';
const LINEAR_PREDICTOR_COLUMN = 'linear_predictors';

/**
 * Decode a `ValidationResult`'s columnar frames into the typed {@link NormalizedResult}. Scalar metrics
 * (`auc`, `brierScore`, `expectedByObservedRatio`, `calibration`, `info`, `reference`) are already
 * camelCased on `result` and read straight from there, so they are not duplicated here.
 */
export function normalizeValidationResult(result: ValidationResult): NormalizedResult {
  const study = result.studyData;
  const calibration = result.categorySpecificCalibration;
  const incidenceFrame = result.incidenceRates;

  const isNcc = 'sampling_weights' in study.columns;

  const studyNum = numericGetter(study, 'studyData');
  const perSubject: PerSubject = {
    n: study.nRows,
    id: optId(study),
    observedOutcome: studyNum('observed_outcome'),
    studyEntryAge: studyNum('study_entry_age'),
    studyExitAge: studyNum('study_exit_age'),
    timeOfOnset: studyNum('time_of_onset'),
    observedFollowup: studyNum('observed_followup'),
    predictedRiskInterval: studyNum('predicted_risk_interval'),
    followup: studyNum('followup'),
    riskEstimates: studyNum(RISK_COLUMN),
    linearPredictors: studyNum(LINEAR_PREDICTOR_COLUMN),
    linearPredictorsCategory: requireCategorical(study, 'linear_predictors_category', 'studyData'),
    samplingWeights: optNumeric(study, 'sampling_weights'),
    frequency: optNumeric(study, 'frequency'),
  };

  const calNum = numericGetter(calibration, 'categorySpecificCalibration');
  const categoryCalibration: CategoryCalibration = {
    category: requireStrings(calibration, 'category', 'categorySpecificCalibration'),
    nBins: calibration.nRows,
    observedAbsoluteRisk: calNum('observed_absolute_risk'),
    predictedAbsoluteRisk: calNum('predicted_absolute_risk'),
    lowerCiAbsoluteRisk: calNum('lower_ci_absolute_risk'),
    upperCiAbsoluteRisk: calNum('upper_ci_absolute_risk'),
    observedRelativeRisk: calNum('observed_relative_risk'),
    predictedRelativeRisk: calNum('predicted_relative_risk'),
    lowerCiRelativeRisk: calNum('lower_ci_relative_risk'),
    upperCiRelativeRisk: calNum('upper_ci_relative_risk'),
    expectedByObservedRatio: calNum('expected_by_observed_ratio'),
    lowerCiExpectedByObservedRatio: calNum('lower_ci_expected_by_observed_ratio'),
    upperCiExpectedByObservedRatio: calNum('upper_ci_expected_by_observed_ratio'),
  };

  const incidence: IncidenceRates = {
    age: requireNumeric(incidenceFrame, 'age', 'incidenceRates'),
    studyRate: requireNumeric(incidenceFrame, 'study_rate', 'incidenceRates'),
    populationRate: optNumeric(incidenceFrame, 'population_rate'),
  };

  return { perSubject, categoryCalibration, incidence, isNcc };
}
