// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import { buildRoc, renderRocChart, type RocAuc } from './roc';
import { rocCurve } from '../math/roc';
import type { PerSubject } from '../services/resultNormalizer';
import { svgToString } from '../lib/figureExport';

// End-to-end render against the real Observable Plot library, to catch any Plot-API misuse (the area-under-
// curve fill, the chance diagonal, the Youden guide/marker, the baked title/annotation text marks, the
// pointer tip) the pure-builder unit tests can't. Plot measures text via getBBox for auto-layout, which
// jsdom omits; stub a zero box so the render completes.
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as {
    getBBox?: () => { x: number; y: number; width: number; height: number };
    getComputedTextLength?: () => number;
  };
  if (typeof proto.getBBox !== 'function') proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (typeof proto.getComputedTextLength !== 'function') proto.getComputedTextLength = () => 0;
});

function makePerSubject(score: number[], outcome: number[]): PerSubject {
  const n = score.length;
  const zero = (): Float64Array => new Float64Array(n);
  return {
    n,
    observedOutcome: Float64Array.from(outcome),
    studyEntryAge: zero(),
    studyExitAge: zero(),
    timeOfOnset: zero(),
    observedFollowup: zero(),
    predictedRiskInterval: zero(),
    followup: zero(),
    riskEstimates: zero(),
    linearPredictors: Float64Array.from(score),
    linearPredictorsCategory: new Array<string | null>(n).fill(null),
    samplingWeights: null,
    frequency: null,
  };
}

const AUC: RocAuc = { auc: 0.6, lowerCi: 0.55, upperCi: 0.65 };

describe('renderRocChart (real Plot)', () => {
  // Cases score higher on average → an interior Youden point exists.
  const ps = makePerSubject([6, 5, 4, 3, 2, 1], [1, 1, 0, 1, 0, 0]);
  const data = buildRoc(rocCurve(ps, false), AUC);
  const baseOpts = {
    data,
    title: 'Discrimination: ROC curve',
    curveColor: '#e34948',
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 480,
  };

  it('returns a bare square <svg> with the area, diagonal, curve, and Youden dot', () => {
    const svg = renderRocChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('width')).toBe(String(svg.getAttribute('height'))); // square frame
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(3); // area + diagonal + curve + guide
    expect(svg.querySelector('circle')).not.toBeNull(); // the Youden marker dot
    expect(svg.style.color).not.toBe(''); // drives currentColor for dark-mode export
  });

  it('bakes the title, both axis labels, and the AUC + Youden annotation into the export', () => {
    const xml = svgToString(renderRocChart(Plot, baseOpts));
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Discrimination: ROC curve');
    expect(xml).toContain('False-positive rate');
    expect(xml).toContain('True-positive rate (sensitivity)');
    expect(xml).toContain('AUC 0.600');
    expect(xml).toContain('Youden');
  });

  it('renders a degenerate (single-class) curve without a Youden marker and without throwing', () => {
    const allCases = buildRoc(rocCurve(makePerSubject([3, 2, 1], [1, 1, 1]), false), AUC);
    const svg = renderRocChart(Plot, { ...baseOpts, data: allCases });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.querySelector('circle')).toBeNull(); // no Youden dot for a degenerate curve
  });
});
