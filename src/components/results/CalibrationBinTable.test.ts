// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { CalibrationBinTable } from './CalibrationBinTable';
import type { CalibrationBin } from '../../math/calibrationMath';

// A real client-side mount of the per-bin table: it pins the headers, the percent/CI/E-O formatting, that a
// degenerate bin em-dashes rather than showing a misleading zero, the row count, and the relative-risk
// column set (which Phase 9 reuses).

function bin(overrides: Partial<CalibrationBin> = {}): CalibrationBin {
  return {
    index: 0,
    label: '(-1, 0]',
    lo: -1,
    hi: 0,
    n: 512,
    weight: 512,
    observedAbsoluteRisk: 0.05,
    predictedAbsoluteRisk: 0.048,
    varianceAbsoluteRisk: 0.0001,
    lowerCiAbsoluteRisk: 0.02,
    upperCiAbsoluteRisk: 0.08,
    observedRelativeRisk: 1.1,
    predictedRelativeRisk: 1.05,
    lowerCiRelativeRisk: 0.8,
    upperCiRelativeRisk: 1.4,
    expectedByObservedRatio: 0.96,
    lowerCiExpectedByObservedRatio: 0.6,
    upperCiExpectedByObservedRatio: 1.5,
    degenerate: false,
    ...overrides,
  };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function mount(node: React.ReactElement): void {
  const root = createRoot(container);
  act(() => root.render(node));
}

describe('CalibrationBinTable — absolute scale', () => {
  it('renders headers, percent values, CIs, and one row per bin', () => {
    mount(
      createElement(CalibrationBinTable, {
        scale: 'absolute',
        bins: [bin({ index: 0 }), bin({ index: 1, n: 480 })],
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Per-bin absolute-risk calibration');
    for (const h of ['Group', 'N', 'Predicted', 'Observed (95% CI)', 'E/O (95% CI)']) {
      expect(text).toContain(h);
    }
    expect(text).toContain('5.00%'); // observed absolute risk
    expect(text).toContain('4.80%'); // predicted absolute risk
    expect(text).toContain('2.00–8.00'); // observed CI, percent
    expect(text).toContain('0.96'); // E/O
    expect(text).toContain('0.60–1.50'); // E/O CI
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelectorAll('thead th')).toHaveLength(5);
  });

  it('em-dashes a degenerate bin’s E/O instead of a misleading value', () => {
    mount(
      createElement(CalibrationBinTable, {
        scale: 'absolute',
        bins: [
          bin({
            index: 0,
            degenerate: true,
            expectedByObservedRatio: NaN,
            lowerCiExpectedByObservedRatio: NaN,
            upperCiExpectedByObservedRatio: NaN,
          }),
        ],
      }),
    );
    const eoCell = container.querySelector('tbody tr td:last-child');
    expect(eoCell?.textContent).toBe('—');
  });

  it('notes inverse-probability weighting for a nested case-control study', () => {
    mount(createElement(CalibrationBinTable, { scale: 'absolute', bins: [bin()], isNcc: true }));
    expect(container.textContent).toContain('inverse-probability-weighted');
  });
});

describe('CalibrationBinTable — relative scale (Phase 9 reuse)', () => {
  it('switches to the relative-risk column set', () => {
    mount(createElement(CalibrationBinTable, { scale: 'relative', bins: [bin()] }));
    const text = container.textContent ?? '';
    expect(text).toContain('Per-bin relative-risk calibration');
    expect(text).toContain('Predicted RR');
    expect(text).toContain('Observed RR (95% CI)');
    expect(text).toContain('1.10'); // observed RR
    expect(text).toContain('0.80–1.40'); // observed RR CI
  });
});
