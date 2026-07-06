import { formatNumber, formatPValue, formatCi, formatCount } from '../../lib/format';
import { Section } from '../ui/Section';
import { metricRow } from '../ui/styles';
import { Metric } from './Metric';
import { AbsoluteRiskCalibrationSection } from './AbsoluteRiskCalibrationSection';
import { RelativeRiskCalibrationSection } from './RelativeRiskCalibrationSection';
import { EoRatioSection } from './EoRatioSection';
import { RebinControls } from './RebinControls';
import type { GofResult, RecomputedCalibration } from '../../math/calibrationMath';
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

const excludedNote: React.CSSProperties = { margin: '0 0 12px', fontSize: 12, color: 'var(--app-muted)' };

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
  rc,
}: {
  result: ValidationResult;
  normalized: NormalizedResult;
  // One recompute (from `useRecomputedCalibration` in ResultsPanel) is shared by both sub-panels, the
  // E/O-by-group chart, and the "Download all" export, so the plots, tables, tiles, and files can't
  // diverge — and it severs the old live binSettingsStore read (a post-run input edit no longer re-bins).
  rc: RecomputedCalibration;
}) {
  const eo = result.expectedByObservedRatio;
  const total = normalized.perSubject.n;

  return (
    <Section title="Calibration">
      <div style={{ ...metricRow, marginBottom: 16 }}>
        <Metric
          label="E / O ratio"
          value={formatNumber(eo.ratio)}
          sub={formatCi(eo.lowerCi, eo.upperCi)}
        />
        {gofTile('Hosmer–Lemeshow', rc.absoluteRiskGof)}
        {gofTile('Relative-risk GOF', rc.relativeRiskGof)}
      </div>
      <RebinControls warnings={rc.warnings} />
      {rc.nExcluded > 0 && (
        <p style={excludedNote} role="note">
          {formatCount(total - rc.nExcluded)} of {formatCount(total)} subjects binned ·{' '}
          {formatCount(rc.nExcluded)} excluded from the per-bin calibration (missing risk score).
        </p>
      )}
      <div className="cal-grid">
        <AbsoluteRiskCalibrationSection rc={rc} result={result} normalized={normalized} />
        <RelativeRiskCalibrationSection rc={rc} normalized={normalized} />
      </div>
      <EoRatioSection rc={rc} />
    </Section>
  );
}
