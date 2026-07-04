// Phase 11 — the ROC (receiver operating characteristic) engine: a weighted empirical ROC of the model's
// RISK SCORE (`linearPredictors`) against the observed outcome. It traces sensitivity (true-positive rate)
// against 1 − specificity (false-positive rate) as the score threshold sweeps from high to low.
//
// py-icare does NOT emit a ROC — the vendored wheel's model_validation.py has no plotting code and returns
// only the AUC scalar (a Mann–Whitney U statistic on `linear_predictors`). We build the curve here so the
// discrimination story is complete and the figure is downloadable. The trapezoidal area under this ROC
// reproduces `result.auc.auc` exactly (up to float error): the trapezoid over a tie-grouped, IPW-weighted
// empirical ROC equals the normalized weighted Mann–Whitney U with 0.5 credit for ties — the SDK's AUC.
// That identity is the module's correctness anchor (roc.test.ts checks it against both live fixtures).
//
// Scale discipline (do NOT conflate — see kde.ts:22-23): the discrimination KDE is on `riskEstimates`
// (absolute risk); bins, AUC, and this ROC are on `linearPredictors` (the pure risk score). Absolute risk
// is not monotonic in the linear predictor across a wide-age cohort, so a risk-scale ROC would diverge from
// the reported AUC — building on the linear predictor is what keeps the two consistent.
//
// Pure module, no I/O. The nested-case-control guard mirrors `discriminationDensities` (kde.ts): when
// `isNcc`, weight each subject by `frequency = 1/sampling_weights` (inverse-probability weighting), so the
// curve and its AUC represent the source cohort, not the biased nested sample.

import type { PerSubject } from '../services/resultNormalizer';

/**
 * Scores within this gap are treated as tied — matching py-icare's Mann–Whitney `AUC_TIE_TOLERANCE`. A
 * case and a control at the same score then share one ROC vertex (a diagonal segment), whose trapezoid area
 * gives them the 0.5 credit the SDK's U statistic assigns. Real data has genuine ties: a covariate-only
 * model gives every identical categorical profile an identical linear predictor.
 */
export const AUC_TIE_TOLERANCE = 1e-9;

/** One ROC operating point: false-positive rate (x), true-positive rate (y), and the score threshold there. */
export interface RocPoint {
  /** False-positive rate = 1 − specificity ∈ [0, 1] (weighted for ncc). */
  fpr: number;
  /** True-positive rate = sensitivity ∈ [0, 1] (weighted for ncc). */
  tpr: number;
  /** Risk-score (linear-predictor) cutoff at this point: predict positive when score ≥ threshold. The
   *  leading seed point is `+Infinity` (classify none positive). */
  threshold: number;
}

/** The Youden-optimal operating point (maximizes J = sensitivity + specificity − 1 = tpr − fpr). */
export interface YoudenPoint {
  fpr: number;
  tpr: number;
  /** Risk-score cutoff achieving the optimum. */
  threshold: number;
  /** Youden's J = tpr − fpr = sensitivity + specificity − 1 ∈ [0, 1]. */
  j: number;
  /** = tpr. */
  sensitivity: number;
  /** = 1 − fpr. */
  specificity: number;
}

export interface RocCurve {
  /** Operating points from (0,0) to (1,1); `fpr` and `tpr` are both non-decreasing. */
  points: RocPoint[];
  /** Trapezoidal area under the curve; ≈ `result.auc.auc`. `NaN` when a class is empty (curve undefined). */
  auc: number;
  /** Optimal operating point, or `null` for a degenerate curve. */
  youden: YoudenPoint | null;
  /** Raw case / control subject counts (for the empty-state guard and legend). */
  nCases: number;
  nControls: number;
  /** Σ weight per class: the raw count for a cohort, Σ frequency (design-effective count) for ncc. */
  weightSum: { cases: number; controls: number };
  isNcc: boolean;
}

/**
 * Build the weighted empirical ROC of `perSubject.linearPredictors` (the risk score) vs.
 * `perSubject.observedOutcome`. `isNcc` must come from the authoritative `NormalizedResult.isNcc`; when
 * true, `perSubject.frequency` is required (inverse-probability weighting), mirroring
 * `discriminationDensities`' contract. Non-finite scores are skipped (a linear predictor is Σβx and is
 * finite in practice; the guard is defensive and keeps the AUC identity intact).
 */
export function rocCurve(perSubject: PerSubject, isNcc: boolean): RocCurve {
  if (isNcc && !perSubject.frequency) {
    throw new Error(
      'rocCurve: nested case-control requires per-subject frequency (1/sampling_weights).',
    );
  }
  const score = perSubject.linearPredictors;
  const label = perSubject.observedOutcome;
  const freq = perSubject.frequency;
  const nAll = score.length;

  // Collect finite-score subjects; tally weighted positives P / negatives N and the raw + design counts. The
  // per-subject weight is the inverse-probability `frequency` for ncc, else 1 (a plain cohort count).
  const idx: number[] = [];
  let positives = 0; // Σ w over cases (weighted true condition-positive)
  let negatives = 0; // Σ w over controls
  let nCases = 0;
  let nControls = 0;
  for (let i = 0; i < nAll; i += 1) {
    const s = score[i];
    if (!Number.isFinite(s)) continue;
    const w = isNcc ? freq![i] : 1;
    idx.push(i);
    if (label[i] === 1) {
      positives += w;
      nCases += 1;
    } else {
      negatives += w;
      nControls += 1;
    }
  }
  const weightSum = { cases: positives, controls: negatives };

  // A ROC needs both classes: TPR normalizes by the cases, FPR by the controls. Degenerate → the bare
  // diagonal endpoints, NaN AUC, no Youden point; the section renders its empty state.
  if (!(positives > 0) || !(negatives > 0)) {
    return {
      points: [
        { fpr: 0, tpr: 0, threshold: Infinity },
        { fpr: 1, tpr: 1, threshold: -Infinity },
      ],
      auc: NaN,
      youden: null,
      nCases,
      nControls,
      weightSum,
      isNcc,
    };
  }

  // Sweep thresholds from high to low: sort subjects by score descending, then walk, LOWERING the implied
  // cutoff and marking each newly-included subject positive. Grouping tied scores (within AUC_TIE_TOLERANCE)
  // emits one vertex per distinct score, so a case+control tie becomes a diagonal segment (the 0.5 credit).
  idx.sort((a, b) => score[b] - score[a]);

  // Accumulate RAW cumulative case/control weights, then normalize by the sweep's OWN final totals. Dividing
  // by the separately-summed `positives`/`negatives` (a different summation order) can drift by a ULP, push a
  // vertex a hair past 1, and dent monotonicity; normalizing by the same running sum makes fpr/tpr exactly
  // monotone in [0,1] with the terminus exactly (1,1) — no pinning needed.
  const rawFp: number[] = [0];
  const rawTp: number[] = [0];
  const thresholds: number[] = [Infinity];
  let tpCum = 0;
  let fpCum = 0;
  let k = 0;
  while (k < idx.length) {
    const groupScore = score[idx[k]];
    // Consume the whole run of scores within tolerance of this (highest-in-group) score.
    while (k < idx.length && groupScore - score[idx[k]] <= AUC_TIE_TOLERANCE) {
      const i = idx[k];
      const w = isNcc ? freq![i] : 1;
      if (label[i] === 1) tpCum += w;
      else fpCum += w;
      k += 1;
    }
    rawFp.push(fpCum);
    rawTp.push(tpCum);
    thresholds.push(groupScore);
  }
  const posTotal = tpCum; // Σ case weight (sweep order) — the exact TPR denominator
  const negTotal = fpCum; // Σ control weight (sweep order) — the exact FPR denominator
  const points: RocPoint[] = rawFp.map((fp, i) => ({
    fpr: fp / negTotal,
    tpr: rawTp[i] / posTotal,
    threshold: thresholds[i],
  }));

  // Trapezoidal area under the curve — the empirical AUC, ≈ the SDK's Mann–Whitney AUC.
  let auc = 0;
  for (let i = 1; i < points.length; i += 1) {
    auc += ((points[i].fpr - points[i - 1].fpr) * (points[i].tpr + points[i - 1].tpr)) / 2;
  }

  // Youden-optimal point: the vertex maximizing J = tpr − fpr (furthest above the chance diagonal). Strict
  // `>` keeps the FIRST maximizer on ties — the higher-threshold / higher-specificity one.
  let youden: YoudenPoint | null = null;
  let bestJ = -Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    const j = p.tpr - p.fpr;
    if (j > bestJ) {
      bestJ = j;
      youden = {
        fpr: p.fpr,
        tpr: p.tpr,
        threshold: p.threshold,
        j,
        sensitivity: p.tpr,
        specificity: 1 - p.fpr,
      };
    }
  }

  return { points, auc, youden, nCases, nControls, weightSum, isNcc };
}
