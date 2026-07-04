import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import { buildEoRatio, renderEoRatioChart } from '../../viz/eoRatio';
import { OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { captionStyle, cssVar } from '../../viz/chartChrome';
import { formatGofResult } from '../../lib/format';
import type { RecomputedCalibration } from '../../math/calibrationMath';

// Results-step calibration viz #4 (Phase 12): the Expected/Observed-by-group plot, mounted full-width below
// the two calibration scatters inside the Calibration panel. Reads the same shared `rc`, so it re-bins with
// no SDK re-run. Its annotation is the recomputed Hosmer–Lemeshow test (the formal summary of these per-group
// E/O deviations), matching the absolute-risk scatter's H–L line.

const TITLE = 'Expected / Observed by risk group';

const sectionStyle: React.CSSProperties = {
  margin: '16px 0 0',
  paddingTop: 16,
  borderTop: '1px solid var(--app-border)',
};

export function EoRatioSection({ rc }: { rc: RecomputedCalibration }) {
  const theme = useAppStore((s) => s.theme);

  const { points, groups, logBound } = useMemo(() => buildEoRatio(rc), [rc]);
  const hasData = points.length > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const observedColor = pickSeriesColor(OBSERVED_COLOR, theme);

  const annotationLines = [`H–L ${formatGofResult(rc.absoluteRiskGof)}`];

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderEoRatioChart(Plot, {
          points,
          groups,
          logBound,
          title: TITLE,
          observedColor,
          annotationLines,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  const caption =
    `Each group's Expected / Observed ratio (mean predicted ÷ observed absolute risk) with its 95% ` +
    `confidence interval, on a log axis about the reference line at 1. A marker above 1 means the model ` +
    `over-predicts risk in that group, below 1 under-predicts; a CI that crosses 1 is consistent with good ` +
    `calibration there. This is the per-group view of the Hosmer–Lemeshow test — especially readable under ` +
    `a clinical cutpoint.` +
    (rc.isNcc ? ' Ratios are inverse-probability-weighted (nested case-control design).' : '');

  return (
    <figure style={sectionStyle} aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[points, groups, logBound, theme]}
        exportName="expected-observed-by-group"
        pngBackground={surface}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
    </figure>
  );
}
