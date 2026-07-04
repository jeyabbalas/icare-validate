import { MODEL_FILE_KEYS, MODE_A_REQUIRED, slotFilled } from '../../state/inputStore';
import type { FileSlot, InputState, ModelFileKey } from '../../state/inputStore';

// The language-neutral intermediate representation for the "Code" tab's generators. `buildCodegenModel`
// mirrors `buildValidateOptions` (src/lib/buildValidateOptions.ts) field-for-field — same Mode-A/B
// branching and the same "omit blank/null optionals" rule — so the Python / JavaScript / R renderers all
// emit exactly the call the app runs. Keeping one IR feed three renderers guarantees they stay in sync.

export interface BinSettings {
  numberOfPercentiles: number;
  seed: number;
}

/** SDK input kinds. `data|formula|logOR|snpInfo` map to py-icare's `*_path` params; the rest are values. */
export type ParamKind = 'data' | 'formula' | 'logOR' | 'snpInfo';

/** A file-backed input, referenced by the filename the app saw (edited by the user before running). */
export interface FileParam {
  type: 'file';
  jsKey: string; // camelCase SDK option key
  kind: ParamKind;
  filename: string; // original file name (or URL basename)
}

/** A scalar/array value input (risk interval, names, ages, percentiles, seed, cutoffs). */
export interface ValueParam {
  type: 'value';
  jsKey: string;
  value: string | number | boolean | number[];
}

/** A numeric vector parsed from a file (Mode-B reference risks/LP): too large to inline — reference it. */
export interface VectorParam {
  type: 'vector';
  jsKey: string;
  count: number;
  filename: string | null;
}

export type Param = FileParam | ValueParam | VectorParam;

export interface CodegenModel {
  mode: 'A' | 'B';
  /** Top-level options in emission order; `studyData` is always first, `predictedRiskInterval` second. */
  top: Param[];
  /** Entries nested under `icareModelParameters` (empty when none apply). */
  model: Param[];
  numberOfPercentiles: number;
  seed: number;
  datasetName?: string;
  modelName?: string;
  /** Non-blocking notes for the user (e.g. required Mode-A inputs still missing). */
  warnings: string[];
}

/** `slot.filename` if present, else the basename of its URL, else a placeholder. */
export function slotFilename(slot: FileSlot): string {
  if (slot.filename) return slot.filename;
  if (slot.url) {
    const tail = slot.url
      .split(/[/\\?#]/)
      .filter(Boolean)
      .pop();
    if (tail) return tail;
  }
  return 'FILE';
}

const KIND_BY_KEY: Record<ModelFileKey, ParamKind> = {
  modelDiseaseIncidenceRates: 'data',
  modelCompetingIncidenceRates: 'data',
  modelCovariateFormula: 'formula',
  modelLogRelativeRisk: 'logOR',
  modelReferenceDataset: 'data',
  modelSnpInfo: 'snpInfo',
  applyCovariateProfile: 'data',
  applySnpProfile: 'data',
};

function fileParam(jsKey: string, kind: ParamKind, slot: FileSlot): FileParam {
  return { type: 'file', jsKey, kind, filename: slotFilename(slot) };
}

/** Build the language-neutral model from the current input + bin-settings state. */
export function buildCodegenModel(input: InputState, binSettings: BinSettings): CodegenModel {
  const warnings: string[] = [];
  const top: Param[] = [];
  const model: Param[] = [];

  // studyData is required and always first.
  if (slotFilled(input.study)) {
    top.push(fileParam('studyData', 'data', input.study));
  } else {
    top.push({ type: 'file', jsKey: 'studyData', kind: 'data', filename: 'study.csv' });
    warnings.push('Study data is required — add it before running this code.');
  }

  // predictedRiskInterval is always second.
  top.push({ type: 'value', jsKey: 'predictedRiskInterval', value: riskIntervalValue(input) });

  if (input.mode === 'A') {
    // icareModelParameters: the filled model-file slots (SDK keys 1:1), then the bound scalars.
    for (const key of MODEL_FILE_KEYS) {
      const slot = input.modelFiles[key];
      if (slotFilled(slot)) model.push(fileParam(key, KIND_BY_KEY[key], slot));
    }
    for (const key of MODE_A_REQUIRED) {
      if (!slotFilled(input.modelFiles[key])) {
        warnings.push(`Mode A input "${key}" is required but not set.`);
      }
    }
    const weights = input.modelReferenceDatasetWeightsVariableName.trim();
    if (weights)
      model.push({
        type: 'value',
        jsKey: 'modelReferenceDatasetWeightsVariableName',
        value: weights,
      });
    const familyHistory = input.modelFamilyHistoryVariableName.trim();
    if (familyHistory)
      model.push({ type: 'value', jsKey: 'modelFamilyHistoryVariableName', value: familyHistory });
    if (input.numImputations != null)
      model.push({ type: 'value', jsKey: 'numImputations', value: input.numImputations });

    if (input.referenceEntryAge != null)
      top.push({ type: 'value', jsKey: 'referenceEntryAge', value: input.referenceEntryAge });
    if (input.referenceExitAge != null)
      top.push({ type: 'value', jsKey: 'referenceExitAge', value: input.referenceExitAge });
  } else {
    // Mode B: precomputed columns inside studyData (canonical names enforced upstream).
    top.push({
      type: 'value',
      jsKey: 'predictedRiskVariableName',
      value: input.predictedRiskVariableName.trim(),
    });
    top.push({
      type: 'value',
      jsKey: 'linearPredictorVariableName',
      value: input.linearPredictorVariableName.trim(),
    });

    const disease = input.modelFiles.modelDiseaseIncidenceRates;
    if (slotFilled(disease)) model.push(fileParam('modelDiseaseIncidenceRates', 'data', disease));

    const rr = input.referencePredictedRisks;
    if (rr.values && rr.values.length > 0) {
      top.push({
        type: 'vector',
        jsKey: 'referencePredictedRisks',
        count: rr.values.length,
        filename: rr.filename,
      });
    }
    const lp = input.referenceLinearPredictors;
    if (lp.values && lp.values.length > 0) {
      top.push({
        type: 'vector',
        jsKey: 'referenceLinearPredictors',
        count: lp.values.length,
        filename: lp.filename,
      });
    }
  }

  if (input.linearPredictorCutoffs && input.linearPredictorCutoffs.length > 0) {
    top.push({
      type: 'value',
      jsKey: 'linearPredictorCutoffs',
      value: input.linearPredictorCutoffs,
    });
  }

  return {
    mode: input.mode,
    top,
    model,
    numberOfPercentiles: binSettings.numberOfPercentiles,
    seed: binSettings.seed,
    datasetName: input.datasetName.trim() || undefined,
    modelName: input.modelName.trim() || undefined,
    warnings,
  };
}

function riskIntervalValue(input: InputState): string | number | number[] {
  switch (input.riskInterval.kind) {
    case 'total-followup':
      return 'total-followup';
    case 'years':
      return input.riskInterval.years;
    case 'custom':
      return input.riskInterval.values;
  }
}

/** camelCase -> snake_case (matches the SDK's `camelToSnake`). */
export function camelToSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** The py-icare kwarg name: snake_case, with `_path` appended for file inputs. */
export function pyName(param: Param): string {
  const snake = camelToSnake(param.jsKey);
  return param.type === 'file' ? `${snake}_path` : snake;
}
