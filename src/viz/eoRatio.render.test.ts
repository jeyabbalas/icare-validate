// @vitest-environment jsdom
import * as Plot from '@observablehq/plot';
import { describe, it, expect } from 'vitest';
import { buildEoRatio, renderEoRatioChart } from './eoRatio';
import { recomputeCalibration } from '../math/calibrationMath';
import { loadFixture } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// Real-Plot render smoke test: renderEoRatioChart returns a bare <svg> (never an HTML <figure>, which would
// break single-image export) with the title, legend, and goodness-of-fit annotation baked in as text marks.

const norm = normalizeValidationResult(loadFixture('icare-lit-ge50').result);
const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
  scale: 'linear-predictor',
  numberOfPercentiles: 10,
});

describe('renderEoRatioChart', () => {
  it('returns a bare <svg> with the title, legend, and annotation', () => {
    const { points, groups, logBound } = buildEoRatio(rc);
    const svg = renderEoRatioChart(Plot, {
      points,
      groups,
      logBound,
      title: 'Expected / Observed by risk group',
      observedColor: '#e34948',
      annotationLines: ['H–L χ² 23.17 · df 10 · p 0.010'],
      colors: { fg: '#0f172a', muted: '#64748b', surface: '#f8fafc' },
      width: 720,
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    const text = svg.textContent ?? '';
    expect(text).toContain('Expected / Observed by risk group');
    expect(text).toContain('E/O ratio (95% CI)');
    expect(text).toContain('H–L');
  });
});
