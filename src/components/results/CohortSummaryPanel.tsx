import { useMemo } from 'react';
import type { GoodnessOfFitTest, ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';
import { computeCohortSummary } from '../../lib/cohortSummary';
import { formatNumber, formatCount, formatRange, formatGof } from '../../lib/format';
import { Metric } from './Metric';

// Phase 6: the cohort summary a clinician reads first — py-icare's demo notebook (cell 50) text panel,
// reorganized into three grouped sections. Pure/presentational: `ResultsPanel` reads the store, guards the
// empty state, and passes `result` (SDK scalars, verbatim, at the default deciles) + `normalized`
// (per-subject arrays). Descriptive stats are derived unweighted (faithful to py-icare); a nested
// case-control study additionally surfaces the design-weighted "effective cohort" on each card's sub-line.

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

// en-dash CI, each endpoint finite-guarded to an em-dash
function ci(lower: number, upper: number, digits = 3): string {
  return `95% CI ${formatNumber(lower, digits)}–${formatNumber(upper, digits)}`;
}

function GofLine({ label, g }: { label: string; g: GoodnessOfFitTest }) {
  return (
    <div>
      <strong style={{ color: 'var(--app-fg)' }}>{label}:</strong> {formatGof(g)}
    </div>
  );
}

export function CohortSummaryPanel({
  result,
  normalized,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
}) {
  const ps = normalized.perSubject;
  const isNcc = normalized.isNcc;
  const s = useMemo(() => computeCohortSummary(ps, isNcc), [ps, isNcc]);
  const w = s.weighted;
  const { auc, brierScore, expectedByObservedRatio, calibration } = result;

  return (
    <>
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
            sub={w ? `effective ≈ ${formatCount(w.effectiveCases)}` : undefined}
          />
          <Metric
            label="Follow-up"
            value={`${formatNumber(s.followupMean, 1)} yr`}
            sub={
              <>
                range {formatRange(s.followupMin, s.followupMax, 1)}
                {w && ` · wt. mean ${formatNumber(w.followupMean, 1)}`}
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

      <section style={section}>
        <h3 style={sectionTitle}>Calibration</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={row}>
            <Metric
              label="E / O ratio"
              value={formatNumber(expectedByObservedRatio.ratio)}
              sub={ci(expectedByObservedRatio.lowerCi, expectedByObservedRatio.upperCi)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 12,
              color: 'var(--app-muted)',
              paddingTop: 4,
            }}
          >
            <GofLine label="Hosmer–Lemeshow (absolute risk)" g={calibration.absoluteRisk} />
            <GofLine label="Relative-risk GOF" g={calibration.relativeRisk} />
          </div>
        </div>
      </section>

      <section style={section}>
        <h3 style={sectionTitle}>Discrimination</h3>
        <div style={row}>
          <Metric label="AUC" value={formatNumber(auc.auc)} sub={ci(auc.lowerCi, auc.upperCi)} />
          <Metric
            label="Brier score"
            value={formatNumber(brierScore.brierScore, 4)}
            sub={ci(brierScore.lowerCi, brierScore.upperCi, 4)}
          />
        </div>
      </section>
    </>
  );
}
