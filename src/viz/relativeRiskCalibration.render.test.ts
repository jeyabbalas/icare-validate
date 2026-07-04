// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import {
  buildRelativeRiskCalibration,
  renderRelativeRiskCalibrationChart,
} from './relativeRiskCalibration';
import type { CalibrationBin, RecomputedCalibration } from '../math/calibrationMath';
import { svgToString } from '../lib/figureExport';

// End-to-end render against the real Observable Plot library, in BOTH the linear (default) and log axis
// modes the toolbar toggles between, to catch any misuse of the Plot API (the RR=1 crosshair, the identity
// line, the CI whiskers, the dots, the group-number labels, the baked title/legend/annotation text marks,
// the pointer tip, the log scale) that the pure-builder unit tests can't. Plot measures text via getBBox for
// auto-layout, which jsdom omits; stub a zero box so the render completes. Geometry isn't asserted — only
// that we get a bare <svg> whose export carries the title, legend, annotation, and axis labels.
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

describe('renderRelativeRiskCalibrationChart (real Plot)', () => {
  const rc = rcOf([
    bin({ index: 0, predictedRelativeRisk: 0.5, observedRelativeRisk: 0.45, lowerCiRelativeRisk: 0.3, upperCiRelativeRisk: 0.7 }),
    bin({ index: 1, predictedRelativeRisk: 1.0, observedRelativeRisk: 1.1, lowerCiRelativeRisk: 0.8, upperCiRelativeRisk: 1.5 }),
    bin({ index: 2, predictedRelativeRisk: 2.2, observedRelativeRisk: 2.5, lowerCiRelativeRisk: 1.6, upperCiRelativeRisk: 3.8 }),
  ]);
  const { points, linearMax, logBound } = buildRelativeRiskCalibration(rc);

  const baseOpts = {
    points,
    linearMax,
    logBound,
    axisScale: 'linear' as const,
    title: 'Relative-risk calibration',
    observedColor: '#e34948',
    annotationLines: ['RR GOF χ² 16.9 · df 9 · p 0.058'],
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 480,
  };

  it('returns a bare <svg> with markers, an identity line, and rule lines (linear)', () => {
    const svg = renderRelativeRiskCalibrationChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('circle')).not.toBeNull(); // the dot markers
    expect(svg.querySelector('path')).not.toBeNull(); // the identity line
    expect(svg.querySelector('line')).not.toBeNull(); // CI whiskers + the RR=1 crosshair (ruleX/ruleY)
    // style.color drives currentColor so exported axes/text aren't black in dark mode.
    expect(svg.style.color).not.toBe('');
  });

  it('renders on a log scale with symmetric fractional ticks', () => {
    const svg = renderRelativeRiskCalibrationChart(Plot, { ...baseOpts, axisScale: 'log' });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.querySelector('circle')).not.toBeNull();
    const xml = svgToString(svg);
    // logBound === 5 → ticks [0.2, 0.5, 1, 2, 5]; a fractional tick confirms the log scale is active.
    expect(xml).toContain('0.5');
  });

  it('bakes the title, all three legend entries, the RR GOF annotation, and axis labels', () => {
    const svg = renderRelativeRiskCalibrationChart(Plot, baseOpts);
    const xml = svgToString(svg);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Relative-risk calibration');
    expect(xml).toContain('Observed rel. risk (95% CI)');
    expect(xml).toContain('Perfect calibration (y = x)');
    expect(xml).toContain('Population average (RR = 1)');
    expect(xml).toContain('RR GOF');
    expect(xml).toContain('Predicted relative risk');
    expect(xml).toContain('Observed relative risk');
  });

  it('renders without CI whiskers when no bin has a defined interval', () => {
    const noCi = buildRelativeRiskCalibration(
      rcOf([bin({ lowerCiRelativeRisk: NaN, upperCiRelativeRisk: NaN })]),
    );
    const svg = renderRelativeRiskCalibrationChart(Plot, {
      ...baseOpts,
      points: noCi.points,
      linearMax: noCi.linearMax,
      logBound: noCi.logBound,
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    // The crosshair always draws lines, so assert the dot is present rather than line === null.
    expect(svg.querySelector('circle')).not.toBeNull();
  });
});
