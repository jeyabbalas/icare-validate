import { describe, it, expect } from 'vitest';
import { buildDiscrimination, type DiscriminationAuc } from './discrimination';
import type { DiscriminationDensities } from '../math/kde';

// Build a minimal DiscriminationDensities so the builder's percent/density rescaling, markers, annotation,
// and hover ratios are tested in isolation from the KDE math (covered by kde.test.ts / kde.parity.test.ts).
function makeDensities(over: {
  grid: number[];
  control: number[];
  case_: number[];
  controlMedian?: number;
  caseMedian?: number;
  controlN?: number;
  caseN?: number;
  overlap?: number;
  riskMaxDisplay?: number;
}): DiscriminationDensities {
  const grid = Float64Array.from(over.grid);
  return {
    grid,
    overlap: over.overlap ?? 0.4,
    riskMaxDisplay: over.riskMaxDisplay ?? grid[grid.length - 1],
    isNcc: false,
    control: {
      x: grid,
      density: Float64Array.from(over.control),
      median: over.controlMedian ?? 0.04,
      n: over.controlN ?? 100,
      weightSum: over.controlN ?? 100,
      bandwidth: 0.01,
    },
    case_: {
      x: grid,
      density: Float64Array.from(over.case_),
      median: over.caseMedian ?? 0.09,
      n: over.caseN ?? 20,
      weightSum: over.caseN ?? 20,
      bandwidth: 0.01,
    },
  };
}

const AUC: DiscriminationAuc = { auc: 0.6, lowerCi: 0.55, upperCi: 0.65 };

describe('buildDiscrimination', () => {
  const dens = makeDensities({
    grid: [0, 0.05, 0.1],
    control: [10, 20, 5],
    case_: [2, 8, 16],
    riskMaxDisplay: 0.1,
  });
  const d = buildDiscrimination(dens, AUC);

  it('emits both series on the percent x-axis with per-percentage-point density', () => {
    expect(d.points).toHaveLength(6); // 2 series × 3 grid points
    const ctrl = d.points.filter((p) => p.series === 'control');
    expect(ctrl.map((p) => p.x)).toEqual([0, 5, 10]); // grid × 100
    expect(ctrl.map((p) => p.density)).toEqual([0.1, 0.2, 0.05]); // density / 100
  });

  it('scales medians to percent and squares off tidy axis domains', () => {
    expect(d.controlMedian).toBeCloseTo(4, 12); // 0.04 × 100
    expect(d.caseMedian).toBeCloseTo(9, 12);
    expect(d.domainX).toEqual([0, 10]); // niceCeil(0.1 × 100)
    expect(d.domainY).toEqual([0, 0.2]); // niceCeil(max visible density 0.2)
  });

  it('labels each series with its subject count', () => {
    expect(d.controlLabel).toBe('Controls · n = 100');
    expect(d.caseLabel).toBe('Cases · n = 20');
  });

  it('bakes the AUC (with CI) and the distribution-overlap annotation', () => {
    expect(d.annotationLines).toEqual([
      'AUC 0.600 (95% CI 0.550–0.650)',
      'Distribution overlap 0.40',
    ]);
  });

  it('reports the case:control density ratio (empirical likelihood ratio) per risk in the tip', () => {
    expect(d.tipRows).toHaveLength(3);
    expect(d.tipRows[0].tip).toContain('Predicted risk 0.0%');
    expect(d.tipRows[0].tip).toContain('Case:control ratio 0.20'); // 2 / 10
    expect(d.tipRows[2].tip).toContain('Case:control ratio 3.20'); // 16 / 5
    expect(d.tipRows[1].tip).toContain('Density — cases 0.08, controls 0.2');
  });

  it('the tip ratio is undefined where a density is numerically zero', () => {
    const z = buildDiscrimination(
      makeDensities({ grid: [0, 0.05], control: [0, 5], case_: [3, 5], riskMaxDisplay: 0.05 }),
      AUC,
    );
    expect(z.tipRows[0].tip).toContain('Case:control ratio —');
  });

  it('clamps the visible-density scan and domain to the display window', () => {
    // A tall spike beyond the 99.5th-percentile display window must not inflate the y-domain.
    const spiky = buildDiscrimination(
      makeDensities({
        grid: [0, 0.05, 0.9],
        control: [10, 20, 900],
        case_: [2, 8, 5],
        riskMaxDisplay: 0.1,
      }),
      AUC,
    );
    expect(spiky.domainX).toEqual([0, 10]);
    expect(spiky.domainY[1]).toBeLessThan(1); // the x=90% spike (density 9) is outside the window
  });
});
