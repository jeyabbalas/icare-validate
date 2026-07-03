// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { InputBuilder } from './InputBuilder';
import { useInputStore } from '../../state/inputStore';

// A real client-side mount (jsdom), unlike the SSR smoke test which renders once and therefore
// cannot surface a re-render loop. This is the regression guard for the zustand v5 pitfall where a
// selector that returns a fresh object every call ("getSnapshot should be cached") drives
// useSyncExternalStore into "Maximum update depth exceeded". If InputSummaryPanel (or any panel)
// reintroduces an unstable selector, mounting here throws and the test fails.

let container: HTMLDivElement;

beforeEach(() => {
  useInputStore.getState().reset();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('InputBuilder (client mount)', () => {
  it('mounts without an update-depth loop and shows the summary', () => {
    const root = createRoot(container);
    act(() => {
      root.render(createElement(InputBuilder));
    });
    expect(container.textContent).toContain('Input summary');
    expect(container.textContent).toContain('need attention');
    act(() => root.unmount());
  });

  it('renders the Mode B surface (both columns, population rates, reference panel)', () => {
    const root = createRoot(container);
    act(() => {
      useInputStore.getState().setMode('B');
      root.render(createElement(InputBuilder));
    });
    expect(container.textContent).toContain('Pre-computed risks');
    expect(container.textContent).toContain('Predicted-risk column');
    expect(container.textContent).toContain('Linear-predictor column');
    expect(container.textContent).toContain('Disease incidence rates (population)');
    expect(container.textContent).toContain('Reference population');
    act(() => root.unmount());
  });
});
