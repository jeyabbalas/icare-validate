import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recomputeCalibration } from './calibrationMath';
import { loadFixture, type FixtureName } from './fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';

// Statistical faithfulness of Phase 12's absolute-risk binning — the one calibration path py-icare cannot
// validate (it bins only on the linear predictor). Two anchors:
//   1. Parity vs an INDEPENDENT pandas oracle (scripts/verify-rebin.mjs, `npm run verify:rebin`): the golden
//      rebin-<name>.json files are produced by `pandas.cut(include_lowest=True)` — py-icare's own binning
//      primitive — applied to risk_estimates, with py-icare's per-bin reductions + HL (incl. the design-
//      corrected weighted variance for the nested case-control fixture). This checks the include-lowest /
//      right-closed boundary convention against a genuinely different binning implementation.
//   2. A hermetic in-test reduction (no Pyodide) at a 3% cut, computed with plain boolean masks (NOT the
//      engine's assignBins), which also confirms the absolute-risk partition differs from the LP partition.

const FIX = path.join(process.cwd(), 'src', 'math', 'fixtures');
const NAMES: FixtureName[] = ['icare-lit-ge50', 'bpc3-covariate'];

interface OracleCase {
  id: string;
  cutoffs: number[];
  nBins: number;
  n: number[];
  weight: number[];
  observed: number[];
  predicted: number[];
  variance: number[];
  eo: number[];
  chiSquare: number;
  df: number;
}
interface OracleGolden {
  name: string;
  isNcc: boolean;
  cases: OracleCase[];
}

function golden(name: FixtureName): OracleGolden {
  return JSON.parse(readFileSync(path.join(FIX, `rebin-${name}.json`), 'utf8')) as OracleGolden;
}

describe('recomputeCalibration — absolute-risk binning vs the pandas oracle', () => {
  for (const name of NAMES) {
    const norm = normalizeValidationResult(loadFixture(name).result);
    const g = golden(name);

    it(`${name}: isNcc flag agrees with the oracle`, () => {
      expect(norm.isNcc).toBe(g.isNcc);
    });

    for (const c of g.cases) {
      it(`${name} · ${c.id} (cut ${c.cutoffs.join(',')}): per-bin stats + HL match pandas`, () => {
        const rc = recomputeCalibration(norm.perSubject, norm.isNcc, {
          scale: 'absolute-risk',
          cutoffs: c.cutoffs,
        });
        expect(rc.nBins).toBe(c.nBins);
        expect(rc.bins.map((b) => b.n)).toEqual(c.n); // partition identical → boundary convention matches
        for (let i = 0; i < c.nBins; i += 1) {
          const b = rc.bins[i];
          expect(b.weight).toBeCloseTo(c.weight[i], 6);
          expect(b.observedAbsoluteRisk).toBeCloseTo(c.observed[i], 10);
          expect(b.predictedAbsoluteRisk).toBeCloseTo(c.predicted[i], 10);
          expect(b.varianceAbsoluteRisk).toBeCloseTo(c.variance[i], 12);
          expect(b.expectedByObservedRatio).toBeCloseTo(c.eo[i], 8);
        }
        expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(c.df);
        expect(rc.absoluteRiskGof.chiSquare).toBeCloseTo(c.chiSquare, 6);
      });
    }
  }
});

describe('recomputeCalibration — absolute-risk binning (independent in-test reduction)', () => {
  it('a 3% cut matches a from-scratch mask reduction and differs from the LP partition', () => {
    const norm = normalizeValidationResult(loadFixture('icare-lit-ge50').result);
    const risk = norm.perSubject.riskEstimates;
    const outcome = norm.perSubject.observedOutcome;
    const lp = norm.perSubject.linearPredictors;
    const n = norm.perSubject.n;
    const c = 0.03;

    // Independent boolean-mask reduction (NOT the engine's assignBins): include-lowest → the edge goes low.
    let n0 = 0;
    let n1 = 0;
    let os0 = 0;
    let os1 = 0;
    let ps0 = 0;
    let ps1 = 0;
    for (let i = 0; i < n; i += 1) {
      const r = risk[i];
      if (!Number.isFinite(r)) continue;
      if (r <= c) {
        n0 += 1;
        os0 += outcome[i];
        ps0 += r;
      } else {
        n1 += 1;
        os1 += outcome[i];
        ps1 += r;
      }
    }
    const obs0 = os0 / n0;
    const obs1 = os1 / n1;
    const pred0 = ps0 / n0;
    const pred1 = ps1 / n1;
    const chi2 =
      (obs0 - pred0) ** 2 / ((obs0 * (1 - obs0)) / n0) +
      (obs1 - pred1) ** 2 / ((obs1 * (1 - obs1)) / n1);

    const rc = recomputeCalibration(norm.perSubject, false, {
      scale: 'absolute-risk',
      cutoffs: [c],
    });
    expect(rc.nBins).toBe(2);
    expect(rc.bins[0].n).toBe(n0);
    expect(rc.bins[1].n).toBe(n1);
    expect(rc.bins[0].observedAbsoluteRisk).toBeCloseTo(obs0, 10);
    expect(rc.bins[1].observedAbsoluteRisk).toBeCloseTo(obs1, 10);
    expect(rc.bins[0].predictedAbsoluteRisk).toBeCloseTo(pred0, 10);
    expect(rc.bins[1].predictedAbsoluteRisk).toBeCloseTo(pred1, 10);
    expect(rc.bins[0].expectedByObservedRatio).toBeCloseTo(pred0 / obs0, 10);
    expect(rc.absoluteRiskGof.degreesOfFreedom).toBe(2);
    expect(rc.absoluteRiskGof.chiSquare).toBeCloseTo(chi2, 6);

    // Absolute risk is NOT monotonic in the linear predictor (age dominates), so binning by risk genuinely
    // reshuffles subjects vs an LP split — at least one subject lands on the other side.
    const lpSorted = [...lp].sort((a, b) => a - b);
    const lpMed = lpSorted[Math.floor(n / 2)];
    const flipped = Array.from({ length: n }).some((_, i) => risk[i] <= c !== lp[i] <= lpMed);
    expect(flipped).toBe(true);
  });
});
