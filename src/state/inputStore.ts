import { create } from 'zustand';
import type { ParseMeta } from '../lib/csvIngest';
import { loadExample as fetchExample, type ExampleId } from '../lib/examples';
import { useBinSettingsStore } from './binSettingsStore';

// The input builder's state model. It covers both validation modes:
//   • Mode A — build the model on the fly from `icareModelParameters` (formula + betas + rates + …).
//   • Mode B — the study data already carries pre-computed risk / linear-predictor columns.
//
// Per the browser constraint, every file lives as a raw `File` (Blob) or `{url}` — never an
// in-memory table — so it can be dropped straight into the SDK options object in Phase 4. Each slot
// also carries UI-only `parse` metadata (headers, row count, errors, ncc badge) which never reaches
// the SDK. This store does NOT build the options object or call validate — that is Phase 4.

// ---- Slot model ------------------------------------------------------------

export type SlotSource = 'upload' | 'example' | 'url';

export interface FileSlot {
  file: File | null; // the raw Blob kept for the SDK (upload / fetched example)
  url: string | null; // set when the input is referenced by URL instead of a File
  source: SlotSource | null;
  filename: string | null;
  size: number | null; // bytes, for display
  parse?: ParseMeta; // preview + validation metadata (UI only)
  parsing?: boolean; // an async validation is in flight
}

export function emptySlot(): FileSlot {
  return { file: null, url: null, source: null, filename: null, size: null };
}

/** A slot is "filled" once it references a File or URL, regardless of validation outcome. */
export function slotFilled(slot: FileSlot): boolean {
  return slot.file !== null || slot.url !== null;
}

/** A slot is "valid" when filled and its parse produced no blocking errors. */
export function slotValid(slot: FileSlot): boolean {
  return slotFilled(slot) && (slot.parse?.errors.length ?? 0) === 0;
}

// ---- Model-file keys (Mode A) ----------------------------------------------

export type ModelFileKey =
  | 'modelDiseaseIncidenceRates'
  | 'modelCompetingIncidenceRates'
  | 'modelCovariateFormula'
  | 'modelLogRelativeRisk'
  | 'modelReferenceDataset'
  | 'modelSnpInfo'
  | 'applyCovariateProfile'
  | 'applySnpProfile';

const MODEL_FILE_KEYS: ModelFileKey[] = [
  'modelDiseaseIncidenceRates',
  'modelCompetingIncidenceRates',
  'modelCovariateFormula',
  'modelLogRelativeRisk',
  'modelReferenceDataset',
  'modelSnpInfo',
  'applyCovariateProfile',
  'applySnpProfile',
];

/** Mode-A model files that must be present for a run. */
export const MODE_A_REQUIRED: ModelFileKey[] = [
  'modelDiseaseIncidenceRates',
  'modelCovariateFormula',
  'modelLogRelativeRisk',
  'modelReferenceDataset',
  'applyCovariateProfile',
];

function emptyModelFiles(): Record<ModelFileKey, FileSlot> {
  return Object.fromEntries(MODEL_FILE_KEYS.map((k) => [k, emptySlot()])) as Record<
    ModelFileKey,
    FileSlot
  >;
}

// ---- Config ----------------------------------------------------------------

export type InputMode = 'A' | 'B';

/** `predictedRiskInterval` for the SDK, modeled as a discriminated union for a type-safe UI. */
export type RiskIntervalConfig =
  | { kind: 'total-followup' }
  | { kind: 'years'; years: number }
  | { kind: 'custom'; values: number[] };

/** SDK `AgeSpec` = a single age or a per-instance array. `null` = not provided. */
export type AgeSpecValue = number | number[] | null;

/**
 * The reference-risk arrays (`referencePredictedRisks` / `referenceLinearPredictors`) are typed as
 * `number[]` in the SDK options, so — unlike the file slots whose Blob is sent verbatim — they are
 * parsed client-side into numbers. This slot keeps the parsed values plus display/validation meta.
 */
export interface NumericVectorSlot {
  values: number[] | null;
  filename: string | null;
  nRows: number;
  errors: string[];
  warnings: string[];
}

export function emptyVectorSlot(): NumericVectorSlot {
  return { values: null, filename: null, nRows: 0, errors: [], warnings: [] };
}

export type ReferenceVectorKey = 'referencePredictedRisks' | 'referenceLinearPredictors';

// ---- Store -----------------------------------------------------------------

type ConfigPatch = Partial<
  Pick<
    InputState,
    | 'riskInterval'
    | 'datasetName'
    | 'modelName'
    | 'modelReferenceDatasetWeightsVariableName'
    | 'modelFamilyHistoryVariableName'
    | 'numImputations'
    | 'predictedRiskVariableName'
    | 'linearPredictorVariableName'
    | 'referenceEntryAge'
    | 'referenceExitAge'
    | 'linearPredictorCutoffs'
  >
>;

interface InputState {
  mode: InputMode;

  study: FileSlot;
  modelFiles: Record<ModelFileKey, FileSlot>;

  // Mode-A scalar params bound to model files.
  modelReferenceDatasetWeightsVariableName: string;
  modelFamilyHistoryVariableName: string;
  numImputations: number | null;

  // Mode-B column names (columns inside studyData).
  predictedRiskVariableName: string;
  linearPredictorVariableName: string;

  // Shared config.
  riskInterval: RiskIntervalConfig;
  datasetName: string;
  modelName: string;

  // Advanced / optional reference-population inputs (enable the reference calibration curve).
  // Mode A: the model computes reference risks from the reference dataset given these ages.
  referenceEntryAge: AgeSpecValue;
  referenceExitAge: AgeSpecValue;
  // Mode B: the user supplies precomputed reference risks directly (parsed from an uploaded file).
  referencePredictedRisks: NumericVectorSlot;
  referenceLinearPredictors: NumericVectorSlot;
  linearPredictorCutoffs: number[] | null;

  exampleId: ExampleId | null;
  exampleLoading: boolean;
  exampleError: string | null;

  // Actions.
  setMode: (mode: InputMode) => void;
  setStudy: (slot: FileSlot) => void;
  setModelFile: (key: ModelFileKey, slot: FileSlot) => void;
  clearModelFile: (key: ModelFileKey) => void;
  setConfig: (patch: ConfigPatch) => void;
  setReferenceVector: (key: ReferenceVectorKey, slot: NumericVectorSlot) => void;
  loadExample: (id: ExampleId) => Promise<void>;
  reset: () => void;
}

function initialState(): Omit<
  InputState,
  | 'setMode'
  | 'setStudy'
  | 'setModelFile'
  | 'clearModelFile'
  | 'setConfig'
  | 'setReferenceVector'
  | 'loadExample'
  | 'reset'
> {
  return {
    mode: 'A',
    study: emptySlot(),
    modelFiles: emptyModelFiles(),
    modelReferenceDatasetWeightsVariableName: '',
    modelFamilyHistoryVariableName: '',
    numImputations: null,
    predictedRiskVariableName: '',
    linearPredictorVariableName: '',
    riskInterval: { kind: 'total-followup' },
    datasetName: '',
    modelName: '',
    referenceEntryAge: null,
    referenceExitAge: null,
    referencePredictedRisks: emptyVectorSlot(),
    referenceLinearPredictors: emptyVectorSlot(),
    linearPredictorCutoffs: null,
    exampleId: null,
    exampleLoading: false,
    exampleError: null,
  };
}

export const useInputStore = create<InputState>((set) => ({
  ...initialState(),

  setMode: (mode) => set({ mode }),
  setStudy: (slot) => set({ study: slot }),
  setModelFile: (key, slot) => set((s) => ({ modelFiles: { ...s.modelFiles, [key]: slot } })),
  clearModelFile: (key) => set((s) => ({ modelFiles: { ...s.modelFiles, [key]: emptySlot() } })),
  setConfig: (patch) => set(patch),
  setReferenceVector: (key, slot) => set({ [key]: slot } as Pick<InputState, ReferenceVectorKey>),

  loadExample: async (id) => {
    set({ exampleLoading: true, exampleError: null });
    try {
      const { study, modelFiles, config } = await fetchExample(id);
      set({
        ...initialState(),
        mode: 'A',
        study,
        modelFiles: { ...emptyModelFiles(), ...modelFiles },
        riskInterval: config.riskInterval,
        datasetName: config.datasetName,
        modelName: config.modelName,
        modelFamilyHistoryVariableName: config.modelFamilyHistoryVariableName ?? '',
        exampleId: id,
        exampleLoading: false,
      });
      useBinSettingsStore
        .getState()
        .set({ numberOfPercentiles: config.numberOfPercentiles, seed: config.seed });
    } catch (e) {
      set({ exampleLoading: false, exampleError: e instanceof Error ? e.message : String(e) });
    }
  },

  reset: () => {
    set(initialState());
    // Percentiles/seed live in a separate store; clear them too so Reset is a clean slate.
    useBinSettingsStore.getState().reset();
  },
}));

// ---- Derived readiness (pure selectors, not stored) ------------------------

export interface ValidationSummaryItem {
  key: string;
  label: string;
  required: boolean;
  status: 'missing' | 'invalid' | 'valid' | 'parsing';
  errors: string[];
  warnings: string[];
}

export interface ValidationSummary {
  items: ValidationSummaryItem[];
  isNcc: boolean;
  ready: boolean;
}

const MODEL_FILE_LABELS: Record<ModelFileKey, string> = {
  modelDiseaseIncidenceRates: 'Disease incidence rates',
  modelCompetingIncidenceRates: 'Competing incidence rates',
  modelCovariateFormula: 'Covariate formula',
  modelLogRelativeRisk: 'Log relative risks',
  modelReferenceDataset: 'Reference dataset',
  modelSnpInfo: 'SNP info',
  applyCovariateProfile: 'Covariate profile',
  applySnpProfile: 'SNP profile',
};

function slotItem(
  key: string,
  label: string,
  required: boolean,
  slot: FileSlot,
): ValidationSummaryItem {
  let status: ValidationSummaryItem['status'];
  if (slot.parsing) status = 'parsing';
  else if (!slotFilled(slot)) status = 'missing';
  else if ((slot.parse?.errors.length ?? 0) > 0) status = 'invalid';
  else status = 'valid';
  return {
    key,
    label,
    required,
    status,
    errors: slot.parse?.errors ?? [],
    warnings: slot.parse?.warnings ?? [],
  };
}

/**
 * True when the current `riskInterval` config carries a usable value. py-icare requires the interval
 * to be `'total-followup'`, a positive integer, or a list of positive integers — non-integers are
 * rejected. The per-subject list-length rule (== study rows) is enforced in `riskIntervalItem`, which
 * has the study row count.
 */
export function riskIntervalValid(ri: RiskIntervalConfig): boolean {
  if (ri.kind === 'total-followup') return true;
  if (ri.kind === 'years') return Number.isInteger(ri.years) && ri.years >= 1;
  return ri.values.length > 0 && ri.values.every((v) => Number.isInteger(v) && v >= 1);
}

/**
 * A summary line for a non-default predicted-risk interval. Beyond `riskIntervalValid`'s integer/
 * positivity rules, it enforces py-icare's rule that a custom per-subject list must have exactly one
 * value per study row. Returns `null` for the `'total-followup'` default (nothing to show).
 */
function riskIntervalItem(s: InputState): ValidationSummaryItem | null {
  const ri = s.riskInterval;
  if (ri.kind === 'total-followup') return null;
  const errors: string[] = [];
  if (ri.kind === 'years') {
    if (!(Number.isInteger(ri.years) && ri.years >= 1)) {
      errors.push('A fixed interval must be a whole number of years ≥ 1.');
    }
  } else if (ri.values.length === 0) {
    errors.push('Enter one whole-number interval per subject.');
  } else if (!ri.values.every((v) => Number.isInteger(v) && v >= 1)) {
    errors.push('Custom intervals must be whole numbers ≥ 1.');
  } else {
    const n = s.study.parse?.nRows;
    if (n != null && ri.values.length !== n) {
      errors.push(
        `Custom interval list has ${ri.values.length} value(s) but the study has ${n} row(s).`,
      );
    }
  }
  return {
    key: 'riskInterval',
    label: 'Predicted-risk interval',
    required: true,
    status: errors.length ? 'invalid' : 'valid',
    errors,
    warnings: [],
  };
}

// ---- Cross-file consistency (maximal advisory checks) ----------------------

/** Integer ages in [min, max) — py-icare's `check_rate_covers_all_ages` span — absent from `present`. */
function missingAges(min: number, max: number, present: number[]): number[] {
  const set = new Set(present);
  const missing: number[] = [];
  for (let a = Math.ceil(min); a < Math.ceil(max); a += 1) {
    if (!set.has(a)) missing.push(a);
  }
  return missing;
}

function formatAgeList(ages: number[], limit = 8): string {
  if (ages.length <= limit) return ages.join(', ');
  return `${ages.slice(0, limit).join(', ')}, … (+${ages.length - limit} more)`;
}

/**
 * A summary line for the optional reference population. py-icare silently ignores a lone reference
 * entry/exit age (or a lone reference array), so this flags a half-specified pair. Returns `null`
 * when nothing is specified or the pair is consistent.
 */
function referencePopulationItem(s: InputState): ValidationSummaryItem | null {
  const warnings: string[] = [];
  if (s.mode === 'A') {
    const e = s.referenceEntryAge;
    const x = s.referenceExitAge;
    if (e == null && x == null) return null;
    if ((e == null) !== (x == null)) {
      warnings.push(
        'Provide both reference entry and exit ages, or neither — a lone value is ignored.',
      );
    } else {
      const flat = (v: AgeSpecValue): number[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
      const es = flat(e);
      const xs = flat(x);
      if ([...es, ...xs].some((n) => !Number.isInteger(n))) {
        warnings.push('Reference ages should be whole numbers.');
      }
      if (Array.isArray(e) && Array.isArray(x) && e.length !== x.length) {
        warnings.push(
          `Reference entry/exit age lists differ in length (${e.length} vs ${x.length}).`,
        );
      }
      if (es.length === 1 && xs.length === 1 && xs[0] <= es[0]) {
        warnings.push('Reference exit age should exceed entry age.');
      }
    }
  } else {
    const p = s.referencePredictedRisks.values ?? [];
    const l = s.referenceLinearPredictors.values ?? [];
    if (p.length === 0 && l.length === 0) return null;
    if ((p.length > 0) !== (l.length > 0)) {
      warnings.push('Provide both reference predicted-risk and linear-predictor arrays, or neither.');
    } else if (p.length !== l.length) {
      warnings.push(`Reference arrays differ in length (${p.length} vs ${l.length}).`);
    }
  }
  if (warnings.length === 0) return null;
  return {
    key: 'referencePopulation',
    label: 'Reference population',
    required: false,
    status: 'valid',
    errors: [],
    warnings,
  };
}

/** Append cross-file advisory warnings onto the summary items that already exist. */
function applyCrossFileChecks(items: ValidationSummaryItem[], s: InputState): void {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const studyStats = s.study.parse?.stats;
  const studyRows = s.study.parse?.nRows;

  // Per-subject profiles must align 1:1 with the study rows.
  for (const key of ['applyCovariateProfile', 'applySnpProfile'] as ModelFileKey[]) {
    const item = byKey.get(key);
    const rows = s.modelFiles[key].parse?.nRows;
    if (item && studyRows != null && rows != null && rows !== studyRows) {
      item.warnings.push(
        `Has ${rows} row(s) but the study has ${studyRows} — a profile should have one row per study subject.`,
      );
    }
  }

  // Incidence-rate tables must cover every integer age across the study span.
  if (studyStats?.ageMin != null && studyStats.ageMax != null) {
    const rateKeys: ModelFileKey[] = ['modelDiseaseIncidenceRates', 'modelCompetingIncidenceRates'];
    for (const key of rateKeys) {
      const item = byKey.get(key);
      const rateAges = s.modelFiles[key].parse?.stats?.rateAges;
      if (!item || !rateAges || rateAges.length === 0) continue;
      const missing = missingAges(studyStats.ageMin, studyStats.ageMax, rateAges);
      if (missing.length) {
        item.warnings.push(
          `Does not cover every study age ${studyStats.ageMin}–${studyStats.ageMax}: missing ${formatAgeList(missing)}.`,
        );
      }
    }
  }

  // Mode B: precomputed columns should be numeric; the predicted risk is a probability in [0, 1].
  if (s.mode === 'B' && studyStats?.columns) {
    const pr = studyStats.columns[s.predictedRiskVariableName.trim()];
    const prItem = byKey.get('predictedRiskColumn');
    if (pr && prItem) {
      const nonNumeric = pr.total - pr.numeric;
      if (nonNumeric > 0) prItem.warnings.push(`${nonNumeric} value(s) are non-numeric or missing.`);
      if (pr.min != null && pr.max != null && (pr.min < 0 || pr.max > 1)) {
        prItem.warnings.push(
          `Predicted absolute risks should lie in [0, 1] (found ${pr.min} to ${pr.max}).`,
        );
      }
    }
    const lp = studyStats.columns[s.linearPredictorVariableName.trim()];
    const lpItem = byKey.get('linearPredictorColumn');
    if (lp && lpItem) {
      const nonNumeric = lp.total - lp.numeric;
      if (nonNumeric > 0) lpItem.warnings.push(`${nonNumeric} value(s) are non-numeric or missing.`);
    }
  }

  // Mode A: named weights / family-history columns should exist in the relevant tables.
  if (s.mode === 'A') {
    const refItem = byKey.get('modelReferenceDataset');
    const refHeaders = s.modelFiles.modelReferenceDataset.parse?.headers ?? [];
    const covItem = byKey.get('applyCovariateProfile');
    const covHeaders = s.modelFiles.applyCovariateProfile.parse?.headers ?? [];

    const weightsName = s.modelReferenceDatasetWeightsVariableName.trim();
    if (weightsName && refItem && refHeaders.length > 0 && !refHeaders.includes(weightsName)) {
      refItem.warnings.push(
        `Weights column \`${weightsName}\` was not found in the reference dataset.`,
      );
    }

    const fhName = s.modelFamilyHistoryVariableName.trim();
    if (fhName) {
      if (covItem && covHeaders.length > 0 && !covHeaders.includes(fhName)) {
        covItem.warnings.push(
          `Family-history column \`${fhName}\` was not found in the covariate profile.`,
        );
      }
      if (refItem && refHeaders.length > 0 && !refHeaders.includes(fhName)) {
        refItem.warnings.push(
          `Family-history column \`${fhName}\` was not found in the reference dataset.`,
        );
      }
    }
  }
}

/** Build the readiness summary that drives the InputSummaryPanel. */
export function selectValidationSummary(s: InputState): ValidationSummary {
  const items: ValidationSummaryItem[] = [];

  items.push(slotItem('study', 'Study data', true, s.study));

  if (s.mode === 'A') {
    for (const key of MODEL_FILE_KEYS) {
      const slot = s.modelFiles[key];
      const required = MODE_A_REQUIRED.includes(key);
      // Skip optional, unfilled model files so they don't clutter the summary.
      if (!required && !slotFilled(slot)) continue;
      items.push(slotItem(key, MODEL_FILE_LABELS[key], required, slot));
    }
  } else {
    // Mode B needs BOTH columns present in the study data: py-icare only uses precomputed risks
    // when predicted_risk AND linear_predictor are both there — supplying one alone silently falls
    // back to rebuilding the model. When the study headers are known, verify the named column exists.
    const studyHeaders = s.study.parse?.headers;
    const columnItem = (key: string, label: string, value: string): ValidationSummaryItem => {
      const name = value.trim();
      const errors: string[] = [];
      let status: ValidationSummaryItem['status'];
      if (name === '') {
        status = 'missing';
        errors.push(`Enter the ${label.toLowerCase()} present in the study data.`);
      } else if (studyHeaders && studyHeaders.length > 0 && !studyHeaders.includes(name)) {
        status = 'invalid';
        errors.push(`Column \`${name}\` was not found in the study data headers.`);
      } else {
        status = 'valid';
      }
      return { key, label, required: true, status, errors, warnings: [] };
    };
    items.push(
      columnItem('predictedRiskColumn', 'Predicted-risk column', s.predictedRiskVariableName),
    );
    items.push(
      columnItem('linearPredictorColumn', 'Linear-predictor column', s.linearPredictorVariableName),
    );

    // Optional: population disease-incidence rates add the cohort-vs-population incidence comparison.
    const rates = s.modelFiles.modelDiseaseIncidenceRates;
    if (slotFilled(rates)) {
      items.push(
        slotItem('modelDiseaseIncidenceRates', 'Disease incidence rates (population)', false, rates),
      );
    }
  }

  const riskItem = riskIntervalItem(s);
  if (riskItem) items.push(riskItem);

  const refItem = referencePopulationItem(s);
  if (refItem) items.push(refItem);

  // Advisory cross-file warnings (row parity, age coverage, value ranges, named columns). These
  // never change an item's status, so they inform without blocking `ready`.
  applyCrossFileChecks(items, s);

  const isNcc = Boolean(s.study.parse?.badges?.includes('ncc'));

  const requiredOk = items.filter((it) => it.required).every((it) => it.status === 'valid');
  const noInvalid = items.every((it) => it.status !== 'invalid');
  const ready = requiredOk && noInvalid && riskIntervalValid(s.riskInterval);

  return { items, isNcc, ready };
}

export function selectIsReadyToRun(s: InputState): boolean {
  return selectValidationSummary(s).ready;
}
