import { describe, it, expect, beforeEach } from 'vitest';
import { useInputStore, selectValidationSummary, selectIsReadyToRun, type FileSlot } from './inputStore';
import type { ParseMeta } from '../lib/csvIngest';

// py-icare 1.3.0 requires the precomputed columns to be named exactly `risk_estimates` /
// `linear_predictors`; the Mode-B readiness rule enforces that so the run can't reach a KeyError.

function studySlot(headers: string[]): FileSlot {
  const parse: ParseMeta = { headers, nRows: 10, errors: [], warnings: [] };
  return { file: new File(['x'], 'study.csv'), url: null, source: 'upload', filename: 'study.csv', size: 1, parse };
}

function itemStatus(key: string): string | undefined {
  return selectValidationSummary(useInputStore.getState()).items.find((it) => it.key === key)?.status;
}
function ready(): boolean {
  return selectIsReadyToRun(useInputStore.getState());
}

beforeEach(() => {
  const s = useInputStore.getState();
  s.reset();
  s.setMode('B');
});

describe('Mode B canonical column enforcement', () => {
  it('is ready when the columns are named canonically and present in the study headers', () => {
    const s = useInputStore.getState();
    s.setStudy(studySlot(['observed_outcome', 'risk_estimates', 'linear_predictors']));
    s.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'linear_predictors',
    });
    expect(itemStatus('predictedRiskColumn')).toBe('valid');
    expect(itemStatus('linearPredictorColumn')).toBe('valid');
    expect(ready()).toBe(true);
  });

  it('marks a non-canonical name invalid (with a rename hint) and blocks ready', () => {
    const s = useInputStore.getState();
    s.setStudy(studySlot(['observed_outcome', 'my_risk', 'linear_predictors']));
    s.setConfig({
      predictedRiskVariableName: 'my_risk',
      linearPredictorVariableName: 'linear_predictors',
    });
    const item = selectValidationSummary(useInputStore.getState()).items.find(
      (it) => it.key === 'predictedRiskColumn',
    );
    expect(item?.status).toBe('invalid');
    expect(item?.errors.join(' ')).toMatch(/risk_estimates/);
    expect(ready()).toBe(false);
  });

  it('marks a canonically-named column invalid when it is absent from the study headers', () => {
    const s = useInputStore.getState();
    s.setStudy(studySlot(['observed_outcome'])); // canonical columns not present
    s.setConfig({
      predictedRiskVariableName: 'risk_estimates',
      linearPredictorVariableName: 'linear_predictors',
    });
    expect(itemStatus('predictedRiskColumn')).toBe('invalid');
    expect(itemStatus('linearPredictorColumn')).toBe('invalid');
    expect(ready()).toBe(false);
  });

  it('marks blank column names as missing', () => {
    useInputStore.getState().setStudy(studySlot(['risk_estimates', 'linear_predictors']));
    expect(itemStatus('predictedRiskColumn')).toBe('missing');
    expect(itemStatus('linearPredictorColumn')).toBe('missing');
    expect(ready()).toBe(false);
  });
});
