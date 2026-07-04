import { describe, it, expect } from 'vitest';
import { csvParse } from 'd3-dsv';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult } from '../services/resultNormalizer';
import { recomputeCalibration } from '../math/calibrationMath';
import { computeCohortSummary } from './cohortSummary';
import {
  collectResultFiles,
  cohortSummaryCsv,
  cohortSummaryJson,
  columnarToRows,
  currentCalibrationCsv,
  encodeCell,
  incidenceRatesCsv,
  metricsJson,
  mimeFor,
  referenceDistributionCsv,
  sdkCalibrationCsv,
  slugify,
  studyDataCsv,
  type RebinSnapshot,
} from './resultsExport';
import type { CategoricalColumn, ColumnarTableResult, ValidationResult } from './icareTypes';
import type { RunBinSpec } from '../state/rebinStore';
import type { RunProvenance } from '../state/resultsStore';

const NOW = new Date('2026-07-04T12:00:00.000Z');
const DEFAULT_SPEC: RunBinSpec = { numberOfPercentiles: 10, linearPredictorCutoffs: null };
const DEFAULT_PROVENANCE: RunProvenance = { mode: 'A', numImputations: null, seed: 50 };
const DEFAULT_REBIN: RebinSnapshot = {
  scale: 'linear-predictor',
  method: 'quantiles',
  numberOfPercentiles: 10,
  cutpoints: null,
};

function setup(name: FixtureName) {
  const { result } = loadFixture(name);
  const normalized = normalizeValidationResult(result);
  const rc = recomputeCalibration(normalized.perSubject, normalized.isNcc, {
    scale: 'linear-predictor',
    numberOfPercentiles: 10,
  });
  return { result, normalized, rc };
}

function frame(
  columns: Record<string, number[] | string[] | Float64Array | CategoricalColumn>,
  order: string[],
  nRows: number,
): ColumnarTableResult {
  return { columns, order, nRows };
}

describe('encodeCell', () => {
  it('preserves non-finite meaning as NaN / Inf / -Inf tokens', () => {
    expect(encodeCell(NaN)).toBe('NaN');
    expect(encodeCell(Infinity)).toBe('Inf');
    expect(encodeCell(-Infinity)).toBe('-Inf');
    expect(encodeCell(0)).toBe('0');
    expect(encodeCell(0.03)).toBe('0.03');
    expect(encodeCell(-1.5)).toBe('-1.5');
  });
});

describe('columnarToRows', () => {
  it('falls back to Object.keys when order is empty', () => {
    const { columns, rows } = columnarToRows(frame({ a: [1, 2], b: ['x', 'y'] }, [], 2));
    expect(columns).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { a: '1', b: 'x' },
      { a: '2', b: 'y' },
    ]);
  });

  it('drops order keys absent from columns and appends columns keys absent from order', () => {
    const { columns } = columnarToRows(frame({ b: [1], a: [2], c: [3] }, ['z', 'b', 'a'], 1));
    expect(columns).toEqual(['b', 'a', 'c']); // 'z' dropped, 'c' appended
  });

  it('encodes Float64Array non-finite cells', () => {
    const f = frame({ x: new Float64Array([NaN, Infinity, -Infinity, 0.5]) }, ['x'], 4);
    expect(columnarToRows(f).rows.map((r) => r.x)).toEqual(['NaN', 'Inf', '-Inf', '0.5']);
  });

  it('decodes a categorical column (missing code → empty cell)', () => {
    const cat: CategoricalColumn = {
      codes: Int32Array.from([0, 1, -1]),
      categories: ['(-0.1, 0.2]', '(0.2, 0.5]'],
    };
    const rows = columnarToRows(frame({ bin: cat }, ['bin'], 3)).rows;
    expect(rows.map((r) => r.bin)).toEqual(['(-0.1, 0.2]', '(0.2, 0.5]', '']);
  });
});

describe('referenceDistributionCsv', () => {
  it('emits risk_score,absolute_risk rows when a reference is present', () => {
    const fake = {
      reference: { riskScore: [0.1, 0.2], absoluteRisk: [0.01, 0.02] },
    } as unknown as ValidationResult;
    const parsed = csvParse(referenceDistributionCsv(fake) as string);
    expect(parsed.columns).toEqual(['risk_score', 'absolute_risk']);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({ risk_score: '0.1', absolute_risk: '0.01' });
  });

  it('returns null when there is no reference', () => {
    expect(referenceDistributionCsv({} as ValidationResult)).toBeNull();
  });
});

describe('slugify', () => {
  it('lowercases to single-dash alphanumerics, falling back to "validation"', () => {
    expect(slugify('iCARE-Lit ge50')).toBe('icare-lit-ge50');
    expect(slugify('Example dataset')).toBe('example-dataset');
    expect(slugify('A/B (x)!')).toBe('a-b-x');
    expect(slugify('')).toBe('validation');
  });
});

describe('mimeFor', () => {
  it('infers a MIME type from the extension', () => {
    expect(mimeFor('metrics.json')).toBe('application/json');
    expect(mimeFor('study-data.csv')).toBe('text/csv');
    expect(mimeFor('README.txt')).toBe('text/plain');
  });
});

describe.each<FixtureName>(['icare-lit-ge50', 'bpc3-covariate'])('resultsExport — %s', (name) => {
  const { result, normalized, rc } = setup(name);

  it('studyDataCsv: header matches frame order, row count matches nRows', () => {
    const parsed = csvParse(studyDataCsv(result));
    expect(parsed.columns).toEqual(result.studyData.order);
    expect(parsed.length).toBe(result.studyData.nRows);
  });

  it('studyDataCsv: censored subjects keep time_of_onset = Inf', () => {
    const parsed = csvParse(studyDataCsv(result));
    expect(parsed.some((r) => r.time_of_onset === 'Inf')).toBe(true);
  });

  it('incidenceRatesCsv: age + study_rate + population_rate, one row per age', () => {
    const parsed = csvParse(incidenceRatesCsv(result));
    expect(parsed.columns).toEqual(expect.arrayContaining(['age', 'study_rate', 'population_rate']));
    expect(parsed.length).toBe(result.incidenceRates.nRows);
  });

  it('sdkCalibrationCsv: verbatim SDK category table (10 bins)', () => {
    const parsed = csvParse(sdkCalibrationCsv(result));
    expect(parsed.columns).toEqual(result.categorySpecificCalibration.order);
    expect(parsed.length).toBe(10);
  });

  it('currentCalibrationCsv: one row per bin, degenerate flag, comma-safe interval labels', () => {
    const parsed = csvParse(currentCalibrationCsv(rc));
    expect(parsed.length).toBe(rc.bins.length);
    expect(parsed.columns).toEqual(expect.arrayContaining(['lo', 'hi', 'degenerate']));
    // LP-decile labels contain commas; a clean round-trip proves they were quoted.
    expect(parsed.some((r) => (r.category ?? '').includes(','))).toBe(true);
  });

  it('cohortSummary CSV/JSON reflect nested-case-control-ness', () => {
    const summary = computeCohortSummary(normalized.perSubject, normalized.isNcc);
    const csv = cohortSummaryCsv(summary);
    const json = JSON.parse(cohortSummaryJson(summary));
    expect(csv).toContain('n_subjects');
    expect(csv).toContain('n_censored');
    expect(csv).toContain('n_event_free');
    expect(csv).toContain('person_years');
    expect(json.nSubjects).toBe(normalized.perSubject.n);
    expect(json.nCensored).toBe(summary.nCensored);
    expect(json.personYears).toBe(summary.personYears);
    if (normalized.isNcc) {
      expect(csv).toContain('effective_n');
      expect(csv).toContain('effective_censored');
      expect(csv).toContain('weighted_case_fraction');
      expect(csv).toContain('weighted_followup_mean');
      expect(json.weighted).not.toBeNull();
    } else {
      expect(csv).not.toContain('effective_n');
      expect(csv).not.toContain('effective_censored');
      expect(json.weighted).toBeNull();
    }
  });

  it('no reference distribution for these fixtures', () => {
    expect(referenceDistributionCsv(result)).toBeNull();
  });

  it('metricsJson: provenance + both blocks; SDK scalars verbatim; default view is default', () => {
    const m = JSON.parse(
      metricsJson(result, normalized, rc, DEFAULT_REBIN, DEFAULT_SPEC, DEFAULT_PROVENANCE, NOW),
    );
    expect(m.app).toBe('iCARE-validate');
    expect(m.exportedAt).toBe('2026-07-04T12:00:00.000Z');
    expect(m.pyicareVersion).toBe('1.3.0');
    expect(m.isNcc).toBe(normalized.isNcc);
    expect(m.hasReference).toBe(false);
    // run provenance: Mode A with a blank imputation count → py-icare's default of 5, flagged as default
    expect(m.run).toEqual({ mode: 'A', imputations: 5, imputationsDefault: true, seed: 50 });
    // binning-invariant scalars come straight off the SDK result
    expect(m.sdkAsRun.auc.auc).toBe(result.auc.auc);
    expect(m.sdkAsRun.expectedByObservedRatio.ratio).toBe(result.expectedByObservedRatio.ratio);
    expect(m.sdkAsRun.calibration.absoluteRisk.chiSquare).toBe(
      result.calibration.absoluteRisk.statistic.chiSquare,
    );
    expect(m.sdkAsRun.calibration.absoluteRisk.degreesOfFreedom).toBe(
      result.calibration.absoluteRisk.parameter.degreesOfFreedom,
    );
    expect(m.currentView.binning.isDefaultRebin).toBe(true);
    expect(m.currentView.binning.nBins).toBe(10);
    expect(m.currentView.nExcluded).toBe(0); // continuous fixture scores → nothing unbinnable
    // recompute at the run-seeded default reproduces the SDK Hosmer–Lemeshow within engine tolerance
    const a = m.currentView.absoluteRiskGof.chiSquare;
    const b = m.sdkAsRun.calibration.absoluteRisk.chiSquare;
    expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(1e-3);
  });

  it('metricsJson: run provenance reflects mode, imputations, and seed', () => {
    // Mode A, explicit imputation count → reported verbatim, not flagged as the default
    const mA = JSON.parse(
      metricsJson(result, normalized, rc, DEFAULT_REBIN, DEFAULT_SPEC, {
        mode: 'A',
        numImputations: 20,
        seed: 7,
      }, NOW),
    );
    expect(mA.run).toEqual({ mode: 'A', imputations: 20, imputationsDefault: false, seed: 7 });
    // Mode B skips imputation entirely → imputations null
    const mB = JSON.parse(
      metricsJson(result, normalized, rc, DEFAULT_REBIN, DEFAULT_SPEC, {
        mode: 'B',
        numImputations: null,
        seed: 50,
      }, NOW),
    );
    expect(mB.run).toEqual({ mode: 'B', imputations: null, imputationsDefault: false, seed: 50 });
    // no provenance captured (pre-run / legacy) → null block
    const mNull = JSON.parse(
      metricsJson(result, normalized, rc, DEFAULT_REBIN, DEFAULT_SPEC, null, NOW),
    );
    expect(mNull.run).toBeNull();
  });

  it('metricsJson: a 3% absolute-risk re-bin moves currentView but not sdkAsRun', () => {
    const rc3 = recomputeCalibration(normalized.perSubject, normalized.isNcc, {
      scale: 'absolute-risk',
      cutoffs: [0.03],
    });
    const rebin3: RebinSnapshot = {
      scale: 'absolute-risk',
      method: 'cutpoints',
      numberOfPercentiles: 10,
      cutpoints: [3],
    };
    const mDef = JSON.parse(
      metricsJson(result, normalized, rc, DEFAULT_REBIN, DEFAULT_SPEC, DEFAULT_PROVENANCE, NOW),
    );
    const m3 = JSON.parse(
      metricsJson(result, normalized, rc3, rebin3, DEFAULT_SPEC, DEFAULT_PROVENANCE, NOW),
    );

    expect(m3.currentView.binning.isDefaultRebin).toBe(false);
    expect(m3.currentView.binning.scale).toBe('absolute-risk');
    expect(m3.currentView.binning.nBins).toBe(2);
    expect(m3.currentView.binning.cutpoints).toEqual([3]);
    // the official (as-run) block is unchanged by client-side re-binning
    expect(m3.sdkAsRun.calibration.absoluteRisk.chiSquare).toBe(
      mDef.sdkAsRun.calibration.absoluteRisk.chiSquare,
    );
    // the current-view GOF moves with the bins
    expect(m3.currentView.absoluteRiskGof.chiSquare).not.toBe(
      mDef.currentView.absoluteRiskGof.chiSquare,
    );
  });

  it('collectResultFiles: exact file set (no reference in these fixtures)', () => {
    const files = collectResultFiles(
      result,
      normalized,
      rc,
      DEFAULT_REBIN,
      DEFAULT_SPEC,
      DEFAULT_PROVENANCE,
      NOW,
    );
    expect(Object.keys(files).sort()).toEqual([
      'calibration-current-view.csv',
      'calibration-sdk-default.csv',
      'cohort-summary.csv',
      'cohort-summary.json',
      'incidence-rates.csv',
      'metrics.json',
      'study-data.csv',
    ]);
    expect(files['metrics.json']).toContain('iCARE-validate');
  });
});
