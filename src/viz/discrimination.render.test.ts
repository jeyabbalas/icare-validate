// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import { buildDiscrimination, renderDiscriminationChart, type DiscriminationAuc } from './discrimination';
import { discriminationDensities } from '../math/kde';
import type { PerSubject } from '../services/resultNormalizer';
import { svgToString } from '../lib/figureExport';

// End-to-end render against the real Observable Plot library, to catch any misuse of the Plot API (the
// filled areaY densities, the lineY outlines, the median ruleX marks, the baked title/legend/annotation
// text marks, the pointer tip) that the pure-builder unit tests can't. Plot measures text via getBBox for
// auto-layout, which jsdom omits; stub a zero box so the render completes.
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as {
    getBBox?: () => { x: number; y: number; width: number; height: number };
    getComputedTextLength?: () => number;
  };
  if (typeof proto.getBBox !== 'function') proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (typeof proto.getComputedTextLength !== 'function') proto.getComputedTextLength = () => 0;
});

function makePerSubject(risk: number[], outcome: number[]): PerSubject {
  const n = risk.length;
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
    riskEstimates: Float64Array.from(risk),
    linearPredictors: zero(),
    linearPredictorsCategory: new Array<string | null>(n).fill(null),
    samplingWeights: null,
    frequency: null,
  };
}

const AUC: DiscriminationAuc = { auc: 0.6, lowerCi: 0.55, upperCi: 0.65 };

describe('renderDiscriminationChart (real Plot)', () => {
  const ps = makePerSubject(
    [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
  );
  const data = buildDiscrimination(discriminationDensities(ps, false), AUC);
  const baseOpts = {
    data,
    title: 'Discrimination: predicted-risk distribution',
    caseColor: '#e34948',
    controlColor: '#2a78d6',
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 640,
  };

  it('returns a bare <svg> with filled densities, outlines, and median rules', () => {
    const svg = renderDiscriminationChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2); // areas + lines
    expect(svg.querySelector('line')).not.toBeNull(); // the median ruleX marks
    expect(svg.style.color).not.toBe(''); // drives currentColor for dark-mode export
  });

  it('bakes the title, both legend entries, and the AUC + overlap annotation into the export', () => {
    const xml = svgToString(renderDiscriminationChart(Plot, baseOpts));
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Discrimination: predicted-risk distribution');
    expect(xml).toContain('Cases · n = 6');
    expect(xml).toContain('Controls · n = 6');
    expect(xml).toContain('AUC 0.600');
    expect(xml).toContain('Distribution overlap');
    expect(xml).toContain('Predicted absolute risk (%)');
    expect(xml).toContain('Density');
  });

  it('omits a median rule for an empty group without throwing', () => {
    const emptyCase = buildDiscrimination(
      discriminationDensities(makePerSubject([0.01, 0.02, 0.03], [0, 0, 0]), false),
      AUC,
    );
    const svg = renderDiscriminationChart(Plot, { ...baseOpts, data: emptyCase });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });
});
