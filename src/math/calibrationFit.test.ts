import { describe, it, expect } from 'vitest';
import { weightedLinearFit, type WlsPoint } from './calibrationFit';

describe('weightedLinearFit', () => {
  it('fits a perfect line (slope 1, intercept 0) through y = x points, whatever the weights', () => {
    const pts: WlsPoint[] = [
      { x: 1, y: 1, w: 1 },
      { x: 2, y: 2, w: 5 },
      { x: 3, y: 3, w: 0.2 },
    ];
    const fit = weightedLinearFit(pts);
    expect(fit.defined).toBe(true);
    expect(fit.nPoints).toBe(3);
    expect(fit.slope).toBeCloseTo(1, 10);
    expect(fit.intercept).toBeCloseTo(0, 10);
  });

  it('recovers a known line y = 2x + 1 (weights irrelevant on collinear points)', () => {
    const pts: WlsPoint[] = [
      { x: 0, y: 1, w: 3 },
      { x: 1, y: 3, w: 1 },
      { x: 4, y: 9, w: 7 },
    ];
    const fit = weightedLinearFit(pts);
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
  });

  it('equals ordinary least squares when all weights are equal', () => {
    // (0,0),(1,0),(2,2): x̄=1, ȳ=2/3; Sxy = 2, Sxx = 2 → slope 1, intercept ȳ − slope·x̄ = −1/3.
    const pts: WlsPoint[] = [
      { x: 0, y: 0, w: 1 },
      { x: 1, y: 0, w: 1 },
      { x: 2, y: 2, w: 1 },
    ];
    const fit = weightedLinearFit(pts);
    expect(fit.slope).toBeCloseTo(1, 10);
    expect(fit.intercept).toBeCloseTo(-1 / 3, 10);
  });

  it('lets heavily-weighted points dominate the line', () => {
    // Endpoints on y = x carry ~all the weight; a wildly off-line middle point (tiny weight) barely moves it.
    const pts: WlsPoint[] = [
      { x: 0, y: 0, w: 1e6 },
      { x: 1, y: 5, w: 1e-6 },
      { x: 2, y: 2, w: 1e6 },
    ];
    const fit = weightedLinearFit(pts);
    expect(fit.slope).toBeCloseTo(1, 4);
    expect(fit.intercept).toBeCloseTo(0, 4);
  });

  it('inverse-variance weighting pulls the slope toward the precise points', () => {
    const base: WlsPoint[] = [
      { x: 1, y: 1, w: 1 },
      { x: 2, y: 2, w: 1 },
      { x: 3, y: 3, w: 1 },
    ];
    const heavyOutlier = weightedLinearFit([...base, { x: 4, y: 1, w: 100 }]);
    const lightOutlier = weightedLinearFit([...base, { x: 4, y: 1, w: 0.01 }]);
    // A high-weight (low-variance) outlier drags the slope down far more than a low-weight one.
    expect(heavyOutlier.slope).toBeLessThan(lightOutlier.slope);
    expect(lightOutlier.slope).toBeCloseTo(1, 1);
  });

  it('is undefined with fewer than two usable points', () => {
    expect(weightedLinearFit([]).defined).toBe(false);
    const one = weightedLinearFit([{ x: 1, y: 1, w: 1 }]);
    expect(one.defined).toBe(false);
    expect(Number.isNaN(one.slope)).toBe(true);
    expect(one.nPoints).toBe(1);
  });

  it('is undefined for coincident x (a vertical, non-identifiable system)', () => {
    const fit = weightedLinearFit([
      { x: 2, y: 1, w: 1 },
      { x: 2, y: 5, w: 1 },
      { x: 2, y: 9, w: 3 },
    ]);
    expect(fit.defined).toBe(false);
    expect(Number.isNaN(fit.slope)).toBe(true);
  });

  it('drops points with non-finite coordinates or non-finite / ≤ 0 weights', () => {
    const pts: WlsPoint[] = [
      { x: 1, y: 1, w: 1 },
      { x: 2, y: 2, w: 1 },
      { x: NaN, y: 3, w: 1 }, // bad x
      { x: 4, y: Infinity, w: 1 }, // bad y
      { x: 5, y: 5, w: 0 }, // zero weight
      { x: 6, y: 6, w: -2 }, // negative weight
      { x: 7, y: 7, w: NaN }, // non-finite weight
    ];
    const fit = weightedLinearFit(pts);
    expect(fit.nPoints).toBe(2); // only the first two survive the filter
    expect(fit.defined).toBe(true);
    expect(fit.slope).toBeCloseTo(1, 10);
    expect(fit.intercept).toBeCloseTo(0, 10);
  });
});
