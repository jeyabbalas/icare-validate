// The results-step DISCRIMINATION plot (Phase 10): the "risk-distribution / separation plot". It overlays
// the smoothed distribution of the model's PREDICTED ABSOLUTE RISK among cases (subjects who developed the
// disease, red) and controls (disease-free, blue). Discrimination is the visible separation between the two
// densities: a model that ranks cases above controls pushes the red density to the right of the blue one,
// and their residual OVERLAP is exactly what the AUC cannot resolve — AUC = P(risk of a random case > risk
// of a random control), so the plot IS the geometry behind the AUC number.
//
// The densities come from the Phase-10 KDE engine (kde.ts), which reproduces seaborn/scipy `gaussian_kde`
// (py-icare's notebook) and inverse-probability-weights a nested case-control study. Each density is
// area-normalized independently (equal area), so both curves are full-height and directly comparable and a
// rare-outcome case curve stays visible.
//
// Two halves, mirroring absoluteRiskCalibration.ts / incidenceRates.ts:
//   • `buildDiscrimination` — pure: rescales the grid to a clinical PERCENT x-axis and the density to a
//     per-percentage-point y (so the area under each curve is 1 on the displayed axes and the y numbers stay
//     modest), builds the median markers, the legend labels with counts, the baked AUC + overlap annotation,
//     and a per-risk hover tip carrying the case:control density ratio (the empirical likelihood ratio at
//     that risk). All strings are pre-formatted so the builder is unit-testable.
//   • `renderDiscriminationChart` — takes the lazily-loaded Plot module and returns a bare, self-contained
//     <svg>: two filled densities (α 0.3, their overlap reads darker) with solid outlines, dashed median
//     rules, and the baked title / legend / annotation / tip. It sets `style.color` (so exported axes/text
//     aren't black in dark mode) and uses NO `title`/`caption`/legend Plot option (each returns an HTML
//     <figure> that can't export as one image). Colors arrive resolved to hex (Plot can't read CSS vars).

import type * as PlotNS from '@observablehq/plot';
import { extent, niceCeil } from '../math/numeric';
import { formatCount, formatNumber, formatPercent } from '../lib/format';
import type { DiscriminationDensities } from '../math/kde';

export type OutcomeSeries = 'control' | 'case';

/** One tidy density point on the displayed axes: risk in percent (x), density per percentage-point (y). */
export interface DensityPoint {
  x: number; // predicted absolute risk (%)
  density: number; // density per percentage-point (∫ over the %-axis = 1)
  series: OutcomeSeries;
}

/** A crosshair-tip row per grid risk: pre-formatted local densities + the case:control likelihood ratio. */
export interface DensityTipRow {
  x: number; // risk (%) — the pointerX anchor
  yAnchor: number; // the taller of the two densities, so the tip box clears the curves
  tip: string;
}

export interface DiscriminationChartData {
  points: DensityPoint[]; // both series, full grid (clipped to the frame at render)
  controlMedian: number; // % — dashed marker; NaN when the group is empty
  caseMedian: number; // %
  controlCount: number; // raw subject counts (legend)
  caseCount: number;
  /** Legend labels with counts, built here so the render stays presentational. */
  controlLabel: string;
  caseLabel: string;
  /** Overall discrimination stats baked bottom-right (AUC + CI, distribution overlap). */
  annotationLines: string[];
  tipRows: DensityTipRow[];
  domainX: [number, number]; // [0, niceCeil(99.5th pooled-risk pct)]
  domainY: [number, number]; // [0, niceCeil(max visible density)]
}

/** The overall discrimination scalars this plot annotates (from `result.auc`). */
export interface DiscriminationAuc {
  auc: number;
  lowerCi: number;
  upperCi: number;
}

/** Format a small density magnitude to a couple of significant digits for the tooltip. */
function formatDensity(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return v.toLocaleString('en-US', { maximumSignificantDigits: 2 });
}

/**
 * Turn the KDE engine's case/control densities into tidy, percent-scaled scatter/area points plus the
 * markers, legend, annotation, and hover tips. `dens.grid` is in risk PROPORTION; x is scaled to percent
 * and the density divided by 100 so it is per-percentage-point (keeping ∫ = 1 on the displayed axes).
 */
export function buildDiscrimination(
  dens: DiscriminationDensities,
  auc: DiscriminationAuc,
): DiscriminationChartData {
  const grid = dens.grid;
  const control = dens.control.density;
  const caseD = dens.case_.density;

  // x display domain: the 99.5th pooled-risk percentile, rounded up to a tidy 1/2/5 ceiling (percent).
  const maxGridPct = grid.length ? grid[grid.length - 1] * 100 : 1;
  const upperPct =
    Number.isFinite(dens.riskMaxDisplay) && dens.riskMaxDisplay > 0
      ? dens.riskMaxDisplay * 100
      : maxGridPct;
  const domainXMax = niceCeil(upperPct);

  const points: DensityPoint[] = [];
  const tipRows: DensityTipRow[] = [];
  const visibleDensities: number[] = [];
  for (let j = 0; j < grid.length; j += 1) {
    const xPct = grid[j] * 100;
    const ctrl = control[j] / 100; // per percentage-point
    const cse = caseD[j] / 100;
    points.push({ x: xPct, density: ctrl, series: 'control' });
    points.push({ x: xPct, density: cse, series: 'case' });

    if (xPct >= 0 && xPct <= domainXMax) {
      visibleDensities.push(ctrl, cse);
      // Empirical likelihood ratio LR(x) = f_case(x) / f_control(x): how much more concentrated cases are
      // than controls at this risk. Undefined where either density is numerically zero.
      const ratio = control[j] > 1e-9 && caseD[j] > 1e-9 ? caseD[j] / control[j] : NaN;
      const ratioLine = Number.isFinite(ratio)
        ? `Case:control ratio ${ratio >= 100 ? '>100' : ratio < 0.01 ? '<0.01' : formatNumber(ratio, 2)}`
        : 'Case:control ratio —';
      tipRows.push({
        x: xPct,
        yAnchor: Math.max(ctrl, cse),
        tip: [
          `Predicted risk ${formatPercent(grid[j], 1)}`,
          `Density — cases ${formatDensity(cse)}, controls ${formatDensity(ctrl)}`,
          ratioLine,
        ].join('\n'),
      });
    }
  }

  const [, maxDensity] = extent(visibleDensities);
  const domainY: [number, number] = [0, niceCeil(Number.isFinite(maxDensity) ? maxDensity : 1)];

  const controlCount = dens.control.n;
  const caseCount = dens.case_.n;

  const annotationLines = [
    `AUC ${formatNumber(auc.auc)} (95% CI ${formatNumber(auc.lowerCi)}–${formatNumber(auc.upperCi)})`,
    `Distribution overlap ${formatNumber(dens.overlap, 2)}`,
  ];

  return {
    points,
    controlMedian: dens.control.median * 100,
    caseMedian: dens.case_.median * 100,
    controlCount,
    caseCount,
    controlLabel: `Controls · n = ${formatCount(controlCount)}`,
    caseLabel: `Cases · n = ${formatCount(caseCount)}`,
    annotationLines,
    tipRows,
    domainX: [0, domainXMax],
    domainY,
  };
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface DiscriminationChartColors {
  /** Foreground: axis text, gridlines, title, legend labels, tip text (drives `currentColor`). */
  fg: string;
  /** Muted ink: the overall AUC + overlap annotation. */
  muted: string;
  /** Surface color: tooltip background. */
  surface: string;
}

export interface DiscriminationChartOptions {
  data: DiscriminationChartData;
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the case (developed-disease) density — warm/red. */
  caseColor: string;
  /** Resolved color for the control (disease-free) density — cool/blue. */
  controlColor: string;
  colors: DiscriminationChartColors;
  width: number;
  height?: number;
  ariaLabel?: string;
}

/**
 * Render the case-vs-control predicted-risk density overlay as a bare <svg>. Landscape (a density reads best
 * wide); the caller (PlotFigure) supplies the lazily-imported Plot module and the current container width.
 */
export function renderDiscriminationChart(
  Plot: typeof PlotNS,
  opts: DiscriminationChartOptions,
): SVGSVGElement {
  const { data, title, caseColor, controlColor, colors, width, ariaLabel } = opts;
  const height = opts.height ?? Math.max(300, Math.min(430, Math.round(width * 0.5)));

  const controlPts = data.points.filter((p) => p.series === 'control');
  const casePts = data.points.filter((p) => p.series === 'case');
  const marks: PlotNS.Markish[] = [];

  // Two filled densities (α 0.3 so their overlap reads darker) with solid 2px outlines, control UNDER case.
  // `clip` keeps the KDE's sub-zero left tail and long right tail inside the frame, so each fill closes
  // cleanly at the axis edges.
  const areaOf = (pts: DensityPoint[], fill: string) =>
    Plot.areaY(pts, { x: 'x', y: 'density', fill, fillOpacity: 0.3, clip: true });
  const lineOf = (pts: DensityPoint[], stroke: string) =>
    Plot.lineY(pts, {
      x: 'x',
      y: 'density',
      stroke,
      strokeWidth: 2,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      clip: true,
    });
  marks.push(areaOf(controlPts, controlColor), areaOf(casePts, caseColor));
  marks.push(lineOf(controlPts, controlColor), lineOf(casePts, caseColor));

  // Median predicted-risk markers: a dashed vertical rule per group. The gap between them is a robust,
  // outlier-resistant read of the location shift the AUC summarizes.
  const medianRule = (m: number, stroke: string) =>
    Plot.ruleX([m], { stroke, strokeWidth: 1.5, strokeDasharray: '3 4', opacity: 0.7 });
  if (Number.isFinite(data.controlMedian)) marks.push(medianRule(data.controlMedian, controlColor));
  if (Number.isFinite(data.caseMedian)) marks.push(medianRule(data.caseMedian, caseColor));

  // Title baked into the top margin (self-describing downloads).
  marks.push(
    Plot.text([title], {
      text: (d) => d,
      frameAnchor: 'top-left',
      dy: -28,
      textAnchor: 'start',
      fontSize: 14,
      fontWeight: 600,
      fill: colors.fg,
    }),
  );

  // In-SVG legend, top-RIGHT (the empty high-risk corner): a filled-square swatch at the frame edge with a
  // right-aligned label to its left. Text marks because color:{legend:true} returns an HTML <figure>.
  const legend: { i: number; label: string; color: string }[] = [
    { i: 0, label: data.caseLabel, color: caseColor },
    { i: 1, label: data.controlLabel, color: controlColor },
  ];
  for (const e of legend) {
    marks.push(
      Plot.text(['■'], {
        text: (d) => d,
        frameAnchor: 'top-right',
        dx: -8,
        dy: 12 + e.i * 16,
        textAnchor: 'end',
        fontSize: 12,
        fill: e.color,
      }),
      Plot.text([e.label], {
        text: (d) => d,
        frameAnchor: 'top-right',
        dx: -22,
        dy: 12 + e.i * 16,
        textAnchor: 'end',
        fontSize: 12,
        fill: colors.fg,
      }),
    );
  }

  // Overall discrimination annotation (AUC + CI, distribution overlap), baked bottom-right and muted.
  const n = data.annotationLines.length;
  data.annotationLines.forEach((line, i) => {
    marks.push(
      Plot.text([line], {
        text: (d) => d,
        frameAnchor: 'bottom-right',
        dx: -8,
        dy: -8 - (n - 1 - i) * 15,
        textAnchor: 'end',
        fontSize: 11,
        fill: colors.muted,
      }),
    );
  });

  // Crosshair tip: the local case + control densities and their ratio (the empirical likelihood ratio).
  marks.push(
    Plot.tip(
      data.tipRows,
      Plot.pointerX({
        x: 'x',
        y: 'yAnchor',
        fill: colors.surface,
        title: (d: DensityTipRow) => d.tip,
      }),
    ),
  );

  const node = Plot.plot({
    width,
    height,
    marginTop: 44,
    marginRight: 24,
    marginBottom: 44,
    marginLeft: 60,
    style: { color: colors.fg, background: 'transparent', fontSize: '12px' },
    ariaLabel: ariaLabel ?? title,
    x: {
      label: 'Predicted absolute risk (%)',
      labelAnchor: 'center',
      labelArrow: false,
      domain: data.domainX,
      grid: true,
      nice: false,
    },
    y: {
      // Relative (area-normalized) density: the axis is a scale reference, not a value readers act on.
      label: 'Density',
      labelAnchor: 'center',
      labelArrow: false,
      domain: data.domainY,
      grid: true,
      ticks: 4,
    },
    marks,
  });

  // Dev guard: a stray title/caption/legend option would return an HTML <figure>, silently breaking
  // single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error(
      'renderDiscriminationChart expected a bare <svg> from Plot.plot (got a <figure>).',
    );
  }
  return node;
}
