import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import { buildRoc, renderRocChart } from '../../viz/roc';
import { rocCurve } from '../../math/roc';
import { OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { captionStyle, cssVar } from '../../viz/chartChrome';
import { formatNumber } from '../../lib/format';
import type { PerSubject } from '../../services/resultNormalizer';
import type { ValidationResult } from '../../lib/icareTypes';

// Results-step discrimination viz #2 (Phase 11), mounted below the KDE in the Discrimination panel. The ROC
// is recomputed synchronously from the in-memory per-subject arrays (roc.ts) — a weighted empirical sweep of
// the risk score (linear predictor) vs the observed outcome, inverse-probability-weighted for a nested
// case-control study — and handed to the shared PlotFigure (lazy Plot import + SVG/PNG download). The curve
// is the palette's categorical red, resolved to hex for the current theme (Plot bakes colours in, so we
// re-render on a theme flip). No units toggle: the [0,1] sensitivity/specificity square is the one scale.

const TITLE = 'Discrimination: ROC curve';

export function RocSection({
  perSubject,
  isNcc,
  auc,
}: {
  perSubject: PerSubject;
  isNcc: boolean;
  auc: ValidationResult['auc'];
}) {
  const theme = useAppStore((s) => s.theme);

  const roc = useMemo(() => rocCurve(perSubject, isNcc), [perSubject, isNcc]);
  const data = useMemo(() => buildRoc(roc, auc), [roc, auc]);
  const hasData = roc.nCases > 0 && roc.nControls > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const curveColor = pickSeriesColor(OBSERVED_COLOR, theme); // categorical red — matches the case density

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderRocChart(Plot, {
          data,
          title: TITLE,
          curveColor,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  // Epidemiological read: the ROC is the operating-characteristic view of the same discrimination the KDE
  // shows — the area under it is the c-statistic (= AUC), and the Youden point is the threshold that best
  // separates cases from controls. Built on the risk score (linear predictor), not the absolute-risk scale.
  const caption =
    `Sensitivity (true-positive rate) against 1 − specificity (false-positive rate) as the model's ` +
    `risk-score threshold varies. The area under the curve is the c-statistic (AUC), here ` +
    `${formatNumber(auc.auc * 100, 0)}% — the chance the model assigns a random case a higher risk score ` +
    `than a random control; the dashed diagonal is chance discrimination (AUC 50%). The marked point is the ` +
    `Youden-optimal operating point (maximizing sensitivity + specificity). Built on the linear predictor ` +
    `(the risk score), so its area matches the reported AUC.` +
    (isNcc ? ' Curve and AUC are inverse-probability-weighted (nested case-control design).' : '');

  return (
    <figure className="disc-figure roc-figure" aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[data, theme]}
        exportName="discrimination-roc-curve"
        pngBackground={surface}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
    </figure>
  );
}
