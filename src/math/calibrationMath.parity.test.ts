import { describe, it, expect } from 'vitest';
import { loadFixture, type FixtureName } from './fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';
import { recomputeCalibration } from './calibrationMath';
import type { GoodnessOfFitTest } from '../lib/icareTypes';

// The Phase-5 correctness anchor: with default deciles on the linear-predictor scale the TypeScript engine
// must reproduce the SDK's own categorySpecificCalibration + calibration for both a cohort (iCARE-Lit) and
// a nested case-control study (BPC3). Parity is against the *live dump* (same runtime), so the only
// expected difference is float-translation error — not the older literature goldens, which drift with the
// vendored numpy/scipy versions.

// NaN/±Inf-aware closeness. On a miss it defers to toBeCloseTo so the failure shows a readable diff.
function expectClose(actual: number, expected: number, abs = 1e-9, rel = 1e-7): void {
  if (Number.isNaN(expected) || Number.isNaN(actual)) {
    expect(Number.isNaN(actual)).toBe(Number.isNaN(expected));
    return;
  }
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    expect(actual).toBe(expected);
    return;
  }
  if (Math.abs(actual - expected) > abs + rel * Math.abs(expected)) {
    expect(actual).toBeCloseTo(expected, 12); // force a readable failure
  }
}

function expectMatrixClose(actual: number[][], expected: number[][], abs = 1e-9, rel = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i].length).toBe(expected[i].length);
    for (let j = 0; j < expected[i].length; j += 1)
      expectClose(actual[i][j], expected[i][j], abs, rel);
  }
}

// Two binnings induce the same partition iff subject→bin is a consistent bijection with subject→label.
function assertSamePartition(binIndex: Int32Array, labels: (string | null)[]): number {
  const binToLabel = new Map<number, string>();
  const labelToBin = new Map<string, number>();
  for (let i = 0; i < labels.length; i += 1) {
    const b = binIndex[i];
    const lab = labels[i];
    expect(b >= 0 && lab != null).toBe(true); // every subject binned by both
    const label = lab as string;
    if (binToLabel.has(b)) expect(binToLabel.get(b)).toBe(label);
    else binToLabel.set(b, label);
    if (labelToBin.has(label)) expect(labelToBin.get(label)).toBe(b);
    else labelToBin.set(label, b);
  }
  return binToLabel.size;
}

const CASES: Array<{ name: FixtureName; ncc: boolean }> = [
  { name: 'icare-lit-ge50', ncc: false },
  { name: 'bpc3-covariate', ncc: true },
];

describe.each(CASES)('LP-scale decile parity — $name', ({ name, ncc }) => {
  const { result, isNcc, numberOfPercentiles } = loadFixture(name);
  const norm = normalizeValidationResult(result);
  const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
    scale: 'linear-predictor',
    numberOfPercentiles,
  });

  it('normalizer agrees on the study type', () => {
    expect(norm.isNcc).toBe(ncc);
    expect(isNcc).toBe(ncc);
  });

  it('reproduces the SDK partition and realized bin count', () => {
    const nBins = assertSamePartition(rc.binIndex, norm.perSubject.linearPredictorsCategory);
    expect(rc.nBins).toBe(nBins);
    expect(rc.nBins).toBe(norm.categoryCalibration.nBins);
  });

  it('reproduces every per-bin calibration column (index-aligned)', () => {
    const cal = norm.categoryCalibration;
    expect(rc.nBins).toBe(cal.nBins);
    for (let b = 0; b < rc.nBins; b += 1) {
      const bin = rc.bins[b];
      expectClose(bin.observedAbsoluteRisk, cal.observedAbsoluteRisk[b]);
      expectClose(bin.predictedAbsoluteRisk, cal.predictedAbsoluteRisk[b]);
      expectClose(bin.lowerCiAbsoluteRisk, cal.lowerCiAbsoluteRisk[b]);
      expectClose(bin.upperCiAbsoluteRisk, cal.upperCiAbsoluteRisk[b]);
      expectClose(bin.observedRelativeRisk, cal.observedRelativeRisk[b]);
      expectClose(bin.predictedRelativeRisk, cal.predictedRelativeRisk[b]);
      expectClose(bin.lowerCiRelativeRisk, cal.lowerCiRelativeRisk[b]);
      expectClose(bin.upperCiRelativeRisk, cal.upperCiRelativeRisk[b]);
      expectClose(bin.expectedByObservedRatio, cal.expectedByObservedRatio[b]);
      expectClose(bin.lowerCiExpectedByObservedRatio, cal.lowerCiExpectedByObservedRatio[b]);
      expectClose(bin.upperCiExpectedByObservedRatio, cal.upperCiExpectedByObservedRatio[b]);
    }
  });

  it('reproduces the Hosmer–Lemeshow (absolute-risk) goodness-of-fit', () => {
    const gof: GoodnessOfFitTest = result.calibration.absoluteRisk;
    expectClose(rc.absoluteRiskGof.chiSquare, gof.statistic.chiSquare, 1e-9, 1e-6);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(gof.parameter.degreesOfFreedom);
    expectClose(rc.absoluteRiskGof.pValue, gof.pValue, 1e-9, 1e-6);
    expectMatrixClose(rc.absoluteRiskGof.variance, gof.variance);
  });

  it('reproduces the relative-risk goodness-of-fit', () => {
    const gof: GoodnessOfFitTest = result.calibration.relativeRisk;
    expectClose(rc.relativeRiskGof.chiSquare, gof.statistic.chiSquare, 1e-9, 1e-6);
    expect(rc.relativeRiskGof.degreesOfFreedom).toBe(gof.parameter.degreesOfFreedom);
    expectClose(rc.relativeRiskGof.pValue, gof.pValue, 1e-9, 1e-6);
    expectMatrixClose(rc.relativeRiskGof.variance, gof.variance);
  });
});
