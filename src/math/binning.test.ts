import { describe, it, expect } from 'vitest';
import {
  r7Quantile,
  interp,
  weightedTable,
  weightedEcdf,
  quantileEdges,
  cutoffEdges,
  assignBins,
} from './binning';

describe('r7Quantile', () => {
  it('matches numpy linear quantiles on 0..9', () => {
    const s = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r7Quantile(s, 0)).toBe(0);
    expect(r7Quantile(s, 1)).toBe(9);
    expect(r7Quantile(s, 0.5)).toBeCloseTo(4.5, 12);
    expect(r7Quantile(s, 0.1)).toBeCloseTo(0.9, 12);
    expect(r7Quantile(s, 0.25)).toBeCloseTo(2.25, 12);
  });

  it('handles singletons and interpolation', () => {
    expect(r7Quantile([7], 0.3)).toBe(7);
    expect(r7Quantile(Float64Array.from([1, 2, 3, 4]), 0.5)).toBeCloseTo(2.5, 12);
  });
});

describe('interp (np.interp)', () => {
  const xp = [0, 1, 2];
  const fp = [10, 20, 40];
  it('clamps at the ends and hits knots exactly', () => {
    expect(interp(-5, xp, fp)).toBe(10);
    expect(interp(5, xp, fp)).toBe(40);
    expect(interp(0, xp, fp)).toBe(10);
    expect(interp(1, xp, fp)).toBe(20);
    expect(interp(2, xp, fp)).toBe(40);
  });
  it('interpolates linearly between knots', () => {
    expect(interp(0.5, xp, fp)).toBeCloseTo(15, 12);
    expect(interp(1.5, xp, fp)).toBeCloseTo(30, 12);
  });
  it('resolves a tie in xp to the lower knot (the prepended ecdf point)', () => {
    // xp = [0, 0, 1] with a duplicate leading knot → interp(0) picks the first fp
    expect(interp(0, [0, 0, 1], [5, 5, 9])).toBe(5);
  });
});

describe('weightedTable / weightedEcdf', () => {
  it('sorts, collapses duplicate x, sums weights', () => {
    const t = weightedTable([2, 1, 2, 3], [1, 1, 1, 1]);
    expect(Array.from(t.x)).toEqual([1, 2, 3]);
    expect(Array.from(t.w)).toEqual([1, 2, 1]);
  });
  it('drops NaN x / w', () => {
    const t = weightedTable([1, NaN, 2], [1, 1, 1]);
    expect(Array.from(t.x)).toEqual([1, 2]);
  });
  it('builds a normalized ecdf with a prepended (x0, 0) point', () => {
    const e = weightedEcdf([1, 2, 3], [1, 1, 2]); // cumu 1,2,4 → cdf .25,.5,1
    expect(Array.from(e.x)).toEqual([1, 1, 2, 3]);
    expect(Array.from(e.ecdf)).toEqual([0, 0.25, 0.5, 1]);
  });
});

describe('quantileEdges', () => {
  it('cohort (unweighted) → R-7 deciles of 0..9', () => {
    const edges = quantileEdges([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], null, 10);
    expect(edges.length).toBe(11);
    const expected = [0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 6.3, 7.2, 8.1, 9];
    edges.forEach((e, i) => expect(e).toBeCloseTo(expected[i], 8));
  });

  it('nested case-control (weighted i/n ecdf + interp)', () => {
    // x=[1,2,3], w=[1,1,2] → ecdf knots at .25(1) .5(2) 1(3)
    expect(quantileEdges([1, 2, 3], [1, 1, 2], 2)).toEqual([1, 2, 3]);
    // q=4 probs .25 .5 .75 → [1,1,2,2.5,3] with the duplicate leading edge dropped
    expect(quantileEdges([1, 2, 3], [1, 1, 2], 4)).toEqual([1, 2, 2.5, 3]);
  });

  it('drops duplicate edges from tied scores', () => {
    // three distinct values with heavy ties → fewer than q+1 unique edges
    const edges = quantileEdges([1, 1, 1, 1, 2, 2, 3], null, 10);
    // strictly increasing, no duplicates
    for (let i = 1; i < edges.length; i += 1) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });

  it('a constant score collapses to a single zero-width [v,v] bin', () => {
    expect(quantileEdges([5, 5, 5], null, 10)).toEqual([5, 5]);
  });
});

describe('cutoffEdges', () => {
  it('sandwiches interior cutoffs between min and max', () => {
    const { edges, warnings } = cutoffEdges([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [3, 7]);
    expect(edges).toEqual([0, 3, 7, 10]);
    expect(warnings).toHaveLength(0);
  });
  it('sorts unsorted cutoffs', () => {
    expect(cutoffEdges([0, 10], [7, 3]).edges).toEqual([0, 3, 7, 10]);
  });
  it('drops out-of-range and duplicate cutoffs with a warning (never throws)', () => {
    const a = cutoffEdges([0, 10], [-1, 3, 15]);
    expect(a.edges).toEqual([0, 3, 10]);
    expect(a.warnings).toHaveLength(2);
    const b = cutoffEdges([0, 10], [3, 3, 7]);
    expect(b.edges).toEqual([0, 3, 7, 10]);
    expect(b.warnings).toHaveLength(1);
    const c = cutoffEdges([0, 10], [0, 10]); // equal to min/max → both dropped
    expect(c.edges).toEqual([0, 10]);
    expect(c.warnings).toHaveLength(2);
  });
});

describe('assignBins (pd.cut include_lowest)', () => {
  const edges = [0, 3, 7, 10];

  it('bin 0 is closed [e0,e1]; a subject on an interior edge falls to the lower bin', () => {
    const a = assignBins([0, 3, 3.5, 7, 7.5, 10], edges, { dropEmpty: false });
    expect(Array.from(a.binIndex)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(a.nBins).toBe(3);
    expect(a.bins[0].label).toBe('[0, 3]');
    expect(a.bins[1].label).toBe('(3, 7]');
    expect(a.bins[2].label).toBe('(7, 10]');
  });

  it('NaN score → bin -1', () => {
    expect(Array.from(assignBins([1, NaN, 8], edges, { dropEmpty: false }).binIndex)).toEqual([
      0, -1, 2,
    ]);
  });

  it('dropEmpty:false keeps an empty middle bin and counts it', () => {
    const a = assignBins([1, 2, 8, 9], edges, { dropEmpty: false });
    expect(a.nBins).toBe(3);
    expect(a.bins[1].count).toBe(0);
    expect(Array.from(a.binIndex)).toEqual([0, 0, 2, 2]);
  });

  it('dropEmpty:true removes the empty bin and renumbers the survivors', () => {
    const a = assignBins([1, 2, 8, 9], edges, { dropEmpty: true });
    expect(a.nBins).toBe(2);
    expect(a.bins.map((b) => b.label)).toEqual(['[0, 3]', '(7, 10]']);
    expect(Array.from(a.binIndex)).toEqual([0, 0, 1, 1]);
  });

  it('a single zero-width bin holds everyone', () => {
    const a = assignBins([5, 5, 5], [5, 5], { dropEmpty: true });
    expect(a.nBins).toBe(1);
    expect(a.bins[0].count).toBe(3);
    expect(Array.from(a.binIndex)).toEqual([0, 0, 0]);
  });
});
