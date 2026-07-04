import { describe, it, expect } from 'vitest';
import { buildEoRatio } from './eoRatio';
import { recomputeCalibration } from '../math/calibrationMath';
import { loadFixture } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// Pure builder tests over a real committed fixture (iCARE-Lit ge50, cohort): the E/O points mirror the
// engine's per-bin E/O, degenerate bins drop out while their x-axis slot remains (a documented gap), and
// the absolute-risk scale formats the tooltip boundary as a percentage.

const norm = normalizeValidationResult(loadFixture('icare-lit-ge50').result);

describe('buildEoRatio', () => {
  it('one point per non-degenerate bin at default deciles, matching the engine E/O', () => {
    const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });
    const { points, groups, logBound } = buildEoRatio(rc);
    const plottable = rc.bins.filter(
      (b) => !b.degenerate && Number.isFinite(b.expectedByObservedRatio) && b.expectedByObservedRatio > 0,
    );
    expect(points).toHaveLength(plottable.length);
    expect(groups).toEqual(Array.from({ length: rc.nBins }, (_, i) => i + 1));
    expect(logBound).toBeGreaterThanOrEqual(2);
    for (const p of points) {
      const bin = rc.bins[p.index];
      expect(p.eo).toBe(bin.expectedByObservedRatio);
      expect(p.group).toBe(bin.index + 1);
    }
  });

  it('skips a degenerate bin but keeps its x-axis group slot (documented gap)', () => {
    const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });
    const rigged = {
      ...rc,
      bins: rc.bins.map((b, i) => (i === 0 ? { ...b, degenerate: true } : b)),
    };
    const { points, groups } = buildEoRatio(rigged);
    expect(points.some((p) => p.group === 1)).toBe(false);
    expect(groups).toContain(1);
  });

  it('formats the tooltip boundary as a percentage on the absolute-risk scale', () => {
    const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
      scale: 'absolute-risk',
      cutoffs: [0.03],
    });
    const { points, groups } = buildEoRatio(rc);
    expect(groups).toEqual([1, 2]);
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].tip).toContain('%');
    expect(points[0].tip).toContain('E/O:');
  });
});
