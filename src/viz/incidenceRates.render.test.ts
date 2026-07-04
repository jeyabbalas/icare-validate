// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as Plot from '@observablehq/plot';
import { buildIncidenceSeries, renderIncidenceChart } from './incidenceRates';
import { svgToString } from '../lib/figureExport';
import type { IncidenceRates } from '../services/resultNormalizer';

// End-to-end render against the real Observable Plot library, to catch any misuse of the Plot API
// (the two line marks, dots, baked title/legend text marks, the crosshair tip, scales) that unit tests
// on the pure builder can't. Plot measures text via getBBox for auto-layout, which jsdom omits; stub a
// zero box so the render completes. Geometry isn't asserted — only that we get a bare <svg> whose export
// carries the in-svg title and the correct legend entries.
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

function inc(age: number[], study: number[], population: number[] | null): IncidenceRates {
  return {
    age: Float64Array.from(age),
    studyRate: Float64Array.from(study),
    populationRate: population === null ? null : Float64Array.from(population),
  };
}

describe('renderIncidenceChart (real Plot)', () => {
  const twoSeries = inc(
    [40, 50, 60, 70],
    [0.001, 0.002, 0.004, 0.006],
    [0.0012, 0.0022, 0.0038, 0.0061],
  );

  const baseOpts = {
    points: buildIncidenceSeries(twoSeries),
    title: 'Age-specific incidence rates',
    studyColor: '#e34948',
    populationColor: '#2a78d6',
    unitScale: 1,
    yLabel: 'Incidence rate (per person-year)',
    unitShort: 'per person-yr',
    colors: { fg: '#0f172a', muted: '#64748b', surface: '#ffffff' },
    width: 720,
  };

  it('returns a bare <svg> that serializes with the title and both legend labels', () => {
    const svg = renderIncidenceChart(Plot, baseOpts);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('path')).not.toBeNull(); // the line marks
    // The style.color drives currentColor so exported axes/text aren't black in dark mode.
    expect(svg.style.color).not.toBe('');
    const xml = svgToString(svg);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain('Age-specific incidence rates'); // baked-in title travels into the export
    expect(xml).toContain('Observed (study)');
    expect(xml).toContain('Expected (population)');
  });

  it('omits the expected line and legend entry when population is absent', () => {
    const svg = renderIncidenceChart(Plot, {
      ...baseOpts,
      points: buildIncidenceSeries(inc([40, 50, 60], [0.001, 0.002, 0.003], null)),
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    const xml = svgToString(svg);
    expect(xml).toContain('Observed (study)');
    expect(xml).not.toContain('Expected (population)');
  });

  it('renders the per-100,000 unit scale', () => {
    const svg = renderIncidenceChart(Plot, {
      ...baseOpts,
      unitScale: 100000,
      yLabel: 'Incidence rate (per 100,000 person-years)',
      unitShort: 'per 100k p-yr',
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });

  it('renders an all-zero study series without throwing (niceCeil(0) guard)', () => {
    const svg = renderIncidenceChart(Plot, {
      ...baseOpts,
      points: buildIncidenceSeries(inc([40, 50, 60], [0, 0, 0], null)),
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });

  it('renders with interior NaN study gaps alongside a full population line', () => {
    const svg = renderIncidenceChart(Plot, {
      ...baseOpts,
      points: buildIncidenceSeries(
        inc([40, 50, 60, 70], [0.001, NaN, 0.004, 0.006], [0.0012, 0.0022, 0.0038, 0.0061]),
      ),
    });
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('accepts an explicit shared x-domain', () => {
    const svg = renderIncidenceChart(Plot, { ...baseOpts, xDomain: [0, 100] as [number, number] });
    expect(svg).toBeInstanceOf(SVGSVGElement);
  });
});
