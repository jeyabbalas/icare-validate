// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import { renderRateChart, toRateSeries } from './rateChart';
import { svgToString } from '../lib/figureExport';

// A real end-to-end render against the actual Observable Plot library, to catch any misuse of the Plot
// API in renderRateChart (constant-channel rect, text/tip marks, scales) — the part unit tests on the
// pure data helper can't cover. Plot measures text via getBBox for some auto-layout, which jsdom omits;
// we stub a zero box so the render completes. Geometry is not asserted — only that it produces a bare
// <svg> whose exported string carries the in-svg title.
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

describe('renderRateChart (real Plot)', () => {
  const points = toRateSeries([
    { age: '40', rate: '0.001' },
    { age: '50', rate: '0.002' },
    { age: '60', rate: '0.004' },
    { age: '70', rate: '0.006' },
  ]);

  const baseOpts = {
    points,
    title: 'Disease incidence rates',
    color: '#2a78d6',
    unitScale: 1,
    yLabel: 'Rate (per person-year)',
    unitShort: 'per person-yr',
    band: [45, 65] as [number, number],
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 720,
  };

  it('returns a bare <svg> that serializes with the in-svg title', () => {
    const svg = renderRateChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('path')).not.toBeNull(); // the line mark
    const xml = svgToString(svg);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Disease incidence rates'); // baked-in title travels into the export
    // The style.color drives currentColor so exported axes/text aren't black in dark mode.
    expect(svg.style.color).not.toBe('');
  });

  it('renders with no study band', () => {
    expect(renderRateChart(Plot, { ...baseOpts, band: null })).toBeInstanceOf(SVGSVGElement);
  });

  it('renders the per-100,000 unit scale', () => {
    const svg = renderRateChart(Plot, {
      ...baseOpts,
      unitScale: 100000,
      yLabel: 'Rate (per 100,000 person-years)',
      unitShort: 'per 100k p-yr',
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });

  it('renders an all-zero (young-age) series without throwing', () => {
    const zeros = toRateSeries([
      { age: '0', rate: '0' },
      { age: '1', rate: '0' },
      { age: '2', rate: '0' },
    ]);
    expect(renderRateChart(Plot, { ...baseOpts, points: zeros, band: null })).toBeInstanceOf(
      SVGSVGElement,
    );
  });

  it('renders age bands as a stepped <svg> carrying the in-svg title', () => {
    const svg = renderRateChart(Plot, {
      ...baseOpts,
      points: [],
      intervals: [
        { startAge: 0, endAge: 40, rate: 0.001 },
        { startAge: 40, endAge: 50, rate: 0.02 },
      ],
      band: null,
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.querySelector('path')).not.toBeNull(); // the step line
    expect(svgToString(svg)).toContain('Disease incidence rates');
  });

  it('accepts an explicit shared x-domain', () => {
    const svg = renderRateChart(Plot, { ...baseOpts, xDomain: [0, 100] });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });
});
