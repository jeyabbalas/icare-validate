import { describe, it, expect } from 'vitest';
import { normalizeValidationResult, decodeCategorical, asFloat64 } from './resultNormalizer';
import type { CategoricalColumn, ColumnarTableResult, ValidationResult } from '../lib/icareTypes';

// Synthetic frames exercise every decode path deterministically (no SDK boot). Integer columns are
// `number[]` and float columns are `Float64Array` — the real dtype split the coercion must smooth over.

function frame(columns: ColumnarTableResult['columns'], nRows: number): ColumnarTableResult {
  return { columns, order: Object.keys(columns), nRows };
}

function categorical(codes: number[], categories: string[]): CategoricalColumn {
  return { codes: Int32Array.from(codes), categories };
}

const studyCohort = frame(
  {
    id: [0, 1, 2],
    observed_outcome: [0, 1, 0],
    study_entry_age: [50, 55, 60],
    study_exit_age: [60, 65, 70],
    time_of_onset: Float64Array.from([Infinity, 62, Infinity]),
    observed_followup: Float64Array.from([10, 10, 10]),
    predicted_risk_interval: Float64Array.from([10, 10, 10]),
    followup: Float64Array.from([10, 10, 10]),
    risk_estimates: Float64Array.from([0.01, 0.05, 0.02]),
    linear_predictors: Float64Array.from([-0.5, 0.3, -0.1]),
    linear_predictors_category: categorical([0, 1, -1], ['(-0.5, 0]', '(0, 0.3]']),
  },
  3,
);

const studyNcc = frame(
  {
    ...studyCohort.columns,
    sampling_weights: Float64Array.from([0.1, 1, 0.2]),
    frequency: Float64Array.from([10, 1, 5]),
  },
  3,
);

const calibration = frame(
  {
    category: ['(-0.5, 0]', '(0, 0.3]'],
    observed_absolute_risk: Float64Array.from([0.01, 0.05]),
    predicted_absolute_risk: Float64Array.from([0.012, 0.048]),
    lower_ci_absolute_risk: Float64Array.from([0.0, 0.02]),
    upper_ci_absolute_risk: Float64Array.from([0.02, 0.08]),
    observed_relative_risk: Float64Array.from([0.5, 1.5]),
    predicted_relative_risk: Float64Array.from([0.6, 1.4]),
    lower_ci_relative_risk: Float64Array.from([0.3, 1.1]),
    upper_ci_relative_risk: Float64Array.from([0.9, 2.0]),
    expected_by_observed_ratio: Float64Array.from([NaN, 0.96]), // bin 0 degenerate
    lower_ci_expected_by_observed_ratio: Float64Array.from([NaN, 0.8]),
    upper_ci_expected_by_observed_ratio: Float64Array.from([NaN, 1.15]),
  },
  2,
);

const incidenceWithPop = frame(
  {
    age: [50, 51, 52],
    population_rate: Float64Array.from([0.001, 0.0011, 0.0012]),
    study_rate: Float64Array.from([0.0009, NaN, 0.0013]), // NaN: nobody at risk at age 51
  },
  3,
);

const incidenceNoPop = frame(
  { age: [50, 51], study_rate: Float64Array.from([0.0009, 0.001]) },
  2,
);

function makeResult(study: ColumnarTableResult, incidence: ColumnarTableResult): ValidationResult {
  return {
    studyData: study,
    categorySpecificCalibration: calibration,
    incidenceRates: incidence,
  } as unknown as ValidationResult;
}

describe('normalizeValidationResult — per-subject', () => {
  it('decodes a cohort result: coerced typed arrays, categorical labels, no NCC weights', () => {
    const n = normalizeValidationResult(makeResult(studyCohort, incidenceWithPop));
    expect(n.isNcc).toBe(false);

    const ps = n.perSubject;
    expect(ps.n).toBe(3);
    expect(ps.id).toEqual([0, 1, 2]);
    // integer column coerced to Float64Array
    expect(ps.observedOutcome).toBeInstanceOf(Float64Array);
    expect(Array.from(ps.observedOutcome)).toEqual([0, 1, 0]);
    expect(ps.riskEstimates).toBeInstanceOf(Float64Array);
    expect(ps.timeOfOnset[0]).toBe(Infinity); // censored preserved
    // categorical decoded; code -1 → null
    expect(ps.linearPredictorsCategory).toEqual(['(-0.5, 0]', '(0, 0.3]', null]);
    expect(ps.samplingWeights).toBeNull();
    expect(ps.frequency).toBeNull();
    // every per-subject array aligns to nRows
    for (const arr of [ps.observedOutcome, ps.studyEntryAge, ps.riskEstimates, ps.linearPredictors]) {
      expect(arr.length).toBe(3);
    }
  });

  it('flags nested case-control and surfaces sampling_weights + frequency', () => {
    const n = normalizeValidationResult(makeResult(studyNcc, incidenceWithPop));
    expect(n.isNcc).toBe(true);
    expect(Array.from(n.perSubject.samplingWeights!)).toEqual([0.1, 1, 0.2]);
    expect(Array.from(n.perSubject.frequency!)).toEqual([10, 1, 5]);
  });

  it('throws a descriptive error when a required column (risk_estimates) is missing', () => {
    const brokenColumns = { ...studyCohort.columns };
    delete (brokenColumns as Record<string, unknown>).risk_estimates;
    const broken = frame(brokenColumns, 3);
    expect(() => normalizeValidationResult(makeResult(broken, incidenceWithPop))).toThrow(
      /risk_estimates/,
    );
  });
});

describe('normalizeValidationResult — category calibration & incidence', () => {
  it('decodes all 12 calibration columns, preserving NaN in degenerate E/O bins', () => {
    const c = normalizeValidationResult(makeResult(studyCohort, incidenceWithPop)).categoryCalibration;
    expect(c.nBins).toBe(2);
    expect(c.category).toEqual(['(-0.5, 0]', '(0, 0.3]']);
    expect(c.observedAbsoluteRisk).toBeInstanceOf(Float64Array);
    expect(Number.isNaN(c.expectedByObservedRatio[0])).toBe(true);
    expect(c.expectedByObservedRatio[1]).toBeCloseTo(0.96);
    expect(Number.isNaN(c.lowerCiExpectedByObservedRatio[0])).toBe(true);
  });

  it('decodes incidence with a population rate and preserves NaN study_rate', () => {
    const inc = normalizeValidationResult(makeResult(studyCohort, incidenceWithPop)).incidence;
    expect(inc.populationRate).toBeInstanceOf(Float64Array);
    expect(inc.age.length).toBe(3);
    expect(Number.isNaN(inc.studyRate[1])).toBe(true);
  });

  it('leaves populationRate null when the frame has no population_rate column', () => {
    const inc = normalizeValidationResult(makeResult(studyCohort, incidenceNoPop)).incidence;
    expect(inc.populationRate).toBeNull();
    expect(inc.age.length).toBe(2);
  });
});

describe('decoding helpers', () => {
  it('decodeCategorical maps codes to labels and -1 to null', () => {
    expect(
      decodeCategorical({ codes: Int32Array.from([1, -1, 0]), categories: ['a', 'b'] }),
    ).toEqual(['b', null, 'a']);
  });

  it('asFloat64 passes a Float64Array through and copies a number[]', () => {
    const arr = Float64Array.from([1, 2]);
    expect(asFloat64(arr)).toBe(arr);
    const copied = asFloat64([3, 4]);
    expect(copied).toBeInstanceOf(Float64Array);
    expect(Array.from(copied)).toEqual([3, 4]);
  });
});
