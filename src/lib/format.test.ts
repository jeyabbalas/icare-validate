import { describe, it, expect } from 'vitest';
import type { GoodnessOfFitTest } from './icareTypes';
import { formatNumber, formatCount, formatPValue, formatRange, formatCi, formatGof } from './format';

describe('formatNumber', () => {
  it('formats to the requested precision', () => {
    expect(formatNumber(0.6002)).toBe('0.600');
    expect(formatNumber(0.12345, 4)).toBe('0.1235');
    expect(formatNumber(7, 0)).toBe('7');
  });
  it('guards non-finite / missing values with an em-dash', () => {
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatCount', () => {
  it('adds thousands separators and rounds', () => {
    expect(formatCount(5285)).toBe('5,285');
    expect(formatCount(1053)).toBe('1,053');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(41871.6)).toBe('41,872'); // weighted Σ frequency rounds
    expect(formatCount(0)).toBe('0');
  });
  it('guards non-finite values', () => {
    expect(formatCount(NaN)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
  });
});

describe('formatPValue', () => {
  it('shows three decimals above the threshold', () => {
    expect(formatPValue(0.691)).toBe('0.691');
    expect(formatPValue(1)).toBe('1.000');
    expect(formatPValue(0.001)).toBe('0.001');
  });
  it('collapses tiny p-values to <0.001', () => {
    expect(formatPValue(0.0009)).toBe('<0.001');
    expect(formatPValue(1e-15)).toBe('<0.001');
    expect(formatPValue(0)).toBe('<0.001');
  });
  it('guards non-finite values', () => {
    expect(formatPValue(NaN)).toBe('—');
    expect(formatPValue(undefined)).toBe('—');
  });
});

describe('formatRange', () => {
  it('joins with an en-dash and trims trailing zeros', () => {
    expect(formatRange(0.1, 12.0, 1)).toBe('0.1–12');
    expect(formatRange(50, 74, 0)).toBe('50–74');
    expect(formatRange(50.0, 74.0, 1)).toBe('50–74'); // integer ages don't grow a ".0"
    expect(formatRange(0.12, 12.94, 1)).toBe('0.1–12.9');
  });
  it('does not strip zeros from a bare integer part', () => {
    expect(formatRange(100, 200, 0)).toBe('100–200');
  });
  it('guards non-finite endpoints', () => {
    expect(formatRange(NaN, 5, 1)).toBe('—–5');
  });
});

describe('formatCi', () => {
  it('prefixes "95% CI" and joins endpoints with an en-dash at the requested precision', () => {
    expect(formatCi(0.9, 1.01)).toBe('95% CI 0.900–1.010');
    expect(formatCi(0.5678, 1.111, 4)).toBe('95% CI 0.5678–1.1110');
  });
  it('guards a non-finite endpoint with an em-dash', () => {
    expect(formatCi(NaN, 1.2)).toBe('95% CI —–1.200');
  });
});

describe('formatGof', () => {
  const gof = (chiSquare: number, degreesOfFreedom: number, pValue: number): GoodnessOfFitTest => ({
    method: 'Hosmer–Lemeshow goodness of fit (GOF) test for Absolute Risk',
    pValue,
    variance: [],
    statistic: { chiSquare },
    parameter: { degreesOfFreedom },
  });

  it('renders χ² / df / p from the nested SDK fields', () => {
    expect(formatGof(gof(7.35, 10, 0.691))).toBe('χ² 7.35 · df 10 · p 0.691');
    expect(formatGof(gof(6.324, 9, 0.7076))).toBe('χ² 6.32 · df 9 · p 0.708');
  });
  it('guards a non-finite statistic', () => {
    expect(formatGof(gof(NaN, 10, NaN))).toBe('χ² — · df 10 · p —');
  });
});
