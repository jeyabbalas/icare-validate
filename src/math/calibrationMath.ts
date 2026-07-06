// The Phase-5 recompute engine: reproduces py-icare's per-bin calibration statistics in TypeScript from
// the normalized per-subject arrays, so re-binning is instant (no SDK re-run) and can bin on the
// absolute-risk scale (py-icare only bins on the linear predictor).
//
// Correctness anchor: with default deciles on the linear-predictor scale this must reproduce
// `result.categorySpecificCalibration` and `result.calibration` within float tolerance for both a cohort
// (unweighted) and a nested case-control study (inverse-probability weighted). The cohort vs NCC split
// follows py-icare's `_calculate_risk_calibration` / `_calculate_risk_weighted_calibration`; the shared
// relative-risk delta-method is `calculate_rr_stddev_chi2_and_variance`.
//
// Total function: empty bins, bins with observed rate 0 or 1, non-positive predicted risk, and a single
// realized bin all yield NaN statistics + a `degenerate` flag rather than throwing — interactive
// re-binning routinely produces these, and py-icare itself would either emit NaN or raise.

import type { PerSubject } from '../services/resultNormalizer';
import { mean } from './numeric';
import { assignBins, cutoffEdges, quantileEdges, type BinMeta } from './binning';
import { diagFromVec, matMul, quadraticFormInverse, transpose } from './linalg';
import { chi2SurvivalLossy, logWaldCi, waldCi } from './stats';
import { weightedLinearFit, type LinearFit, type WlsPoint } from './calibrationFit';

export type BinScale = 'linear-predictor' | 'absolute-risk';

export interface RecomputeOptions {
  /** Which per-subject score to bin on. `absolute-risk` is the app's extension (py-icare bins on LP). */
  scale: BinScale;
  /** Interior cut points on the chosen scale. When present, these win over `numberOfPercentiles`. */
  cutoffs?: number[];
  /** Number of quantile bins when no explicit cutoffs are given (default 10 = deciles). */
  numberOfPercentiles?: number;
}

export interface CalibrationBin {
  index: number;
  label: string;
  lo: number;
  hi: number;
  n: number; // realized subject count
  weight: number; // Σ frequency (nested case-control) or n (cohort)
  observedAbsoluteRisk: number;
  predictedAbsoluteRisk: number;
  varianceAbsoluteRisk: number;
  lowerCiAbsoluteRisk: number; // may be < 0 — clamp only when plotting
  upperCiAbsoluteRisk: number;
  observedRelativeRisk: number;
  predictedRelativeRisk: number;
  lowerCiRelativeRisk: number;
  upperCiRelativeRisk: number;
  expectedByObservedRatio: number; // NaN for a degenerate bin
  lowerCiExpectedByObservedRatio: number;
  upperCiExpectedByObservedRatio: number;
  degenerate: boolean; // empty | observed ∉ (0,1) | predicted ≤ 0
}

export interface GofResult {
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
  variance: number[][]; // AR: diag(variance); RR: log-RR variance-covariance matrix
  defined: boolean;
}

export interface RecomputedCalibration {
  scale: BinScale;
  isNcc: boolean;
  nBins: number;
  nExcluded: number; // subjects with a NaN/unbinnable score (binIndex −1), dropped from every per-bin stat
  bins: CalibrationBin[];
  binIndex: Int32Array; // per-subject realized bin; -1 = NaN / unbinnable score
  edges: number[]; // realized cut edges
  meanObservedProb: number; // relative-risk normalization denominator (observed)
  meanPredictedProb: number; // relative-risk normalization denominator (predicted)
  absoluteRiskGof: GofResult; // Hosmer–Lemeshow, df = nBins
  relativeRiskGof: GofResult; // df = nBins − 1
  absoluteRiskFit: LinearFit; // inverse-variance WLS slope/intercept of observed-on-predicted absolute risk
  relativeRiskFit: LinearFit; // same for relative risk, fit on the linear RR scale (slope 1 = calibrated)
  warnings: string[]; // e.g. dropped out-of-range custom cutoffs
}

interface RrDelta {
  stddevLogRr: number[];
  chi2: number;
  varCovLogRr: number[][];
}

/** py-icare `calculate_rr_stddev_chi2_and_variance` — delta-method covariance of the log relative risks. */
function rrDeltaMethod(
  varianceAr: number[],
  meanObservedProb: number,
  observed: number[],
  observedRr: number[],
  predictedRr: number[],
): RrDelta {
  const k = observed.length;
  const off = -1 / (k * meanObservedProb);
  // D: D_ii = 1/observedᵢ + off, D_ij = off (i ≠ j)
  const d: number[][] = [];
  for (let i = 0; i < k; i += 1) {
    const row = new Array<number>(k).fill(off);
    row[i] = 1 / observed[i] + off;
    d.push(row);
  }
  const varMat = diagFromVec(varianceAr);
  const varCovLogRr = matMul(matMul(d, varMat), d); // D·diag(var)·D
  const stddevLogRr = varCovLogRr.map((row, i) => Math.sqrt(row[i]));

  const dm = d.slice(0, k - 1); // (k−1)×k
  const m = matMul(matMul(dm, varMat), transpose(dm)); // (k−1)×(k−1)
  const diff: number[] = [];
  for (let i = 0; i < k - 1; i += 1) diff.push(Math.log(observedRr[i]) - Math.log(predictedRr[i]));
  const chi2 = quadraticFormInverse(m, diff);
  return { stddevLogRr, chi2, varCovLogRr };
}

/**
 * Recompute per-bin calibration + goodness-of-fit from the normalized per-subject arrays. `isNcc` must
 * come from the authoritative `NormalizedResult.isNcc`; when true, `perSubject.frequency` and
 * `perSubject.samplingWeights` are required.
 */
export function recomputeCalibration(
  perSubject: PerSubject,
  isNcc: boolean,
  options: RecomputeOptions,
): RecomputedCalibration {
  const score =
    options.scale === 'absolute-risk' ? perSubject.riskEstimates : perSubject.linearPredictors;
  const outcome = perSubject.observedOutcome;
  const risk = perSubject.riskEstimates;

  let frequency: Float64Array | null = null;
  let samplingWeights: Float64Array | null = null;
  if (isNcc) {
    if (!perSubject.frequency || !perSubject.samplingWeights) {
      throw new Error(
        'recomputeCalibration: nested case-control requires per-subject frequency and samplingWeights.',
      );
    }
    frequency = perSubject.frequency;
    samplingWeights = perSubject.samplingWeights;
  }

  // Build the cut edges. Custom cutoffs win over percentiles (matching buildValidateOptions / py-icare)
  // and are the only path that keeps empty bins.
  const warnings: string[] = [];
  let edges: number[];
  let dropEmpty: boolean;
  if (options.cutoffs && options.cutoffs.length > 0) {
    const cut = cutoffEdges(score, options.cutoffs);
    edges = cut.edges;
    warnings.push(...cut.warnings);
    dropEmpty = false;
  } else {
    edges = quantileEdges(score, frequency, options.numberOfPercentiles ?? 10);
    dropEmpty = true;
  }

  const assignment = assignBins(score, edges, { dropEmpty });
  const { binIndex, nBins, bins: binMetas } = assignment;

  // On the quantile path, tied scores collapse duplicate edges (and any empty bins are dropped), so the
  // realized bin count can fall below the number requested — which also shrinks the goodness-of-fit df.
  // Surface that so "10 deciles" silently becoming 7 groups is never invisible. (The custom-cutoff path
  // keeps its bins and warns separately about out-of-range/duplicate cutoffs.)
  if (dropEmpty) {
    const requested = options.numberOfPercentiles ?? 10;
    if (nBins < requested) {
      warnings.push(
        `Requested ${requested} risk groups, realized ${nBins} — tied scores merged quantile bins, reducing the goodness-of-fit degrees of freedom.`,
      );
    }
  }

  // ---- Per-bin observed / predicted / variance -----------------------------
  const cnt = new Array<number>(nBins).fill(0);
  const sumW = new Float64Array(nBins); // Σ frequency (ncc) or n (cohort)
  const sumObs = new Float64Array(nBins); // Σ outcome (cohort) or Σ outcome·freq (ncc)
  const sumPred = new Float64Array(nBins); // Σ risk (cohort) or Σ risk·freq (ncc)
  let nExcluded = 0; // subjects whose score was NaN/unbinnable (binIndex −1) — dropped from every bin
  for (let i = 0; i < binIndex.length; i += 1) {
    const b = binIndex[i];
    if (b < 0) {
      nExcluded += 1;
      continue;
    }
    cnt[b] += 1;
    const w = isNcc ? frequency![i] : 1;
    sumW[b] += w;
    sumObs[b] += outcome[i] * w;
    sumPred[b] += risk[i] * w;
  }

  const observed = new Array<number>(nBins);
  const predicted = new Array<number>(nBins);
  for (let b = 0; b < nBins; b += 1) {
    observed[b] = sumObs[b] / sumW[b];
    predicted[b] = sumPred[b] / sumW[b];
  }

  const varianceAr = new Array<number>(nBins);
  if (isNcc) {
    // Design correction: (outcomeᵢ − predBin)² · (1 − wᵢ)/wᵢ², summed per bin then divided by Σfrequency.
    const sumCorr = new Float64Array(nBins);
    for (let i = 0; i < binIndex.length; i += 1) {
      const b = binIndex[i];
      if (b < 0) continue;
      const sw = samplingWeights![i];
      const resid = outcome[i] - predicted[b];
      sumCorr[b] += (resid * resid * (1 - sw)) / (sw * sw);
    }
    for (let b = 0; b < nBins; b += 1) {
      const correction = sumCorr[b] / sumW[b];
      varianceAr[b] = (observed[b] * (1 - observed[b]) + correction) / sumW[b];
    }
  } else {
    for (let b = 0; b < nBins; b += 1) {
      varianceAr[b] = (observed[b] * (1 - observed[b])) / cnt[b];
    }
  }

  // ---- Relative risk (shared delta-method) ---------------------------------
  const meanObservedProb = mean(observed);
  const meanPredictedProb = mean(predicted);
  const observedRr = observed.map((o) => o / meanObservedProb);
  const predictedRr = predicted.map((p) => p / meanPredictedProb);
  const rr = rrDeltaMethod(varianceAr, meanObservedProb, observed, observedRr, predictedRr);

  // ---- Assemble per-bin rows ----------------------------------------------
  const outBins: CalibrationBin[] = binMetas.map((meta: BinMeta, b: number) => {
    const o = observed[b];
    const p = predicted[b];
    const v = varianceAr[b];
    const [arLo, arHi] = waldCi(o, Math.sqrt(v));
    const [rrLo, rrHi] = logWaldCi(observedRr[b], rr.stddevLogRr[b]);

    const eoDegenerate = !(o > 0) || !(p > 0);
    let eo = p / o;
    let eoLo: number;
    let eoHi: number;
    if (eoDegenerate) {
      eo = NaN;
      eoLo = NaN;
      eoHi = NaN;
    } else {
      [eoLo, eoHi] = logWaldCi(eo, Math.sqrt(v / (o * o)));
    }

    return {
      index: b,
      label: meta.label,
      lo: meta.lo,
      hi: meta.hi,
      n: cnt[b],
      weight: sumW[b],
      observedAbsoluteRisk: o,
      predictedAbsoluteRisk: p,
      varianceAbsoluteRisk: v,
      lowerCiAbsoluteRisk: arLo,
      upperCiAbsoluteRisk: arHi,
      observedRelativeRisk: observedRr[b],
      predictedRelativeRisk: predictedRr[b],
      lowerCiRelativeRisk: rrLo,
      upperCiRelativeRisk: rrHi,
      expectedByObservedRatio: eo,
      lowerCiExpectedByObservedRatio: eoLo,
      upperCiExpectedByObservedRatio: eoHi,
      degenerate: cnt[b] === 0 || !(o > 0 && o < 1) || !(p > 0),
    };
  });

  // ---- Goodness-of-fit -----------------------------------------------------
  let chi2Ar = 0;
  for (let b = 0; b < nBins; b += 1) {
    const resid = observed[b] - predicted[b];
    chi2Ar += (resid * resid) / varianceAr[b];
  }
  const dfAr = nBins;
  const absoluteRiskGof: GofResult = {
    chiSquare: chi2Ar,
    degreesOfFreedom: dfAr,
    pValue: chi2SurvivalLossy(chi2Ar, dfAr),
    variance: diagFromVec(varianceAr),
    defined: nBins >= 1 && Number.isFinite(chi2Ar),
  };

  const dfRr = nBins - 1;
  const relativeRiskGof: GofResult = {
    chiSquare: rr.chi2,
    degreesOfFreedom: dfRr,
    pValue: chi2SurvivalLossy(rr.chi2, dfRr),
    variance: rr.varCovLogRr,
    defined: nBins >= 2 && Number.isFinite(rr.chi2),
  };

  // ---- Calibration-slope fits (weighted least squares) ---------------------
  // Each scatter's observed-on-predicted line, fit by INVERSE-VARIANCE-weighted least squares over the
  // non-degenerate bins — exactly the markers the plots draw. Slope 1 = perfect calibration. Weighting by
  // 1/Var (rather than plain OLS) keeps small, noisy bins — routine after interactive re-binning — from
  // swinging the slope, and makes the line respect the same 95% CIs drawn as whiskers.
  const absFitPoints: WlsPoint[] = [];
  const relFitPoints: WlsPoint[] = [];
  for (let b = 0; b < nBins; b += 1) {
    if (outBins[b].degenerate) continue;
    // Absolute-risk plot: x = predicted, y = observed (proportions); weight = 1/Var(observed).
    const o = observed[b];
    const p = predicted[b];
    const v = varianceAr[b];
    if (Number.isFinite(o) && Number.isFinite(p) && v > 0 && Number.isFinite(v)) {
      absFitPoints.push({ x: p, y: o, w: 1 / v });
    }
    // Relative-risk plot (fit on the linear RR scale): x = predicted RR, y = observed RR. The observed-RR
    // variance comes from the delta method on the log scale: Var(obsRR) ≈ obsRR² · stddevLogRr².
    const oRr = observedRr[b];
    const pRr = predictedRr[b];
    const sdLog = rr.stddevLogRr[b];
    const vRr = oRr * oRr * sdLog * sdLog;
    if (oRr > 0 && pRr > 0 && Number.isFinite(pRr) && vRr > 0 && Number.isFinite(vRr)) {
      relFitPoints.push({ x: pRr, y: oRr, w: 1 / vRr });
    }
  }
  const absoluteRiskFit = weightedLinearFit(absFitPoints);
  const relativeRiskFit = weightedLinearFit(relFitPoints);

  return {
    scale: options.scale,
    isNcc,
    nBins,
    nExcluded,
    bins: outBins,
    binIndex,
    edges,
    meanObservedProb,
    meanPredictedProb,
    absoluteRiskGof,
    relativeRiskGof,
    absoluteRiskFit,
    relativeRiskFit,
    warnings,
  };
}
