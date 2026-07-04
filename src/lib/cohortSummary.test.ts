import { describe, it, expect } from 'vitest';
import { loadFixture, type FixtureName } from '../math/fixtures/loadFixture';
import { normalizeValidationResult, type PerSubject } from '../services/resultNormalizer';
import { computeCohortSummary } from './cohortSummary';

// Correctness is anchored to py-icare's notebook reductions (unweighted mean / min / max / count), so the
// test recomputes each stat with an INDEPENDENT naive loop and asserts the module matches. Comparing the
// follow-up mean against `perSubject.followup` (not `observedFollowup`) also pins that we read the correct,
// risk-interval-truncated column. Live fixtures are the same two examples used elsewhere: iCARE-Lit ge50
// (cohort) and BPC3 (nested case-control).

const rawSum = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i];
  return s;
};
const rawMean = (a: ArrayLike<number>): number => rawSum(a) / a.length;
const rawMin = (a: ArrayLike<number>): number => {
  let m = Infinity;
  for (let i = 0; i < a.length; i += 1) if (a[i] < m) m = a[i];
  return m;
};
const rawMax = (a: ArrayLike<number>): number => {
  let m = -Infinity;
  for (let i = 0; i < a.length; i += 1) if (a[i] > m) m = a[i];
  return m;
};
const rawWeightedSum = (a: ArrayLike<number>, w: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * w[i];
  return s;
};

const empty = new Float64Array(0);
function makePerSubject(fields: Partial<PerSubject> & { n: number }): PerSubject {
  return {
    observedOutcome: empty,
    studyEntryAge: empty,
    studyExitAge: empty,
    timeOfOnset: empty,
    observedFollowup: empty,
    predictedRiskInterval: empty,
    followup: empty,
    riskEstimates: empty,
    linearPredictors: empty,
    linearPredictorsCategory: [],
    samplingWeights: null,
    frequency: null,
    ...fields,
  };
}

const CASES: Array<{ name: FixtureName; ncc: boolean }> = [
  { name: 'icare-lit-ge50', ncc: false },
  { name: 'bpc3-covariate', ncc: true },
];

describe.each(CASES)('computeCohortSummary — $name (live fixture)', ({ name, ncc }) => {
  const { result } = loadFixture(name);
  const normalized = normalizeValidationResult(result);
  const ps = normalized.perSubject;
  const s = computeCohortSummary(ps, normalized.isNcc);

  it('detects the study design as expected', () => {
    expect(normalized.isNcc).toBe(ncc);
  });

  it('counts subjects and cases unweighted', () => {
    expect(s.nSubjects).toBe(ps.n);
    expect(s.nSubjects).toBe(ps.observedOutcome.length);
    expect(s.nCases).toBeCloseTo(rawSum(ps.observedOutcome), 6);
    expect(s.nCases).toBeGreaterThan(0);
    expect(s.nCases).toBeLessThanOrEqual(s.nSubjects);
  });

  it('reduces follow-up over the (truncated) `followup` column', () => {
    expect(s.followupMean).toBeCloseTo(rawMean(ps.followup), 9);
    expect(s.followupMin).toBe(rawMin(ps.followup));
    expect(s.followupMax).toBe(rawMax(ps.followup));
    expect(s.followupMin).toBeLessThanOrEqual(s.followupMean);
    expect(s.followupMean).toBeLessThanOrEqual(s.followupMax);
  });

  it('reduces baseline age over `study_entry_age`', () => {
    expect(s.baselineAgeMean).toBeCloseTo(rawMean(ps.studyEntryAge), 9);
    expect(s.baselineAgeMin).toBe(rawMin(ps.studyEntryAge));
    expect(s.baselineAgeMax).toBe(rawMax(ps.studyEntryAge));
  });

  it('partitions censoring (event-free + after-horizon) and totals person-time', () => {
    // Independent recompute of the censoring partition: event-free = time_of_onset is Inf;
    // after-horizon = a control (observed_outcome 0) whose onset is finite (fell past the interval).
    let eventFree = 0;
    let afterHorizon = 0;
    for (let i = 0; i < ps.n; i += 1) {
      if (!Number.isFinite(ps.timeOfOnset[i])) eventFree += 1;
      else if (ps.observedOutcome[i] === 0) afterHorizon += 1;
    }
    expect(s.nEventFree).toBe(eventFree);
    expect(s.nAfterHorizon).toBe(afterHorizon);
    // The two invariants that must always hold.
    expect(s.nEventFree + s.nAfterHorizon).toBe(s.nCensored);
    expect(s.nCases + s.nCensored).toBeCloseTo(s.nSubjects, 6);
    // Person-time and the incidence/censoring proportions.
    expect(s.personYears).toBeCloseTo(rawSum(ps.followup), 6);
    expect(s.caseFraction).toBeCloseTo(s.nCases / s.nSubjects, 12);
    expect(s.censoredFraction).toBeCloseTo(s.nCensored / s.nSubjects, 12);
    expect(s.caseFraction + s.censoredFraction).toBeCloseTo(1, 12);
  });

  if (ncc) {
    it('adds the design-weighted effective cohort', () => {
      expect(s.weighted).not.toBeNull();
      const w = s.weighted!;
      const freq = ps.frequency!;
      expect(w.effectiveN).toBeCloseTo(rawSum(freq), 6);
      expect(w.effectiveCases).toBeCloseTo(rawWeightedSum(ps.observedOutcome, freq), 6);
      expect(w.followupMean).toBeCloseTo(rawWeightedSum(ps.followup, freq) / rawSum(freq), 9);
      expect(w.baselineAgeMean).toBeCloseTo(rawWeightedSum(ps.studyEntryAge, freq) / rawSum(freq), 9);
      // effective cohort is a strict inflation of the analyzed nested sample
      expect(w.effectiveN).toBeGreaterThan(s.nSubjects);
      expect(w.effectiveCases).toBeGreaterThan(0);
      expect(w.effectiveCases).toBeLessThan(w.effectiveN);
      // design-weighted censored total + the design-consistent incidence proportion
      expect(w.effectiveCensored).toBeCloseTo(w.effectiveN - w.effectiveCases, 6);
      expect(w.effectiveCensored).toBeCloseTo(rawSum(freq) - rawWeightedSum(ps.observedOutcome, freq), 6);
      expect(w.weightedCaseFraction).toBeCloseTo(w.effectiveCases / w.effectiveN, 12);
      expect(w.weightedCaseFraction).toBeGreaterThan(0);
      expect(w.weightedCaseFraction).toBeLessThan(1);
    });
  } else {
    it('has no weighted block for a cohort study', () => {
      expect(s.weighted).toBeNull();
    });
  }
});

describe('computeCohortSummary — edge cases', () => {
  it('empty study → zero counts, NaN reductions, no weighted block', () => {
    const s = computeCohortSummary(makePerSubject({ n: 0 }), false);
    expect(s.nSubjects).toBe(0);
    expect(s.nCases).toBe(0);
    expect(s.nCensored).toBe(0);
    expect(s.nEventFree).toBe(0);
    expect(s.nAfterHorizon).toBe(0);
    expect(s.personYears).toBe(0);
    expect(Number.isNaN(s.caseFraction)).toBe(true);
    expect(Number.isNaN(s.censoredFraction)).toBe(true);
    expect(Number.isNaN(s.followupMean)).toBe(true);
    expect(Number.isNaN(s.followupMin)).toBe(true);
    expect(Number.isNaN(s.baselineAgeMax)).toBe(true);
    expect(s.weighted).toBeNull();
  });

  it('all-controls → zero cases, all censored as event-free', () => {
    const s = computeCohortSummary(
      makePerSubject({
        n: 3,
        observedOutcome: Float64Array.from([0, 0, 0]),
        timeOfOnset: Float64Array.from([Infinity, Infinity, Infinity]),
        followup: Float64Array.from([4, 5, 6]),
        studyEntryAge: Float64Array.from([50, 55, 60]),
      }),
      false,
    );
    expect(s.nCases).toBe(0);
    expect(s.nCensored).toBe(3);
    expect(s.nEventFree).toBe(3);
    expect(s.nAfterHorizon).toBe(0);
    expect(s.caseFraction).toBe(0);
    expect(s.censoredFraction).toBe(1);
    expect(s.personYears).toBeCloseTo(15, 12); // 4 + 5 + 6
    expect(s.followupMean).toBeCloseTo(5, 12);
    expect(s.followupMin).toBe(4);
    expect(s.followupMax).toBe(6);
    expect(s.baselineAgeMean).toBeCloseTo(55, 12);
  });

  it('splits censored into event-free vs. after-horizon', () => {
    const s = computeCohortSummary(
      makePerSubject({
        n: 3,
        observedOutcome: Float64Array.from([1, 0, 0]),
        // case (onset within interval); event-free (Inf); onset past the horizon (finite, censored)
        timeOfOnset: Float64Array.from([3, Infinity, 8]),
        followup: Float64Array.from([3, 10, 5]),
        studyEntryAge: Float64Array.from([50, 55, 60]),
      }),
      false,
    );
    expect(s.nCases).toBe(1);
    expect(s.nEventFree).toBe(1); // the Inf
    expect(s.nAfterHorizon).toBe(1); // finite onset on a control → beyond the horizon
    expect(s.nCensored).toBe(2);
    expect(s.nCases + s.nCensored).toBe(s.nSubjects);
    expect(s.caseFraction).toBeCloseTo(1 / 3, 12);
    expect(s.censoredFraction).toBeCloseTo(2 / 3, 12);
    expect(s.personYears).toBeCloseTo(18, 12); // 3 + 10 + 5
  });

  it('single subject → mean equals the lone value; min == max', () => {
    const s = computeCohortSummary(
      makePerSubject({
        n: 1,
        observedOutcome: Float64Array.from([1]),
        timeOfOnset: Float64Array.from([5]),
        followup: Float64Array.from([7.5]),
        studyEntryAge: Float64Array.from([62]),
      }),
      false,
    );
    expect(s.nCases).toBe(1);
    expect(s.nCensored).toBe(0);
    expect(s.nEventFree).toBe(0);
    expect(s.nAfterHorizon).toBe(0);
    expect(s.caseFraction).toBe(1);
    expect(s.censoredFraction).toBe(0);
    expect(s.personYears).toBe(7.5);
    expect(s.followupMean).toBe(7.5);
    expect(s.followupMin).toBe(7.5);
    expect(s.followupMax).toBe(7.5);
    expect(s.baselineAgeMean).toBe(62);
  });

  it('nested case-control → Horvitz–Thompson totals and weighted means', () => {
    const s = computeCohortSummary(
      makePerSubject({
        n: 2,
        observedOutcome: Float64Array.from([1, 0]),
        timeOfOnset: Float64Array.from([3, Infinity]),
        followup: Float64Array.from([5, 10]),
        studyEntryAge: Float64Array.from([50, 60]),
        samplingWeights: Float64Array.from([0.5, 0.25]),
        frequency: Float64Array.from([2, 4]),
      }),
      true,
    );
    expect(s.nSubjects).toBe(2);
    expect(s.nCases).toBe(1);
    expect(s.nCensored).toBe(1);
    expect(s.nEventFree).toBe(1);
    expect(s.weighted).not.toBeNull();
    expect(s.weighted!.effectiveN).toBeCloseTo(6, 12); // 2 + 4
    expect(s.weighted!.effectiveCases).toBeCloseTo(2, 12); // 1·2 + 0·4
    expect(s.weighted!.effectiveCensored).toBeCloseTo(4, 12); // 6 − 2
    expect(s.weighted!.weightedCaseFraction).toBeCloseTo(2 / 6, 12); // 2 / 6
    expect(s.weighted!.followupMean).toBeCloseTo(50 / 6, 12); // (5·2 + 10·4)/6
    expect(s.weighted!.baselineAgeMean).toBeCloseTo(340 / 6, 12); // (50·2 + 60·4)/6
  });

  it('ignores the weighted request when frequency is absent (defensive)', () => {
    const s = computeCohortSummary(
      makePerSubject({
        n: 1,
        observedOutcome: Float64Array.from([0]),
        timeOfOnset: Float64Array.from([Infinity]),
        frequency: null,
      }),
      true, // isNcc true but no frequency column
    );
    expect(s.weighted).toBeNull();
  });
});
