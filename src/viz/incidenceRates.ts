// The results-step age-specific incidence chart: the OBSERVED age-specific hazard in the validation
// cohort overlaid on the EXPECTED population hazard the model assumes, on one shared axis. This is a
// calibration-in-the-large *by age* diagnostic — a systematic observed-vs-expected gap that trends with
// age flags cohort selection (screening enrichment, healthy-volunteer effects, a mismatched reference
// population) before the binned calibration plots (Phases 8–9) ever run.
//
// Two halves, mirroring rateChart.ts:
//   • `buildIncidenceSeries` — pure: zips the normalized parallel Float64Arrays into tidy long-form
//     points. It DROPS a NaN study rate (an age where nobody is at risk — genuinely "no data") while
//     keeping that age's finite population point, and it KEEPS a true 0 study rate (an at-risk but
//     event-free age — a real, diagnostic zero, distinct from the NaN). Population points are emitted
//     only when a population-rate column was provided.
//   • `renderIncidenceChart` — takes the lazily-loaded Plot module and returns a bare, self-contained
//     <svg>. It sets `style.color` (Plot bakes `fill="currentColor"` into axes/text — without this the
//     exported image renders black in dark mode), bakes the title + legend INSIDE the svg as text marks
//     (so a downloaded image is self-describing), and uses NO `title`/`caption`/legend Plot option — any
//     of those returns an HTML <figure> that can't export as one image. Colors are passed in resolved
//     to hex (Plot can't read CSS vars) and the two series are drawn as two explicit line marks (no
//     `color` scale), which also gives z-order control: the smooth expected line under the noisy
//     observed line + dots.

import type * as PlotNS from '@observablehq/plot';
import { extent } from '../math/numeric';
import type { IncidenceRates } from '../services/resultNormalizer';

export type IncidenceSeries = 'study' | 'population';

/** One tidy long-form point. `rate` is RAW (per person-year); the renderer applies `unitScale`. */
export interface IncidencePoint {
  age: number;
  rate: number;
  series: IncidenceSeries;
}

/**
 * Zip the normalized incidence frame into tidy points, study-before-population within each age. Drops a
 * NaN study rate (nobody at risk) while keeping that age's finite population point; keeps a true 0 study
 * rate (at-risk but event-free); emits population points only when `populationRate` is present. A
 * non-finite age drops both series at that index.
 */
export function buildIncidenceSeries(inc: IncidenceRates): IncidencePoint[] {
  const pts: IncidencePoint[] = [];
  const { age, studyRate, populationRate } = inc;
  for (let i = 0; i < age.length; i += 1) {
    const a = age[i];
    if (!Number.isFinite(a)) continue;
    if (Number.isFinite(studyRate[i])) pts.push({ age: a, rate: studyRate[i], series: 'study' });
    if (populationRate && Number.isFinite(populationRate[i])) {
      pts.push({ age: a, rate: populationRate[i], series: 'population' });
    }
  }
  return pts;
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface IncidenceChartColors {
  /** Foreground: axis text, gridlines, title, legend labels, tip text (drives `currentColor`). */
  fg: string;
  /** Muted ink (reserved for optional notes; kept for parity with the other chart color shapes). */
  muted: string;
  /** Surface color: tooltip background. */
  surface: string;
}

export interface IncidenceChartOptions {
  /** Both series concatenated (population absent ⇒ study-only). Rates are raw; `unitScale` is applied here. */
  points: IncidencePoint[];
  /** Chart title, baked into the svg so downloads are self-describing. */
  title: string;
  /** Resolved color for the observed (study) line + dots. */
  studyColor: string;
  /** Resolved color for the expected (population) reference line. */
  populationColor: string;
  /** Multiplier applied to every rate (1 = per person-year, 100000 = per 100,000 person-years). */
  unitScale: number;
  /** Y-axis label including the unit (e.g. "Incidence rate (per 100,000 person-years)"). */
  yLabel: string;
  /** Short unit shown in the tooltip (e.g. "per 100k p-yr"). */
  unitShort: string;
  /** Shared x-axis domain [min,max]. Omit ⇒ Plot auto-fits the data. */
  xDomain?: [number, number] | null;
  colors: IncidenceChartColors;
  width: number;
  height?: number;
  ariaLabel?: string;
}

/** Round up to a clean 1/2/5 × 10ⁿ ceiling, so the y-domain top and its ticks are tidy. */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const frac = x / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/** Format a displayed rate for the tooltip: thousands-comma'd when large, else a few significant digits. */
function formatRate(v: number): string {
  if (v === 0) return '0';
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return v.toLocaleString('en-US', { maximumSignificantDigits: 3 });
}

/**
 * Render the observed-vs-expected age-specific incidence overlay as a bare <svg>. The caller (PlotFigure)
 * supplies the lazily-imported Plot module and the current container width.
 */
export function renderIncidenceChart(Plot: typeof PlotNS, opts: IncidenceChartOptions): SVGSVGElement {
  const {
    points,
    title,
    studyColor,
    populationColor,
    unitScale,
    yLabel,
    unitShort,
    xDomain,
    colors,
    width,
    height = 340,
    ariaLabel,
  } = opts;

  // Scale into display space once, then partition — so axis, legend, and tooltip all agree.
  const scaled = points.map((p) => ({ age: p.age, rate: p.rate * unitScale, series: p.series }));
  const studyPts = scaled.filter((d) => d.series === 'study');
  const popPts = scaled.filter((d) => d.series === 'population');
  const hasPopulation = popPts.length > 0;

  // One shared y-axis over BOTH series. extent() is finite-safe; niceCeil(0)→1 guards the all-zero case.
  const [, maxRate] = extent(scaled.map((d) => d.rate));
  const niceMax = niceCeil(Number.isFinite(maxRate) ? maxRate : 0);

  // Merge by age so one crosshair tip shows observed AND expected at the hovered age (the money view for
  // reading the gap). yAnchor = the higher line, so the tip box doesn't cover the marks.
  const byAge = new Map<number, { age: number; study?: number; population?: number; yAnchor: number }>();
  for (const d of scaled) {
    const row = byAge.get(d.age) ?? { age: d.age, yAnchor: 0 };
    if (d.series === 'study') row.study = d.rate;
    else row.population = d.rate;
    row.yAnchor = Math.max(row.yAnchor, d.rate);
    byAge.set(d.age, row);
  }
  const tipRows = [...byAge.values()].sort((a, b) => a.age - b.age);

  const marks: PlotNS.Markish[] = [];

  // Expected (population) reference — smooth, defined at all ages, drawn UNDER the noisy observed line.
  if (hasPopulation) {
    marks.push(
      Plot.line(popPts, {
        x: 'age',
        y: 'rate',
        stroke: populationColor,
        strokeWidth: 2,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
        curve: 'linear',
      }),
    );
  }

  // Observed (study) — jagged small-cohort series: a 2px line + per-age dots on top.
  marks.push(
    Plot.line(studyPts, {
      x: 'age',
      y: 'rate',
      stroke: studyColor,
      strokeWidth: 2,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      curve: 'linear',
    }),
    Plot.dot(studyPts, { x: 'age', y: 'rate', fill: studyColor, r: 1.6 }),
  );

  // Title baked into the top margin (self-describing downloads) — identical pattern to rateChart.ts.
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

  // In-SVG legend (top-left INSIDE the frame — the empty corner for an age↑ incidence curve). Built from
  // text marks because color:{legend:true} returns an HTML <figure> and breaks single-<svg> export. Each
  // entry = a colored em-dash swatch (reads as a line segment) + an ink label.
  const legend: { i: number; label: string; color: string }[] = [
    { i: 0, label: 'Observed (study)', color: studyColor },
  ];
  if (hasPopulation) legend.push({ i: 1, label: 'Expected (population)', color: populationColor });
  for (const e of legend) {
    marks.push(
      Plot.text(['—'], {
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
        dx: 24,
        dy: 12 + e.i * 16,
        textAnchor: 'start',
        fontSize: 12,
        fill: colors.fg,
      }),
    );
  }

  // Crosshair tip: observed + expected at the nearest age.
  marks.push(
    Plot.tip(
      tipRows,
      Plot.pointerX({
        x: 'age',
        y: 'yAnchor',
        fill: colors.surface,
        title: (d: { age: number; study?: number; population?: number }) => {
          const lines = [`Age ${d.age}`];
          if (d.study !== undefined) lines.push(`Observed: ${formatRate(d.study)} ${unitShort}`);
          if (d.population !== undefined) {
            lines.push(`Expected: ${formatRate(d.population)} ${unitShort}`);
          }
          return lines.join('\n');
        },
      }),
    ),
  );

  const node = Plot.plot({
    width,
    height,
    marginTop: 44,
    marginRight: 22,
    marginBottom: 40,
    marginLeft: 64,
    style: { color: colors.fg, background: 'transparent', fontSize: '12px' },
    ariaLabel: ariaLabel ?? title,
    x: {
      label: 'Age (years)',
      tickFormat: (d: number) => String(d),
      grid: false,
      domain: xDomain ?? undefined,
    },
    y: {
      label: yLabel,
      domain: [0, niceMax],
      grid: true,
      tickFormat: unitScale === 1 ? undefined : (d: number) => d.toLocaleString('en-US'),
    },
    marks,
  });

  // Dev guard: any stray title/caption/legend option would return an HTML <figure> instead, silently
  // breaking single-image export. Fail loud instead.
  if (!(node instanceof SVGSVGElement)) {
    throw new Error('renderIncidenceChart expected a bare <svg> from Plot.plot (got a <figure>).');
  }
  return node;
}
