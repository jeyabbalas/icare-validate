// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodePanel } from './CodePanel';
import { MODE_A_REQUIRED, useInputStore, type FileSlot } from '../../state/inputStore';
import { useBinSettingsStore } from '../../state/binSettingsStore';

// Drives the Code panel's behavior: the empty-state guard, live code generation for the default language,
// the Copy/Download actions, and switching between Python / JavaScript (Node · Browser) / R.

let container: HTMLDivElement;

const slot = (filename: string): FileSlot => ({
  file: null,
  url: filename,
  source: 'url',
  filename,
  size: null,
});

/** Populate the input store so the panel renders code (Mode A: valid study + required model files). */
function fillValidInputs() {
  const modelFiles = { ...useInputStore.getState().modelFiles };
  for (const k of MODE_A_REQUIRED) modelFiles[k] = slot(`${k}.csv`);
  useInputStore.setState({
    mode: 'A',
    study: slot('icare_lit_validation_study.csv'),
    modelFiles,
    datasetName: 'iCARE-Lit ge50',
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  useInputStore.getState().reset();
  useBinSettingsStore.getState().reset();
});

afterEach(() => {
  useInputStore.getState().reset();
  container.remove();
});

function render() {
  const root = createRoot(container);
  act(() => root.render(createElement(CodePanel)));
  return root;
}

function clickButton(text: string) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!btn) throw new Error(`no button labelled "${text}"`);
  act(() => btn.click());
}

const preText = () => container.querySelector('pre')?.textContent ?? '';
const buttonTexts = () => [...container.querySelectorAll('button')].map((b) => b.textContent);

describe('CodePanel', () => {
  it('shows an empty state until the inputs can build a validation', () => {
    const root = render();
    expect(container.textContent).toContain('Add the required inputs');
    expect(container.querySelector('pre')).toBeNull();
    act(() => root.unmount());
  });

  it('renders runnable Python by default, with Copy and Download actions', () => {
    fillValidInputs();
    const root = render();
    expect(preText()).toContain('from icare import validate_absolute_risk_model');
    expect(preText()).toContain('study_data_path="icare_lit_validation_study.csv"');
    expect(preText()).toContain('number_of_percentiles=10');
    expect(buttonTexts()).toContain('Copy');
    expect(buttonTexts()).toContain('Download validate.py');
    act(() => root.unmount());
  });

  it('switches to JavaScript and exposes a Node/Browser sub-toggle', () => {
    fillValidInputs();
    const root = render();
    clickButton('JavaScript');
    expect(preText()).toContain("import { loadICARE } from 'wasm-icare'");
    expect(buttonTexts()).toContain('Node.js');
    expect(buttonTexts()).toContain('Browser (CDN)');

    clickButton('Browser (CDN)');
    expect(preText()).toContain('https://esm.sh/wasm-icare@2');
    expect(preText()).toContain('<input type="file"');
    expect(buttonTexts()).toContain('Download validate.html');
    act(() => root.unmount());
  });

  it('switches to R (Quarto) with ojs_define serialization + Blob rebuild', () => {
    fillValidInputs();
    const root = render();
    clickButton('R (Quarto)');
    expect(preText()).toContain('ojs_define(');
    expect(preText()).toContain('read_file(');
    expect(preText()).toContain('new Blob([studyDataText])');
    expect(buttonTexts()).toContain('Download validate.qmd');
    act(() => root.unmount());
  });

  it('language tabs are an ARIA tablist with roving tabIndex + arrow-key navigation', () => {
    fillValidInputs();
    const root = render();
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = () => [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];

    // Selected (Python) tab is the sole tab stop; each tab controls the shared tabpanel.
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].getAttribute('aria-controls')).toBe('code-panel');
    const panel = container.querySelector('#code-panel');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('code-tab-python');

    // ArrowRight from the focused Python tab moves selection (and focus) to JavaScript.
    const python = tabs()[0];
    python.focus();
    act(() => {
      python.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const after = tabs();
    expect(after[1].getAttribute('aria-selected')).toBe('true');
    expect(after.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(document.activeElement).toBe(after[1]);
    expect(preText()).toContain("import { loadICARE } from 'wasm-icare'");

    // Wraps: ArrowLeft from the first tab jumps to the last (R).
    tabs()[0].focus();
    act(() => {
      tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    act(() => root.unmount());
  });
});
