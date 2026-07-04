import { formatCi, formatNumber } from '../../lib/format';
import { cardStyle } from '../../viz/chartChrome';
import { Metric } from './Metric';
import { DiscriminationKdeSection } from './DiscriminationKdeSection';
import type { ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// The Discrimination container (Phase 10), mirroring CalibrationPanel: it absorbs the overall discrimination
// stats that used to live in the cohort-summary panel — AUC + its 95% CI and the Brier score — as matching
// Metric tiles, then houses the risk-distribution KDE. Phase 11 adds the ROC curve beside it. Kept as a
// dedicated panel (not a sub-section of the cohort summary) so the results dashboard reads Cohort →
// Calibration → Discrimination, each self-contained.

const card: React.CSSProperties = { ...cardStyle, margin: '0 0 16px' };
const sectionTitle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--app-muted)',
};
const headerRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 16,
};

export function DiscriminationPanel({
  result,
  normalized,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
}) {
  const { auc, brierScore } = result;

  return (
    <section style={card} aria-label="Discrimination">
      <h3 style={sectionTitle}>Discrimination</h3>
      <div style={headerRow}>
        <Metric
          label="AUC"
          value={formatNumber(auc.auc)}
          sub={formatCi(auc.lowerCi, auc.upperCi)}
        />
        <Metric
          label="Brier score"
          value={formatNumber(brierScore.brierScore, 4)}
          sub={formatCi(brierScore.lowerCi, brierScore.upperCi, 4)}
        />
      </div>
      <DiscriminationKdeSection
        perSubject={normalized.perSubject}
        isNcc={normalized.isNcc}
        auc={auc}
      />
    </section>
  );
}
