import { describe, expect, it } from 'vitest';
import { buildValidateOptions } from '../buildValidateOptions';
import { generateCode } from './index';
import { buildCodegenModel, type BinSettings } from './model';
import { MODEL_FILE_KEYS, emptySlot, emptyVectorSlot } from '../../state/inputStore';
import type { FileSlot, InputState, ModelFileKey } from '../../state/inputStore';

// A slot referenced by URL (== filename) so both buildValidateOptions (needs file|url) and the codegen
// (needs a filename) are satisfied without constructing File objects.
function slot(filename: string): FileSlot {
  return { file: null, url: filename, source: 'url', filename, size: null };
}

const BIN: BinSettings = { numberOfPercentiles: 10, seed: 50 };

/** A full InputState with sensible defaults; override the fields a test cares about. */
function makeInput(overrides: Partial<InputState>): InputState {
  const modelFiles = Object.fromEntries(MODEL_FILE_KEYS.map((k) => [k, emptySlot()])) as Record<
    ModelFileKey,
    FileSlot
  >;
  const noop = () => {};
  return {
    mode: 'A',
    study: emptySlot(),
    modelFiles,
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
    setMode: noop,
    setStudy: noop,
    setModelFile: noop,
    clearModelFile: noop,
    setConfig: noop,
    setReferenceVector: noop,
    loadExample: async () => {},
    reset: noop,
    ...overrides,
  };
}

/** The bundled iCARE-Lit ge50 Mode-A run. */
function icareLitGe50(): InputState {
  const modelFiles = Object.fromEntries(MODEL_FILE_KEYS.map((k) => [k, emptySlot()])) as Record<
    ModelFileKey,
    FileSlot
  >;
  modelFiles.modelDiseaseIncidenceRates = slot('age_specific_breast_cancer_incidence_rates.csv');
  modelFiles.modelCompetingIncidenceRates = slot('age_specific_all_cause_mortality_rates.csv');
  modelFiles.modelCovariateFormula = slot('model_formula_ge50.txt');
  modelFiles.modelLogRelativeRisk = slot('model_log_odds_ratios_ge50.json');
  modelFiles.modelReferenceDataset = slot('reference_covariate_data_ge50.csv');
  modelFiles.applyCovariateProfile = slot('icare_lit_validation_covariates.csv');
  return makeInput({
    mode: 'A',
    study: slot('icare_lit_validation_study.csv'),
    modelFiles,
    datasetName: 'iCARE-Lit ge50',
    modelName: 'iCARE-Lit',
  });
}

/** BPC3 nested case-control: adds SNP files + a family-history variable. */
function bpc3(): InputState {
  const input = icareLitGe50();
  input.modelFiles.modelSnpInfo = slot('breast_cancer_72_snps_info.csv');
  input.modelFiles.applySnpProfile = slot('validation_nested_case_control_snp_data.csv');
  input.modelFamilyHistoryVariableName = 'family_history';
  input.datasetName = 'BPC3';
  input.modelName = 'BPC3';
  return input;
}

/** Mode B: precomputed risk / linear-predictor columns inside the study data. */
function modeB(): InputState {
  return makeInput({
    mode: 'B',
    study: slot('study_with_precomputed.csv'),
    predictedRiskVariableName: 'risk_estimates',
    linearPredictorVariableName: 'linear_predictors',
    datasetName: 'Precomputed',
  });
}

describe('buildCodegenModel', () => {
  it('mirrors buildValidateOptions key-for-key (the consistency guard)', () => {
    for (const input of [icareLitGe50(), bpc3(), modeB()]) {
      const opts = buildValidateOptions(input, BIN) as unknown as Record<string, unknown>;
      const model = buildCodegenModel(input, BIN);

      const codegenTop = new Set(model.top.map((p) => p.jsKey));
      codegenTop.add('numberOfPercentiles');
      codegenTop.add('seed');
      if (model.datasetName) codegenTop.add('datasetName');
      if (model.modelName) codegenTop.add('modelName');
      if (model.model.length) codegenTop.add('icareModelParameters');

      expect(codegenTop).toEqual(new Set(Object.keys(opts)));

      if (opts.icareModelParameters) {
        const nested = new Set(model.model.map((p) => p.jsKey));
        expect(nested).toEqual(new Set(Object.keys(opts.icareModelParameters as object)));
      }
    }
  });

  it('flags a missing required study file as a warning but still renders', () => {
    const model = buildCodegenModel(makeInput({ study: emptySlot() }), BIN);
    expect(model.warnings.some((w) => /study/i.test(w))).toBe(true);
  });
});

describe('renderPython', () => {
  const py = generateCode('python', icareLitGe50(), BIN).code;

  it('calls the py-icare API with snake_case *_path kwargs', () => {
    expect(py).toContain('from icare import validate_absolute_risk_model');
    expect(py).toContain('study_data_path="icare_lit_validation_study.csv"');
    expect(py).toContain('icare_model_parameters={');
    expect(py).toContain('"model_covariate_formula_path": "model_formula_ge50.txt"');
    expect(py).toContain('"model_log_relative_risk_path": "model_log_odds_ratios_ge50.json"');
  });

  it('always emits number_of_percentiles=10 and seed=50 (the app defaults)', () => {
    expect(py).toContain('number_of_percentiles=10');
    expect(py).toContain('seed=50');
    expect(py).toContain('dataset_name="iCARE-Lit ge50"');
  });

  it('surfaces SNP + family-history params for BPC3', () => {
    const bp = generateCode('python', bpc3(), BIN).code;
    expect(bp).toContain('"model_snp_info_path": "breast_cancer_72_snps_info.csv"');
    expect(bp).toContain('"model_family_history_variable_name": "family_history"');
  });

  it('switches to the precomputed-risk form in Mode B (no icare_model_parameters)', () => {
    const b = generateCode('python', modeB(), BIN).code;
    expect(b).toContain('predicted_risk_variable_name="risk_estimates"');
    expect(b).toContain('linear_predictor_variable_name="linear_predictors"');
    expect(b).not.toContain('icare_model_parameters=');
  });
});

describe('renderJavaScriptNode', () => {
  const js = generateCode('javascript-node', icareLitGe50(), BIN).code;

  it('imports wasm-icare and uses { path } file inputs', () => {
    expect(js).toContain("import { loadICARE } from 'wasm-icare'");
    expect(js).toContain('studyData: { path: "icare_lit_validation_study.csv" }');
    expect(js).toContain('icareModelParameters: {');
    expect(js).toContain('modelCovariateFormula: { path: "model_formula_ge50.txt" }');
    expect(js).toContain('numberOfPercentiles: 10');
    expect(js).toContain('seed: 50');
    expect(js).toContain('await icare.close()');
  });
});

describe('renderJavaScriptBrowser', () => {
  const html = generateCode('javascript-browser', icareLitGe50(), BIN);

  it('is a self-contained HTML page importing wasm-icare from esm.sh with File inputs', () => {
    expect(html.filename).toBe('validate.html');
    expect(html.code).toContain("import { loadICARE } from 'https://esm.sh/wasm-icare@2'");
    expect(html.code).toContain('<input type="file" id="studyData" />');
    expect(html.code).toContain('<input type="file" id="modelCovariateFormula" />');
    expect(html.code).toContain('studyData: fileOf("studyData")');
    expect(html.code).toContain('modelLogRelativeRisk: fileOf("modelLogRelativeRisk")');
  });
});

describe('renderRQuarto', () => {
  const qmd = generateCode('r', icareLitGe50(), BIN);

  it('serializes each file as raw text via ojs_define and rebuilds Blobs in OJS', () => {
    expect(qmd.filename).toBe('validate.qmd');
    expect(qmd.code).toContain('library(readr)');
    expect(qmd.code).toContain('ojs_define(');
    expect(qmd.code).toContain('studyDataText = read_file("icare_lit_validation_study.csv")');
    expect(qmd.code).toContain('import("https://esm.sh/wasm-icare@2")');
    expect(qmd.code).toContain('studyData: new Blob([studyDataText])');
    // Model tables + log-OR go as Blobs; the formula passes as an inline string.
    expect(qmd.code).toContain('modelLogRelativeRisk: new Blob([modelLogRelativeRiskText])');
    expect(qmd.code).toContain('modelCovariateFormula: modelCovariateFormulaText');
    expect(qmd.code).not.toContain('modelCovariateFormula: new Blob');
  });
});
