import { create } from 'zustand';
import type { ParseMeta } from '../lib/csvIngest';
import { loadIcareLitGe50 } from '../lib/examples';
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
    | 'referencePredictedRisks'
    | 'referenceLinearPredictors'
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

  // Advanced / optional reference-population inputs.
  referencePredictedRisks: number[] | null;
  referenceLinearPredictors: number[] | null;
  linearPredictorCutoffs: number[] | null;

  exampleId: 'icare-lit-ge50' | null;
  exampleLoading: boolean;
  exampleError: string | null;

  // Actions.
  setMode: (mode: InputMode) => void;
  setStudy: (slot: FileSlot) => void;
  setModelFile: (key: ModelFileKey, slot: FileSlot) => void;
  clearModelFile: (key: ModelFileKey) => void;
  setConfig: (patch: ConfigPatch) => void;
  loadExample: (id: 'icare-lit-ge50') => Promise<void>;
  reset: () => void;
}

function initialState(): Omit<
  InputState,
  'setMode' | 'setStudy' | 'setModelFile' | 'clearModelFile' | 'setConfig' | 'loadExample' | 'reset'
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
    referencePredictedRisks: null,
    referenceLinearPredictors: null,
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

  loadExample: async (id) => {
    set({ exampleLoading: true, exampleError: null });
    try {
      const { study, modelFiles, config } = await loadIcareLitGe50();
      set({
        ...initialState(),
        mode: 'A',
        study,
        modelFiles: { ...emptyModelFiles(), ...modelFiles },
        riskInterval: config.riskInterval,
        datasetName: config.datasetName,
        modelName: config.modelName,
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

/** True when the current `riskInterval` config carries a usable value. */
export function riskIntervalValid(ri: RiskIntervalConfig): boolean {
  if (ri.kind === 'total-followup') return true;
  if (ri.kind === 'years') return Number.isFinite(ri.years) && ri.years > 0;
  return ri.values.length > 0 && ri.values.every((v) => Number.isFinite(v) && v > 0);
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
    const hasColumn =
      s.predictedRiskVariableName.trim() !== '' || s.linearPredictorVariableName.trim() !== '';
    items.push({
      key: 'modeBColumns',
      label: 'Predicted-risk / linear-predictor column',
      required: true,
      status: hasColumn ? 'valid' : 'missing',
      errors: hasColumn
        ? []
        : ['Enter a predicted-risk or linear-predictor column name present in the study data.'],
      warnings: [],
    });
  }

  const isNcc = Boolean(s.study.parse?.badges?.includes('ncc'));

  const requiredOk = items.filter((it) => it.required).every((it) => it.status === 'valid');
  const noInvalid = items.every((it) => it.status !== 'invalid');
  const ready = requiredOk && noInvalid && riskIntervalValid(s.riskInterval);

  return { items, isNcc, ready };
}

export function selectIsReadyToRun(s: InputState): boolean {
  return selectValidationSummary(s).ready;
}
