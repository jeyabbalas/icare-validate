import { describe, it, expect } from 'vitest';
import { buildAbsoluteRiskCalibration } from './absoluteRiskCalibration';
import type { CalibrationBin, RecomputedCalibration } from '../math/calibrationMath';
import { recomputeCalibration } from '../math/calibrationMath';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// Two tiers, matching the incidence chart: pure builder unit tests (scaling, CI clamp, degenerate/NaN
// dropping, domain, tooltip strings) here, plus a render test against the real Plot lib in the sibling
// file. The fixture-driven block is the Phase-8 correctness anchor: the builder's points reproduce the
// SDK's default-decile absolute-risk calibration (via the parity-tested recompute engine), ×100.

/** A non-degenerate bin with sensible defaults; override just what a case cares about. */
function bin(overrides: Partial<CalibrationBin> = {}): CalibrationBin {
  return {
    index: 0,
    label: '(-1, 0]',
    lo: -1,
    hi: 0,
    n: 100,
    weight: 100,
    nCases: 5,
    weightedCases: 5,
    observedAbsoluteRisk: 0.05,
    predictedAbsoluteRisk: 0.048,
    varianceAbsoluteRisk: 0.0001,
    lowerCiAbsoluteRisk: 0.03,
    upperCiAbsoluteRisk: 0.07,
    observedRelativeRisk: 1,
    predictedRelativeRisk: 1,
    lowerCiRelativeRisk: 0.8,
    upperCiRelativeRisk: 1.2,
    expectedByObservedRatio: 0.96,
    lowerCiExpectedByObservedRatio: 0.6,
    upperCiExpectedByObservedRatio: 1.5,
    degenerate: false,
    ...overrides,
  };
}

function rcOf(bins: CalibrationBin[]): RecomputedCalibration {
  return { nBins: bins.length, bins } as unknown as RecomputedCalibration;
}

describe('buildAbsoluteRiskCalibration', () => {
  it('scales absolute risks to percent and keeps bin order', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([
        bin({ index: 0, predictedAbsoluteRisk: 0.01, observedAbsoluteRisk: 0.012 }),
        bin({ index: 1, predictedAbsoluteRisk: 0.05, observedAbsoluteRisk: 0.048 }),
      ]),
    );
    expect(points).toHaveLength(2);
    expect(points[0].predPct).toBeCloseTo(1, 10);
    expect(points[0].obsPct).toBeCloseTo(1.2, 10);
    expect(points[1].predPct).toBeCloseTo(5, 10);
    expect(points[0].group).toBe(1);
    expect(points[1].group).toBe(2);
  });

  it('clamps a negative lower CI to 0 for the whisker', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([bin({ lowerCiAbsoluteRisk: -0.01, upperCiAbsoluteRisk: 0.06 })]),
    );
    expect(points[0].loPct).toBe(0);
    expect(points[0].hiPct).toBeCloseTo(6, 10);
  });

  it('drops degenerate bins', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([bin({ index: 0 }), bin({ index: 1, degenerate: true })]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(0);
  });

  it('drops a bin with a non-finite observed or predicted risk', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([
        bin({ index: 0, observedAbsoluteRisk: NaN }),
        bin({ index: 1, predictedAbsoluteRisk: NaN }),
        bin({ index: 2 }),
      ]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(2);
  });

  it('leaves loPct/hiPct NaN when the CI is undefined', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([bin({ lowerCiAbsoluteRisk: NaN, upperCiAbsoluteRisk: NaN })]),
    );
    expect(Number.isNaN(points[0].loPct)).toBe(true);
    expect(Number.isNaN(points[0].hiPct)).toBe(true);
  });

  it('sets domainMax from the largest predicted/observed/upper-CI, rounded up nicely', () => {
    // upper CI (9%) is the largest value → niceCeil(9) === 10.
    const { domainMax } = buildAbsoluteRiskCalibration(
      rcOf([bin({ predictedAbsoluteRisk: 0.04, observedAbsoluteRisk: 0.05, upperCiAbsoluteRisk: 0.09 })]),
    );
    expect(domainMax).toBe(10);
  });

  it('builds a per-bin tooltip carrying that group’s stats', () => {
    const { points } = buildAbsoluteRiskCalibration(
      rcOf([bin({ index: 6, n: 512, predictedAbsoluteRisk: 0.031, observedAbsoluteRisk: 0.034 })]),
    );
    const tip = points[0].tip;
    expect(tip).toContain('Group 7 of 1');
    expect(tip).toContain('N = 512');
    expect(tip).toContain('Predicted: 3.10%');
    expect(tip).toContain('Observed: 3.40%');
    expect(tip).toContain('E/O:');
  });

  it('returns an empty result (domainMax ≥ 1) when every bin is degenerate', () => {
    const { points, domainMax } = buildAbsoluteRiskCalibration(
      rcOf([bin({ degenerate: true }), bin({ degenerate: true })]),
    );
    expect(points).toHaveLength(0);
    expect(domainMax).toBe(1);
  });
});

// Correctness anchor: the recompute engine at the default deciles reproduces the SDK category table
// (calibrationMath.parity.test.ts); here we confirm the builder faithfully carries those absolute-risk
// columns onto the plot, scaled to percent with the lower CI clamped.
const CASES: FixtureName[] = ['icare-lit-ge50', 'bpc3-covariate'];

describe.each(CASES)('buildAbsoluteRiskCalibration — matches SDK default bins (%s)', (name) => {
  const { result, numberOfPercentiles } = loadFixture(name);
  const norm = normalizeValidationResult(result);
  const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
    scale: 'linear-predictor',
    numberOfPercentiles,
  });
  const { points } = buildAbsoluteRiskCalibration(rc);
  const cal = norm.categoryCalibration;

  it('produces one point per (non-degenerate) SDK bin, in order', () => {
    expect(points).toHaveLength(cal.nBins);
    points.forEach((p, i) => expect(p.index).toBe(i));
  });

  it('reproduces each bin’s predicted / observed / CI as percent (lower clamped ≥ 0)', () => {
    points.forEach((p, i) => {
      expect(p.predPct).toBeCloseTo(cal.predictedAbsoluteRisk[i] * 100, 6);
      expect(p.obsPct).toBeCloseTo(cal.observedAbsoluteRisk[i] * 100, 6);
      expect(p.hiPct).toBeCloseTo(cal.upperCiAbsoluteRisk[i] * 100, 6);
      expect(p.loPct).toBeCloseTo(Math.max(cal.lowerCiAbsoluteRisk[i], 0) * 100, 6);
      expect(p.loPct).toBeGreaterThanOrEqual(0);
    });
  });
});
