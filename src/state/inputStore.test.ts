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

  it('Mode B: a predicted-risk column name flips readiness green', () => {
    const store = useInputStore.getState();
    store.setMode('B');
    store.setStudy(validSlot());
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(false); // no column yet
    useInputStore.getState().setConfig({ predictedRiskVariableName: 'predicted_risk' });
    expect(selectIsReadyToRun(useInputStore.getState())).toBe(true);
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
