import { describe, it, expect } from 'vitest';
import type { PerSubject } from '../services/resultNormalizer';
import { recomputeCalibration } from './calibrationMath';

// A minimal PerSubject: the engine only reads linearPredictors, riskEstimates, observedOutcome and
// (for nested case-control) frequency + samplingWeights. The remaining fields are filled with zeros.
function makePerSubject(fields: {
  lp: number[];
  risk: number[];
  outcome: number[];
  sw?: number[];
}): PerSubject {
  const n = fields.lp.length;
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
    riskEstimates: Float64Array.from(fields.risk),
    linearPredictors: Float64Array.from(fields.lp),
    linearPredictorsCategory: new Array<string | null>(n).fill(null),
    samplingWeights: sw,
    frequency: freq,
  };
}

describe('recomputeCalibration — cohort (unweighted)', () => {
  // lp deciles→2 bins: [1,4.5] and (4.5,8]; each bin observed=predicted so HL=0.
  const ps = makePerSubject({
    lp: [1, 2, 3, 4, 5, 6, 7, 8],
    outcome: [0, 1, 0, 0, 1, 0, 1, 1],
    risk: [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9],
  });
  const rc = recomputeCalibration(ps, false, { scale: 'linear-predictor', numberOfPercentiles: 2 });

  it('splits into two equal bins with correct means and counts', () => {
    expect(rc.nBins).toBe(2);
    expect(rc.bins.map((b) => b.n)).toEqual([4, 4]);
    expect(rc.bins.map((b) => b.weight)).toEqual([4, 4]); // cohort weight = count
    expect(rc.bins[0].observedAbsoluteRisk).toBeCloseTo(0.25, 12);
    expect(rc.bins[1].observedAbsoluteRisk).toBeCloseTo(0.75, 12);
    expect(rc.bins[0].predictedAbsoluteRisk).toBeCloseTo(0.25, 12);
    expect(rc.bins[1].predictedAbsoluteRisk).toBeCloseTo(0.75, 12);
  });

  it('binomial variance and (possibly negative) Wald CI', () => {
    expect(rc.bins[0].varianceAbsoluteRisk).toBeCloseTo(0.046875, 12); // .25·.75/4
    expect(rc.bins[0].lowerCiAbsoluteRisk).toBeCloseTo(-0.174352, 5); // clamp only when plotting
    expect(rc.bins[0].upperCiAbsoluteRisk).toBeCloseTo(0.674352, 5);
  });

  it('relative risk normalized by the simple across-bin mean', () => {
    expect(rc.meanObservedProb).toBeCloseTo(0.5, 12);
    expect(rc.meanPredictedProb).toBeCloseTo(0.5, 12);
    expect(rc.bins[0].observedRelativeRisk).toBeCloseTo(0.5, 12);
    expect(rc.bins[1].observedRelativeRisk).toBeCloseTo(1.5, 12);
    expect(rc.bins[0].predictedRelativeRisk).toBeCloseTo(0.5, 12);
    expect(rc.bins[1].predictedRelativeRisk).toBeCloseTo(1.5, 12);
  });

  it('perfect calibration → HL and RR chi-square 0, p-value 1', () => {
    expect(rc.absoluteRiskGof.chiSquare).toBeCloseTo(0, 12);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(2);
    expect(rc.absoluteRiskGof.pValue).toBeCloseTo(1, 12);
    expect(rc.absoluteRiskGof.defined).toBe(true);
    expect(rc.relativeRiskGof.chiSquare).toBeCloseTo(0, 12);
    expect(rc.relativeRiskGof.degreesOfFreedom).toBe(1);
    expect(rc.relativeRiskGof.pValue).toBeCloseTo(1, 12);
  });

  it('E/O ratio = predicted / observed per bin', () => {
    expect(rc.bins[0].expectedByObservedRatio).toBeCloseTo(1, 12);
    expect(rc.bins[1].expectedByObservedRatio).toBeCloseTo(1, 12);
  });
});

describe('recomputeCalibration — nested case-control (weighted)', () => {
  // freq = 1/sw. Weighted deciles→2 bins: [1,2.5] and (2.5,4].
  const ps = makePerSubject({
    lp: [1, 2, 3, 4],
    outcome: [0, 1, 0, 1],
    risk: [0.2, 0.4, 0.3, 0.5],
    sw: [0.5, 0.5, 0.25, 0.25], // freq = [2, 2, 4, 4]
  });
  const rc = recomputeCalibration(ps, true, { scale: 'linear-predictor', numberOfPercentiles: 2 });

  it('weighted per-bin observed / predicted and Σfrequency weight', () => {
    expect(rc.nBins).toBe(2);
    expect(rc.bins.map((b) => b.weight)).toEqual([4, 8]); // Σ frequency
    expect(rc.bins.map((b) => b.n)).toEqual([2, 2]);
    expect(rc.bins[0].observedAbsoluteRisk).toBeCloseTo(0.5, 12);
    expect(rc.bins[1].observedAbsoluteRisk).toBeCloseTo(0.5, 12);
    expect(rc.bins[0].predictedAbsoluteRisk).toBeCloseTo(0.3, 12);
    expect(rc.bins[1].predictedAbsoluteRisk).toBeCloseTo(0.4, 12);
  });

  it('design-corrected variance', () => {
    // bin0: (0.5·0.5 + 0.29)/4 = 0.135 ; bin1: (0.25 + 0.78)/8 = 0.12875
    expect(rc.bins[0].varianceAbsoluteRisk).toBeCloseTo(0.135, 12);
    expect(rc.bins[1].varianceAbsoluteRisk).toBeCloseTo(0.12875, 12);
  });

  it('HL statistic and per-bin E/O from the weighted rates', () => {
    // 0.04/0.135 + 0.01/0.12875
    expect(rc.absoluteRiskGof.chiSquare).toBeCloseTo(0.373966, 5);
    expect(rc.meanPredictedProb).toBeCloseTo(0.35, 12);
    expect(rc.bins[0].expectedByObservedRatio).toBeCloseTo(0.6, 12);
    expect(rc.bins[1].expectedByObservedRatio).toBeCloseTo(0.8, 12);
  });

  it('throws only on the contract violation of missing weights', () => {
    const cohortShaped = makePerSubject({ lp: [1, 2], outcome: [0, 1], risk: [0.1, 0.2] });
    expect(() => recomputeCalibration(cohortShaped, true, { scale: 'linear-predictor' })).toThrow(
      /frequency/,
    );
  });
});

describe('recomputeCalibration — absolute-risk scale (the app extension)', () => {
  it('a 3% cutpoint splits ≤3% vs >3% with correct per-bin stats, variance, and HL', () => {
    const ps = makePerSubject({
      lp: [-1, -0.5, 0.5, 1],
      risk: [0.01, 0.02, 0.04, 0.05],
      outcome: [0, 1, 0, 1],
    });
    const rc = recomputeCalibration(ps, false, { scale: 'absolute-risk', cutoffs: [0.03] });
    expect(rc.nBins).toBe(2);
    expect(rc.edges).toEqual([0.01, 0.03, 0.05]);
    expect(rc.bins.map((b) => b.n)).toEqual([2, 2]); // ≤3% : {0.01,0.02}, >3% : {0.04,0.05}
    expect(rc.bins[0].lo).toBe(0.01);
    expect(rc.bins[0].hi).toBe(0.03);
    expect(rc.bins[0].observedAbsoluteRisk).toBeCloseTo(0.5, 12); // outcome {0,1}
    expect(rc.bins[1].observedAbsoluteRisk).toBeCloseTo(0.5, 12);
    expect(rc.bins[0].predictedAbsoluteRisk).toBeCloseTo(0.015, 12);
    expect(rc.bins[1].predictedAbsoluteRisk).toBeCloseTo(0.045, 12);
    // Binomial variance obs(1−obs)/n = 0.5·0.5/2.
    expect(rc.bins[0].varianceAbsoluteRisk).toBeCloseTo(0.125, 12);
    expect(rc.bins[1].varianceAbsoluteRisk).toBeCloseTo(0.125, 12);
    expect(rc.bins[0].expectedByObservedRatio).toBeCloseTo(0.03, 12); // 0.015 / 0.5
    expect(rc.bins[1].expectedByObservedRatio).toBeCloseTo(0.09, 12); // 0.045 / 0.5
    // HL df = nBins = 2; χ² = Σ(obs−pred)²/var = (0.485² + 0.455²)/0.125.
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(2);
    expect(rc.absoluteRiskGof.chiSquare).toBeCloseTo(3.538, 3);
    expect(rc.absoluteRiskGof.defined).toBe(true);
    expect(rc.relativeRiskGof.degreesOfFreedom).toBe(1); // nBins − 1
  });

  it('threads inverse-probability weights through a nested case-control abs-risk cut', () => {
    // sw = sampling weights → frequency = 1/sw = [2,2,1,1]; the ≤3% bin over-weights its two subjects.
    const ps = makePerSubject({
      lp: [-1, -0.5, 0.5, 1],
      risk: [0.01, 0.02, 0.04, 0.05],
      outcome: [0, 1, 0, 1],
      sw: [0.5, 0.5, 1, 1],
    });
    const rc = recomputeCalibration(ps, true, { scale: 'absolute-risk', cutoffs: [0.03] });
    expect(rc.nBins).toBe(2);
    expect(rc.bins.map((b) => b.n)).toEqual([2, 2]);
    expect(rc.bins.map((b) => b.weight)).toEqual([4, 2]); // Σ frequency: 2+2 vs 1+1
    expect(rc.bins[0].observedAbsoluteRisk).toBeCloseTo(0.5, 12); // (0·2 + 1·2)/4
    expect(rc.bins[0].predictedAbsoluteRisk).toBeCloseTo(0.015, 12); // (0.01·2 + 0.02·2)/4
    expect(rc.bins[1].predictedAbsoluteRisk).toBeCloseTo(0.045, 12);
    expect(rc.bins[0].expectedByObservedRatio).toBeCloseTo(0.03, 12);
    // The design-corrected variance stays finite and positive (its exact value is anchored by the
    // LP-scale parity test + the pandas oracle); the HL test is defined.
    expect(rc.bins[0].varianceAbsoluteRisk).toBeGreaterThan(0);
    expect(Number.isFinite(rc.bins[1].varianceAbsoluteRisk)).toBe(true);
    expect(rc.absoluteRiskGof.defined).toBe(true);
  });
});

describe('recomputeCalibration — degenerate / guarded cases (never throws)', () => {
  it('observed 0 and 1 bins → GOF undefined, E/O NaN, flagged, no throw', () => {
    const ps = makePerSubject({
      lp: [1, 2, 3, 4],
      outcome: [0, 0, 1, 1], // bin0 all controls, bin1 all cases
      risk: [0.1, 0.2, 0.8, 0.9],
    });
    const rc = recomputeCalibration(ps, false, {
      scale: 'linear-predictor',
      numberOfPercentiles: 2,
    });
    expect(rc.absoluteRiskGof.defined).toBe(false);
    expect(rc.relativeRiskGof.defined).toBe(false);
    expect(rc.bins[0].degenerate).toBe(true);
    expect(rc.bins[1].degenerate).toBe(true);
    expect(Number.isNaN(rc.bins[0].expectedByObservedRatio)).toBe(true);
  });

  it('empty bin under custom cutoffs is kept (NaN stats) and still counts toward df', () => {
    const ps = makePerSubject({
      lp: [1, 2, 8, 9],
      outcome: [0, 1, 0, 1],
      risk: [0.1, 0.2, 0.3, 0.4],
    });
    const rc = recomputeCalibration(ps, false, { scale: 'linear-predictor', cutoffs: [3, 7] });
    expect(rc.nBins).toBe(3);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(3);
    expect(rc.bins[1].n).toBe(0);
    expect(rc.bins[1].degenerate).toBe(true);
    expect(Number.isNaN(rc.bins[1].observedAbsoluteRisk)).toBe(true);
    expect(rc.warnings).toHaveLength(0);
    expect(rc.bins[0].n).toBe(2);
    expect(rc.bins[2].n).toBe(2);
  });

  it('tied scores collapse deciles below q, still binning every subject', () => {
    const ps = makePerSubject({
      lp: [1, 1, 1, 1, 1, 2, 2, 2, 2, 3],
      outcome: [0, 0, 1, 0, 0, 1, 0, 1, 1, 1],
      risk: [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3],
    });
    const rc = recomputeCalibration(ps, false, {
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });
    expect(rc.nBins).toBeLessThan(10);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(rc.nBins);
    expect(rc.bins.reduce((s, b) => s + b.n, 0)).toBe(10); // every subject binned
    // The shortfall from the requested decile count is surfaced as a warning (not silent).
    expect(rc.warnings.some((w) => /Requested 10 risk groups, realized/.test(w))).toBe(true);
    expect(rc.nExcluded).toBe(0); // no NaN scores here — every subject is binned
  });

  it('excludes NaN scores from every bin and counts them in nExcluded', () => {
    const ps = makePerSubject({
      lp: [1, 2, NaN, 4, NaN], // two unbinnable scores
      outcome: [0, 1, 1, 0, 1],
      risk: [0.1, 0.2, 0.3, 0.4, 0.5],
    });
    const rc = recomputeCalibration(ps, false, {
      scale: 'linear-predictor',
      numberOfPercentiles: 2,
    });
    expect(rc.nExcluded).toBe(2);
    expect(rc.bins.reduce((s, b) => s + b.n, 0)).toBe(3); // only the 3 finite-score subjects binned
    expect([...rc.binIndex].filter((b) => b < 0)).toHaveLength(2);
  });

  it('a constant score → single bin, RR GOF undefined (df 0)', () => {
    const ps = makePerSubject({
      lp: [5, 5, 5, 5],
      outcome: [0, 1, 0, 1],
      risk: [0.4, 0.5, 0.6, 0.5],
    });
    const rc = recomputeCalibration(ps, false, {
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });
    expect(rc.nBins).toBe(1);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(1);
    expect(rc.relativeRiskGof.degreesOfFreedom).toBe(0);
    expect(rc.relativeRiskGof.defined).toBe(false);
    expect(Number.isNaN(rc.relativeRiskGof.pValue)).toBe(true);
  });
});
