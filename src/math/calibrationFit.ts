// Weighted least-squares line fit for the calibration scatters: given a risk group's (predicted, observed)
// points plus a per-point weight, return the slope + intercept of the observed-on-predicted regression
// line. The SLOPE is the "calibration slope": 1 = perfect calibration (points on the y = x identity),
// < 1 = predictions too spread out (over-fit), > 1 = too compressed.
//
// The line is fit by WEIGHTED least squares (minimize Σ wᵢ (yᵢ − a − b·xᵢ)²), not ordinary OLS, because
// the calibration bins can differ in size and precision — routinely so after interactive re-binning
// (custom cutpoints, quantile collapse). Weighting each group by the inverse variance of its observed
// value (the caller supplies the weights) is the BLUE estimator: it keeps a small, noisy bin from
// swinging the slope, and makes the line "listen to" the 95% CIs already drawn as whiskers.
//
// Total function, matching the calibration engine's never-throw contract: fewer than two usable points,
// a coincident-x (vertical, non-identifiable) system, or non-finite / ≤ 0 weights yield `defined: false`
// with NaN slope / intercept rather than throwing. The 2×2 normal equations are solved with linalg
// `solve`, which itself degrades to NaN on a singular / non-finite system.

import { solve } from './linalg';
import { sumKahan } from './numeric';

/** A fitted line `y = intercept + slope·x`. `defined` is false when the fit is not identifiable. */
export interface LinearFit {
  slope: number;
  intercept: number;
  /** Number of points that passed the finite / positive-weight filter and entered the fit. */
  nPoints: number;
  defined: boolean;
}

/** One weighted point for the least-squares fit. */
export interface WlsPoint {
  x: number;
  y: number;
  w: number;
}

const undefinedFit = (nPoints: number): LinearFit => ({
  slope: NaN,
  intercept: NaN,
  nPoints,
  defined: false,
});

/**
 * Weighted least-squares fit of `y` on `x`. Points with a non-finite coordinate or a non-finite / ≤ 0
 * weight are dropped first; the fit needs ≥ 2 surviving points with non-coincident x. Returns
 * `defined: false` (NaN slope / intercept) when the fit is not identifiable — never throws.
 */
export function weightedLinearFit(points: WlsPoint[]): LinearFit {
  const use = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w) && p.w > 0,
  );
  if (use.length < 2) return undefinedFit(use.length);

  // Moment sums for the normal equations. Kahan-compensated because these sums gate a visible slope —
  // the same reason the engine's per-bin accumulations are (see numeric.ts).
  const sw = sumKahan(use.map((p) => p.w));
  const sx = sumKahan(use.map((p) => p.w * p.x));
  const sy = sumKahan(use.map((p) => p.w * p.y));
  const sxx = sumKahan(use.map((p) => p.w * p.x * p.x));
  const sxy = sumKahan(use.map((p) => p.w * p.x * p.y));

  // Normal equations  [[Σw, Σwx], [Σwx, Σwx²]] · [intercept, slope]ᵀ = [Σwy, Σwxy]ᵀ.
  // `solve` returns [NaN, NaN] on a singular system (e.g. all x coincident → zero determinant).
  const [intercept, slope] = solve(
    [
      [sw, sx],
      [sx, sxx],
    ],
    [sy, sxy],
  );

  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return undefinedFit(use.length);
  return { slope, intercept, nPoints: use.length, defined: true };
}
