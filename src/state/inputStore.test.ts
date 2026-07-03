import { beforeEach, describe, it, expect } from 'vitest';
import {
  useInputStore,
  selectValidationSummary,
  selectIsReadyToRun,
  emptySlot,
  MODE_A_REQUIRED,
  type FileSlot,
} from './inputStore';
import { useBinSettingsStore } from './binSettingsStore';
import type { ParseMeta, ParseStats } from '../lib/csvIngest';

/** A filled slot whose parse metadata can be tuned per test (headers, nRows, stats). */
const slotWith = (parse: Partial<ParseMeta>): FileSlot => ({
  file: new File(['x'], 'f.csv'),
  url: null,
  source: 'upload',
  filename: 'f.csv',
  size: 1,
  parse: { headers: ['a'], nRows: 1, errors: [], warnings: [], ...parse },
});

const validSlot = (badges?: string[]): FileSlot => ({
  file: new File(['x'], 'f.csv'),
  url: null,
  source: 'upload',
  filename: 'f.csv',
  size: 1,
  parse: { headers: ['a'], nRows: 1, errors: [], warnings: [], badges },
});

const invalidSlot = (): FileSlot => ({
  ...validSlot(),
  parse: { headers: ['a'], nRows: 1, errors: ['bad'], warnings: [] },
});

function fillModeARequired() {
  const store = useInputStore.getState();
  store.setStudy(validSlot());
  for (const key of MODE_A_REQUIRED) store.setModelFile(key, validSlot());
}

describe('input readiness selectors', () => {
  beforeEach(() => useInputStore.getState().reset());

  it('a fresh Mode-A input is not ready (study + model files missing)', () => {
    const summary = selectValidationSummary(useInputStore.getState());
    expect(summary.ready).toBe(false);
    expect(summary.items.find((i) => i.key === 'study')?.status).toBe('missing');
  });

  it('becomes ready once every required Mode-A input is valid', () => {
    fillModeARequired();
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(true);
  });

  it('an invalid (error-carrying) slot blocks readiness', () => {
    fillModeARequired();
    useInputStore.getState().setModelFile('modelCovariateFormula', invalidSlot());
    const summary = selectValidationSummary(useInputStore.getState());
    expect(summary.ready).toBe(false);
    expect(summary.items.find((i) => i.key === 'modelCovariateFormula')?.status).toBe('invalid');
  });

  it('surfaces the nested-case-control badge from the study slot', () => {
    fillModeARequired();
    useInputStore.getState().setStudy(validSlot(['ncc']));
    expect(selectValidationSummary(useInputStore.getState()).isNcc).toBe(true);
  });

  const studyWithColumns = (): FileSlot => ({
    ...validSlot(),
    parse: {
      headers: ['id', 'risk_estimates', 'linear_predictors'],
      nRows: 1,
      errors: [],
      warnings: [],
    },
  });

  it('Mode B: needs BOTH columns present in the study headers to be ready', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(studyWithColumns());
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false); // no columns yet
    useInputStore.getState().setConfig({ predictedRiskVariableName: 'risk_estimates' });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false); // only one column
    useInputStore.getState().setConfig({ linearPredictorVariableName: 'linear_predictors' });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(true); // both present
  });

  it('Mode B: a column name absent from the study headers is invalid', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(studyWithColumns());
    store.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'nope',
    });
    const summary = selectValidationSummary(useInputStore.getState());
    expect(summary.ready).toBe(false);
    expect(summary.items.find((i) => i.key === 'linearPredictorColumn')?.status).toBe('invalid');
  });

  it('Mode B: an optional population disease-rates slot appears once filled', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(studyWithColumns());
    store.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'linear_predictors',
    });
    store.setModelFile('modelDiseaseIncidenceRates', validSlot());
    const summary = selectValidationSummary(useInputStore.getState());
    const item = summary.items.find((i) => i.key === 'modelDiseaseIncidenceRates');
    expect(item?.required).toBe(false);
    expect(item?.status).toBe('valid');
    expect(summary.ready).toBe(true); // a valid optional slot does not block
  });

  it('an invalid risk interval (0 years) blocks readiness', () => {
    fillModeARequired();
    useInputStore.getState().setConfig({ riskInterval: { kind: 'years', years: 0 } });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false);
  });

  it('a non-integer fixed risk interval blocks readiness', () => {
    fillModeARequired();
    useInputStore.getState().setConfig({ riskInterval: { kind: 'years', years: 2.5 } });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false);
  });

  it('a custom risk interval must have one integer value per study row', () => {
    fillModeARequired(); // study validSlot() reports nRows: 1
    useInputStore.getState().setConfig({ riskInterval: { kind: 'custom', values: [5, 5] } });
    let summary = selectValidationSummary(useInputStore.getState());
    expect(summary.ready).toBe(false);
    expect(summary.items.find((i) => i.key === 'riskInterval')?.status).toBe('invalid');

    // one value matches the single study row → valid and ready
    useInputStore.getState().setConfig({ riskInterval: { kind: 'custom', values: [5] } });
    summary = selectValidationSummary(useInputStore.getState());
    expect(summary.items.find((i) => i.key === 'riskInterval')?.status).toBe('valid');
    expect(summary.ready).toBe(true);
  });

  it('reset clears study back to an empty slot', () => {
    useInputStore.getState().setStudy(validSlot());
    useInputStore.getState().reset();
    expect(useInputStore.getState().study).toEqual(emptySlot());
  });

  it('reset also restores bin-settings defaults (percentiles/seed)', () => {
    useBinSettingsStore.getState().set({ numberOfPercentiles: 4, seed: 999 });
    useInputStore.getState().reset();
    const bin = useBinSettingsStore.getState();
    expect(bin.numberOfPercentiles).toBe(10);
    expect(bin.seed).toBe(50);
  });
});

describe('cross-file consistency checks', () => {
  beforeEach(() => useInputStore.getState().reset());

  function fillModeAWithStudy(studyRows: number, studyStats?: Partial<ParseStats>) {
    const store = useInputStore.getState();
    store.setStudy(
      slotWith({
        headers: ['id'],
        nRows: studyRows,
        stats: { ageMin: 50, ageMax: 80, nCases: 10, columns: {}, ...studyStats },
      }),
    );
    for (const key of MODE_A_REQUIRED) store.setModelFile(key, slotWith({ nRows: studyRows }));
  }

  it('warns (does not block) when a covariate profile row count differs from the study', () => {
    fillModeAWithStudy(100);
    useInputStore.getState().setModelFile('applyCovariateProfile', slotWith({ nRows: 90 }));
    const summary = selectValidationSummary(useInputStore.getState());
    const item = summary.items.find((i) => i.key === 'applyCovariateProfile');
    expect(item?.warnings.join(' ')).toMatch(/90 row.*100/);
    expect(summary.ready).toBe(true); // advisory only
  });

  it('warns when incidence rates do not cover the study age span', () => {
    fillModeAWithStudy(100, { ageMin: 40, ageMax: 60 });
    useInputStore
      .getState()
      .setModelFile(
        'modelDiseaseIncidenceRates',
        slotWith({ nRows: 100, stats: { rateAges: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59] } }),
      );
    const summary = selectValidationSummary(useInputStore.getState());
    const item = summary.items.find((i) => i.key === 'modelDiseaseIncidenceRates');
    expect(item?.warnings.join(' ')).toMatch(/does not cover/i);
  });

  it('warns on a half-specified reference age pair (Mode A)', () => {
    fillModeAWithStudy(100);
    useInputStore.getState().setConfig({ referenceEntryAge: 50 });
    const summary = selectValidationSummary(useInputStore.getState());
    const item = summary.items.find((i) => i.key === 'referencePopulation');
    expect(item?.warnings.join(' ')).toMatch(/both reference entry and exit/i);
    expect(summary.ready).toBe(true); // reference population is optional
  });

  it('warns when a Mode-B predicted-risk column falls outside [0, 1]', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(
      slotWith({
        headers: ['risk_estimates', 'linear_predictors'],
        nRows: 3,
        stats: {
          columns: {
            risk_estimates: { numeric: 3, missing: 0, total: 3, min: -0.1, max: 1.4 },
            linear_predictors: { numeric: 3, missing: 0, total: 3, min: -2, max: 2 },
          },
        },
      }),
    );
    store.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'linear_predictors',
    });
    const summary = selectValidationSummary(useInputStore.getState());
    const item = summary.items.find((i) => i.key === 'predictedRiskColumn');
    expect(item?.warnings.join(' ')).toMatch(/\[0, 1\]/);
  });

  it('warns when a named family-history column is absent from the profile/reference', () => {
    fillModeAWithStudy(100);
    useInputStore
      .getState()
      .setModelFile('applyCovariateProfile', slotWith({ headers: ['id', 'bmi'], nRows: 100 }));
    useInputStore.getState().setModelFile('modelReferenceDataset', slotWith({ headers: ['bmi'] }));
    useInputStore.getState().setConfig({ modelFamilyHistoryVariableName: 'family_history' });
    const summary = selectValidationSummary(useInputStore.getState());
    const cov = summary.items.find((i) => i.key === 'applyCovariateProfile');
    expect(cov?.warnings.join(' ')).toMatch(/family-history column.*not found/i);
  });
});
