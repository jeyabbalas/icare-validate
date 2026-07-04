// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { ResultsPanel } from './ResultsPanel';
import { useResultsStore } from '../state/resultsStore';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// A real client-side mount of the whole Results view against the live golden fixtures. Beyond guarding the
// zustand v5 unstable-selector loop, it pins the rendered summary: the three grouped sections, the SDK
// scalars, the goodness-of-fit lines, and (BPC3 only) the nested-case-control badge + design-weighted
// effective cohort. Rendered text is asserted via container.textContent.

function seed(name: FixtureName): void {
  const { result } = loadFixture(name);
  useResultsStore.setState({
    result,
    normalized: normalizeValidationResult(result),
    status: 'done',
    error: null,
  });
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  useResultsStore.getState().reset();
  container.remove();
});

function mount(): string {
  const root = createRoot(container);
  act(() => {
    root.render(createElement(ResultsPanel));
  });
  const text = container.textContent ?? '';
  act(() => root.unmount());
  return text;
}

describe('ResultsPanel — empty state', () => {
  it('prompts to run a validation when there is no result', () => {
    const text = mount();
    expect(text).toContain('No results yet');
    expect(text).toContain('Back to input');
  });
});

describe('ResultsPanel — grouped summary (both fixtures)', () => {
  it.each<FixtureName>(['icare-lit-ge50', 'bpc3-covariate'])('renders every group for %s', (name) => {
    seed(name);
    const text = mount();
    // three groups
    expect(text).toContain('Cohort');
    expect(text).toContain('Calibration');
    expect(text).toContain('Discrimination');
    // metric labels
    for (const label of ['Subjects', 'Cases', 'Follow-up', 'Baseline age', 'E / O ratio', 'AUC', 'Brier score']) {
      expect(text).toContain(label);
    }
    // goodness-of-fit lines
    expect(text).toContain('Hosmer–Lemeshow (absolute risk)');
    expect(text).toContain('Relative-risk GOF');
    expect(text).toContain('χ²');
    expect(text).toContain('df ');
    expect(text).toContain('New validation');
  });
});

describe('ResultsPanel — absolute-risk calibration section (both fixtures)', () => {
  it.each<FixtureName>(['icare-lit-ge50', 'bpc3-covariate'])(
    'renders the calibration figure caption + per-bin table for %s',
    (name) => {
      seed(name);
      const text = mount();
      expect(text).toContain('quantiles of predicted risk'); // figure caption
      expect(text).toContain('Per-bin absolute-risk calibration'); // table caption
      expect(text).toContain('Observed (95% CI)'); // table header
      expect(text).toContain('E/O (95% CI)'); // table header
    },
  );
});

describe('ResultsPanel — relative-risk calibration section (both fixtures)', () => {
  it.each<FixtureName>(['icare-lit-ge50', 'bpc3-covariate'])(
    'renders the RR calibration figure caption, toggle, + per-bin table for %s',
    (name) => {
      seed(name);
      const text = mount();
      expect(text).toContain('ranks and spreads'); // figure caption
      expect(text).toContain('Per-bin relative-risk calibration'); // table caption
      expect(text).toContain('Predicted RR'); // table header
      expect(text).toContain('Observed RR (95% CI)'); // table header
      // linear/log axis toggle (default linear)
      expect(text).toContain('Linear');
      expect(text).toContain('Log');
    },
  );
});

describe('ResultsPanel — cohort study (iCARE-Lit)', () => {
  it('shows raw counts, no nested-case-control badge, no weighted cohort', () => {
    seed('icare-lit-ge50');
    const text = mount();
    expect(text).toContain('5,000'); // subjects
    expect(text).toContain('183'); // cases
    expect(text).toContain('9.0 yr'); // follow-up mean 8.9842 → 9.0
    expect(text).toContain('0.634'); // AUC
    expect(text).not.toContain('nested case-control');
    expect(text).not.toContain('effective cohort');
    expect(text).not.toContain('wt. mean');
  });
});

describe('ResultsPanel — nested case-control (BPC3)', () => {
  it('shows the badge and the design-weighted effective cohort alongside raw counts', () => {
    seed('bpc3-covariate');
    const text = mount();
    expect(text).toContain('nested case-control'); // badge
    expect(text).toContain('5,285'); // raw subjects
    expect(text).toContain('1,251'); // raw cases
    expect(text).toContain('effective cohort ≈ 50,483'); // Σ frequency
    expect(text).toContain('effective ≈ 1,765'); // Σ frequency·outcome
    expect(text).toContain('wt. mean'); // weighted follow-up / age means
    expect(text).toContain('0.600'); // AUC ≈ 0.6002 golden
    expect(text).toContain('0.952'); // E/O ratio
  });
});
