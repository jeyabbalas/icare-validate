import { formatNumber, formatPValue, formatCi } from '../../lib/format';
import { cardStyle } from '../../viz/chartChrome';
import { Metric } from './Metric';
import { AbsoluteRiskCalibrationSection } from './AbsoluteRiskCalibrationSection';
import { RelativeRiskCalibrationSection } from './RelativeRiskCalibrationSection';
import { RebinControls } from './RebinControls';
import { useRecomputedCalibration } from './useRecomputedCalibration';
import type { GofResult } from '../../math/calibrationMath';
import type { ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// The unified, full-width Calibration container. Supersedes the two loose calibration cards (which rendered
// at unequal widths and with vertically mis-aligned bin-tables) and absorbs the overall calibration stats
// that used to live in the cohort-summary panel — shown here as three matching Metric tiles: E/O-in-the-large
// + its 95% CI, and the two goodness-of-fit tests (Hosmer–Lemeshow for absolute risk, GOF for relative risk).
// The Phase-5 recompute runs ONCE via `useRecomputedCalibration` and the same `rc` is handed to each sub-panel,
// so the absolute and relative scatters and their per-bin tables always share one set of bins. Phase 12 drives
// the bins from the results-scoped `rebinStore` (interactive re-binning, no SDK re-run), so the two GOF tiles
// re-source from `rc` and move with the bins; E/O-in-the-large stays the SDK scalar (Σpredicted/Σobserved,
// binning-invariant). The two sub-panels sit in a `.cal-grid` (see index.css): equal-width columns whose
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

/**
 * One recomputed goodness-of-fit test as a Metric tile: the p-value as the headline, χ² · df as the
 * sub-line. Reads the engine's FLAT GofResult; an undefined GOF (an empty/degenerate bin makes χ² NaN)
 * shows an em-dash headline while still reporting its df.
 */
function gofTile(label: string, g: GofResult) {
  return (
    <Metric
      label={label}
      value={g.defined ? `p ${formatPValue(g.pValue)}` : '—'}
      sub={`χ² ${formatNumber(g.chiSquare, 2)} · df ${g.degreesOfFreedom}`}
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
  // One recompute for both sub-panels, driven by the results-scoped rebinStore (severs the old live
  // binSettingsStore read, which let a post-run input-config edit silently re-bin the results).
  const rc = useRecomputedCalibration(normalized);

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
        {gofTile('Hosmer–Lemeshow', rc.absoluteRiskGof)}
        {gofTile('Relative-risk GOF', rc.relativeRiskGof)}
      </div>
      <RebinControls warnings={rc.warnings} />
      <div className="cal-grid">
        <AbsoluteRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
        <RelativeRiskCalibrationSection rc={rc} normalized={normalized} />
      </div>
    </section>
  );
}
