// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Stepper } from './Stepper';
import { useAppStore } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import type { ValidationResult } from '../lib/icareTypes';

// The two-view switcher, restyled as prominent underline tabs (issue #1). The visual treatment is inline
// CSS, but the behavior/accessibility contract is what a regression would break, so that is pinned here: a
// labelled nav holding two tabs, the active one marked `aria-current`, Results locked (disabled) until a
// result exists, and a click on an enabled tab switching the view.

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  useAppStore.setState({ step: 'input' });
  useResultsStore.getState().reset();
});

afterEach(() => {
  useResultsStore.getState().reset();
  useAppStore.setState({ step: 'input' });
  container.remove();
});

function render() {
  const root = createRoot(container);
  act(() => root.render(createElement(Stepper)));
  return root;
}

describe('Stepper — underline view tabs', () => {
  it('renders a labelled nav with an Input and a Results tab', () => {
    const root = render();
    expect(container.querySelector('nav[aria-label="Views"]')).not.toBeNull();
    const tabs = container.querySelectorAll('button');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toBe('Input');
    expect(tabs[1].textContent).toBe('Results');
    act(() => root.unmount());
  });

  it('marks the active tab and locks Results until a result exists', () => {
    const root = render();
    const [input, results] = container.querySelectorAll('button');
    expect(input.getAttribute('aria-current')).toBe('page');
    expect(results.getAttribute('aria-current')).toBeNull();
    expect(results.disabled).toBe(true);
    expect(results.getAttribute('aria-disabled')).toBe('true');
    act(() => root.unmount());
  });

  it('unlocks Results and switches the view on click once a result exists', () => {
    useResultsStore.setState({ result: {} as ValidationResult });
    const root = render();
    const results = container.querySelectorAll('button')[1];
    expect(results.disabled).toBe(false);
    act(() => results.click());
    expect(useAppStore.getState().step).toBe('results');
    act(() => root.unmount());
  });
});
