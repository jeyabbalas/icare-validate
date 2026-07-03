import { describe, it, expect } from 'vitest';
import { waldCi, logWaldCi, logGamma, gammpLower, chi2Cdf, chi2SurvivalLossy } from './stats';

describe('Wald CIs', () => {
  it('waldCi is estimate ± 1.96·se', () => {
    const [lo, hi] = waldCi(0.5, 0.1);
    expect(lo).toBeCloseTo(0.304, 12);
    expect(hi).toBeCloseTo(0.696, 12);
  });

  it('logWaldCi exponentiates a log-scale interval', () => {
    const [lo, hi] = logWaldCi(1, 0.1);
    expect(lo).toBeCloseTo(Math.exp(-0.196), 12);
    expect(hi).toBeCloseTo(Math.exp(0.196), 12);
  });
});

describe('logGamma', () => {
  it('matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10); // Γ(1)=1
    expect(logGamma(2)).toBeCloseTo(0, 10); // Γ(2)=1
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10); // Γ(5)=4!
    expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 10); // Γ(1/2)=√π
    expect(logGamma(10)).toBeCloseTo(Math.log(362880), 9); // Γ(10)=9!
  });
});

describe('gammpLower / chi2Cdf', () => {
  // Closed form: chi2Cdf(x, 2) = 1 − exp(−x/2). Exercises both the series (x<a+1) and CF (x>a+1) regions.
  it('matches the df=2 closed form in the series region', () => {
    expect(chi2Cdf(2, 2)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(chi2Cdf(1, 2)).toBeCloseTo(1 - Math.exp(-0.5), 12);
  });

  it('matches the df=2 closed form in the continued-fraction region', () => {
    expect(chi2Cdf(10, 2)).toBeCloseTo(1 - Math.exp(-5), 12);
    expect(chi2Cdf(20, 2)).toBeCloseTo(1 - Math.exp(-10), 12);
  });

  it('matches textbook chi-square critical points', () => {
    expect(chi2Cdf(3.841459, 1)).toBeCloseTo(0.95, 5); // 1.96² → 0.95 for df=1
    expect(chi2Cdf(9.487729, 4)).toBeCloseTo(0.95, 5);
    expect(chi2Cdf(11.070498, 5)).toBeCloseTo(0.95, 5);
  });

  it('gammpLower boundary behaviour', () => {
    expect(gammpLower(3, 0)).toBe(0);
    expect(Number.isNaN(gammpLower(0, 1))).toBe(true);
    expect(Number.isNaN(gammpLower(3, -1))).toBe(true);
  });
});

describe('chi2SurvivalLossy', () => {
  it('is 1 − cdf', () => {
    expect(chi2SurvivalLossy(2, 2)).toBeCloseTo(Math.exp(-1), 12);
    expect(chi2SurvivalLossy(10, 2)).toBeCloseTo(Math.exp(-5), 12);
  });

  it('NaN when df < 1 (single-bin RR GOF has df 0)', () => {
    expect(Number.isNaN(chi2SurvivalLossy(5, 0))).toBe(true);
    expect(Number.isNaN(chi2Cdf(5, 0))).toBe(true);
  });
});
