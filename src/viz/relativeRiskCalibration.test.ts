import { describe, it, expect } from 'vitest';
import { buildRelativeRiskCalibration } from './relativeRiskCalibration';
import type { CalibrationBin, RecomputedCalibration } from '../math/calibrationMath';
import { recomputeCalibration } from '../math/calibrationMath';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// Mirrors absoluteRiskCalibration.test.ts: pure builder unit tests (RR pass-through with NO ×100 / NO clamp,
// degenerate/non-finite/non-positive dropping, the symmetric linear+log domains, tooltip strings) here, plus
// a render test against the real Plot lib in the sibling file. The fixture-driven block is the Phase-9
// correctness anchor: the builder's points reproduce the SDK's default-decile RELATIVE-risk calibration (via
// the parity-tested recompute engine), as raw ratios.

/** A non-degenerate bin with sensible defaults; override just what a case cares about. */
function bin(overrides: Partial<CalibrationBin> = {}): CalibrationBin {
  return {
    index: 0,
    label: '(-1, 0]',
    lo: -1,
    hi: 0,
    n: 100,
    weight: 100,
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

describe('buildRelativeRiskCalibration', () => {
  it('carries relative risks onto x/y as raw ratios (no ×100) and keeps bin order', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([
        bin({ index: 0, predictedRelativeRisk: 0.6, observedRelativeRisk: 0.55 }),
        bin({ index: 1, predictedRelativeRisk: 1.8, observedRelativeRisk: 2.1 }),
      ]),
    );
    expect(points).toHaveLength(2);
    expect(points[0].predRr).toBeCloseTo(0.6, 10);
    expect(points[0].obsRr).toBeCloseTo(0.55, 10);
    expect(points[1].predRr).toBeCloseTo(1.8, 10);
    expect(points[0].group).toBe(1);
    expect(points[1].group).toBe(2);
    expect(points[0].index).toBe(0);
  });

  it('passes the log-Wald CI through verbatim (no zero-clamp, unlike absolute risk)', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([
        bin({ observedRelativeRisk: 0.3, lowerCiRelativeRisk: 0.05, upperCiRelativeRisk: 0.9 }),
      ]),
    );
    expect(points[0].obsRr).toBeCloseTo(0.3, 10);
    expect(points[0].loRr).toBeCloseTo(0.05, 10);
    expect(points[0].hiRr).toBeCloseTo(0.9, 10);
  });

  it('drops degenerate bins', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([bin({ index: 0 }), bin({ index: 1, degenerate: true })]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(0);
  });

  it('drops a bin with a non-finite predicted or observed RR', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([
        bin({ index: 0, observedRelativeRisk: NaN }),
        bin({ index: 1, predictedRelativeRisk: NaN }),
        bin({ index: 2 }),
      ]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(2);
  });

  it('drops a bin with a non-positive RR (a log axis needs strictly positive coordinates)', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([
        bin({ index: 0, observedRelativeRisk: 0 }),
        bin({ index: 1, predictedRelativeRisk: -1 }),
        bin({ index: 2 }),
      ]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].index).toBe(2);
  });

  it('leaves loRr/hiRr NaN when the CI is undefined', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([bin({ lowerCiRelativeRisk: NaN, upperCiRelativeRisk: NaN })]),
    );
    expect(Number.isNaN(points[0].loRr)).toBe(true);
    expect(Number.isNaN(points[0].hiRr)).toBe(true);
  });

  it('sets the linear top and the symmetric log bound from the largest value / distance-from-1', () => {
    // upper CI 4.2 is the largest value → niceCeil(4.2) === 5 for both bounds.
    const { linearMax, logBound } = buildRelativeRiskCalibration(
      rcOf([bin({ predictedRelativeRisk: 1.5, observedRelativeRisk: 2, upperCiRelativeRisk: 4.2 })]),
    );
    expect(linearMax).toBe(5);
    expect(logBound).toBe(5);
    expect(1 / logBound).toBeCloseTo(0.2, 10); // symmetric log domain [0.2, 5]
  });

  it('floors both domains at 2 for a tight, well-calibrated cluster near 1', () => {
    const { linearMax, logBound } = buildRelativeRiskCalibration(
      rcOf([
        bin({ predictedRelativeRisk: 0.85, observedRelativeRisk: 1.2, lowerCiRelativeRisk: 0.7, upperCiRelativeRisk: 1.4 }),
      ]),
    );
    expect(linearMax).toBe(2);
    expect(logBound).toBe(2);
  });

  it('widens the log bound when a low decile dominates the distance from 1', () => {
    // observed RR 0.25 is 4× away from 1 → niceCeil(4) === 5.
    const { logBound } = buildRelativeRiskCalibration(
      rcOf([bin({ observedRelativeRisk: 0.25, predictedRelativeRisk: 1, lowerCiRelativeRisk: NaN, upperCiRelativeRisk: NaN })]),
    );
    expect(logBound).toBe(5);
  });

  it('returns an empty result with floored domains when every bin is degenerate', () => {
    const { points, linearMax, logBound } = buildRelativeRiskCalibration(
      rcOf([bin({ degenerate: true }), bin({ degenerate: true })]),
    );
    expect(points).toHaveLength(0);
    expect(linearMax).toBe(2);
    expect(logBound).toBe(2);
  });

  it('handles a single-bin RR≡1 study (both normalize to 1) without collapsing the domain', () => {
    const { points, linearMax, logBound } = buildRelativeRiskCalibration(
      rcOf([
        bin({ observedRelativeRisk: 1, predictedRelativeRisk: 1, lowerCiRelativeRisk: 1, upperCiRelativeRisk: 1 }),
      ]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].predRr).toBe(1);
    expect(points[0].obsRr).toBe(1);
    expect(linearMax).toBe(2);
    expect(logBound).toBe(2);
  });

  it('builds a per-bin tooltip carrying the group’s risk-score interval + stats', () => {
    const { points } = buildRelativeRiskCalibration(
      rcOf([
        bin({
          index: 6,
          label: '(0.5678, 1.111]',
          n: 512,
          predictedRelativeRisk: 1.23,
          observedRelativeRisk: 1.45,
          lowerCiRelativeRisk: 1.12,
          upperCiRelativeRisk: 1.88,
        }),
      ]),
    );
    const tip = points[0].tip;
    expect(tip).toContain('Group 7 of');
    expect(tip).toContain('risk score (0.5678, 1.111]');
    expect(tip).toContain('N = 512');
    expect(tip).toContain('Predicted RR: 1.23');
    expect(tip).toContain('Observed RR: 1.45');
    expect(tip).toContain('E/O:');
  });
});

// Correctness anchor: the recompute engine at the default deciles reproduces the SDK category table
// (calibrationMath.parity.test.ts); here we confirm the builder faithfully carries those RELATIVE-risk
// columns onto the plot as raw ratios, with the log-Wald CI unclamped.
const CASES: FixtureName[] = ['icare-lit-ge50', 'bpc3-covariate'];

describe.each(CASES)('buildRelativeRiskCalibration — matches SDK default bins (%s)', (name) => {
  const { result, numberOfPercentiles } = loadFixture(name);
  const norm = normalizeValidationResult(result);
  const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
    scale: 'linear-predictor',
    numberOfPercentiles,
  });
  const { points } = buildRelativeRiskCalibration(rc);
  const cal = norm.categoryCalibration;

  it('produces one point per (non-degenerate) SDK bin, in order', () => {
    expect(points).toHaveLength(cal.nBins);
    points.forEach((p, i) => expect(p.index).toBe(i));
  });

  it('reproduces each bin’s predicted / observed / CI relative risk (raw ratios, unclamped)', () => {
    points.forEach((p, i) => {
      expect(p.predRr).toBeCloseTo(cal.predictedRelativeRisk[i], 6);
      expect(p.obsRr).toBeCloseTo(cal.observedRelativeRisk[i], 6);
      expect(p.loRr).toBeCloseTo(cal.lowerCiRelativeRisk[i], 6);
      expect(p.hiRr).toBeCloseTo(cal.upperCiRelativeRisk[i], 6);
      // Log-friendly: the whisker stays strictly positive and brackets the observed point.
      expect(p.loRr).toBeGreaterThan(0);
      expect(p.loRr).toBeLessThanOrEqual(p.obsRr);
      expect(p.obsRr).toBeLessThanOrEqual(p.hiRr);
    });
  });
});
