// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { CalibrationPanel } from './CalibrationPanel';
import { loadFixture } from '../../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../../services/resultNormalizer';
import { recomputeCalibration } from '../../math/calibrationMath';

// A real client-side mount of the Calibration panel against a live golden fixture, to pin the interactive
// wiring the pure render tests can't: each calibration plot has its own "Linear fit" overlay toggle, it is
// off by default, and clicking one flips only that plot's state. (jsdom has no ResizeObserver, so the
// PlotFigure charts stay width 0 and never draw — but their toolbars, including the toggle, still render.)

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function fitToggles(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Linear fit');
}

describe('CalibrationPanel — per-plot "Linear fit" overlay toggle', () => {
  it('renders one toggle per plot, off by default, flipped independently on click', () => {
    const { result } = loadFixture('icare-lit-ge50');
    const normalized = normalizeValidationResult(result);
    const rc = recomputeCalibration(normalized.perSubject, normalized.isNcc, {
      scale: 'linear-predictor',
      numberOfPercentiles: 10,
    });

    const root = createRoot(container);
    act(() => {
      root.render(createElement(CalibrationPanel, { result, normalized, rc }));
    });

    const before = fitToggles();
    expect(before).toHaveLength(2); // absolute-risk + relative-risk plots
    expect(before.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);

    act(() => {
      before[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const after = fitToggles();
    expect(after[0].getAttribute('aria-pressed')).toBe('true'); // clicked plot's overlay turned on
    expect(after[1].getAttribute('aria-pressed')).toBe('false'); // the other plot is unaffected

    act(() => root.unmount());
  });
});
