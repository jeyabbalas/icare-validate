import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRebinStore,
  buildRebinOptions,
  isDefaultRebin,
  type RebinState,
} from './rebinStore';

// A live-state shape for the pure helpers (only the fields they read).
function state(patch: Partial<RebinState> = {}): RebinState {
  return {
    scale: 'linear-predictor',
    method: 'quantiles',
    numberOfPercentiles: 10,
    cutpoints: null,
    defaultSpec: null,
    set: () => {},
    reset: () => {},
    initFromRun: () => {},
    ...patch,
  };
}

describe('buildRebinOptions — the percent→proportion boundary', () => {
  it('converts absolute-risk cutpoints from percent to proportion', () => {
    const opts = buildRebinOptions(
      state({ scale: 'absolute-risk', method: 'cutpoints', cutpoints: [3, 5] }),
    );
    expect(opts).toEqual({ scale: 'absolute-risk', cutoffs: [0.03, 0.05] });
  });

  it('passes linear-predictor cutpoints through unchanged (no ÷100)', () => {
    const opts = buildRebinOptions(
      state({ scale: 'linear-predictor', method: 'cutpoints', cutpoints: [-1.5, 0, 1.5] }),
    );
    expect(opts).toEqual({ scale: 'linear-predictor', cutoffs: [-1.5, 0, 1.5] });
  });

  it('falls back to quantiles when method=cutpoints but no cutpoints are set', () => {
    expect(
      buildRebinOptions(
        state({ scale: 'absolute-risk', method: 'cutpoints', cutpoints: null, numberOfPercentiles: 8 }),
      ),
    ).toEqual({ scale: 'absolute-risk', numberOfPercentiles: 8 });
    expect(
      buildRebinOptions(state({ method: 'cutpoints', cutpoints: [], numberOfPercentiles: 8 })),
    ).toEqual({ scale: 'linear-predictor', numberOfPercentiles: 8 });
  });

  it('returns the quantile count on the quantiles method', () => {
    expect(buildRebinOptions(state({ numberOfPercentiles: 10 }))).toEqual({
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });
  });

  it('clamps the quantile count to an integer ≥ 2', () => {
    expect(buildRebinOptions(state({ numberOfPercentiles: 0 })).numberOfPercentiles).toBe(2);
    expect(buildRebinOptions(state({ numberOfPercentiles: 1 })).numberOfPercentiles).toBe(2);
    expect(buildRebinOptions(state({ numberOfPercentiles: 3.7 })).numberOfPercentiles).toBe(4);
    expect(buildRebinOptions(state({ numberOfPercentiles: NaN })).numberOfPercentiles).toBe(10);
  });
});

describe('isDefaultRebin', () => {
  it('is default before any run (Reset disabled)', () => {
    expect(isDefaultRebin(state({ defaultSpec: null }))).toBe(true);
  });

  it('is not default on the absolute-risk scale', () => {
    expect(
      isDefaultRebin(
        state({
          scale: 'absolute-risk',
          defaultSpec: { numberOfPercentiles: 10, linearPredictorCutoffs: null },
        }),
      ),
    ).toBe(false);
  });

  it('tracks the quantile-run default', () => {
    const spec = { numberOfPercentiles: 10, linearPredictorCutoffs: null };
    expect(isDefaultRebin(state({ numberOfPercentiles: 10, defaultSpec: spec }))).toBe(true);
    expect(isDefaultRebin(state({ numberOfPercentiles: 5, defaultSpec: spec }))).toBe(false);
    expect(
      isDefaultRebin(state({ method: 'cutpoints', cutpoints: [0], defaultSpec: spec })),
    ).toBe(false);
  });

  it('tracks the linear-predictor-cutoffs run default', () => {
    const spec = { numberOfPercentiles: 10, linearPredictorCutoffs: [-1, 1] };
    expect(
      isDefaultRebin(state({ method: 'cutpoints', cutpoints: [-1, 1], defaultSpec: spec })),
    ).toBe(true);
    expect(
      isDefaultRebin(state({ method: 'cutpoints', cutpoints: [-1, 2], defaultSpec: spec })),
    ).toBe(false);
    expect(isDefaultRebin(state({ method: 'quantiles', defaultSpec: spec }))).toBe(false);
  });
});

describe('useRebinStore actions', () => {
  beforeEach(() => {
    useRebinStore.setState({
      scale: 'linear-predictor',
      method: 'quantiles',
      numberOfPercentiles: 10,
      cutpoints: null,
      defaultSpec: null,
    });
  });

  it('clears cutpoints when the scale changes (unit reinterpretation guard)', () => {
    useRebinStore.setState({ method: 'cutpoints', cutpoints: [3] });
    useRebinStore.getState().set({ scale: 'absolute-risk' });
    expect(useRebinStore.getState().cutpoints).toBeNull();
    expect(useRebinStore.getState().scale).toBe('absolute-risk');
  });

  it('preserves cutpoints when only the method changes', () => {
    useRebinStore.setState({ method: 'cutpoints', cutpoints: [3] });
    useRebinStore.getState().set({ method: 'quantiles' });
    expect(useRebinStore.getState().cutpoints).toEqual([3]);
  });

  it('initFromRun reproduces a quantile run and stashes the default', () => {
    useRebinStore.getState().initFromRun({ numberOfPercentiles: 12, linearPredictorCutoffs: null });
    const s = useRebinStore.getState();
    expect(s.scale).toBe('linear-predictor');
    expect(s.method).toBe('quantiles');
    expect(s.numberOfPercentiles).toBe(12);
    expect(s.defaultSpec).toEqual({ numberOfPercentiles: 12, linearPredictorCutoffs: null });
  });

  it('initFromRun reproduces a linear-predictor-cutoffs run', () => {
    useRebinStore
      .getState()
      .initFromRun({ numberOfPercentiles: 10, linearPredictorCutoffs: [-1, 1] });
    const s = useRebinStore.getState();
    expect(s.method).toBe('cutpoints');
    expect(s.cutpoints).toEqual([-1, 1]);
  });

  it('reset returns to the captured default', () => {
    useRebinStore.getState().initFromRun({ numberOfPercentiles: 12, linearPredictorCutoffs: null });
    useRebinStore.getState().set({ scale: 'absolute-risk', method: 'cutpoints' });
    useRebinStore.setState({ cutpoints: [3] });
    useRebinStore.getState().reset();
    const s = useRebinStore.getState();
    expect(s.scale).toBe('linear-predictor');
    expect(s.method).toBe('quantiles');
    expect(s.numberOfPercentiles).toBe(12);
    expect(s.cutpoints).toBeNull();
  });
});
