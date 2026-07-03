import { beforeEach, describe, it, expect } from 'vitest';
import {
  useInputStore,
  selectValidationSummary,
  selectIsReadyToRun,
  emptySlot,
  MODE_A_REQUIRED,
  type FileSlot,
} from './inputStore';

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
      headers: ['id', 'predicted_risk', 'linear_predictor'],
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
    useInputStore.getState().setConfig({ predictedRiskVariableName: 'predicted_risk' });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false); // only one column
    useInputStore.getState().setConfig({ linearPredictorVariableName: 'linear_predictor' });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(true); // both present
  });

  it('Mode B: a column name absent from the study headers is invalid', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(studyWithColumns());
    store.setConfig({
      predictedRiskVariableName: 'predicted_risk',
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
      predictedRiskVariableName: 'predicted_risk',
      linearPredictorVariableName: 'linear_predictor',
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

  it('reset clears study back to an empty slot', () => {
    useInputStore.getState().setStudy(validSlot());
    useInputStore.getState().reset();
    expect(useInputStore.getState().study).toEqual(emptySlot());
  });
});
