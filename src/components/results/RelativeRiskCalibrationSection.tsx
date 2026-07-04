import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import {
  buildRelativeRiskCalibration,
  renderRelativeRiskCalibrationChart,
} from '../../viz/relativeRiskCalibration';
import { OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { captionStyle, cssVar, miniToggle } from '../../viz/chartChrome';
import { formatGofResult } from '../../lib/format';
import { CalibrationBinTable } from './CalibrationBinTable';
import type { RecomputedCalibration } from '../../math/calibrationMath';
import type { NormalizedResult } from '../../services/resultNormalizer';

// Results-step calibration viz #3 (Phase 9): the relative-risk calibration scatter — predicted vs observed
// RELATIVE risk per risk group (both mean-normalized to a cohort average of 1), with the perfect-calibration
// identity line and a faint RR=1 population-average crosshair. Where the absolute-risk plot (Phase 8) asks
// whether the risk LEVEL is right, this asks whether the model RANKS/SPREADS risk correctly. Fed by the same
// Phase-5 recompute (LP-decile bins) — CalibrationPanel computes `rc` once and shares it — resolves the theme
// colors to hex (Plot bakes colors in), reads the overall RR goodness-of-fit from the SDK scalar, and offers a
// linear/log axis toggle (relative risk is multiplicative). Renders as a borderless `.cal-col` grid column.

const TITLE = 'Relative-risk calibration';

type AxisScale = 'linear' | 'log';

export interface RelativeRiskCalibrationSectionProps {
  rc: RecomputedCalibration;
  normalized: NormalizedResult;
}

/** linear ↔ log axis toggle, shown as the chart's toolbar extra (relative risk reads well on a log scale). */
function ScaleToggle({ scale, onChange }: { scale: AxisScale; onChange: (s: AxisScale) => void }) {
  const opt = (val: AxisScale, label: string) => (
    <button
      type="button"
      onClick={() => onChange(val)}
      aria-pressed={scale === val}
      style={miniToggle(scale === val)}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Axis scale">
      {opt('linear', 'Linear')}
      {opt('log', 'Log')}
    </div>
  );
}

export function RelativeRiskCalibrationSection({
  rc,
  normalized,
}: RelativeRiskCalibrationSectionProps) {
  const theme = useAppStore((s) => s.theme);
  const [axisScale, setAxisScale] = useState<AxisScale>('linear');

  const isNcc = normalized.isNcc;

  const { points, linearMax, logBound } = useMemo(() => buildRelativeRiskCalibration(rc), [rc]);
  const hasData = points.length > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const observedColor = pickSeriesColor(OBSERVED_COLOR, theme);

  // Relative-risk goodness-of-fit for THIS plot's bins, from the recompute engine so it moves with
  // interactive re-binning (equals the SDK value at the default deciles). There is no RR "E/O-in-the-large".
  const annotationLines = [`RR GOF ${formatGofResult(rc.relativeRiskGof)}`];

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderRelativeRiskCalibrationChart(Plot, {
          points,
          linearMax,
          logBound,
          axisScale,
          title: TITLE,
          observedColor,
          annotationLines,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  const binnedBy =
    rc.scale === 'absolute-risk'
      ? 'predicted absolute risk'
      : "the model's risk score (linear predictor)";
  const caption =
    `Each marker is one of ${rc.nBins} risk groups (binned by ${binnedBy}): the group's mean predicted ` +
    `relative risk (x) versus its observed relative risk (y) — both ` +
    `normalized so the cohort average is 1 — with 95% confidence intervals on the observed value. ` +
    `Relative-risk calibration asks whether the model ranks and spreads risk correctly: does the group it ` +
    `calls twice the average really run twice the risk? A model can sit on the dotted identity line here ` +
    `(good risk stratification) while still systematically over- or under-estimating absolute risk (the ` +
    `absolute-risk plot). The faint RR = 1 crosshair marks the population-average stratum — below-average ` +
    `groups fall in the lower-left, above-average in the upper-right. Use the toolbar toggle to switch ` +
    `between linear and log (multiplicative) axes.` +
    (isNcc
      ? ' Observed relative risks and intervals are inverse-probability-weighted (nested case-control design).'
      : '');

  return (
    <figure className="cal-col" aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[points, linearMax, logBound, theme, axisScale]}
        exportName="relative-risk-calibration"
        pngBackground={surface}
        toolbarExtras={<ScaleToggle scale={axisScale} onChange={setAxisScale} />}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
      <CalibrationBinTable
        bins={rc.bins}
        scale="relative"
        isNcc={isNcc}
        boundaryUnit={rc.scale === 'absolute-risk' ? 'percent' : 'lp'}
      />
    </figure>
  );
}
