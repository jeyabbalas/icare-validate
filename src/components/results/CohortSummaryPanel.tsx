import { useMemo } from 'react';
import type { NormalizedResult } from '../../services/resultNormalizer';
import { computeCohortSummary } from '../../lib/cohortSummary';
import { formatNumber, formatCount, formatRange, formatPercent } from '../../lib/format';
import { Metric } from './Metric';

// Phase 6: the cohort summary a clinician reads first — py-icare's demo notebook (cell 50) text panel,
// reorganized into grouped sections. Pure/presentational: `ResultsPanel` reads the store, guards the empty
// state, and passes `normalized` (per-subject arrays). Descriptive stats are derived unweighted (faithful to
// py-icare); a nested case-control study additionally surfaces the design-weighted "effective cohort" on
// each card's sub-line. Cases carries the observed cumulative-incidence proportion, and a Censored card
// surfaces py-icare's fixed-horizon censoring (event-free vs. administratively censored past the horizon)
// with total person-time on Follow-up. Calibration (E/O + goodness-of-fit) and Discrimination (AUC, Brier)
// now live in their own dedicated panels, so this panel is Cohort-only.

const section: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  marginBottom: 16,
};
const sectionTitle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--app-muted)',
};
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10 };

export function CohortSummaryPanel({ normalized }: { normalized: NormalizedResult }) {
  const ps = normalized.perSubject;
  const isNcc = normalized.isNcc;
  const s = useMemo(() => computeCohortSummary(ps, isNcc), [ps, isNcc]);
  const w = s.weighted;

  return (
    <section style={section}>
      <h3 style={sectionTitle}>Cohort</h3>
      <div style={row}>
        <Metric
          label="Subjects"
          value={formatCount(s.nSubjects)}
          sub={w ? `effective cohort ≈ ${formatCount(w.effectiveN)}` : undefined}
        />
        <Metric
          label="Cases"
          value={formatCount(s.nCases)}
          sub={
            w
              ? `effective ≈ ${formatCount(w.effectiveCases)} · ${formatPercent(w.weightedCaseFraction, 1)} of source pop.`
              : `${formatPercent(s.caseFraction, 1)} of subjects`
          }
        />
        <Metric
          label="Censored"
          value={formatCount(s.nCensored)}
          title="Censored = subjects with no event inside the risk-prediction window. Event-free: no onset during their observed follow-up (time_of_onset = ∞). After horizon: an onset did occur, but beyond the prediction interval, so iCARE administratively censors it."
          sub={
            <>
              {w
                ? `effective ≈ ${formatCount(w.effectiveCensored)}`
                : `${formatPercent(s.censoredFraction, 1)} of subjects`}
              <br />
              {formatCount(s.nEventFree)} event-free · {formatCount(s.nAfterHorizon)} after horizon
            </>
          }
        />
        <Metric
          label="Follow-up"
          value={`${formatNumber(s.followupMean, 1)} yr`}
          sub={
            <>
              range {formatRange(s.followupMin, s.followupMax, 1)}
              {w && ` · wt. mean ${formatNumber(w.followupMean, 1)}`}
              <br />Σ {formatCount(s.personYears)} person-yr
            </>
          }
        />
        <Metric
          label="Baseline age"
          value={`${formatNumber(s.baselineAgeMean, 1)} yr`}
          sub={
            <>
              range {formatRange(s.baselineAgeMin, s.baselineAgeMax, 1)}
              {w && ` · wt. mean ${formatNumber(w.baselineAgeMean, 1)}`}
            </>
          }
        />
      </div>
    </section>
  );
}
