// The descriptive cohort statistics for the Phase-6 summary panel. py-icare does NOT compute these — its
// demo notebook (cell 50) derives them as plain, UNWEIGHTED reductions over the returned study_data, and we
// replicate that exactly: N = row count, cases = Σ observed_outcome (post-censoring), follow-up over the
// `followup` column (the risk-interval-truncated one, NOT `observed_followup`), baseline age over
// `study_entry_age`, each as mean + [min, max].
//
// Extension (user decision): for a nested case-control study we ALSO surface the design-weighted
// "effective cohort" — the Horvitz–Thompson totals/means under `frequency = 1/sampling_weights` — shown
// alongside (never replacing) the faithful raw-sample figures.

import { mean, weightedMean, sumKahan, extent } from '../math/numeric';
import type { PerSubject } from '../services/resultNormalizer';

export interface WeightedCohortSummary {
  effectiveN: number; // Σ frequency — estimated source-population size
  effectiveCases: number; // Σ frequency·observed_outcome — estimated source-population cases
  followupMean: number; // weightedMean(followup, frequency)
  baselineAgeMean: number; // weightedMean(study_entry_age, frequency)
}

export interface CohortSummary {
  nSubjects: number; // raw row count (analyzed sample)
  nCases: number; // Σ observed_outcome (unweighted; events within the validated window)
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
  const { observedOutcome, followup, studyEntryAge, frequency } = perSubject;

  const [followupMin, followupMax] = extent(followup);
  const [baselineAgeMin, baselineAgeMax] = extent(studyEntryAge);

  let weighted: WeightedCohortSummary | null = null;
  if (isNcc && frequency) {
    weighted = {
      effectiveN: sumKahan(frequency),
      effectiveCases: weightedSum(observedOutcome, frequency),
      followupMean: weightedMean(followup, frequency),
      baselineAgeMean: weightedMean(studyEntryAge, frequency),
    };
  }

  return {
    nSubjects: perSubject.n,
    nCases: sumKahan(observedOutcome), // 0/1 column → Σ is the case count
    followupMean: mean(followup),
    followupMin,
    followupMax,
    baselineAgeMean: mean(studyEntryAge),
    baselineAgeMin,
    baselineAgeMax,
    weighted,
  };
}
