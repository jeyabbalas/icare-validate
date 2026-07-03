import { describe, it, expect } from 'vitest';
import { sumKahan, cumsumKahan, mean, weightedMean, linspace } from './numeric';

describe('sumKahan', () => {
  it('sums exactly on simple input', () => {
    expect(sumKahan([1, 2, 3, 4])).toBe(10);
  });

  it('resists drift a naive sum accrues (0.1 × 10 = 1)', () => {
    const naive = Array(10)
      .fill(0.1)
      .reduce((a, b) => a + b, 0);
    expect(naive).not.toBe(1); // naive drifts
    expect(sumKahan(Array(10).fill(0.1))).toBe(1); // compensated recovers it
  });

  it('returns 0 for an empty input', () => {
    expect(sumKahan([])).toBe(0);
  });
});

describe('cumsumKahan', () => {
  it('produces running sums whose last entry equals the total', () => {
    const cs = cumsumKahan([1, 2, 3, 4]);
    expect(Array.from(cs)).toEqual([1, 3, 6, 10]);
    expect(cs[cs.length - 1]).toBe(sumKahan([1, 2, 3, 4]));
  });
});

describe('mean / weightedMean', () => {
  it('mean averages, NaN on empty', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('weightedMean weights by w', () => {
    expect(weightedMean([1, 2, 3], [1, 1, 1])).toBeCloseTo(2, 12);
    expect(weightedMean([0, 1], [1, 3])).toBeCloseTo(0.75, 12);
    expect(weightedMean([10, 20], [3, 1])).toBeCloseTo(12.5, 12);
  });

  it('weightedMean is NaN when weights sum to zero', () => {
    expect(Number.isNaN(weightedMean([1, 2], [0, 0]))).toBe(true);
  });
});

describe('linspace (numpy-faithful)', () => {
  it('spans [0,1] in q+1 points with forced endpoints', () => {
    const p = linspace(0, 1, 11);
    expect(p.length).toBe(11);
    expect(p[0]).toBe(0);
    expect(p[10]).toBe(1);
    expect(p[5]).toBeCloseTo(0.5, 15);
  });

  it('uses i·step (not decimal literals) — matches numpy bit patterns', () => {
    const p = linspace(0, 1, 11);
    const step = 1 / 10;
    for (let i = 0; i < 10; i += 1) expect(p[i]).toBe(i * step);
    // numpy linspace(0,1,11)[3] is 0.30000000000000004, i.e. 3 * (1/10), NOT the literal 0.3
    expect(p[3]).toBe(0.30000000000000004);
  });

  it('num === 1 returns [start]', () => {
    expect(Array.from(linspace(0, 1, 1))).toEqual([0]);
  });
});
