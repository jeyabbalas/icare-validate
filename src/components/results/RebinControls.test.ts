// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { RebinControls } from './RebinControls';
import { useRebinStore } from '../../state/rebinStore';

// A real client-side mount of the re-binning toolbar: it pins the two toggles, the quantiles↔cutpoints
// field swap and its scale-aware label, the Reset enable/disable + behaviour, and the warning list — all
// driving the shared rebinStore that the calibration recompute reads.

let container: HTMLDivElement;
let root: Root | null = null;

function mount(warnings: string[] = []): void {
  root = createRoot(container);
  act(() => root!.render(createElement(RebinControls, { warnings })));
}

function button(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn as HTMLButtonElement;
}

function click(text: string): void {
  act(() => button(text).click());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  useRebinStore.setState({
    scale: 'linear-predictor',
    method: 'quantiles',
    numberOfPercentiles: 10,
    cutpoints: null,
    defaultSpec: { numberOfPercentiles: 10, linearPredictorCutoffs: null },
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
});

describe('RebinControls', () => {
  it('renders the scale + method toggles and the Bins field by default', () => {
    mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Risk score');
    expect(text).toContain('Absolute risk');
    expect(text).toContain('Quantiles');
    expect(text).toContain('Cutpoints');
    expect(text).toContain('Bins');
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  it('swaps to the cutpoints field, labelled in % on the absolute-risk scale', () => {
    mount();
    click('Cutpoints');
    click('Absolute risk');
    const text = container.textContent ?? '';
    expect(text).toContain('Cutpoints (%)');
    expect(container.querySelector('input[type="text"]')).not.toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(useRebinStore.getState().scale).toBe('absolute-risk');
    expect(useRebinStore.getState().method).toBe('cutpoints');
  });

  it('labels cutpoints in risk-score units on the linear-predictor scale', () => {
    useRebinStore.setState({ method: 'cutpoints' });
    mount();
    expect(container.textContent).toContain('Cutpoints (risk score)');
  });

  it('disables Reset at the default and enables it after a change', () => {
    mount();
    expect(button('Reset to default').disabled).toBe(true);
    click('Absolute risk');
    expect(button('Reset to default').disabled).toBe(false);
  });

  it('Reset returns to the captured default', () => {
    mount();
    click('Absolute risk');
    expect(useRebinStore.getState().scale).toBe('absolute-risk');
    click('Reset to default');
    expect(useRebinStore.getState().scale).toBe('linear-predictor');
    expect(useRebinStore.getState().method).toBe('quantiles');
  });

  it('renders dropped-cutpoint warnings in an aria-live region', () => {
    mount(['Cutoff 9 lies outside the data range [0.1, 3.2].']);
    expect(container.textContent).toContain('lies outside the data range');
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
