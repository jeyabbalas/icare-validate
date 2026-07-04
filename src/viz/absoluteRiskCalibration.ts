// The results-step ABSOLUTE-RISK calibration plot (Phase 8): for each risk group (decile of the linear
// predictor), the model's mean PREDICTED absolute risk (x) versus the OBSERVED absolute risk (y), with a
// 95% Wald confidence interval on the observed risk and a perfect-calibration identity line. This is the
// figure that answers "does a predicted 3% risk really mean 3%?": a point ON the identity line is
// calibrated, ABOVE it the model under-predicts risk in that group, BELOW it over-predicts.
//
// The plot is fed by the Phase-5 recompute engine (`recomputeCalibration`), not the SDK's frozen category
// table, so Phase 12's interactive re-binning updates it with no SDK re-run; at the default deciles the
// engine reproduces the SDK category table exactly (calibrationMath.parity.test.ts).
//
// Two halves, mirroring incidenceRates.ts:
//   • `buildAbsoluteRiskCalibration` — pure: turns the engine's per-bin rows into tidy scatter points on
//     the PERCENT scale (absolute risks are probabilities but read best as clinical percentages), clamping
//     the lower CI to ≥ 0 (a raw Wald bound can go negative; a risk can't), dropping degenerate bins, and
//     pre-formatting each point's hover tooltip so it is unit-testable. It also returns the shared square
//     axis maximum (`domainMax`).
//   • `renderAbsoluteRiskCalibrationChart` — takes the lazily-loaded Plot module and returns a bare,
//     self-contained <svg>. EQUAL x/y domains + a square frame (square svg with equal margin sums) make
//     the identity line a true 45° (a calibration plot with unequal axes is misleading). It sets
//     `style.color` (so exported axes/text
//     aren't black in dark mode), bakes the title, legend, and the overall goodness-of-fit annotation as
//     text marks (self-describing downloads), and uses NO `title`/`caption`/legend Plot option — any of
//     those returns an HTML <figure> that can't export as one image. Colors arrive resolved to hex.

import type * as PlotNS from '@observablehq/plot';
import { extent } from '../math/numeric';
import { formatNumber, formatPercent } from '../lib/format';
import type { RecomputedCalibration } from '../math/calibrationMath';

/** One calibration marker: a risk group's predicted vs observed absolute risk (percent), + its CI + tip. */
export interface CalibrationScatterPoint {
  /** 0-based engine bin index. */
  index: number;
  /** 1-based group number shown to the user (groups run low→high risk). */
  group: number;
  /** Mean predicted absolute risk in the group, ×100 (percent) — the x coordinate. */
  predPct: number;
  /** Observed absolute risk in the group, ×100 (percent) — the y coordinate. */
  obsPct: number;
  /** Lower 95% CI on the observed risk, ×100, clamped to ≥ 0; NaN when no CI is defined. */
  loPct: number;
  /** Upper 95% CI on the observed risk, ×100; NaN when no CI is defined. */
  hiPct: number;
  /** Pre-formatted, newline-joined per-bin hover tooltip. */
  tip: string;
}

export interface AbsoluteRiskCalibrationData {
  points: CalibrationScatterPoint[];
  /** Shared upper bound for BOTH axes (percent), so the frame is square and the identity line is 45°. */
  domainMax: number;
}

/** Round up to a clean 1/2/5 × 10ⁿ ceiling, so the square domain top and its ticks are tidy. */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const frac = x / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Turn the recompute engine's per-bin rows into tidy calibration-scatter points. Skips degenerate bins
 * (empty / observed ∉ (0,1) / predicted ≤ 0 — routine under custom cutpoints, absent at default deciles)
 * and any bin whose observed/predicted risk is non-finite. Absolute risks are scaled to percent; the lower
 * CI is clamped to ≥ 0 for plotting. `domainMax` covers the largest predicted/observed/upper-CI value so
 * every marker and whisker sits inside the square frame.
 */
export function buildAbsoluteRiskCalibration(rc: RecomputedCalibration): AbsoluteRiskCalibrationData {
  const points: CalibrationScatterPoint[] = [];
  const candidates: number[] = [];

  for (const bin of rc.bins) {
    if (bin.degenerate) continue;
    const pred = bin.predictedAbsoluteRisk;
    const obs = bin.observedAbsoluteRisk;
    if (!Number.isFinite(pred) || !Number.isFinite(obs)) continue;

    const predPct = pred * 100;
    const obsPct = obs * 100;
    const hasCi = Number.isFinite(bin.lowerCiAbsoluteRisk) && Number.isFinite(bin.upperCiAbsoluteRisk);
    const loPct = hasCi ? Math.max(bin.lowerCiAbsoluteRisk * 100, 0) : NaN;
    const hiPct = hasCi ? bin.upperCiAbsoluteRisk * 100 : NaN;

    const group = bin.index + 1;
    const ciText = hasCi
      ? ` (95% CI ${formatPercent(bin.lowerCiAbsoluteRisk)}–${formatPercent(bin.upperCiAbsoluteRisk)})`
      : '';
    const eoText = Number.isFinite(bin.expectedByObservedRatio)
      ? `${formatNumber(bin.expectedByObservedRatio, 2)} (95% CI ${formatNumber(
          bin.lowerCiExpectedByObservedRatio,
          2,
        )}–${formatNumber(bin.upperCiExpectedByObservedRatio, 2)})`
      : '—';
    const tip = [
      `Group ${group} of ${rc.nBins}`,
      `N = ${bin.n.toLocaleString('en-US')}`,
      `Predicted: ${formatPercent(pred)}`,
      `Observed: ${formatPercent(obs)}${ciText}`,
      `E/O: ${eoText}`,
    ].join('\n');

    points.push({ index: bin.index, group, predPct, obsPct, loPct, hiPct, tip });
    candidates.push(predPct, obsPct);
    if (hasCi) candidates.push(hiPct);
  }

  const [, maxVal] = extent(candidates);
  const domainMax = niceCeil(Number.isFinite(maxVal) ? maxVal : 0);
  return { points, domainMax };
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface AbsoluteRiskCalibrationColors {
  /** Foreground: axis text, gridlines, title, legend labels, tip text (drives `currentColor`). */
  fg: string;
  /** Muted ink: the dotted identity line and the goodness-of-fit annotation. */
  muted: string;
  /** Surface color: dot ring + tooltip background. */
  surface: string;
}

export interface AbsoluteRiskCalibrationChartOptions {
  points: CalibrationScatterPoint[];
  /** Shared square-axis maximum (percent) from the builder. */
  domainMax: number;
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the markers + observed-risk CI whiskers. */
  observedColor: string;
  /** Overall study-level stats baked bottom-right (e.g. E/O + Hosmer–Lemeshow), muted. */
  annotationLines: string[];
  colors: AbsoluteRiskCalibrationColors;
  width: number;
  ariaLabel?: string;
}

/**
 * Render the absolute-risk calibration scatter as a bare <svg>. The caller (PlotFigure) supplies the
 * lazily-imported Plot module and the current container width; the section bounds that width so the square
 * chart stays a tidy block.
 */
export function renderAbsoluteRiskCalibrationChart(
  Plot: typeof PlotNS,
  opts: AbsoluteRiskCalibrationChartOptions,
): SVGSVGElement {
  const { points, domainMax, title, observedColor, annotationLines, colors, width, ariaLabel } = opts;

  const ciPoints = points.filter((p) => Number.isFinite(p.loPct) && Number.isFinite(p.hiPct));
  const marks: PlotNS.Markish[] = [];

  // Perfect-calibration reference: a dotted 45° identity line spanning the full square, drawn UNDER the
  // data. Because x and y share [0, domainMax] over a square frame, this is a true diagonal.
  marks.push(
    Plot.line(
      [
        { x: 0, y: 0 },
        { x: domainMax, y: domainMax },
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

  // 95% CI on the observed risk: vertical whiskers at each predicted-risk x (lower clamped ≥ 0), under the
  // markers so the dots stay legible on top.
  if (ciPoints.length > 0) {
    marks.push(
      Plot.ruleX(ciPoints, {
        x: 'predPct',
        y1: 'loPct',
        y2: 'hiPct',
        stroke: observedColor,
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        opacity: 0.85,
      }),
    );
  }

  // The calibration markers: predicted (x) vs observed (y), with a surface-color ring so they pop over the
  // grid and their own whisker.
  marks.push(
    Plot.dot(points, {
      x: 'predPct',
      y: 'obsPct',
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

  // In-SVG legend (top-left INSIDE the frame — the empty corner: low predicted maps to low observed, so
  // that corner never holds a marker). Text-mark swatches because color:{legend:true} returns an <figure>.
  const legend: { i: number; swatch: string; label: string; color: string }[] = [
    { i: 0, swatch: '●', label: 'Observed abs. risk (95% CI)', color: observedColor },
    { i: 1, swatch: '⋯', label: 'Perfect calibration (y = x)', color: colors.muted },
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

  // Overall goodness-of-fit annotation, baked bottom-right (high predicted / low observed corner — the
  // over-prediction region, typically empty). Stacked upward so the last line sits just above the axis.
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

  // Per-marker crosshair tip: that group's own predicted / observed (CI) / E-O stats.
  marks.push(
    Plot.tip(
      points,
      Plot.pointer({
        x: 'predPct',
        y: 'obsPct',
        fill: colors.surface,
        title: (d: CalibrationScatterPoint) => d.tip,
      }),
    ),
  );

  // A square SVG with EQUAL margin sums (top+bottom === left+right) makes the inner plot frame square, so
  // with the shared [0, domainMax] x/y domains the identity line is a true 45° (Plot's `aspectRatio` did
  // not equalize the scales reliably here, so we force the square geometry ourselves and let the section
  // bound the width).
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
      label: 'Predicted absolute risk (%)',
      // Centered along the bottom axis (drops Plot's default right-edge "→" label) — the conventional
      // calibration-plot placement.
      labelAnchor: 'center',
      labelArrow: false,
      domain: [0, domainMax],
      grid: true,
      nice: false,
    },
    y: {
      label: 'Observed absolute risk (%)',
      // Rotated + centered along the left axis, so it clears the baked title in the top margin.
      labelAnchor: 'center',
      labelArrow: false,
      domain: [0, domainMax],
      grid: true,
      nice: false,
    },
    marks,
  });

  // Dev guard: a stray title/caption/legend option would return an HTML <figure>, silently breaking
  // single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error(
      'renderAbsoluteRiskCalibrationChart expected a bare <svg> from Plot.plot (got a <figure>).',
    );
  }
  return node;
}
