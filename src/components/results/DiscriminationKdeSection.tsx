import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import { buildDiscrimination, renderDiscriminationChart } from '../../viz/discrimination';
import { discriminationDensities } from '../../math/kde';
import { EXPECTED_COLOR, OBSERVED_COLOR, pickSeriesColor } from '../../viz/palette';
import { captionStyle, cssVar } from '../../viz/chartChrome';
import { formatNumber } from '../../lib/format';
import type { PerSubject } from '../../services/resultNormalizer';
import type { ValidationResult } from '../../lib/icareTypes';

// Results-step discrimination viz #1 (Phase 10): the case-vs-control predicted-risk density overlay. The
// KDE (kde.ts) is recomputed synchronously from the in-memory per-subject arrays — cases (red) and controls
// (blue), inverse-probability-weighted for a nested case-control study — and handed to the shared PlotFigure
// (lazy Plot import + SVG/PNG download). Colours are the palette's reserved blue↔red case/control pair,
// resolved to hex for the current theme (Plot bakes colours into the svg, so we re-render on a theme flip).
// No units toggle: the risk-percent x-axis is the one clinically legible scale here.

const TITLE = 'Discrimination: predicted-risk distribution';

export function DiscriminationKdeSection({
  perSubject,
  isNcc,
  auc,
}: {
  perSubject: PerSubject;
  isNcc: boolean;
  auc: ValidationResult['auc'];
}) {
  const theme = useAppStore((s) => s.theme);

  const dens = useMemo(() => discriminationDensities(perSubject, isNcc), [perSubject, isNcc]);
  const data = useMemo(() => buildDiscrimination(dens, auc), [dens, auc]);
  const hasData = dens.control.n > 0 || dens.case_.n > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const caseColor = pickSeriesColor(OBSERVED_COLOR, theme); // warm / red — developed disease
  const controlColor = pickSeriesColor(EXPECTED_COLOR, theme); // cool / blue — disease-free

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderDiscriminationChart(Plot, {
          data,
          title: TITLE,
          caseColor,
          controlColor,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  // Epidemiological read: the plot IS the AUC geometry (AUC = P[risk of a random case > risk of a random
  // control]); the shaded overlap is the ambiguity the AUC can't resolve, and the median gap the location
  // shift it summarizes.
  const caption =
    `Smoothed distribution of the model's predicted absolute risk among cases (developed the disease, red) ` +
    `and controls (disease-free, blue), each area-normalized. Discrimination is their separation — the AUC, ` +
    `here ${formatNumber(auc.auc * 100, 0)}%, is the chance the model assigns a random case a higher risk than ` +
    `a random control. Dashed lines mark each group's median risk; their shaded overlap ` +
    `(${formatNumber(dens.overlap, 2)}) is the region the AUC cannot resolve.` +
    (isNcc ? ' Densities are inverse-probability-weighted (nested case-control design).' : '');

  return (
    <figure className="disc-figure" aria-label={TITLE}>
      <PlotFigure
        render={render}
        deps={[data, theme]}
        exportName="discrimination-risk-density"
        ariaLabel="Density plot of predicted risk for cases versus controls"
        pngBackground={surface}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
    </figure>
  );
}
