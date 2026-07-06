// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import {
  buildAbsoluteRiskCalibration,
  renderAbsoluteRiskCalibrationChart,
} from './absoluteRiskCalibration';
import type { CalibrationBin, RecomputedCalibration } from '../math/calibrationMath';
import { svgToString } from '../lib/figureExport';

// End-to-end render against the real Observable Plot library, to catch any misuse of the Plot API (the
// identity line, the CI whiskers via ruleX, the dots, the baked title/legend/annotation text marks, the
// pointer tip, the equal-aspect square scales) that the pure-builder unit tests can't. Plot measures text
// via getBBox for auto-layout, which jsdom omits; stub a zero box so the render completes. Geometry isn't
// asserted — only that we get a bare <svg> whose export carries the title, legend, and stats annotation.
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as {
    getBBox?: () => { x: number; y: number; width: number; height: number };
    getComputedTextLength?: () => number;
  };
  if (typeof proto.getBBox !== 'function') {
    proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  }
  if (typeof proto.getComputedTextLength !== 'function') {
    proto.getComputedTextLength = () => 0;
  }
});

function bin(overrides: Partial<CalibrationBin> = {}): CalibrationBin {
  return {
    index: 0,
    label: '(-1, 0]',
    lo: -1,
    hi: 0,
    n: 100,
    weight: 100,
    nCases: 5,
    weightedCases: 5,
    observedAbsoluteRisk: 0.05,
    predictedAbsoluteRisk: 0.048,
    varianceAbsoluteRisk: 0.0001,
    lowerCiAbsoluteRisk: 0.03,
    upperCiAbsoluteRisk: 0.07,
    observedRelativeRisk: 1,
    predictedRelativeRisk: 1,
    lowerCiRelativeRisk: 0.8,
    upperCiRelativeRisk: 1.2,
    expectedByObservedRatio: 0.96,
    lowerCiExpectedByObservedRatio: 0.6,
    upperCiExpectedByObservedRatio: 1.5,
    degenerate: false,
    ...overrides,
  };
}

function rcOf(bins: CalibrationBin[]): RecomputedCalibration {
  return { nBins: bins.length, bins } as unknown as RecomputedCalibration;
}

describe('renderAbsoluteRiskCalibrationChart (real Plot)', () => {
  const rc = rcOf([
    bin({ index: 0, predictedAbsoluteRisk: 0.005, observedAbsoluteRisk: 0.006, lowerCiAbsoluteRisk: 0.001, upperCiAbsoluteRisk: 0.012 }),
    bin({ index: 1, predictedAbsoluteRisk: 0.02, observedAbsoluteRisk: 0.018, lowerCiAbsoluteRisk: -0.005, upperCiAbsoluteRisk: 0.04 }),
    bin({ index: 2, predictedAbsoluteRisk: 0.06, observedAbsoluteRisk: 0.07, lowerCiAbsoluteRisk: 0.04, upperCiAbsoluteRisk: 0.1 }),
  ]);
  const { points, domainMax } = buildAbsoluteRiskCalibration(rc);

  const baseOpts = {
    points,
    domainMax,
    title: 'Absolute-risk calibration',
    observedColor: '#e34948',
    annotationLines: ['E/O 0.95', 'H–L χ² 7.4 · df 10 · p 0.690'],
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 480,
  };

  it('returns a bare <svg> with markers, an identity line, and CI whiskers', () => {
    const svg = renderAbsoluteRiskCalibrationChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('circle')).not.toBeNull(); // the dot markers
    expect(svg.querySelector('path')).not.toBeNull(); // the identity line
    expect(svg.querySelector('line')).not.toBeNull(); // the CI whiskers (ruleX)
    // style.color drives currentColor so exported axes/text aren't black in dark mode.
    expect(svg.style.color).not.toBe('');
  });

  it('bakes the title, both legend entries, and the goodness-of-fit annotation into the export', () => {
    const svg = renderAbsoluteRiskCalibrationChart(Plot, baseOpts);
    const xml = svgToString(svg);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Absolute-risk calibration');
    expect(xml).toContain('Observed abs. risk (95% CI)');
    expect(xml).toContain('Perfect calibration (y = x)');
    expect(xml).toContain('E/O 0.95');
    expect(xml).toContain('Predicted absolute risk (%)');
    expect(xml).toContain('Observed absolute risk (%)');
  });

  it('renders without CI whiskers when no bin has a defined interval', () => {
    const noCi = buildAbsoluteRiskCalibration(
      rcOf([bin({ lowerCiAbsoluteRisk: NaN, upperCiAbsoluteRisk: NaN })]),
    );
    const svg = renderAbsoluteRiskCalibrationChart(Plot, {
      ...baseOpts,
      points: noCi.points,
      domainMax: noCi.domainMax,
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.querySelector('circle')).not.toBeNull();
  });
});

describe('renderAbsoluteRiskCalibrationChart — fitted-line overlay', () => {
  const rc = rcOf([
    bin({ index: 0, predictedAbsoluteRisk: 0.01, observedAbsoluteRisk: 0.012 }),
    bin({ index: 1, predictedAbsoluteRisk: 0.03, observedAbsoluteRisk: 0.028 }),
    bin({ index: 2, predictedAbsoluteRisk: 0.06, observedAbsoluteRisk: 0.065 }),
  ]);
  const { points, domainMax } = buildAbsoluteRiskCalibration(rc);
  const opts = {
    points,
    domainMax,
    title: 'Absolute-risk calibration',
    observedColor: '#e34948',
    annotationLines: ['E/O 0.95'],
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 480,
  };

  it('draws the line and shows the slope in the legend when showFit is on', () => {
    const fit = { slope: 1.03, intercept: -0.0004, nPoints: 3, defined: true };
    const svg = renderAbsoluteRiskCalibrationChart(Plot, { ...opts, fit, fitColor: '#2a78d6', showFit: true });
    expect(svgToString(svg)).toContain('Linear fit (slope 1.03)');
  });

  it('omits the overlay when showFit is off (default)', () => {
    const fit = { slope: 1.03, intercept: -0.0004, nPoints: 3, defined: true };
    const svg = renderAbsoluteRiskCalibrationChart(Plot, { ...opts, fit, fitColor: '#2a78d6' });
    expect(svgToString(svg)).not.toContain('Linear fit');
  });

  it('shows an em-dash slope for an undefined fit (fewer than two usable groups)', () => {
    const fit = { slope: NaN, intercept: NaN, nPoints: 1, defined: false };
    const svg = renderAbsoluteRiskCalibrationChart(Plot, { ...opts, fit, fitColor: '#2a78d6', showFit: true });
    expect(svgToString(svg)).toContain('Linear fit (slope —)');
  });
});
