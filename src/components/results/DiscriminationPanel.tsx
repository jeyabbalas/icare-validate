import { formatCi, formatNumber } from '../../lib/format';
import { Section } from '../ui/Section';
import { metricRow } from '../ui/styles';
import { Metric } from './Metric';
import { DiscriminationKdeSection } from './DiscriminationKdeSection';
import { RocSection } from './RocSection';
import type { ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// The Discrimination container (Phase 10), mirroring CalibrationPanel: it absorbs the overall discrimination
// stats that used to live in the cohort-summary panel — AUC + its 95% CI and the Brier score — as matching
// Metric tiles, then houses the risk-distribution KDE with the ROC curve stacked below it (Phase 11). Kept
// as a dedicated panel (not a sub-section of the cohort summary) so the results dashboard reads Cohort →
// Calibration → Discrimination, each self-contained.

export function DiscriminationPanel({
  result,
  normalized,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
}) {
  const { auc, brierScore } = result;

  return (
    <Section title="Discrimination">
      <div style={{ ...metricRow, marginBottom: 16 }}>
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
      <RocSection perSubject={normalized.perSubject} isNcc={normalized.isNcc} auc={auc} />
    </Section>
  );
}
