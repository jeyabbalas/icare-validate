import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { useBinSettingsStore } from '../../state/binSettingsStore';
import { PlotFigure } from '../../viz/PlotFigure';
import {
  buildRelativeRiskCalibration,
  renderRelativeRiskCalibrationChart,
} from '../../viz/relativeRiskCalibration';
import { OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { cardStyle, captionStyle, cssVar, miniToggle } from '../../viz/chartChrome';
import { recomputeCalibration } from '../../math/calibrationMath';
import { formatGof } from '../../lib/format';
import { CalibrationBinTable } from './CalibrationBinTable';
import type { ValidationResult } from '../../lib/icareTypes';
import type { NormalizedResult } from '../../services/resultNormalizer';

// Results-step calibration viz #3 (Phase 9): the relative-risk calibration scatter — predicted vs observed
// RELATIVE risk per risk group (both mean-normalized to a cohort average of 1), with the perfect-calibration
// identity line and a faint RR=1 population-average crosshair. Where the absolute-risk plot (Phase 8) asks
// whether the risk LEVEL is right, this asks whether the model RANKS/SPREADS risk correctly. Fed by the same
// Phase-5 recompute engine (LP-decile bins) so Phase-12 re-binning is a no-re-run update; resolves the theme
// colors to hex (Plot bakes colors in), reads the overall RR goodness-of-fit from the SDK scalar (matches the
// summary panel verbatim), and offers a linear/log axis toggle (relative risk is multiplicative).

const calibrationCard: React.CSSProperties = { ...cardStyle, maxWidth: 560, margin: '0 auto 16px' };
const TITLE = 'Relative-risk calibration';

type AxisScale = 'linear' | 'log';

export interface RelativeRiskCalibrationSectionProps {
  result: ValidationResult;
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
  result,
  normalized,
}: RelativeRiskCalibrationSectionProps) {
  const theme = useAppStore((s) => s.theme);
  const numberOfPercentiles = useBinSettingsStore((s) => s.numberOfPercentiles);
  const [axisScale, setAxisScale] = useState<AxisScale>('linear');

  const ps = normalized.perSubject;
  const isNcc = normalized.isNcc;

  // Recompute per-bin calibration on the LINEAR-PREDICTOR scale (the SDK's default) — reproduces
  // result.categorySpecificCalibration at the default deciles and re-bins instantly later.
  const rc = useMemo(
    () => recomputeCalibration(ps, isNcc, { scale: 'linear-predictor', numberOfPercentiles }),
    [ps, isNcc, numberOfPercentiles],
  );
  const { points, linearMax, logBound } = useMemo(() => buildRelativeRiskCalibration(rc), [rc]);
  const hasData = points.length > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const observedColor = pickSeriesColor(OBSERVED_COLOR, theme);

  // Overall relative-risk goodness-of-fit, straight off the SDK result (matches the cohort-summary panel, and
  // equals the engine's value at the default deciles). There is NO relative-risk "E/O-in-the-large" scalar.
  const annotationLines = [`RR GOF ${formatGof(result.calibration.relativeRisk)}`];

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

  const caption =
    `Each marker is one of ${rc.nBins} risk groups (quantiles of the model's risk score, i.e. its linear ` +
    `predictor): the group's mean predicted relative risk (x) versus its observed relative risk (y) — both ` +
    `normalized so the cohort average is 1 — with 95% confidence intervals on the observed value. ` +
    `Relative-risk calibration asks whether the model ranks and spreads risk correctly: does the group it ` +
    `calls twice the average really run twice the risk? A model can sit on the dotted identity line here ` +
    `(good risk stratification) while still systematically over- or under-estimating absolute risk (the ` +
    `plot above). The faint RR = 1 crosshair marks the population-average stratum — below-average groups ` +
    `fall in the lower-left, above-average in the upper-right. Use the toolbar toggle to switch between ` +
    `linear and log (multiplicative) axes.` +
    (isNcc
      ? ' Observed relative risks and intervals are inverse-probability-weighted (nested case-control design).'
      : '');

  return (
    <figure style={calibrationCard} aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[points, linearMax, logBound, theme, axisScale]}
        exportName="relative-risk-calibration"
        pngBackground={surface}
        toolbarExtras={<ScaleToggle scale={axisScale} onChange={setAxisScale} />}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
      <CalibrationBinTable bins={rc.bins} scale="relative" isNcc={isNcc} />
    </figure>
  );
}
