// The results-step DISCRIMINATION plot #2 (Phase 11): the ROC (receiver operating characteristic) curve.
// It plots sensitivity (true-positive rate) against 1 − specificity (false-positive rate) as the model's
// RISK-SCORE threshold sweeps from high to low. The area under it is the c-statistic (AUC) = P(a random
// case scores higher than a random control); the dashed 45° diagonal is chance discrimination (AUC 0.5).
// Where the KDE (Phase 10) shows the two risk distributions, the ROC shows the sensitivity–specificity
// trade-off those distributions imply — the same discrimination, read as an operating-characteristic curve.
//
// Built from `roc.ts` (roc engine), which sweeps `linearPredictors` vs `observedOutcome`, inverse-
// probability-weighted for a nested case-control study. Scale discipline: the ROC/AUC are on the linear
// predictor (the risk score), NOT `riskEstimates` — see kde.ts:22-23.
//
// Two halves, mirroring discrimination.ts / absoluteRiskCalibration.ts:
//   • `buildRoc` — pure: tidy curve points, the Youden-optimal marker + its guide line, per-operating-point
//     hover tips (sensitivity / specificity / risk-score cut), and the baked AUC + Youden annotation. All
//     strings pre-formatted so the builder is unit-testable.
//   • `renderRocChart` — takes the lazily-loaded Plot module and returns a bare, self-contained <svg>. EQUAL
//     [0,1] x/y domains + a square frame (square svg with equal margin sums) make the chance diagonal a true
//     45°. A subtle area-under-the-curve fill makes the AUC visual. It sets `style.color` (dark-mode export),
//     bakes title/annotation as text marks, and uses NO `title`/`caption`/legend Plot option (each returns an
//     HTML <figure> that can't export as one image). Colors arrive resolved to hex.

import type * as PlotNS from '@observablehq/plot';
import { formatNumber, formatPercent } from '../lib/format';
import type { RocCurve } from '../math/roc';

/** One tidy ROC vertex on the [0,1]² axes. */
export interface RocCurvePoint {
  fpr: number;
  tpr: number;
}

/** The Youden-optimal marker (on the curve) with its display label. */
export interface RocYoudenMarker {
  fpr: number;
  tpr: number;
  label: string;
}

/** A hover row per operating point: pre-formatted sensitivity / specificity / risk-score cut. */
export interface RocTipRow {
  fpr: number;
  tpr: number;
  tip: string;
}

export interface RocChartData {
  /** ROC vertices from (0,0) to (1,1) — the line and the area-under-curve fill. */
  curve: RocCurvePoint[];
  /** Youden-optimal operating point, or null for a degenerate curve. */
  youden: RocYoudenMarker | null;
  /** Two points [(fpr,fpr) on the diagonal, (fpr,tpr) on the curve] — the vertical guide showing Youden's J
   *  (height above chance). Null when there is no Youden point. */
  youdenGuide: { x: number; y: number }[] | null;
  /** Per-operating-point hover rows (the trivial "classify none" seed is dropped). */
  tipRows: RocTipRow[];
  /** AUC (with CI) + Youden sensitivity/specificity, baked bottom-right (the always-empty lower triangle). */
  annotationLines: string[];
  /** Shared [0,1] axis domain (both axes), so the square frame's diagonal is a true 45°. */
  domain: [number, number];
}

/** The overall discrimination scalars this plot annotates (from `result.auc`). */
export interface RocAuc {
  auc: number;
  lowerCi: number;
  upperCi: number;
}

/**
 * Turn the roc engine's curve into tidy plot data: the polyline/area vertices, the Youden marker + its guide
 * line, the per-point hover tips, and the baked AUC + Youden annotation. Sensitivity = tpr and specificity =
 * 1 − fpr are rendered as clinical percentages; the risk-score cut is the linear-predictor threshold there.
 */
export function buildRoc(roc: RocCurve, auc: RocAuc): RocChartData {
  const curve: RocCurvePoint[] = roc.points.map((p) => ({ fpr: p.fpr, tpr: p.tpr }));

  // Hover per real operating point (skip the +Infinity "classify nobody" seed, which has no finite cut).
  const tipRows: RocTipRow[] = [];
  for (const p of roc.points) {
    if (!Number.isFinite(p.threshold)) continue;
    tipRows.push({
      fpr: p.fpr,
      tpr: p.tpr,
      tip: [
        `Sensitivity ${formatPercent(p.tpr, 1)}`,
        `Specificity ${formatPercent(1 - p.fpr, 1)}`,
        `Risk-score cut ${formatNumber(p.threshold, 3)}`,
      ].join('\n'),
    });
  }

  const y = roc.youden;
  const youden: RocYoudenMarker | null = y ? { fpr: y.fpr, tpr: y.tpr, label: 'Youden' } : null;
  // Vertical guide from the chance diagonal (fpr,fpr) up to the operating point (fpr,tpr): its height IS
  // Youden's J = sensitivity + specificity − 1.
  const youdenGuide = y
    ? [
        { x: y.fpr, y: y.fpr },
        { x: y.fpr, y: y.tpr },
      ]
    : null;

  const annotationLines = [
    `AUC ${formatNumber(auc.auc)} (95% CI ${formatNumber(auc.lowerCi)}–${formatNumber(auc.upperCi)})`,
  ];
  if (y) {
    annotationLines.push(
      `Youden-optimal · sensitivity ${formatPercent(y.sensitivity, 0)} · specificity ${formatPercent(
        y.specificity,
        0,
      )}`,
    );
  }

  return { curve, youden, youdenGuide, tipRows, annotationLines, domain: [0, 1] };
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface RocChartColors {
  /** Foreground: axis text, gridlines, title, Youden label, tip text (drives `currentColor`). */
  fg: string;
  /** Muted ink: the chance diagonal, the Youden guide, and the AUC/Youden annotation. */
  muted: string;
  /** Surface color: the Youden dot ring + tooltip background. */
  surface: string;
}

export interface RocChartOptions {
  data: RocChartData;
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the ROC curve, its area fill, and the Youden marker — the categorical red. */
  curveColor: string;
  colors: RocChartColors;
  width: number;
  ariaLabel?: string;
}

/**
 * Render the ROC curve as a bare <svg>. Square (EQUAL [0,1] x/y domains + a square frame with equal margin
 * sums) so the chance diagonal is a true 45° and the plot reads as a proper operating-characteristic; the
 * caller (PlotFigure) supplies the lazily-imported Plot module and the current container width.
 */
export function renderRocChart(Plot: typeof PlotNS, opts: RocChartOptions): SVGSVGElement {
  const { data, title, curveColor, colors, width, ariaLabel } = opts;
  const marks: PlotNS.Markish[] = [];

  // Area under the curve — a subtle wash that literally shades the AUC. Drawn first, under everything.
  marks.push(
    Plot.areaY(data.curve, { x: 'fpr', y: 'tpr', fill: curveColor, fillOpacity: 0.1, clip: true }),
  );

  // Chance reference: a dotted 45° diagonal (AUC 0.5) spanning the square, under the curve.
  marks.push(
    Plot.line(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      {
        x: 'x',
        y: 'y',
        stroke: colors.muted,
        strokeWidth: 1.5,
        strokeDasharray: '2 4',
        strokeLinecap: 'round',
      },
    ),
  );

  // Youden guide: a faint vertical from the diagonal up to the operating point — its length is Youden's J.
  if (data.youdenGuide) {
    marks.push(
      Plot.line(data.youdenGuide, {
        x: 'x',
        y: 'y',
        stroke: colors.muted,
        strokeWidth: 1,
        strokeDasharray: '1 3',
        opacity: 0.7,
      }),
    );
  }

  // The ROC curve itself: plain linear interpolation between operating points (matches the trapezoid AUC).
  marks.push(
    Plot.lineY(data.curve, {
      x: 'fpr',
      y: 'tpr',
      stroke: curveColor,
      strokeWidth: 2,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      clip: true,
    }),
  );

  // Youden-optimal marker (a ringed dot on the curve) + a small inline label.
  if (data.youden) {
    marks.push(
      Plot.dot([data.youden], {
        x: 'fpr',
        y: 'tpr',
        fill: curveColor,
        r: 4.5,
        stroke: colors.surface,
        strokeWidth: 1.5,
      }),
      Plot.text([data.youden], {
        x: 'fpr',
        y: 'tpr',
        text: (d: RocYoudenMarker) => d.label,
        dx: 8,
        dy: 12,
        textAnchor: 'start',
        fontSize: 11,
        fill: colors.fg,
      }),
    );
  }

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

  // Overall discrimination annotation (AUC + CI, Youden sensitivity/specificity), baked bottom-right — the
  // lower triangle below the chance diagonal, which the curve never enters. Stacked upward.
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

  // Crosshair tip: sensitivity / specificity / risk-score cut at the nearest operating point.
  marks.push(
    Plot.tip(
      data.tipRows,
      Plot.pointer({
        x: 'fpr',
        y: 'tpr',
        fill: colors.surface,
        title: (d: RocTipRow) => d.tip,
      }),
    ),
  );

  // A square SVG with EQUAL margin sums (top+bottom === left+right) makes the inner plot frame square, so
  // with the shared [0,1] x/y domains the chance diagonal is a true 45° (mirrors absoluteRiskCalibration.ts).
  const side = width;
  const node = Plot.plot({
    width: side,
    height: side,
    marginTop: 40,
    marginRight: 24,
    marginBottom: 40,
    marginLeft: 56,
    style: { color: colors.fg, background: 'transparent', fontSize: '12px' },
    ariaLabel: ariaLabel ?? title,
    x: {
      label: 'False-positive rate (1 − specificity)',
      labelAnchor: 'center',
      labelArrow: false,
      domain: data.domain,
      grid: true,
      nice: false,
    },
    y: {
      label: 'True-positive rate (sensitivity)',
      labelAnchor: 'center',
      labelArrow: false,
      domain: data.domain,
      grid: true,
      nice: false,
    },
    marks,
  });

  // Dev guard: a stray title/caption/legend option would return an HTML <figure>, silently breaking
  // single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error('renderRocChart expected a bare <svg> from Plot.plot (got a <figure>).');
  }
  return node;
}
