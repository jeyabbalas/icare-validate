import { describe, it, expect } from 'vitest';
import type { PerSubject } from '../services/resultNormalizer';
import { rocCurve } from './roc';
import { loadFixture, type FixtureName } from './fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// A minimal PerSubject: rocCurve reads only linearPredictors (the score), observedOutcome, and — for ncc —
// frequency. Remaining fields are zero-filled. Mirrors kde.test.ts's factory (freq = 1/sw).
function makePerSubject(fields: { score: number[]; outcome: number[]; sw?: number[] }): PerSubject {
  const n = fields.score.length;
  const zero = (): Float64Array => new Float64Array(n);
  const sw = fields.sw ? Float64Array.from(fields.sw) : null;
  const freq = sw ? Float64Array.from(sw, (w) => 1 / w) : null;
  return {
    n,
    observedOutcome: Float64Array.from(fields.outcome),
    studyEntryAge: zero(),
    studyExitAge: zero(),
    timeOfOnset: zero(),
    observedFollowup: zero(),
    predictedRiskInterval: zero(),
    followup: zero(),
    riskEstimates: zero(),
    linearPredictors: Float64Array.from(fields.score),
    linearPredictorsCategory: new Array<string | null>(n).fill(null),
    samplingWeights: sw,
    frequency: freq,
  };
}

// NaN/±Inf-aware closeness (mirrors calibrationMath.parity.test.ts).
function expectClose(actual: number, expected: number, abs = 1e-9, rel = 1e-7): void {
  if (Number.isNaN(expected) || Number.isNaN(actual)) {
    expect(Number.isNaN(actual)).toBe(Number.isNaN(expected));
    return;
  }
  if (Math.abs(actual - expected) > abs + rel * Math.abs(expected)) {
    expect(actual).toBeCloseTo(expected, 12); // force a readable failure
  }
}

describe('rocCurve — curve shape & endpoints', () => {
  it('perfect separation (cases score highest) → AUC 1 and the curve reaches (0,1)', () => {
    const roc = rocCurve(makePerSubject({ score: [3, 2, 1, 0], outcome: [1, 1, 0, 0] }), false);
    expect(roc.auc).toBeCloseTo(1, 12);
    // A corner at (0,1): perfect sensitivity with no false positives.
    expect(roc.points.some((p) => p.fpr === 0 && p.tpr === 1)).toBe(true);
    expect(roc.youden?.j).toBeCloseTo(1, 12);
    expect(roc.youden?.sensitivity).toBeCloseTo(1, 12);
    expect(roc.youden?.specificity).toBeCloseTo(1, 12);
  });

  it('perfect anti-separation (cases score lowest) → AUC 0', () => {
    const roc = rocCurve(makePerSubject({ score: [3, 2, 1, 0], outcome: [0, 0, 1, 1] }), false);
    expect(roc.auc).toBeCloseTo(0, 12);
  });

  it('endpoints are (0,0) and (1,1) with fpr & tpr non-decreasing', () => {
    const roc = rocCurve(
      makePerSubject({ score: [5, 4, 3, 2, 1, 0], outcome: [1, 0, 1, 0, 1, 0] }),
      false,
    );
    const first = roc.points[0];
    const last = roc.points[roc.points.length - 1];
    expect([first.fpr, first.tpr]).toEqual([0, 0]);
    expect([last.fpr, last.tpr]).toEqual([1, 1]);
    for (let i = 1; i < roc.points.length; i += 1) {
      expect(roc.points[i].fpr).toBeGreaterThanOrEqual(roc.points[i - 1].fpr);
      expect(roc.points[i].tpr).toBeGreaterThanOrEqual(roc.points[i - 1].tpr);
    }
    expect(roc.auc).toBeGreaterThanOrEqual(0);
    expect(roc.auc).toBeLessThanOrEqual(1);
  });
});

describe('rocCurve — tie handling (0.5 credit, matching Mann–Whitney)', () => {
  it('all scores tied → AUC 0.5 (a single diagonal segment)', () => {
    const roc = rocCurve(makePerSubject({ score: [1, 1, 1, 1], outcome: [1, 0, 1, 0] }), false);
    expect(roc.auc).toBeCloseTo(0.5, 12);
    // Only the (0,0) seed and the (1,1) terminus — the tie collapses to one segment.
    expect(roc.points).toHaveLength(2);
  });

  it('a case+control tie gives 0.5 credit → AUC 0.875 on the worked example', () => {
    // scores [2,1,1,0] labels [1,1,0,0]: the case@1 and control@1 tie. Mann–Whitney U = 3.5 / (2·2).
    const roc = rocCurve(makePerSubject({ score: [2, 1, 1, 0], outcome: [1, 1, 0, 0] }), false);
    expect(roc.auc).toBeCloseTo(0.875, 12);
  });
});

describe('rocCurve — Youden-optimal operating point', () => {
  it('takes the max-J vertex, keeping the first (higher-specificity) on ties', () => {
    // scores [4,3,2,1] labels [1,0,1,0]: vertices (0,.5) and (.5,1) both have J=0.5; the first wins.
    const roc = rocCurve(makePerSubject({ score: [4, 3, 2, 1], outcome: [1, 0, 1, 0] }), false);
    expect(roc.auc).toBeCloseTo(0.75, 12);
    expect(roc.youden?.j).toBeCloseTo(0.5, 12);
    expect(roc.youden?.sensitivity).toBeCloseTo(0.5, 12);
    expect(roc.youden?.specificity).toBeCloseTo(1, 12);
    expect(roc.youden?.threshold).toBe(4); // the higher-threshold maximizer
  });
});

describe('rocCurve — nested case-control (inverse-probability weighted)', () => {
  it('weights the sweep by frequency → the worked weighted AUC', () => {
    // scores [2,1,0] labels [1,0,1], sw [1,0.5,0.25] → freq [1,2,4]. Weighted U = 2 / (5·2) = 0.2.
    const roc = rocCurve(
      makePerSubject({ score: [2, 1, 0], outcome: [1, 0, 1], sw: [1, 0.5, 0.25] }),
      true,
    );
    expect(roc.auc).toBeCloseTo(0.2, 12);
    expect(roc.isNcc).toBe(true);
    expect(roc.weightSum.cases).toBeCloseTo(5, 12); // Σ freq over cases = 1 + 4
    expect(roc.weightSum.controls).toBeCloseTo(2, 12);
  });

  it('throws on the contract violation of a missing frequency column', () => {
    const cohortShaped = makePerSubject({ score: [1, 2], outcome: [0, 1] });
    expect(() => rocCurve(cohortShaped, true)).toThrow(/frequency/);
  });
});

describe('rocCurve — degenerate & non-finite handling', () => {
  it('no controls → NaN AUC, null Youden, bare diagonal', () => {
    const roc = rocCurve(makePerSubject({ score: [1, 2, 3], outcome: [1, 1, 1] }), false);
    expect(Number.isNaN(roc.auc)).toBe(true);
    expect(roc.youden).toBeNull();
    expect(roc.nControls).toBe(0);
    expect(roc.nCases).toBe(3);
    expect(roc.points).toHaveLength(2);
  });

  it('skips non-finite scores (they drop out of the counts)', () => {
    const roc = rocCurve(makePerSubject({ score: [3, NaN, 1], outcome: [1, 0, 0] }), false);
    expect(roc.nCases).toBe(1);
    expect(roc.nControls).toBe(1); // the NaN-scored control is excluded
    expect(roc.auc).toBeCloseTo(1, 12);
  });
});

// The correctness anchor: the trapezoidal area under our tie-grouped, IPW-weighted empirical ROC equals the
// SDK's Mann–Whitney AUC (`result.auc.auc`) — an exact identity, so it holds up to float error for both a
// cohort (iCARE-Lit) and a nested case-control study (BPC3). No Pyodide needed: result.auc is in the fixture.
const CASES: Array<{ name: FixtureName; ncc: boolean }> = [
  { name: 'icare-lit-ge50', ncc: false },
  { name: 'bpc3-covariate', ncc: true },
];

describe.each(CASES)('rocCurve — SDK AUC parity — $name', ({ name, ncc }) => {
  const { result } = loadFixture(name);
  const norm = normalizeValidationResult(result);
  const roc = rocCurve(norm.perSubject, norm.isNcc);

  it('agrees on the study type', () => {
    expect(norm.isNcc).toBe(ncc);
  });

  it('trapezoidal AUC reproduces result.auc.auc', () => {
    expectClose(roc.auc, result.auc.auc, 1e-6, 1e-6);
  });

  it('is a well-formed curve on real data (monotone, endpoints, Youden present)', () => {
    const first = roc.points[0];
    const last = roc.points[roc.points.length - 1];
    expect([first.fpr, first.tpr]).toEqual([0, 0]);
    expect([last.fpr, last.tpr]).toEqual([1, 1]);
    for (let i = 1; i < roc.points.length; i += 1) {
      expect(roc.points[i].fpr).toBeGreaterThanOrEqual(roc.points[i - 1].fpr);
      expect(roc.points[i].tpr).toBeGreaterThanOrEqual(roc.points[i - 1].tpr);
    }
    expect(roc.youden).not.toBeNull();
    expect(roc.youden!.j).toBeGreaterThan(0);
  });
});
