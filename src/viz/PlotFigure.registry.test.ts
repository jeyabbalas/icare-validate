// @vitest-environment jsdom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PlotFigure } from './PlotFigure';
import { listResultsFigures } from './figureRegistry';

// Verifies the PlotFigure ↔ figureRegistry wiring in the real component (the Map logic itself is covered
// by figureRegistry.test.ts). jsdom has no ResizeObserver, so the chart never draws and getSvg() stays
// null — but registration must still happen on mount and be removed on unmount, which is exactly what the
// "Download all" collection depends on.

let container: HTMLDivElement;

afterEach(() => {
  container?.remove();
});

describe('PlotFigure registry integration', () => {
  it('registers under its exportName on mount and unregisters on unmount', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(PlotFigure, {
          render: () => null,
          deps: [],
          exportName: 'absolute-risk-calibration',
          pngBackground: '#fff',
        }),
      );
    });
    const entry = listResultsFigures().find((f) => f.name === 'absolute-risk-calibration');
    expect(entry).toBeDefined();
    expect(entry?.entry.getBackground()).toBe('#fff'); // getters wired to the live props/refs

    act(() => root.unmount());
    expect(listResultsFigures().some((f) => f.name === 'absolute-risk-calibration')).toBe(false);
  });
});
