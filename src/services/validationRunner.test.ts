import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the engine service: `validate` is driven per-test; `subscribe` is a no-op unsubscribe (appStore
// wires it at import time, so it must exist or the module graph crashes). No Pyodide/worker is loaded.
vi.mock('./icareService', () => ({
  validate: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

import { validate } from './icareService';
import { runValidation } from './validationRunner';
import { useInputStore, type FileSlot, type ModelFileKey } from '../state/inputStore';
import { useBinSettingsStore } from '../state/binSettingsStore';
import { useRebinStore } from '../state/rebinStore';
import { useResultsStore } from '../state/resultsStore';
import { useAppStore } from '../state/appStore';
import type { ColumnarTableResult, ValidationResult } from '../lib/icareTypes';

function fileSlot(name: string): FileSlot {
  return { file: new File(['x'], name), url: null, source: 'upload', filename: name, size: 1 };
}

/** Fill a minimal ready Mode-A input (a filled slot without parse errors reads as valid). */
function makeReadyModeA(): void {
  const s = useInputStore.getState();
  s.setStudy(fileSlot('study.csv'));
  const required: ModelFileKey[] = [
    'modelDiseaseIncidenceRates',
    'modelCovariateFormula',
    'modelLogRelativeRisk',
    'modelReferenceDataset',
    'applyCovariateProfile',
  ];
  for (const k of required) s.setModelFile(k, fileSlot(`${k}.csv`));
}

function f64(...vals: number[]): Float64Array {
  return Float64Array.from(vals);
}
function frame(columns: ColumnarTableResult['columns'], nRows: number): ColumnarTableResult {
  return { columns, order: Object.keys(columns), nRows };
}

const fakeResult = {
  studyData: frame(
    {
      observed_outcome: [0, 1],
      study_entry_age: [50, 55],
      study_exit_age: [60, 65],
      time_of_onset: f64(Infinity, 62),
      observed_followup: f64(10, 10),
      predicted_risk_interval: f64(10, 10),
      followup: f64(10, 10),
      risk_estimates: f64(0.01, 0.05),
      linear_predictors: f64(-0.5, 0.3),
      linear_predictors_category: { codes: Int32Array.from([0, 1]), categories: ['(-inf,0]', '(0,inf]'] },
    },
    2,
  ),
  categorySpecificCalibration: frame(
    {
      category: ['a', 'b'],
      observed_absolute_risk: f64(0.01, 0.05),
      predicted_absolute_risk: f64(0.012, 0.048),
      lower_ci_absolute_risk: f64(0, 0.02),
      upper_ci_absolute_risk: f64(0.02, 0.08),
      observed_relative_risk: f64(0.5, 1.5),
      predicted_relative_risk: f64(0.6, 1.4),
      lower_ci_relative_risk: f64(0.3, 1.1),
      upper_ci_relative_risk: f64(0.9, 2),
      expected_by_observed_ratio: f64(0.9, 0.96),
      lower_ci_expected_by_observed_ratio: f64(0.8, 0.85),
      upper_ci_expected_by_observed_ratio: f64(1.0, 1.1),
    },
    2,
  ),
  incidenceRates: frame({ age: [50, 51], study_rate: f64(0.001, 0.001) }, 2),
} as unknown as ValidationResult;

beforeEach(() => {
  vi.clearAllMocks();
  useInputStore.getState().reset();
  useResultsStore.getState().reset();
  useAppStore.setState({ step: 'input' });
  useRebinStore.setState({
    scale: 'linear-predictor',
    method: 'quantiles',
    numberOfPercentiles: 10,
    cutpoints: null,
    defaultSpec: null,
  });
});

describe('runValidation', () => {
  it('runs a ready input: running → done, populates the store, advances to Results', async () => {
    makeReadyModeA();
    vi.mocked(validate).mockResolvedValue(fakeResult);

    await runValidation();

    const rs = useResultsStore.getState();
    expect(rs.status).toBe('done');
    expect(rs.result).toBe(fakeResult);
    expect(rs.normalized?.perSubject.n).toBe(2);
    expect(rs.error).toBeNull();
    expect(useAppStore.getState().step).toBe('results');
    expect(validate).toHaveBeenCalledOnce();
  });

  it('seeds the rebin default from the run so Reset reproduces the SDK bins', async () => {
    makeReadyModeA();
    useBinSettingsStore.setState({ numberOfPercentiles: 12 });
    useInputStore.getState().setConfig({ linearPredictorCutoffs: [-1, 1] });
    vi.mocked(validate).mockResolvedValue(fakeResult);

    await runValidation();

    const rb = useRebinStore.getState();
    expect(rb.scale).toBe('linear-predictor');
    expect(rb.method).toBe('cutpoints'); // the run used LP cutoffs
    expect(rb.cutpoints).toEqual([-1, 1]);
    expect(rb.defaultSpec).toEqual({ numberOfPercentiles: 12, linearPredictorCutoffs: [-1, 1] });
  });

  it('surfaces a mapped error and stays on the Input step', async () => {
    makeReadyModeA();
    vi.mocked(validate).mockRejectedValue(new Error('Runtime assets missing (no Pyodide indexURL).'));

    await runValidation();

    const rs = useResultsStore.getState();
    expect(rs.status).toBe('error');
    expect(rs.error).toMatch(/runtime assets missing/i);
    expect(rs.result).toBeNull();
    expect(rs.normalized).toBeNull();
    // No navigation on failure — we stay on Input; the RunActionBar surfaces the error inline.
    expect(useAppStore.getState().step).toBe('input');
  });

  it('stays on the Input step while a run is in flight, then advances on success', async () => {
    makeReadyModeA();
    let resolveValidate: (v: ValidationResult) => void = () => {};
    vi.mocked(validate).mockImplementation(
      () => new Promise<ValidationResult>((resolve) => (resolveValidate = resolve)),
    );

    const pending = runValidation();
    // Mid-run: the results store is 'running' but we have NOT navigated away from Input.
    expect(useResultsStore.getState().status).toBe('running');
    expect(useAppStore.getState().step).toBe('input');

    resolveValidate(fakeResult);
    await pending;
    expect(useAppStore.getState().step).toBe('results');
  });

  it('is a no-op when the input is not ready', async () => {
    // Nothing filled after reset → not ready.
    await runValidation();

    expect(validate).not.toHaveBeenCalled();
    expect(useResultsStore.getState().status).toBe('idle');
    expect(useAppStore.getState().step).toBe('input');
  });

  it('ignores a re-entrant call while a run is already in flight', async () => {
    makeReadyModeA();
    useResultsStore.setState({ status: 'running' });

    await runValidation();

    expect(validate).not.toHaveBeenCalled();
  });
});
