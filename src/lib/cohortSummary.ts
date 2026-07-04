// The descriptive cohort statistics for the Phase-6 summary panel. py-icare does NOT compute these — its
// demo notebook (cell 50) derives them as plain, UNWEIGHTED reductions over the returned study_data, and we
// replicate that exactly: N = row count, cases = Σ observed_outcome (post-censoring), follow-up over the
// `followup` column (the risk-interval-truncated one, NOT `observed_followup`), baseline age over
// `study_entry_age`, each as mean + [min, max].
//
// Extension (user decision): for a nested case-control study we ALSO surface the design-weighted
// "effective cohort" — the Horvitz–Thompson totals/means under `frequency = 1/sampling_weights` — shown
// alongside (never replacing) the faithful raw-sample figures.
//
// Censoring: py-icare validates a FIXED-HORIZON model, so after its two censoring stages every subject is
// either a case (observed_outcome === 1: an event inside BOTH observed follow-up and the prediction
// interval) or censored. The censored partition into "event-free" (time_of_onset === Inf — no onset
// during observed follow-up) and "after horizon" (a finite onset that fell BEYOND the prediction interval,
// so py-icare administratively censors it — its time_of_onset stays finite, not Inf). We also total the
// person-time at risk (Σ `followup`) and the observed cumulative-incidence proportion (cases / subjects).

import { mean, weightedMean, sumKahan, extent } from '../math/numeric';
import type { PerSubject } from '../services/resultNormalizer';

export interface WeightedCohortSummary {
  effectiveN: number; // Σ frequency — estimated source-population size
  effectiveCases: number; // Σ frequency·observed_outcome — estimated source-population cases
  effectiveCensored: number; // effectiveN − effectiveCases — estimated source-population censored
  weightedCaseFraction: number; // effectiveCases / effectiveN — design-consistent incidence proportion
  followupMean: number; // weightedMean(followup, frequency)
  baselineAgeMean: number; // weightedMean(study_entry_age, frequency)
}

export interface CohortSummary {
  nSubjects: number; // raw row count (analyzed sample)
  nCases: number; // Σ observed_outcome (unweighted; events within the validated window)
  nCensored: number; // subjects without an in-window event: nSubjects − nCases = nEventFree + nAfterHorizon
  nEventFree: number; // censored with time_of_onset === Inf (no onset during observed follow-up)
  nAfterHorizon: number; // censored with a finite onset beyond the prediction interval (administrative)
  caseFraction: number; // nCases / nSubjects — observed cumulative-incidence proportion (NaN if empty)
  censoredFraction: number; // nCensored / nSubjects (NaN if empty)
  personYears: number; // Σ followup — total person-time at risk over the (truncated) follow-up
  followupMean: number;
  followupMin: number;
  followupMax: number;
  baselineAgeMean: number;
  baselineAgeMin: number;
  baselineAgeMax: number;
  weighted: WeightedCohortSummary | null; // present only for a nested case-control study
}

/** Σ(xᵢ·wᵢ) with Kahan compensation — the weighted counterpart of `sumKahan`, kept local (one caller). */
function weightedSum(xs: ArrayLike<number>, ws: ArrayLike<number>): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const y = xs[i] * ws[i] - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

export function computeCohortSummary(perSubject: PerSubject, isNcc: boolean): CohortSummary {
  const { observedOutcome, timeOfOnset, followup, studyEntryAge, frequency } = perSubject;
  const n = perSubject.n;

  const [followupMin, followupMax] = extent(followup);
  const [baselineAgeMin, baselineAgeMax] = extent(studyEntryAge);

  const nCases = sumKahan(observedOutcome); // 0/1 column → Σ is the case count

  // Partition the censored subjects in one pass. A censored subject is either "event-free"
  // (time_of_onset === Inf) or "after horizon" (observed_outcome === 0 with a finite onset — an event that
  // fell beyond the prediction interval, so py-icare administratively censored it). Cases always carry a
  // finite time_of_onset, so `!isFinite` isolates the event-free group cleanly.
  let nEventFree = 0;
  let nAfterHorizon = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(timeOfOnset[i])) nEventFree += 1;
    else if (observedOutcome[i] === 0) nAfterHorizon += 1;
  }
  const nCensored = nEventFree + nAfterHorizon; // === n − nCases

  let weighted: WeightedCohortSummary | null = null;
  if (isNcc && frequency) {
    const effectiveN = sumKahan(frequency);
    const effectiveCases = weightedSum(observedOutcome, frequency);
    weighted = {
      effectiveN,
      effectiveCases,
      effectiveCensored: effectiveN - effectiveCases,
      weightedCaseFraction: effectiveCases / effectiveN,
      followupMean: weightedMean(followup, frequency),
      baselineAgeMean: weightedMean(studyEntryAge, frequency),
    };
  }

  return {
    nSubjects: n,
    nCases,
    nCensored,
    nEventFree,
    nAfterHorizon,
    caseFraction: n > 0 ? nCases / n : NaN,
    censoredFraction: n > 0 ? nCensored / n : NaN,
    personYears: sumKahan(followup),
    followupMean: mean(followup),
    followupMin,
    followupMax,
    baselineAgeMean: mean(studyEntryAge),
    baselineAgeMin,
    baselineAgeMax,
    weighted,
  };
}
