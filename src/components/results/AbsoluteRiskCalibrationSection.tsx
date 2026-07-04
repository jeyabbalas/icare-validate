import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import {
  buildAbsoluteRiskCalibration,
  renderAbsoluteRiskCalibrationChart,
} from '../../viz/absoluteRiskCalibration';
import { OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { captionStyle, cssVar } from '../../viz/chartChrome';
import { formatGof, formatNumber } from '../../lib/format';
import { CalibrationBinTable } from './CalibrationBinTable';
import type { RecomputedCalibration } from '../../math/calibrationMath';
import type { ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// Results-step calibration viz #2 (Phase 8): the absolute-risk calibration scatter — predicted vs observed
// absolute risk per risk group, with the perfect-calibration identity line. Fed by the Phase-5 recompute
// engine (LP-decile bins, matching the SDK at the default deciles) so Phase 12's re-binning is a no-re-run
// update. Resolves the theme's colors to hex (Plot bakes colors in) and builds the overall goodness-of-fit
// annotation from the SDK scalars. Renders as a borderless `.cal-col` grid column: CalibrationPanel owns the
// card chrome and hands down a shared `rc` (computed once) so this and the relative scatter bin identically.

const TITLE = 'Absolute-risk calibration';

export interface AbsoluteRiskCalibrationSectionProps {
  rc: RecomputedCalibration;
  result: ValidationResult;
  normalized: NormalizedResult;
}

export function AbsoluteRiskCalibrationSection({
  rc,
  result,
  normalized,
}: AbsoluteRiskCalibrationSectionProps) {
  const theme = useAppStore((s) => s.theme);
  const isNcc = normalized.isNcc;

  const { points, domainMax } = useMemo(() => buildAbsoluteRiskCalibration(rc), [rc]);
  const hasData = points.length > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const observedColor = pickSeriesColor(OBSERVED_COLOR, theme);

  // Overall calibration read straight off the SDK result (matches the calibration header, and equals the
  // engine's values at the default deciles). E/O = calibration-in-the-large; H–L = the formal
  // goodness-of-fit test for this very plot.
  const annotationLines = [
    `E/O ${formatNumber(result.expectedByObservedRatio.ratio, 2)}`,
    `H–L ${formatGof(result.calibration.absoluteRisk)}`,
  ];

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderAbsoluteRiskCalibrationChart(Plot, {
          points,
          domainMax,
          title: TITLE,
          observedColor,
          annotationLines,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  const interval = result.info.riskPredictionInterval;
  const caption =
    `Each marker is one of ${rc.nBins} risk groups (quantiles of predicted risk): the model's mean ` +
    `predicted absolute risk (x) versus the observed absolute risk (y) — the probability of the event ` +
    `over the risk-prediction interval (${interval}) — with 95% Wald confidence intervals on the ` +
    `observed risk. Markers on the dotted identity line are well calibrated; above the line the model ` +
    `under-predicts risk in that group, below it over-predicts.` +
    (isNcc
      ? ' Observed risks and intervals are inverse-probability-weighted (nested case-control design).'
      : '');

  return (
    <figure className="cal-col" aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[points, domainMax, theme]}
        exportName="absolute-risk-calibration"
        pngBackground={surface}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
      <CalibrationBinTable bins={rc.bins} scale="absolute" isNcc={isNcc} />
    </figure>
  );
}
