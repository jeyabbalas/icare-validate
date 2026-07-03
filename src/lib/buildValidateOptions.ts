import { MODEL_FILE_KEYS } from '../state/inputStore';
import type { FileSlot, InputState, RiskIntervalConfig } from '../state/inputStore';
import type {
  IcareModelParameters,
  PredictedRiskInterval,
  UrlInput,
  ValidateAbsoluteRiskModelOptions,
} from './icareTypes';

// Phase 4: the store → SDK options translation. Pure and synchronous — the input builder keeps every
// file as a raw `File` (a `Blob`, valid TabularInput) or a base-relative `{url}`, so no async fetch is
// needed here. Optionals that are blank / null are OMITTED (not sent as '' or null): the SDK's
// `toPythonKwargs` drops `undefined`, so py-icare applies its own defaults. The `predictedRiskInterval`,
// bin percentiles/seed, and per-mode reference fields all map straight through.

interface BinSettings {
  numberOfPercentiles: number;
  seed: number;
}

/** Resolve a slot to the SDK input it carries: the in-memory `File`, else its `{url}`. `undefined` if empty. */
function slotInput(slot: FileSlot): File | UrlInput | undefined {
  if (slot.file) return slot.file;
  if (slot.url) return { url: slot.url };
  return undefined;
}

/** Map the UI's discriminated risk-interval union to the SDK's `'total-followup' | number | number[]`. */
function riskIntervalToOption(ri: RiskIntervalConfig): PredictedRiskInterval {
  switch (ri.kind) {
    case 'total-followup':
      return 'total-followup';
    case 'years':
      return ri.years;
    case 'custom':
      return ri.values;
  }
}

/**
 * Mode-A `icareModelParameters`. The 8 `ModelFileKey`s equal the SDK param names 1:1, and each accepts a
 * `Blob`/`{url}`, so we build the map with a narrow `File | UrlInput` value (a member of every relevant
 * SDK input union — TabularInput / FormulaInput / LogOddsRatiosInput) and cast once at the boundary,
 * sidestepping the finicky union-keyed write. Only filled slots and non-blank scalars are included.
 */
function modeAParameters(input: InputState): IcareModelParameters {
  const params: Record<string, File | UrlInput> = {};
  for (const key of MODEL_FILE_KEYS) {
    const value = slotInput(input.modelFiles[key]);
    if (value) params[key] = value;
  }
  const p = params as IcareModelParameters;

  const weights = input.modelReferenceDatasetWeightsVariableName.trim();
  if (weights) p.modelReferenceDatasetWeightsVariableName = weights;
  const familyHistory = input.modelFamilyHistoryVariableName.trim();
  if (familyHistory) p.modelFamilyHistoryVariableName = familyHistory;
  if (input.numImputations != null) p.numImputations = input.numImputations;

  return p;
}

/** Build the `validateAbsoluteRiskModel` options object from the current input + bin-settings state. */
export function buildValidateOptions(
  input: InputState,
  binSettings: BinSettings,
): ValidateAbsoluteRiskModelOptions {
  const studyData = slotInput(input.study);
  if (!studyData) throw new Error('Study data is required to run validation.');

  const options: ValidateAbsoluteRiskModelOptions = {
    studyData,
    predictedRiskInterval: riskIntervalToOption(input.riskInterval),
    // Always sent; py-icare uses cutoffs over percentiles when both are present.
    numberOfPercentiles: binSettings.numberOfPercentiles,
    seed: binSettings.seed,
  };

  const datasetName = input.datasetName.trim();
  if (datasetName) options.datasetName = datasetName;
  const modelName = input.modelName.trim();
  if (modelName) options.modelName = modelName;
  if (input.linearPredictorCutoffs && input.linearPredictorCutoffs.length > 0) {
    options.linearPredictorCutoffs = input.linearPredictorCutoffs;
  }

  if (input.mode === 'A') {
    options.icareModelParameters = modeAParameters(input);
    // Optional reference population: the model computes reference risks from these ages.
    if (input.referenceEntryAge != null) options.referenceEntryAge = input.referenceEntryAge;
    if (input.referenceExitAge != null) options.referenceExitAge = input.referenceExitAge;
  } else {
    // Mode B: the study data already carries precomputed columns (enforced canonical names upstream).
    options.predictedRiskVariableName = input.predictedRiskVariableName.trim();
    options.linearPredictorVariableName = input.linearPredictorVariableName.trim();

    // Optional population incidence adds the cohort-vs-population comparison to the incidence frame.
    const disease = slotInput(input.modelFiles.modelDiseaseIncidenceRates);
    if (disease) options.icareModelParameters = { modelDiseaseIncidenceRates: disease };

    // Optional reference population: user supplies the precomputed arrays directly.
    const referencePredictedRisks = input.referencePredictedRisks.values;
    if (referencePredictedRisks && referencePredictedRisks.length > 0) {
      options.referencePredictedRisks = referencePredictedRisks;
    }
    const referenceLinearPredictors = input.referenceLinearPredictors.values;
    if (referenceLinearPredictors && referenceLinearPredictors.length > 0) {
      options.referenceLinearPredictors = referenceLinearPredictors;
    }
  }

  return options;
}
