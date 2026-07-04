import { describe, it, expect } from 'vitest';
import type { PerSubject } from '../services/resultNormalizer';
import {
  discriminationDensities,
  gaussianKde,
  gaussianKdeBandwidth,
  weightedQuantile,
} from './kde';
import { linspace } from './numeric';

// Trapezoidal integral over a (possibly non-uniform) grid — the "integrates to ≈ 1" oracle.
function trapz(y: ArrayLike<number>, x: ArrayLike<number>): number {
  let a = 0;
  for (let i = 1; i < y.length; i += 1) a += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  return a;
}

describe('gaussianKdeBandwidth — scipy gaussian_kde parity (hand-derived)', () => {
  // values [0,1,2,3], uniform weights: neff=4, unbiased var=5/3, silverman factor=3^(-1/5)=0.802742,
  // h = 0.5 · 0.802742 · √(5/3) = 0.5181677.
  it('unweighted Silverman ×0.5 matches the closed form', () => {
    expect(gaussianKdeBandwidth([0, 1, 2, 3], null)).toBeCloseTo(0.5181677, 6);
  });

  it('Scott ×0.5: factor 4^(-1/5)=0.757858 → h=0.489196', () => {
    expect(gaussianKdeBandwidth([0, 1, 2, 3], null, { bwMethod: 'scott' })).toBeCloseTo(0.4892, 4);
  });

  it('is invariant to a constant weight scale (uniform weights === null)', () => {
    const h0 = gaussianKdeBandwidth([0, 1, 2, 3], null);
    expect(gaussianKdeBandwidth([0, 1, 2, 3], [1, 1, 1, 1])).toBeCloseTo(h0, 12);
    expect(gaussianKdeBandwidth([0, 1, 2, 3], [2, 2, 2, 2])).toBeCloseTo(h0, 12);
  });

  // weights [1,1,1,3]: W=6, neff=3, μ=2, var=2, silverman factor=2.25^(-1/5)=0.850281,
  // h = 0.5 · 0.850281 · √2 = 0.601241.
  it('non-uniform weights follow the weighted closed form', () => {
    expect(gaussianKdeBandwidth([0, 1, 2, 3], [1, 1, 1, 3])).toBeCloseTo(0.60124, 5);
  });

  it('degenerate groups (n<2 or zero variance) get bandwidth 0', () => {
    expect(gaussianKdeBandwidth([], null)).toBe(0);
    expect(gaussianKdeBandwidth([5], null)).toBe(0);
    expect(gaussianKdeBandwidth([2, 2, 2], null)).toBe(0);
  });

  it('bwAdjust scales the bandwidth linearly', () => {
    const half = gaussianKdeBandwidth([0, 1, 2, 3], null, { bwAdjust: 0.5 });
    const full = gaussianKdeBandwidth([0, 1, 2, 3], null, { bwAdjust: 1 });
    expect(full).toBeCloseTo(2 * half, 12);
  });
});

describe('gaussianKde — density properties', () => {
  const grid = linspace(-3, 6, 3001);
  const density = gaussianKde([0, 1, 2, 3], null, grid);

  it('is everywhere non-negative', () => {
    expect(density.every((d) => d >= 0)).toBe(true);
  });

  it('integrates to 1 (a normalized density)', () => {
    expect(trapz(density, grid)).toBeCloseTo(1, 4);
  });

  it('is symmetric about the data mean for symmetric input', () => {
    for (const t of [0.3, 0.7, 1.4]) {
      const [lo, hi] = gaussianKde([0, 1, 2, 3], null, [1.5 - t, 1.5 + t]);
      expect(lo).toBeCloseTo(hi, 10);
    }
  });

  it('a degenerate group evaluates to all zeros', () => {
    expect(Array.from(gaussianKde([5], null, grid)).every((d) => d === 0)).toBe(true);
  });
});

describe('weightedQuantile', () => {
  it('unweighted uses the R-7 quantile', () => {
    expect(weightedQuantile([0.1, 0.2], null, 0.5)).toBeCloseTo(0.15, 12);
    expect(weightedQuantile([0.3, 0.4], null, 0.5)).toBeCloseTo(0.35, 12);
  });

  it('weighted uses the frequency-weighted ecdf', () => {
    // values [0.1,0.2], weights [2,4]: the 0.5 quantile interpolates to 0.125.
    expect(weightedQuantile([0.1, 0.2], [2, 4], 0.5)).toBeCloseTo(0.125, 12);
  });
});

// A minimal PerSubject: discriminationDensities reads only riskEstimates, observedOutcome and (for ncc)
// frequency. Remaining fields are zero-filled. Mirrors calibrationMath.test.ts's factory (freq = 1/sw).
function makePerSubject(fields: {
  risk: number[];
  outcome: number[];
  sw?: number[];
}): PerSubject {
  const n = fields.risk.length;
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
    linearPredictors: zero(),
    linearPredictorsCategory: new Array<string | null>(n).fill(null),
    samplingWeights: sw,
    frequency: freq,
  };
}

describe('discriminationDensities — cohort (unweighted)', () => {
  const ps = makePerSubject({
    risk: [0.02, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.14],
    outcome: [0, 0, 0, 0, 1, 1, 1, 1],
  });
  const d = discriminationDensities(ps, false);

  it('splits by observed_outcome into control (0) and case (1)', () => {
    expect(d.control.n).toBe(4);
    expect(d.case_.n).toBe(4);
    expect(d.control.weightSum).toBe(4); // cohort weight = count
    expect(d.case_.weightSum).toBe(4);
  });

  it('shares one grid and each density integrates to ≈ 1 (equal area)', () => {
    expect(d.control.x).toBe(d.grid);
    expect(d.case_.x).toBe(d.grid);
    expect(trapz(d.control.density, d.grid)).toBeCloseTo(1, 1);
    expect(trapz(d.case_.density, d.grid)).toBeCloseTo(1, 1);
  });

  it('reports weighted medians and an overlap in [0,1]', () => {
    expect(d.control.median).toBeCloseTo(0.045, 12); // R-7 median of [.02,.04,.05,.06] @ idx 1.5 = (.04+.05)/2
    expect(d.case_.median).toBeCloseTo(0.11, 12); // R-7 median of [.08,.1,.12,.14] @ idx 1.5 = (.10+.12)/2
    expect(d.overlap).toBeGreaterThanOrEqual(0);
    expect(d.overlap).toBeLessThanOrEqual(1);
    expect(d.riskMaxDisplay).toBeGreaterThan(d.case_.median);
  });

  it('cases shifted right → the case density peak sits above the control peak', () => {
    const argmax = (a: Float64Array): number => a.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
    expect(d.grid[argmax(d.case_.density)]).toBeGreaterThan(d.grid[argmax(d.control.density)]);
  });
});

describe('discriminationDensities — nested case-control (weighted)', () => {
  const ps = makePerSubject({
    risk: [0.1, 0.2, 0.3, 0.4],
    outcome: [0, 0, 1, 1],
    sw: [0.5, 0.25, 0.5, 0.25], // freq = [2, 4, 2, 4]
  });
  const d = discriminationDensities(ps, true);

  it('weights each group by Σ frequency (the design-effective count)', () => {
    expect(d.isNcc).toBe(true);
    expect(d.control.weightSum).toBeCloseTo(6, 12); // 2 + 4
    expect(d.case_.weightSum).toBeCloseTo(6, 12);
    expect(d.control.n).toBe(2);
  });

  it('uses the frequency-weighted median', () => {
    // controls risk [0.1,0.2] with freq [2,4] → weighted 0.5 quantile = 0.125.
    expect(d.control.median).toBeCloseTo(0.125, 12);
  });

  it('throws on the contract violation of a missing frequency column', () => {
    const cohortShaped = makePerSubject({ risk: [0.1, 0.2], outcome: [0, 1] });
    expect(() => discriminationDensities(cohortShaped, true)).toThrow(/frequency/);
  });
});
