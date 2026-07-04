// Phase 10 — the discrimination density engine: a weighted Gaussian kernel-density estimate of each
// subject's PREDICTED ABSOLUTE RISK, split into cases (developed the disease) and controls (disease-free).
// This is the "risk-distribution / separation plot": good discrimination pushes the case density to the
// right of the control density, and their residual OVERLAP is exactly what the AUC cannot resolve.
//
// py-icare draws this in its demo notebook via seaborn `kdeplot(..., bw_adjust=0.5)`; it is NOT an SDK
// output (the vendored wheel's model_validation.py has no plotting code), so we recompute it here from the
// normalized per-subject arrays. Seaborn's KDE IS scipy's `gaussian_kde`, so this module is written to
// reproduce `scipy.stats.gaussian_kde` bit-for-bit (verified against it in kde.parity.test.ts):
//   • weights normalized to sum 1; effective size neff = 1/Σwₙ²;
//   • bias-corrected weighted variance  var = Σ wₙ(xᵢ−μ)² / (1 − Σwₙ²)   (numpy cov(aweights, bias=False));
//   • bandwidth factor (1-D): silverman (neff·3/4)^(−1/5), scott neff^(−1/5); seaborn scales it by
//     `bw_adjust`, so h = bw_adjust · factor · √var;
//   • density  f(x) = Σ wₙ · φ((x−xᵢ)/h) / h   (φ = standard-normal pdf).
//
// Design choices (settled with the user):
//   • EQUAL AREA — each group's density integrates to 1 independently, so both curves are full-height and
//     directly comparable and their overlap reads as (1 − discrimination). (Not seaborn's default
//     `common_norm=True` prevalence scaling, which shrinks the case curve to a sliver for a rare outcome.)
//   • NESTED CASE-CONTROL — inverse-probability weight by `frequency = 1/sampling_weights` (the same
//     convention the calibration engine uses), so a density represents the source cohort, not the sample.
//   • The x-scale is `riskEstimates` (absolute risk), the clinically legible scale — NOT the linear
//     predictor (that scale carries AUC + ROC; the two are deliberately not conflated).
//
// Pure module, no I/O. The nested-case-control guard mirrors `recomputeCalibration` (calibrationMath.ts).

import type { PerSubject } from '../services/resultNormalizer';
import { extent, linspace, sumKahan } from './numeric';
import { interp, r7Quantile, weightedEcdf } from './binning';

const INV_SQRT_2PI = 0.3989422804014327; // 1/√(2π)

export interface KdeOptions {
  /** seaborn `bw_adjust` — multiplies the rule-of-thumb bandwidth. Default 0.5 (py-icare's notebook). */
  bwAdjust?: number;
  /** Bandwidth rule of thumb. Default `silverman` (per plan); `scott` is scipy/seaborn's own default. */
  bwMethod?: 'silverman' | 'scott';
}

interface KdeFit {
  /** Kernel bandwidth h (same units as the values). `0` for a degenerate group (n < 2 or zero variance). */
  bandwidth: number;
  /** Σ of the raw weights (= n when unweighted). */
  weightSum: number;
}

/**
 * scipy `gaussian_kde` bandwidth: normalize weights, neff = 1/Σwₙ², bias-corrected weighted variance, and
 * `h = bwAdjust · factor · √var`. Returns `bandwidth: 0` for a group too small or too degenerate to smooth.
 */
function fitKde(
  values: ArrayLike<number>,
  weights: ArrayLike<number> | null,
  opts: KdeOptions,
): KdeFit {
  const n = values.length;
  if (n === 0) return { bandwidth: 0, weightSum: 0 };

  // Σw, Σw², Σwx in one pass (weights default to 1). Kahan on the plain sums for parity with the engine.
  const w = (i: number): number => (weights ? weights[i] : 1);
  let weightSum = 0;
  let sumSqW = 0;
  const wx = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const wi = w(i);
    weightSum += wi;
    sumSqW += wi * wi;
    wx[i] = wi * values[i];
  }
  if (!(weightSum > 0)) return { bandwidth: 0, weightSum: 0 };

  const mu = sumKahan(wx) / weightSum;
  const sumSqWnorm = sumSqW / (weightSum * weightSum); // Σ wₙ²  (normalized weights)
  const neff = 1 / sumSqWnorm;

  // Bias-corrected weighted variance = Σ wₙ(xᵢ−μ)² / (1 − Σwₙ²)  ≡  numpy cov(aweights, bias=False).
  const dev = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = values[i] - mu;
    dev[i] = w(i) * d * d;
  }
  const denom = 1 - sumSqWnorm;
  const variance = denom > 0 ? sumKahan(dev) / weightSum / denom : 0;
  if (!(variance > 0) || n < 2) return { bandwidth: 0, weightSum };

  const bwAdjust = opts.bwAdjust ?? 0.5;
  const factor =
    opts.bwMethod === 'scott' ? Math.pow(neff, -0.2) : Math.pow((neff * 3) / 4, -0.2);
  return { bandwidth: bwAdjust * factor * Math.sqrt(variance), weightSum };
}

/** scipy-faithful bandwidth for a (optionally weighted) sample; `0` when the group can't be smoothed. */
export function gaussianKdeBandwidth(
  values: ArrayLike<number>,
  weights: ArrayLike<number> | null,
  opts: KdeOptions = {},
): number {
  return fitKde(values, weights, opts).bandwidth;
}

/**
 * Evaluate a weighted Gaussian KDE on `grid`: `f(g) = Σ wₙ · φ((g−xᵢ)/h) / h` (φ = standard-normal pdf,
 * wₙ = weights normalized to sum 1). Faithful to `scipy.stats.gaussian_kde(values, weights).evaluate(grid)`
 * with the bandwidth scaled by `bwAdjust` (as seaborn does). A degenerate group (h = 0) yields all zeros.
 */
export function gaussianKde(
  values: ArrayLike<number>,
  weights: ArrayLike<number> | null,
  grid: ArrayLike<number>,
  opts: KdeOptions = {},
): Float64Array {
  const m = grid.length;
  const out = new Float64Array(m);
  const { bandwidth: h, weightSum } = fitKde(values, weights, opts);
  if (!(h > 0) || !(weightSum > 0)) return out;

  const n = values.length;
  const norm = INV_SQRT_2PI / (weightSum * h); // wᵢ/Σw · 1/(h√2π), factored out of the inner loop
  for (let j = 0; j < m; j += 1) {
    const g = grid[j];
    let s = 0;
    for (let i = 0; i < n; i += 1) {
      const z = (g - values[i]) / h;
      s += (weights ? weights[i] : 1) * Math.exp(-0.5 * z * z);
    }
    out[j] = s * norm;
  }
  return out;
}

/** Weighted p-quantile: R-7 on the sorted values when unweighted, else py-icare's `frequency`-weighted ecdf. */
export function weightedQuantile(
  values: ArrayLike<number>,
  weights: ArrayLike<number> | null,
  p: number,
): number {
  if (values.length === 0) return NaN;
  if (weights == null) {
    const sorted = Float64Array.from(values);
    sorted.sort();
    return r7Quantile(sorted, p);
  }
  const { x, ecdf } = weightedEcdf(values, weights);
  return interp(p, ecdf, x);
}

/** Trapezoidal integral of `y` over `x` (x strictly increasing). */
function trapz(y: ArrayLike<number>, x: ArrayLike<number>): number {
  let area = 0;
  for (let i = 1; i < y.length; i += 1) {
    area += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  }
  return area;
}

/** One outcome group's smoothed risk density plus the summaries the plot annotates. */
export interface DensityCurve {
  /** Evaluation grid (predicted absolute risk, proportion). Shared across both groups. */
  x: Float64Array;
  /** KDE density on `x` (integrates to ≈ 1 over the full support — equal-area normalization). */
  density: Float64Array;
  /** Weighted median predicted risk (proportion) — the group's central-tendency marker. */
  median: number;
  /** Raw subject count in the group. */
  n: number;
  /** Σ weight: `n` for a cohort, Σ frequency (the design-effective count) for nested case-control. */
  weightSum: number;
  /** Kernel bandwidth h (proportion units). */
  bandwidth: number;
}

export interface DiscriminationDensities {
  control: DensityCurve; // observed_outcome == 0
  case_: DensityCurve; // observed_outcome == 1
  /** Shared evaluation grid (=== control.x === case_.x). */
  grid: Float64Array;
  /** Overlapping coefficient OVL = ∫ min(f_case, f_control) dx ∈ [0, 1]; 0 = disjoint, 1 = identical. */
  overlap: number;
  /** Robust upper bound for the x display domain (proportion): the 99.5th pooled-risk weighted percentile. */
  riskMaxDisplay: number;
  isNcc: boolean;
}

export interface DiscriminationOptions extends KdeOptions {
  /** Number of grid points the densities are evaluated on. Default 256. */
  gridSize?: number;
  /** Bandwidths of headroom added to each end of the support (seaborn `cut`). Default 3. */
  cut?: number;
}

/**
 * Split the per-subject predicted risks into cases / controls and smooth each into an equal-area Gaussian
 * KDE on a shared grid, with the overlap coefficient and a robust display range. `isNcc` must come from the
 * authoritative `NormalizedResult.isNcc`; when true, `perSubject.frequency` is required (inverse-probability
 * weighting), mirroring `recomputeCalibration`'s contract.
 */
export function discriminationDensities(
  perSubject: PerSubject,
  isNcc: boolean,
  opts: DiscriminationOptions = {},
): DiscriminationDensities {
  if (isNcc && !perSubject.frequency) {
    throw new Error(
      'discriminationDensities: nested case-control requires per-subject frequency (1/sampling_weights).',
    );
  }
  const risk = perSubject.riskEstimates;
  const outcome = perSubject.observedOutcome;
  const freq = perSubject.frequency;

  // Partition into cases (outcome 1) and controls (outcome 0), carrying each subject's IPW weight.
  const caseRisk: number[] = [];
  const caseW: number[] = [];
  const ctrlRisk: number[] = [];
  const ctrlW: number[] = [];
  const pooledRisk: number[] = [];
  const pooledW: number[] = [];
  for (let i = 0; i < risk.length; i += 1) {
    const r = risk[i];
    if (!Number.isFinite(r)) continue;
    const w = isNcc ? freq![i] : 1;
    pooledRisk.push(r);
    pooledW.push(w);
    if (outcome[i] === 1) {
      caseRisk.push(r);
      caseW.push(w);
    } else {
      ctrlRisk.push(r);
      ctrlW.push(w);
    }
  }
  const wCase = isNcc ? caseW : null;
  const wCtrl = isNcc ? ctrlW : null;
  const wPool = isNcc ? pooledW : null;

  // Shared support = union range ± cut·(max bandwidth), so both fills align and OVL is well-defined. The
  // left edge may dip below 0 (faithful to seaborn's unclipped support); the plot's x-domain clamps at 0.
  const cut = opts.cut ?? 3;
  const gridSize = opts.gridSize ?? 256;
  const hCase = gaussianKdeBandwidth(caseRisk, wCase, opts);
  const hCtrl = gaussianKdeBandwidth(ctrlRisk, wCtrl, opts);
  const pad = cut * Math.max(hCase, hCtrl, 0);
  const [caseLo, caseHi] = extent(caseRisk);
  const [ctrlLo, ctrlHi] = extent(ctrlRisk);
  const lo = Math.min(Number.isFinite(caseLo) ? caseLo : Infinity, Number.isFinite(ctrlLo) ? ctrlLo : Infinity);
  const hi = Math.max(Number.isFinite(caseHi) ? caseHi : -Infinity, Number.isFinite(ctrlHi) ? ctrlHi : -Infinity);
  const gridLo = Number.isFinite(lo) ? lo - pad : 0;
  const gridHi = Number.isFinite(hi) ? hi + pad : 1;
  const grid = linspace(gridLo, gridHi === gridLo ? gridLo + 1 : gridHi, gridSize);

  const caseDensity = gaussianKde(caseRisk, wCase, grid, opts);
  const ctrlDensity = gaussianKde(ctrlRisk, wCtrl, grid, opts);

  const overlapCurve = new Float64Array(gridSize);
  for (let j = 0; j < gridSize; j += 1) overlapCurve[j] = Math.min(caseDensity[j], ctrlDensity[j]);
  const overlap = trapz(overlapCurve, grid);

  const control: DensityCurve = {
    x: grid,
    density: ctrlDensity,
    median: weightedQuantile(ctrlRisk, wCtrl, 0.5),
    n: ctrlRisk.length,
    weightSum: wCtrl ? sumKahan(wCtrl) : ctrlRisk.length,
    bandwidth: hCtrl,
  };
  const case_: DensityCurve = {
    x: grid,
    density: caseDensity,
    median: weightedQuantile(caseRisk, wCase, 0.5),
    n: caseRisk.length,
    weightSum: wCase ? sumKahan(wCase) : caseRisk.length,
    bandwidth: hCase,
  };

  return {
    control,
    case_,
    grid,
    overlap,
    riskMaxDisplay: weightedQuantile(pooledRisk, wPool, 0.995),
    isNcc,
  };
}
