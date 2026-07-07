// The results-step EXPECTED / OBSERVED-by-group plot (Phase 12): each risk group's E/O ratio
// (predicted ÷ observed absolute risk) with a 95% CI, on a log axis about a reference line at 1. Where the
// absolute-risk scatter encodes E/O as distance from the identity line, this reads it directly per group —
// a group above 1 is over-predicted, below 1 under-predicted, and a CI crossing 1 is consistent with good
// calibration there. It is the per-group face of the Hosmer–Lemeshow test, and reads especially cleanly
// under a clinical cutpoint (e.g. ≤3% vs >3%, two points).
//
// A ratio's meaningful baseline is 1, not 0 — hence a dot + CI on a LOG axis against `ruleY([1])`, not a
// bar from zero. Fed by the recompute engine, so it re-bins with no SDK re-run.
//
// Two halves, mirroring absoluteRiskCalibration.ts:
//   • `buildEoRatio` — pure: per-bin rows → tidy points, skipping degenerate bins (empty / observed ∉ (0,1)
//     / predicted ≤ 0) and any non-positive/non-finite E/O (a log axis needs strictly positive coordinates).
//     Each point's tooltip carries the group's scale-aware boundary. Returns the full 1…nBins group list (so
//     a dropped bin leaves a documented gap on the x-axis) and a symmetric log bound `[1/M, M]`.
//   • `renderEoRatioChart` — takes the lazily-loaded Plot module and returns a bare <svg> (landscape;
//     title/legend/annotation baked as text marks so downloads are self-describing). Colors arrive as hex.

import type * as PlotNS from '@observablehq/plot';
import { niceCeil, logTicks } from '../math/numeric';
import { formatCount, formatNumber, formatPercent, formatPercentInterval } from '../lib/format';
import type { RecomputedCalibration } from '../math/calibrationMath';

/** One E/O marker: a risk group's Expected/Observed ratio + its 95% CI + tooltip. */
export interface EoRatioPoint {
  /** 0-based engine bin index. */
  index: number;
  /** 1-based group number (groups run low→high risk) — the x coordinate. */
  group: number;
  /** Expected/Observed ratio (predicted ÷ observed) — the y coordinate. */
  eo: number;
  /** Lower 95% log-Wald CI on E/O (> 0); NaN when no CI is defined. */
  lo: number;
  /** Upper 95% log-Wald CI on E/O (> 0); NaN when no CI is defined. */
  hi: number;
  /** Pre-formatted, newline-joined per-bin hover tooltip. */
  tip: string;
}

export interface EoRatioData {
  points: EoRatioPoint[];
  /** Full 1…nBins group list = the x-axis point domain, so a dropped (degenerate) bin leaves a gap. */
  groups: number[];
  /** Symmetric log bound: the y-domain is `[1/logBound, logBound]` (≥ 2, so 1 is centered with clean ticks). */
  logBound: number;
}

/**
 * Turn the recompute engine's per-bin rows into E/O points. Skips degenerate bins and any bin whose E/O or
 * CI is non-finite or ≤ 0 (a log axis needs strictly positive coordinates). The tooltip's boundary is
 * scale-aware: a predicted-risk percentage interval on the absolute-risk scale, the raw linear-predictor
 * interval otherwise. `logBound` covers the largest multiplicative distance from 1 (a low CI floor or a high
 * value pushes the symmetric domain out equally).
 */
export function buildEoRatio(rc: RecomputedCalibration): EoRatioData {
  const points: EoRatioPoint[] = [];
  let maxRatio = 1;
  const ratioFrom1 = (v: number): number => Math.max(v, 1 / v);

  for (const bin of rc.bins) {
    if (bin.degenerate) continue;
    const eo = bin.expectedByObservedRatio;
    if (!Number.isFinite(eo) || eo <= 0) continue;

    const lower = bin.lowerCiExpectedByObservedRatio;
    const upper = bin.upperCiExpectedByObservedRatio;
    const hasCi = Number.isFinite(lower) && Number.isFinite(upper) && lower > 0 && upper > 0;
    const lo = hasCi ? lower : NaN;
    const hi = hasCi ? upper : NaN;

    const group = bin.index + 1;
    const boundary = rc.scale === 'absolute-risk' ? formatPercentInterval(bin) : bin.label;
    const ciText = hasCi ? ` (95% CI ${formatNumber(lo, 2)}–${formatNumber(hi, 2)})` : '';
    // Cases: raw sampled count; for ncc also the design-weighted "effective" count (Σ outcome·frequency),
    // which reconciles with the IPW-weighted observed risk in the E/O ratio.
    const casesLine = rc.isNcc
      ? `Cases = ${bin.nCases.toLocaleString('en-US')} (effective ≈ ${formatCount(bin.weightedCases)})`
      : `Cases = ${bin.nCases.toLocaleString('en-US')}`;
    const tip = [
      `Group ${group} of ${rc.nBins} · ${boundary}`,
      `N = ${bin.n.toLocaleString('en-US')}`,
      casesLine,
      `Predicted ${formatPercent(bin.predictedAbsoluteRisk)} vs observed ${formatPercent(bin.observedAbsoluteRisk)}`,
      `E/O: ${formatNumber(eo, 2)}${ciText}`,
    ].join('\n');

    points.push({ index: bin.index, group, eo, lo, hi, tip });
    maxRatio = Math.max(maxRatio, ratioFrom1(eo));
    if (hasCi) maxRatio = Math.max(maxRatio, ratioFrom1(lo), ratioFrom1(hi));
  }

  const groups = Array.from({ length: rc.nBins }, (_, i) => i + 1);
  const logBound = Math.max(niceCeil(maxRatio), 2);
  return { points, groups, logBound };
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface EoRatioColors {
  /** Foreground: axis text, gridlines, title, legend labels, tip text. */
  fg: string;
  /** Muted ink: the E/O = 1 reference line and the goodness-of-fit annotation. */
  muted: string;
  /** Surface color: dot ring + tooltip background. */
  surface: string;
}

export interface EoRatioChartOptions {
  points: EoRatioPoint[];
  /** Full 1…nBins x-axis point domain. */
  groups: number[];
  /** Symmetric log bound (`[1/logBound, logBound]`). */
  logBound: number;
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the markers + E/O CI whiskers. */
  observedColor: string;
  /** Overall study-level stats baked bottom-right (the Hosmer–Lemeshow test), muted. */
  annotationLines: string[];
  colors: EoRatioColors;
  width: number;
  ariaLabel?: string;
}

/**
 * Render the E/O-by-group plot as a bare <svg>. Landscape (unlike the square calibration scatters): the
 * caller (PlotFigure) supplies the lazily-imported Plot module and the current container width.
 */
export function renderEoRatioChart(Plot: typeof PlotNS, opts: EoRatioChartOptions): SVGSVGElement {
  const { points, groups, logBound, title, observedColor, annotationLines, colors, width } = opts;

  const domLo = 1 / logBound;
  const domHi = logBound;
  const ciPoints = points.filter((p) => Number.isFinite(p.lo) && Number.isFinite(p.hi));
  const marks: PlotNS.Markish[] = [];

  // Perfect-calibration reference: the E/O = 1 line, dashed and muted, under the data. THE baseline here.
  marks.push(
    Plot.ruleY([1], {
      stroke: colors.muted,
      strokeWidth: 1.5,
      strokeDasharray: '2 4',
      strokeLinecap: 'round',
    }),
  );

  // 95% CI on each group's E/O: vertical whiskers, under the markers so the dots stay legible on top.
  if (ciPoints.length > 0) {
    marks.push(
      Plot.ruleX(ciPoints, {
        x: 'group',
        y1: 'lo',
        y2: 'hi',
        stroke: observedColor,
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        opacity: 0.85,
      }),
    );
  }

  // The E/O markers, with a surface-color ring so they pop over the grid and their own whisker.
  marks.push(
    Plot.dot(points, {
      x: 'group',
      y: 'eo',
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

  // In-SVG legend (top-left INSIDE the frame). Text-mark swatches because color:{legend:true} returns an
  // <figure> that can't export as one image.
  const legend: { i: number; swatch: string; label: string; color: string }[] = [
    { i: 0, swatch: '●', label: 'E/O ratio (95% CI)', color: observedColor },
    { i: 1, swatch: '⋯', label: 'Perfect calibration (E/O = 1)', color: colors.muted },
  ];
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

  // Overall goodness-of-fit annotation, baked bottom-right. Stacked upward so the last line sits above the axis.
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

  // Per-marker crosshair tip.
  marks.push(
    Plot.tip(
      points,
      Plot.pointer({
        x: 'group',
        y: 'eo',
        fill: colors.surface,
        title: (d: EoRatioPoint) => d.tip,
      }),
    ),
  );

  // Landscape frame (this is NOT a square identity-line plot). Height ≈ half the width, bounded.
  const height = Math.max(260, Math.min(380, Math.round(width * 0.5)));
  const node = Plot.plot({
    width,
    height,
    marginTop: 40,
    marginRight: 24,
    marginBottom: 40,
    marginLeft: 56,
    style: { color: colors.fg, background: 'transparent', fontSize: '12px' },
    ariaLabel: opts.ariaLabel ?? title,
    x: {
      type: 'point',
      domain: groups,
      label: 'Risk group (low → high)',
      labelAnchor: 'center',
      labelArrow: false,
      grid: false,
    },
    y: {
      type: 'log',
      domain: [domLo, domHi],
      ticks: logTicks(logBound),
      tickFormat: (d: number) => String(d),
      label: 'Expected / Observed',
      labelAnchor: 'center',
      labelArrow: false,
      grid: true,
      nice: false,
    },
    marks,
  });

  // Dev guard: a stray title/caption/legend option would return an HTML <figure>, silently breaking
  // single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error('renderEoRatioChart expected a bare <svg> from Plot.plot (got a <figure>).');
  }
  return node;
}
