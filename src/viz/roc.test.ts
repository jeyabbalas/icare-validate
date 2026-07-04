import { describe, it, expect } from 'vitest';
import { buildRoc, type RocAuc } from './roc';
import type { RocCurve } from '../math/roc';

// Build a minimal RocCurve so the builder's curve tidying, Youden marker + guide, hover tips, and baked
// annotation are tested in isolation from the sweep math (covered by roc.test.ts in ../math).
const AUC: RocAuc = { auc: 0.6, lowerCi: 0.55, upperCi: 0.65 };

const roc: RocCurve = {
  points: [
    { fpr: 0, tpr: 0, threshold: Infinity }, // the "classify nobody" seed
    { fpr: 0, tpr: 0.6, threshold: 2 },
    { fpr: 0.3, tpr: 0.6, threshold: 1 },
    { fpr: 1, tpr: 1, threshold: 0 },
  ],
  auc: 0.72,
  youden: { fpr: 0.3, tpr: 0.6, threshold: 1, j: 0.3, sensitivity: 0.6, specificity: 0.7 },
  nCases: 5,
  nControls: 5,
  weightSum: { cases: 5, controls: 5 },
  isNcc: false,
};

describe('buildRoc', () => {
  const d = buildRoc(roc, AUC);

  it('tidies the curve to fpr/tpr vertices over the [0,1] square', () => {
    expect(d.curve).toEqual([
      { fpr: 0, tpr: 0 },
      { fpr: 0, tpr: 0.6 },
      { fpr: 0.3, tpr: 0.6 },
      { fpr: 1, tpr: 1 },
    ]);
    expect(d.domain).toEqual([0, 1]);
  });

  it('marks the Youden point and its vertical guide up from the chance diagonal', () => {
    expect(d.youden).toEqual({ fpr: 0.3, tpr: 0.6, label: 'Youden' });
    // Guide runs from (fpr,fpr) on the diagonal up to (fpr,tpr) on the curve — its height is Youden's J.
    expect(d.youdenGuide).toEqual([
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: 0.6 },
    ]);
  });

  it('bakes the AUC (with CI) and the Youden sensitivity/specificity annotation', () => {
    expect(d.annotationLines).toEqual([
      'AUC 0.600 (95% CI 0.550–0.650)',
      'Youden-optimal · sensitivity 60% · specificity 70%',
    ]);
  });

  it('emits a hover tip per real operating point (dropping the +Infinity seed)', () => {
    expect(d.tipRows).toHaveLength(3);
    // First real point: threshold 2, fpr 0 → specificity 100%, tpr 0.6 → sensitivity 60%.
    expect(d.tipRows[0].tip).toBe('Sensitivity 60.0%\nSpecificity 100.0%\nRisk-score cut 2.000');
    // Middle point carries its own specificity (1 − 0.3 = 70%).
    expect(d.tipRows[1].tip).toContain('Specificity 70.0%');
    expect(d.tipRows[1].tip).toContain('Risk-score cut 1.000');
  });
});

describe('buildRoc — degenerate curve', () => {
  const degen: RocCurve = {
    points: [
      { fpr: 0, tpr: 0, threshold: Infinity },
      { fpr: 1, tpr: 1, threshold: -Infinity },
    ],
    auc: NaN,
    youden: null,
    nCases: 3,
    nControls: 0,
    weightSum: { cases: 3, controls: 0 },
    isNcc: false,
  };
  const d = buildRoc(degen, AUC);

  it('drops the Youden marker/guide and keeps only the AUC annotation line', () => {
    expect(d.youden).toBeNull();
    expect(d.youdenGuide).toBeNull();
    expect(d.annotationLines).toEqual(['AUC 0.600 (95% CI 0.550–0.650)']);
    expect(d.tipRows).toHaveLength(0); // both endpoints have infinite thresholds
  });
});
