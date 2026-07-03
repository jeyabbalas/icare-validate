import { describe, it, expect, beforeEach } from 'vitest';
import { buildValidateOptions } from './buildValidateOptions';
import { useInputStore, type FileSlot, type ModelFileKey } from '../state/inputStore';
import { useBinSettingsStore } from '../state/binSettingsStore';

// The builder is a pure store → SDK-options mapping; it passes each slot's `File` through verbatim (never
// parsing it), so synthetic one-byte Files exercise every branch without touching the fixture files.

function fileSlot(name: string): FileSlot {
  return { file: new File(['x'], name), url: null, source: 'upload', filename: name, size: 1 };
}

function build() {
  return buildValidateOptions(useInputStore.getState(), useBinSettingsStore.getState());
}

beforeEach(() => {
  useInputStore.getState().reset(); // also resets bin settings
});

describe('buildValidateOptions — Mode A', () => {
  it('maps filled model files 1:1, pulls bins/seed from bin settings, omits SNP + scalar optionals', () => {
    const s = useInputStore.getState();
    s.setStudy(fileSlot('study.csv'));
    s.setModelFile('modelDiseaseIncidenceRates', fileSlot('disease.csv'));
    s.setModelFile('modelCompetingIncidenceRates', fileSlot('competing.csv'));
    s.setModelFile('modelCovariateFormula', fileSlot('formula.txt'));
    s.setModelFile('modelLogRelativeRisk', fileSlot('logor.json'));
    s.setModelFile('modelReferenceDataset', fileSlot('reference.csv'));
    s.setModelFile('applyCovariateProfile', fileSlot('profile.csv'));
    s.setConfig({ datasetName: '  DS  ', modelName: 'MN' });
    useBinSettingsStore.getState().set({ numberOfPercentiles: 7, seed: 99 });

    const opts = build();
    expect(opts.studyData).toBeInstanceOf(File);
    expect((opts.studyData as File).name).toBe('study.csv');
    expect(opts.predictedRiskInterval).toBe('total-followup');
    expect(opts.numberOfPercentiles).toBe(7);
    expect(opts.seed).toBe(99);
    expect(opts.datasetName).toBe('DS'); // trimmed
    expect(opts.modelName).toBe('MN');

    const p = opts.icareModelParameters!;
    expect(Object.keys(p).sort()).toEqual([
      'applyCovariateProfile',
      'modelCompetingIncidenceRates',
      'modelCovariateFormula',
      'modelDiseaseIncidenceRates',
      'modelLogRelativeRisk',
      'modelReferenceDataset',
    ]);
    expect(p.modelCovariateFormula).toBeInstanceOf(File);
    expect(p.modelLogRelativeRisk).toBeInstanceOf(File);
    // Unfilled + blank optionals are omitted entirely.
    expect(p.modelSnpInfo).toBeUndefined();
    expect(p.applySnpProfile).toBeUndefined();
    expect(p.modelFamilyHistoryVariableName).toBeUndefined();
    expect(p.modelReferenceDatasetWeightsVariableName).toBeUndefined();
    expect(p.numImputations).toBeUndefined();
    // Mode-B fields absent.
    expect(opts.predictedRiskVariableName).toBeUndefined();
    expect(opts.linearPredictorVariableName).toBeUndefined();
  });

  it('includes SNP files, family-history, weights, and imputations when set', () => {
    const s = useInputStore.getState();
    s.setStudy(fileSlot('ncc.csv'));
    const keys: ModelFileKey[] = [
      'modelDiseaseIncidenceRates',
      'modelCovariateFormula',
      'modelLogRelativeRisk',
      'modelReferenceDataset',
      'applyCovariateProfile',
      'modelSnpInfo',
      'applySnpProfile',
    ];
    for (const k of keys) s.setModelFile(k, fileSlot(`${k}.csv`));
    s.setConfig({
      modelFamilyHistoryVariableName: 'family_history',
      modelReferenceDatasetWeightsVariableName: 'weights',
      numImputations: 3,
    });

    const p = build().icareModelParameters!;
    expect(p.modelSnpInfo).toBeInstanceOf(File);
    expect(p.applySnpProfile).toBeInstanceOf(File);
    expect(p.modelFamilyHistoryVariableName).toBe('family_history');
    expect(p.modelReferenceDatasetWeightsVariableName).toBe('weights');
    expect(p.numImputations).toBe(3);
  });

  it('includes reference entry/exit ages when set', () => {
    const s = useInputStore.getState();
    s.setStudy(fileSlot('study.csv'));
    s.setConfig({ referenceEntryAge: 30, referenceExitAge: [80, 85] });
    const opts = build();
    expect(opts.referenceEntryAge).toBe(30);
    expect(opts.referenceExitAge).toEqual([80, 85]);
  });
});

describe('buildValidateOptions — Mode B', () => {
  it('sends canonical column names, optional disease rates, and reference arrays; no other model files', () => {
    const s = useInputStore.getState();
    s.setMode('B');
    s.setStudy(fileSlot('study.csv'));
    s.setConfig({
      predictedRiskVariableName: ' risk_estimates ',
      linearPredictorVariableName: 'linear_predictors',
    });
    s.setModelFile('modelDiseaseIncidenceRates', fileSlot('disease.csv'));
    s.setReferenceVector('referencePredictedRisks', {
      values: [0.1, 0.2],
      filename: 'r.csv',
      nRows: 2,
      errors: [],
      warnings: [],
    });
    s.setReferenceVector('referenceLinearPredictors', {
      values: [-1, 1],
      filename: 'l.csv',
      nRows: 2,
      errors: [],
      warnings: [],
    });

    const opts = build();
    expect(opts.predictedRiskVariableName).toBe('risk_estimates'); // trimmed
    expect(opts.linearPredictorVariableName).toBe('linear_predictors');
    expect(opts.icareModelParameters).toEqual({ modelDiseaseIncidenceRates: expect.any(File) });
    expect(opts.referencePredictedRisks).toEqual([0.1, 0.2]);
    expect(opts.referenceLinearPredictors).toEqual([-1, 1]);
    // Mode-A reference ages are not emitted in Mode B.
    expect(opts.referenceEntryAge).toBeUndefined();
    expect(opts.referenceExitAge).toBeUndefined();
  });

  it('omits icareModelParameters entirely when no population disease rates are given', () => {
    const s = useInputStore.getState();
    s.setMode('B');
    s.setStudy(fileSlot('study.csv'));
    s.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'linear_predictors',
    });
    expect(build().icareModelParameters).toBeUndefined();
  });
});

describe('buildValidateOptions — shared config', () => {
  it('maps all three risk-interval kinds', () => {
    const s = useInputStore.getState();
    s.setStudy(fileSlot('study.csv'));
    expect(build().predictedRiskInterval).toBe('total-followup');
    s.setConfig({ riskInterval: { kind: 'years', years: 5 } });
    expect(build().predictedRiskInterval).toBe(5);
    s.setConfig({ riskInterval: { kind: 'custom', values: [3, 5, 7] } });
    expect(build().predictedRiskInterval).toEqual([3, 5, 7]);
  });

  it('omits blank names / cutoffs by default and includes non-empty cutoffs', () => {
    const s = useInputStore.getState();
    s.setStudy(fileSlot('study.csv'));
    let opts = build();
    expect(opts.datasetName).toBeUndefined();
    expect(opts.modelName).toBeUndefined();
    expect(opts.linearPredictorCutoffs).toBeUndefined();

    s.setConfig({ linearPredictorCutoffs: [-1.5, 0, 1.5] });
    opts = build();
    expect(opts.linearPredictorCutoffs).toEqual([-1.5, 0, 1.5]);
  });

  it('throws when the study slot is empty', () => {
    expect(() => build()).toThrow(/study data is required/i);
  });
});
