import { useMemo } from 'react';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { recomputeCalibration } from '../../math/calibrationMath';
import { formatNumber, formatPValue, formatCi } from '../../lib/format';
import { cardStyle } from '../../viz/chartChrome';
import { Metric } from './Metric';
import { AbsoluteRiskCalibrationSection } from './AbsoluteRiskCalibrationSection';
import { RelativeRiskCalibrationSection } from './RelativeRiskCalibrationSection';
import type { GoodnessOfFitTest, ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// The unified, full-width Calibration container. Supersedes the two loose calibration cards (which rendered
// at unequal widths and with vertically mis-aligned bin-tables) and absorbs the overall calibration stats
// that used to live in the cohort-summary panel — shown here as three matching Metric tiles: E/O-in-the-large
// + its 95% CI, and the two goodness-of-fit tests (Hosmer–Lemeshow for absolute risk, GOF for relative risk).
// The Phase-5 recompute runs ONCE here (both sub-panels bin identically on the linear-predictor scale) and the
// same `rc` is handed to each, so the absolute and relative scatters and their per-bin tables are guaranteed to
// share one set of bins. The two sub-panels sit in a `.cal-grid` (see index.css): equal-width columns whose
// plot / caption / table rows align via CSS subgrid on wide viewports, stacking to one column on narrow ones.

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

/** One overall goodness-of-fit test as a Metric tile: the p-value as the headline, χ² · df as the sub-line. */
function gofTile(label: string, g: GoodnessOfFitTest) {
  return (
    <Metric
      label={label}
      value={`p ${formatPValue(g.pValue)}`}
      sub={`χ² ${formatNumber(g.statistic?.chiSquare, 2)} · df ${g.parameter?.degreesOfFreedom ?? '—'}`}
    />
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
        <Metric
          label="E / O ratio"
          value={formatNumber(eo.ratio)}
          sub={formatCi(eo.lowerCi, eo.upperCi)}
        />
        {gofTile('Hosmer–Lemeshow', result.calibration.absoluteRisk)}
        {gofTile('Relative-risk GOF', result.calibration.relativeRisk)}
      </div>
      <div className="cal-grid">
        <AbsoluteRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
        <RelativeRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
      </div>
    </section>
  );
}
