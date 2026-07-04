import { useMemo } from 'react';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { recomputeCalibration } from '../../math/calibrationMath';
import { formatNumber, formatGof, formatCi } from '../../lib/format';
import { cardStyle } from '../../viz/chartChrome';
import { Metric } from './Metric';
import { AbsoluteRiskCalibrationSection } from './AbsoluteRiskCalibrationSection';
import { RelativeRiskCalibrationSection } from './RelativeRiskCalibrationSection';
import type { GoodnessOfFitTest, ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// The unified, full-width Calibration container. Supersedes the two loose calibration cards (which rendered
// at unequal widths and with vertically mis-aligned bin-tables) and absorbs the overall calibration stats
// that used to live in the cohort-summary panel — E/O-in-the-large + its 95% CI, and the two goodness-of-fit
// tests. The Phase-5 recompute runs ONCE here (both sub-panels bin identically on the linear-predictor scale)
// and the same `rc` is handed to each, so the absolute and relative scatters and their per-bin tables are
// guaranteed to share one set of bins. The two sub-panels sit in a `.cal-grid` (see index.css): equal-width
// columns whose plot / caption / table rows align via CSS subgrid on wide viewports, stacking to one column
// on narrow ones.

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
  gap: 16,
  alignItems: 'flex-start',
  marginBottom: 16,
};
const metricRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10 };
const gofCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontSize: 12,
  color: 'var(--app-muted)',
  paddingTop: 4,
};

/** One overall goodness-of-fit line: bold label + the SDK's χ²/df/p summary (relocated from the summary panel). */
function GofLine({ label, g }: { label: string; g: GoodnessOfFitTest }) {
  return (
    <div>
      <strong style={{ color: 'var(--app-fg)' }}>{label}:</strong> {formatGof(g)}
    </div>
  );
}

export function CalibrationPanel({
  result,
  normalized,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
}) {
  const numberOfPercentiles = useBinSettingsStore((s) => s.numberOfPercentiles);

  // One recompute for both sub-panels (identical LP-decile bins) — reproduces
  // result.categorySpecificCalibration at the default deciles and re-bins instantly in Phase 12.
  const rc = useMemo(
    () =>
      recomputeCalibration(normalized.perSubject, normalized.isNcc, {
        scale: 'linear-predictor',
        numberOfPercentiles,
      }),
    [normalized.perSubject, normalized.isNcc, numberOfPercentiles],
  );

  const eo = result.expectedByObservedRatio;

  return (
    <section style={card} aria-label="Calibration">
      <h3 style={sectionTitle}>Calibration</h3>
      <div style={headerRow}>
        <div style={metricRow}>
          <Metric
            label="E / O ratio"
            value={formatNumber(eo.ratio)}
            sub={formatCi(eo.lowerCi, eo.upperCi)}
          />
        </div>
        <div style={gofCol}>
          <GofLine label="Hosmer–Lemeshow (absolute risk)" g={result.calibration.absoluteRisk} />
          <GofLine label="Relative-risk GOF" g={result.calibration.relativeRisk} />
        </div>
      </div>
      <div className="cal-grid">
        <AbsoluteRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
        <RelativeRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
      </div>
    </section>
  );
}
