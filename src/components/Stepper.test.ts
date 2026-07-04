// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Stepper } from './Stepper';
import { useAppStore } from '../state/appStore';
import { useResultsStore } from '../state/resultsStore';
import { MODE_A_REQUIRED, useInputStore, type FileSlot } from '../state/inputStore';
import type { ValidationResult } from '../lib/icareTypes';

// The three-view switcher, restyled as prominent underline tabs. The visual treatment is inline CSS, but
// the behavior/accessibility contract is what a regression would break, so that is pinned here: a labelled
// nav holding Input / Results / Code, the active one marked `aria-current`, Results locked until a result
// exists, Code locked until the inputs can build a validation, and a click on an enabled tab switching.

let container: HTMLDivElement;

const slot = (filename: string): FileSlot => ({
  file: null,
  url: filename,
  source: 'url',
  filename,
  size: null,
});

/** Populate the input store so `canBuildValidateOptions` is satisfied (Mode A: study + required files). */
function fillValidInputs() {
  const modelFiles = { ...useInputStore.getState().modelFiles };
  for (const k of MODE_A_REQUIRED) modelFiles[k] = slot(`${k}.csv`);
  useInputStore.setState({ mode: 'A', study: slot('study.csv'), modelFiles });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  useAppStore.setState({ step: 'input' });
  useResultsStore.getState().reset();
  useInputStore.getState().reset();
});

afterEach(() => {
  useResultsStore.getState().reset();
  useInputStore.getState().reset();
  useAppStore.setState({ step: 'input' });
  container.remove();
});

function render() {
  const root = createRoot(container);
  act(() => root.render(createElement(Stepper)));
  return root;
}

describe('Stepper — underline view tabs', () => {
  it('renders a labelled nav with Input, Results, and Code tabs', () => {
    const root = render();
    expect(container.querySelector('nav[aria-label="Views"]')).not.toBeNull();
    const tabs = container.querySelectorAll('button');
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toBe('Input');
    expect(tabs[1].textContent).toBe('Results');
    expect(tabs[2].textContent).toBe('Code');
    act(() => root.unmount());
  });

  it('marks the active tab and locks Results and Code until they are reachable', () => {
    const root = render();
    const [input, results, code] = container.querySelectorAll('button');
    expect(input.getAttribute('aria-current')).toBe('page');
    expect(results.getAttribute('aria-current')).toBeNull();
    expect(results.disabled).toBe(true);
    expect(results.getAttribute('aria-disabled')).toBe('true');
    // Code is locked while inputs are incomplete.
    expect(code.disabled).toBe(true);
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

  it('unlocks Code once inputs can build a validation, and switches on click (no run needed)', () => {
    fillValidInputs();
    const root = render();
    const code = container.querySelectorAll('button')[2];
    expect(code.disabled).toBe(false);
    act(() => code.click());
    expect(useAppStore.getState().step).toBe('code');
    act(() => root.unmount());
  });
});
