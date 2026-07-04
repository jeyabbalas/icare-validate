import { create } from 'zustand';
import type { BinScale, RecomputeOptions } from '../math/calibrationMath';

// Results-scoped interactive re-binning state (Phase 12). This is deliberately SEPARATE from
// `binSettingsStore`: that store's `numberOfPercentiles`/`seed` configure the *SDK run*
// (`validationRunner` → `buildValidateOptions` → py-icare), whereas this store only re-bins the
// already-computed result client-side, with no re-run. Keeping them apart means exploring bins on the
// results step never silently mutates what a later SDK run would do.
//
// The default reproduces exactly what the SDK binned: it is a snapshot (`defaultSpec`) captured at run
// time by `validationRunner.initFromRun`, so "Reset to default" returns to the frozen SDK bins —
// including the linear-predictor-cutoffs case — and is immune to later `binSettingsStore` edits.
//
// Two scales: the risk score (linear predictor, py-icare's own binning variable) and absolute risk (the
// app's clinically-intuitive extension). On the absolute-risk scale the user types cutpoints as PERCENT
// ("3" = 3%); the ÷100 to a proportion happens only at the engine boundary in `buildRebinOptions`.

export type RebinScale = BinScale; // 'linear-predictor' | 'absolute-risk'
export type RebinMethod = 'quantiles' | 'cutpoints';

/** What the SDK actually binned on this run — the target of "Reset to default". */
export interface RunBinSpec {
  numberOfPercentiles: number;
  linearPredictorCutoffs: number[] | null;
}

type RebinPatch = Partial<
  Pick<RebinState, 'scale' | 'method' | 'numberOfPercentiles' | 'cutpoints'>
>;

export interface RebinState {
  scale: RebinScale;
  method: RebinMethod;
  /** Number of equal-count bins when `method === 'quantiles'`. */
  numberOfPercentiles: number;
  /** Interior cut points in DISPLAY units — percent on absolute-risk, raw LP on risk-score. */
  cutpoints: number[] | null;
  /** Snapshot of the run's binning; drives `reset()` and `isDefaultRebin`. `null` until the first run. */
  defaultSpec: RunBinSpec | null;
  set: (patch: RebinPatch) => void;
  reset: () => void;
  initFromRun: (spec: RunBinSpec) => void;
}

const INITIAL = {
  scale: 'linear-predictor' as RebinScale,
  method: 'quantiles' as RebinMethod,
  numberOfPercentiles: 10,
  cutpoints: null as number[] | null,
};

/** The live fields that reproduce a captured run (LP scale; cutpoints iff the run used them). */
function stateFromSpec(spec: RunBinSpec) {
  const hasCutoffs = Boolean(spec.linearPredictorCutoffs && spec.linearPredictorCutoffs.length);
  return {
    scale: 'linear-predictor' as RebinScale,
    method: (hasCutoffs ? 'cutpoints' : 'quantiles') as RebinMethod,
    numberOfPercentiles: spec.numberOfPercentiles,
    cutpoints: spec.linearPredictorCutoffs,
  };
}

export const useRebinStore = create<RebinState>((set) => ({
  ...INITIAL,
  defaultSpec: null,
  set: (patch) =>
    set((s) => {
      const next: RebinPatch = { ...patch };
      // A scale change reinterprets the cutpoint units ("3" = 3% on absolute risk vs 3.0 on the risk
      // score), so stale cutpoints must not silently carry over. Clear them unless the caller sets them.
      if (patch.scale !== undefined && patch.scale !== s.scale && patch.cutpoints === undefined) {
        next.cutpoints = null;
      }
      return next;
    }),
  reset: () =>
    set((s) => (s.defaultSpec ? stateFromSpec(s.defaultSpec) : { ...INITIAL })),
  initFromRun: (spec) => set({ ...stateFromSpec(spec), defaultSpec: spec }),
}));

// ---- Pure helpers (unit-tested; the app's numeric + reset boundaries) -------

type RebinOptionsInput = Pick<
  RebinState,
  'scale' | 'method' | 'numberOfPercentiles' | 'cutpoints'
>;

/**
 * Translate the display-unit rebin state into engine `RecomputeOptions`. The ONLY place percent →
 * proportion happens (absolute-risk cutpoints ÷100). Cutpoints win over the quantile count (matching
 * the engine), but only when non-empty — an empty cutpoints field falls back to quantiles so the plots
 * still show something while the user types. `numberOfPercentiles` is clamped to an integer ≥ 2 here
 * (the consumption boundary) so a mid-typing `NumberField` value can't feed the engine a bad `q`.
 */
export function buildRebinOptions(s: RebinOptionsInput): RecomputeOptions {
  if (s.method === 'cutpoints' && s.cutpoints && s.cutpoints.length > 0) {
    const cutoffs =
      s.scale === 'absolute-risk' ? s.cutpoints.map((c) => c / 100) : s.cutpoints.slice();
    return { scale: s.scale, cutoffs };
  }
  const n = Number.isFinite(s.numberOfPercentiles)
    ? Math.max(2, Math.round(s.numberOfPercentiles))
    : 10;
  return { scale: s.scale, numberOfPercentiles: n };
}

type RebinDefaultInput = Pick<
  RebinState,
  'scale' | 'method' | 'numberOfPercentiles' | 'cutpoints' | 'defaultSpec'
>;

function sameNumbers(a: number[] | null, b: number[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * True when the live rebin state matches the captured run (the SDK-reproducing default). Drives whether
 * "Reset to default" is enabled. Before any run (`defaultSpec === null`) it reports default (Reset off).
 */
export function isDefaultRebin(s: RebinDefaultInput): boolean {
  const d = s.defaultSpec;
  if (!d) return true;
  if (s.scale !== 'linear-predictor') return false;
  const runUsedCutoffs = Boolean(d.linearPredictorCutoffs && d.linearPredictorCutoffs.length);
  if (runUsedCutoffs) {
    return s.method === 'cutpoints' && sameNumbers(s.cutpoints, d.linearPredictorCutoffs);
  }
  return s.method === 'quantiles' && s.numberOfPercentiles === d.numberOfPercentiles;
}
