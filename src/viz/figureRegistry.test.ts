import { afterEach, describe, expect, it } from 'vitest';
import {
  listResultsFigures,
  registerFigure,
  unregisterFigure,
  type FigureEntry,
} from './figureRegistry';

// The registry is module-level global state, so each test cleans up after itself.
function entry(svg: SVGSVGElement | null, bg?: string): FigureEntry {
  return { getSvg: () => svg, getBackground: () => bg };
}

afterEach(() => {
  // listResultsFigures() returns a fresh array, so deleting from the map as we go is safe.
  for (const { name, entry: e } of listResultsFigures()) unregisterFigure(name, e);
});

describe('figureRegistry', () => {
  it('lists registered figures in RESULTS_FIGURE_ORDER regardless of registration order', () => {
    const roc = entry(null);
    const inc = entry(null);
    registerFigure('discrimination-roc-curve', roc);
    registerFigure('age-specific-incidence-rates', inc);

    const names = listResultsFigures().map((f) => f.name);
    expect(names).toEqual(['age-specific-incidence-rates', 'discrimination-roc-curve']);
  });

  it('omits names that are not in the results allow-list', () => {
    registerFigure('some-input-rate-chart', entry(null));
    registerFigure('absolute-risk-calibration', entry(null));

    const names = listResultsFigures().map((f) => f.name);
    expect(names).toEqual(['absolute-risk-calibration']);
  });

  it('exposes the live node and background via the entry getters', () => {
    const svg = { tagName: 'svg' } as unknown as SVGSVGElement;
    registerFigure('relative-risk-calibration', entry(svg, '#fff'));

    const found = listResultsFigures().find((f) => f.name === 'relative-risk-calibration');
    expect(found?.entry.getSvg()).toBe(svg);
    expect(found?.entry.getBackground()).toBe('#fff');
  });

  it('replaces an entry when the same name registers again', () => {
    const a = entry(null, '#000');
    const b = entry(null, '#fff');
    registerFigure('expected-observed-by-group', a);
    registerFigure('expected-observed-by-group', b);

    const found = listResultsFigures().find((f) => f.name === 'expected-observed-by-group');
    expect(found?.entry.getBackground()).toBe('#fff');
  });

  it('identity-checked unregister does not delete a newer live entry (StrictMode remount)', () => {
    const stale = entry(null, 'stale');
    const live = entry(null, 'live');
    registerFigure('discrimination-risk-density', stale);
    registerFigure('discrimination-risk-density', live); // remount registered before stale cleanup

    unregisterFigure('discrimination-risk-density', stale); // stale cleanup must be a no-op

    const found = listResultsFigures().find((f) => f.name === 'discrimination-risk-density');
    expect(found?.entry.getBackground()).toBe('live');

    unregisterFigure('discrimination-risk-density', live);
    expect(listResultsFigures()).toHaveLength(0);
  });
});
