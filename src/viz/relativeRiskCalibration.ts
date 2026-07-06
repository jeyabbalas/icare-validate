// The results-step RELATIVE-RISK calibration plot (Phase 9): for each risk group (decile of the linear
// predictor), the model's mean PREDICTED relative risk (x) versus the OBSERVED relative risk (y), with a
// 95% log-Wald confidence interval on the observed value and a perfect-calibration identity line. Both
// series are mean-normalized so the cohort average is 1. This figure answers "does the model RANK and
// SPREAD risk correctly?" — a group the model calls 2× the cohort average should really run 2× the risk —
// which is a different question from the absolute-risk plot's "is the risk LEVEL right?": a model can lie
// on this identity line (good stratification) while systematically over- or under-estimating absolute risk.
//
// Fed by the Phase-5 recompute engine (`recomputeCalibration`), not the SDK's frozen category table, so
// Phase-12 re-binning updates it with no SDK re-run; at the default deciles the engine reproduces the SDK
// category table exactly (calibrationMath.parity.test.ts).
//
// Two halves, mirroring absoluteRiskCalibration.ts:
//   • `buildRelativeRiskCalibration` — pure: per-bin RR rows → tidy scatter points (NO ×100; a relative risk
//     is already a ratio around 1). Skips degenerate / non-finite / non-positive bins (a log axis needs
//     strictly positive coordinates) and — unlike absolute risk — needs NO CI clamp (the log-Wald interval is
//     already strictly positive). Each point's hover tooltip is pre-formatted, and its "Group" line carries
//     the group's risk-score (linear-predictor) interval. Returns BOTH a linear axis maximum and a log axis
//     bound (symmetric about 1) so the section's linear/log toggle is a pure re-scale.
//   • `renderRelativeRiskCalibrationChart` — takes the lazily-loaded Plot module + the active axis scale and
//     returns a bare <svg>. EQUAL x/y domains over a square frame (square svg, equal margin sums) keep the
//     identity line a true 45° in BOTH linear and log. Adds a faint RR = 1 crosshair (the population-average
//     stratum) kept subordinate to the emphasized identity line; the group's risk-score interval lives only in
//     the hover tooltip + the per-bin table (no on-plot label). Colors arrive resolved to hex; the
//     title/legend/annotation are baked as text marks (self-describing downloads) with
//     NO Plot title/caption/legend option (those return an HTML <figure> that can't export as one image).

import type * as PlotNS from '@observablehq/plot';
import { niceCeil, logTicks } from '../math/numeric';
import { formatNumber } from '../lib/format';
import type { RecomputedCalibration } from '../math/calibrationMath';
import type { LinearFit } from '../math/calibrationFit';

/** One relative-risk calibration marker: a group's predicted vs observed RR (ratio), + its CI + tip. */
export interface RelativeRiskScatterPoint {
  /** 0-based engine bin index. */
  index: number;
  /** 1-based group number shown to the user (groups run low→high risk score). */
  group: number;
  /** The group's risk-score (linear-predictor) interval, e.g. "(0.5678, 1.111]"; surfaced in the tooltip. */
  label: string;
  /** Mean predicted relative risk in the group (normalized to a cohort mean of 1) — the x coordinate. */
  predRr: number;
  /** Observed relative risk in the group (normalized to a cohort mean of 1) — the y coordinate. */
  obsRr: number;
  /** Lower 95% log-Wald CI on the observed RR (> 0); NaN when no CI is defined. */
  loRr: number;
  /** Upper 95% log-Wald CI on the observed RR (> 0); NaN when no CI is defined. */
  hiRr: number;
  /** Pre-formatted, newline-joined per-bin hover tooltip. */
  tip: string;
}

export interface RelativeRiskCalibrationData {
  points: RelativeRiskScatterPoint[];
  /** Upper bound for a LINEAR square frame: `[0, linearMax]` on both axes. */
  linearMax: number;
  /** Bound for a LOG square frame: `[1/logBound, logBound]` on both axes (symmetric about 1). */
  logBound: number;
}

/**
 * Turn the recompute engine's per-bin rows into tidy relative-risk calibration points. Skips degenerate bins
 * (empty / observed ∉ (0,1) / predicted ≤ 0) and any bin whose observed/predicted RR is non-finite or ≤ 0 (a
 * log axis needs strictly positive coordinates). Relative risks are NOT scaled to percent, and the log-Wald
 * CI is already strictly positive, so — unlike the absolute-risk plot — there is no clamp. Returns both
 * square-frame bounds (linear top and symmetric-log bound) so the linear/log toggle only re-scales.
 */
export function buildRelativeRiskCalibration(rc: RecomputedCalibration): RelativeRiskCalibrationData {
  const points: RelativeRiskScatterPoint[] = [];
  let maxUpper = 1; // largest plotted value (drives the linear domain top)
  let maxRatio = 1; // largest multiplicative distance from 1 (drives the symmetric log bound)

  /** Multiplicative distance of a positive value from 1, either direction (2 and 0.5 are both "2× away"). */
  const ratioFrom1 = (v: number): number => Math.max(v, 1 / v);

  for (const bin of rc.bins) {
    if (bin.degenerate) continue;
    const predRr = bin.predictedRelativeRisk;
    const obsRr = bin.observedRelativeRisk;
    if (!Number.isFinite(predRr) || !Number.isFinite(obsRr) || predRr <= 0 || obsRr <= 0) continue;

    const hasCi = Number.isFinite(bin.lowerCiRelativeRisk) && Number.isFinite(bin.upperCiRelativeRisk);
    const loRr = hasCi ? bin.lowerCiRelativeRisk : NaN;
    const hiRr = hasCi ? bin.upperCiRelativeRisk : NaN;

    const group = bin.index + 1;
    const ciText = hasCi ? ` (95% CI ${formatNumber(loRr, 2)}–${formatNumber(hiRr, 2)})` : '';
    const eoText = Number.isFinite(bin.expectedByObservedRatio)
      ? `${formatNumber(bin.expectedByObservedRatio, 2)} (95% CI ${formatNumber(
          bin.lowerCiExpectedByObservedRatio,
          2,
        )}–${formatNumber(bin.upperCiExpectedByObservedRatio, 2)})`
      : '—';
    const tip = [
      `Group ${group} of ${rc.nBins} · risk score ${bin.label}`,
      `N = ${bin.n.toLocaleString('en-US')}`,
      `Predicted RR: ${formatNumber(predRr, 2)}`,
      `Observed RR: ${formatNumber(obsRr, 2)}${ciText}`,
      `E/O: ${eoText}`,
    ].join('\n');

    points.push({ index: bin.index, group, label: bin.label, predRr, obsRr, loRr, hiRr, tip });

    // Linear top: the largest predicted / observed / upper-CI value.
    maxUpper = Math.max(maxUpper, predRr, obsRr);
    if (hasCi) maxUpper = Math.max(maxUpper, hiRr);
    // Log bound: the largest multiplicative distance from 1 (a low CI bottom or a high value push the
    // symmetric domain out equally).
    maxRatio = Math.max(maxRatio, ratioFrom1(predRr), ratioFrom1(obsRr));
    if (hasCi) maxRatio = Math.max(maxRatio, ratioFrom1(loRr), ratioFrom1(hiRr));
  }

  // The ≥ 2 floor keeps the domain valid and un-collapsed (a single-bin RR≡1 study → [0,2] / [0.5,2]) and,
  // for the log frame, yields clean symmetric ticks (logBound ∈ {2,5,10,…}) with 1 always centered.
  const linearMax = Math.max(niceCeil(maxUpper), 2);
  const logBound = Math.max(niceCeil(maxRatio), 2);
  return { points, linearMax, logBound };
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface RelativeRiskCalibrationColors {
  /** Foreground: axis text, gridlines, title, legend labels, tip text. */
  fg: string;
  /** Muted ink: the identity line, the RR = 1 crosshair, and the goodness-of-fit annotation. */
  muted: string;
  /** Surface color: dot ring + tooltip background. */
  surface: string;
}

export interface RelativeRiskCalibrationChartOptions {
  points: RelativeRiskScatterPoint[];
  /** Linear square-axis maximum from the builder (`[0, linearMax]`). */
  linearMax: number;
  /** Log square-axis bound from the builder (`[1/logBound, logBound]`). */
  logBound: number;
  /** Which axis scale to draw; the section toggles this with no SDK re-run. */
  axisScale: 'linear' | 'log';
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the markers + observed-RR CI whiskers. */
  observedColor: string;
  /** Overall study-level stats baked bottom-right (the relative-risk goodness-of-fit), muted. */
  annotationLines: string[];
  /** Fitted calibration line (from the recompute engine, on the linear RR scale); drawn only when `showFit`. */
  fit?: LinearFit;
  /** Whether to overlay the fitted line + show its slope in the legend (toolbar toggle; off by default). */
  showFit?: boolean;
  /** Resolved color for the fitted line + its legend swatch. */
  fitColor?: string;
  colors: RelativeRiskCalibrationColors;
  width: number;
  ariaLabel?: string;
}

/**
 * Render the relative-risk calibration scatter as a bare <svg>. The caller (PlotFigure) supplies the
 * lazily-imported Plot module, the current container width, and (via `axisScale`) the toolbar's linear/log
 * choice; the section bounds the width so the square chart stays a tidy block.
 */
export function renderRelativeRiskCalibrationChart(
  Plot: typeof PlotNS,
  opts: RelativeRiskCalibrationChartOptions,
): SVGSVGElement {
  const { points, linearMax, logBound, axisScale, title, observedColor, annotationLines, colors, width, fit, fitColor } =
    opts;
  const showFit = opts.showFit ?? false;

  const isLog = axisScale === 'log';
  const domLo = isLog ? 1 / logBound : 0;
  const domHi = isLog ? logBound : linearMax;

  const ciPoints = points.filter((p) => Number.isFinite(p.loRr) && Number.isFinite(p.hiRr));
  const marks: PlotNS.Markish[] = [];

  // Population-average reference: the RR = 1 crosshair on both axes. Faint and solid so it reads as an
  // orienting frame (below-average groups lower-left, above-average upper-right) WITHOUT competing with the
  // identity line. Drawn first, under everything.
  marks.push(
    Plot.ruleX([1], { stroke: colors.muted, strokeWidth: 1.2, opacity: 0.5 }),
    Plot.ruleY([1], { stroke: colors.muted, strokeWidth: 1.2, opacity: 0.5 }),
  );

  // Perfect-calibration reference: a dotted 45° identity line spanning the full square. A straight screen
  // segment between two on-diagonal endpoints is exact in BOTH linear and log (log y = log x is itself
  // linear in screen space). The PRIMARY reference — kept more prominent than the crosshair.
  marks.push(
    Plot.line(
      [
        { x: domLo, y: domLo },
        { x: domHi, y: domHi },
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

  // Fitted calibration line (optional overlay, above the identity but under the data), fit on the LINEAR
  // relative-risk scale as y = intercept + slope·x. In the linear view that is a straight segment; in the
  // log view the same RR-space line projects to a curve, so sample it geometrically and keep strictly
  // positive y (a log axis has no room for y ≤ 0). Clipped so it can't spill past the axes.
  if (showFit && fit?.defined && fitColor) {
    const yAt = (x: number): number => fit.intercept + fit.slope * x;
    let linePts: { x: number; y: number }[];
    if (isLog) {
      linePts = [];
      const samples = 64;
      const ratio = domHi / domLo;
      for (let k = 0; k < samples; k += 1) {
        const x = domLo * Math.pow(ratio, k / (samples - 1));
        const y = yAt(x);
        if (y > 0) linePts.push({ x, y });
      }
    } else {
      linePts = [
        { x: domLo, y: yAt(domLo) },
        { x: domHi, y: yAt(domHi) },
      ];
    }
    if (linePts.length >= 2) {
      marks.push(
        Plot.line(linePts, {
          x: 'x',
          y: 'y',
          stroke: fitColor,
          strokeWidth: 1.75,
          strokeLinecap: 'round',
          clip: true,
        }),
      );
    }
  }

  // 95% log-Wald CI on the observed RR: vertical whiskers at each predicted-RR x, under the markers so the
  // dots stay legible on top.
  if (ciPoints.length > 0) {
    marks.push(
      Plot.ruleX(ciPoints, {
        x: 'predRr',
        y1: 'loRr',
        y2: 'hiRr',
        stroke: observedColor,
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        opacity: 0.85,
      }),
    );
  }

  // The calibration markers: predicted (x) vs observed (y) RR, with a surface-color ring so they pop over
  // the grid and their own whisker.
  marks.push(
    Plot.dot(points, {
      x: 'predRr',
      y: 'obsRr',
      fill: observedColor,
      r: 4.5,
      stroke: colors.surface,
      strokeWidth: 1.5,
    }),
  );

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

  // In-SVG legend (top-left INSIDE the frame — the empty corner above the identity line). Text-mark swatches
  // because color:{legend:true} returns an <figure>. Third row explains the RR = 1 crosshair.
  const legend: { i: number; swatch: string; label: string; color: string }[] = [
    { i: 0, swatch: '●', label: 'Observed rel. risk (95% CI)', color: observedColor },
    { i: 1, swatch: '⋯', label: 'Perfect calibration (y = x)', color: colors.muted },
    { i: 2, swatch: '+', label: 'Population average (RR = 1)', color: colors.muted },
  ];
  // Fitted-line legend row, only with the overlay on: its label carries the slope (1 = perfect calibration;
  // an undefined fit — fewer than two usable groups — renders the slope as an em-dash and draws no line).
  if (showFit && fit && fitColor) {
    legend.push({
      i: legend.length,
      swatch: '─',
      label: `Linear fit (slope ${formatNumber(fit.slope, 2)})`,
      color: fitColor,
    });
  }
  for (const e of legend) {
    marks.push(
      Plot.text([e.swatch], {
        text: (d) => d,
        frameAnchor: 'top-left',
        dx: 8,
        dy: 12 + e.i * 16,
        textAnchor: 'start',
        fontSize: 13,
        fontWeight: 700,
        fill: e.color,
      }),
      Plot.text([e.label], {
        text: (d) => d,
        frameAnchor: 'top-left',
        dx: 26,
        dy: 12 + e.i * 16,
        textAnchor: 'start',
        fontSize: 12,
        fill: colors.fg,
      }),
    );
  }

  // Overall relative-risk goodness-of-fit annotation, baked bottom-right (high predicted / low observed
  // corner, typically empty). Stacked upward so the last line sits just above the axis.
  const n = annotationLines.length;
  annotationLines.forEach((line, i) => {
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

  // Per-marker crosshair tip: that group's risk-score interval + predicted / observed (CI) / E-O stats.
  marks.push(
    Plot.tip(
      points,
      Plot.pointer({
        x: 'predRr',
        y: 'obsRr',
        fill: colors.surface,
        title: (d: RelativeRiskScatterPoint) => d.tip,
      }),
    ),
  );

  // Log ticks only in log mode; a linear axis uses Plot's default ticks.
  const logProps = isLog
    ? { type: 'log' as const, ticks: logTicks(logBound), tickFormat: (d: number) => String(d) }
    : {};

  // A square SVG with EQUAL margin sums (top+bottom === left+right) makes the inner frame square, so with the
  // shared [domLo, domHi] x/y domains the identity line is a true 45° in both scales.
  const side = width;
  const node = Plot.plot({
    width: side,
    height: side,
    marginTop: 40,
    marginRight: 24,
    marginBottom: 40,
    marginLeft: 56,
    style: { color: colors.fg, background: 'transparent', fontSize: '12px' },
    ariaLabel: opts.ariaLabel ?? title,
    x: {
      label: 'Predicted relative risk',
      labelAnchor: 'center',
      labelArrow: false,
      domain: [domLo, domHi],
      grid: true,
      nice: false,
      ...logProps,
    },
    y: {
      label: 'Observed relative risk',
      labelAnchor: 'center',
      labelArrow: false,
      domain: [domLo, domHi],
      grid: true,
      nice: false,
      ...logProps,
    },
    marks,
  });

  // Dev guard: a stray title/caption/legend option would return an HTML <figure>, silently breaking
  // single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error(
      'renderRelativeRiskCalibrationChart expected a bare <svg> from Plot.plot (got a <figure>).',
    );
  }
  return node;
}
