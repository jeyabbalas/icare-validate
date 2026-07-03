// The app's first Observable Plot figure: an age-vs-rate line chart for one incidence series
// (disease incidence, or the competing all-cause-mortality hazard). Both are per-person-year hazards
// tabulated by integer age; we draw each on its OWN linear axis in its own chart (the two differ by
// orders of magnitude, so a shared axis would squash one — the user chose separate linear plots).
//
// Two halves:
//   • `toRateSeries` — pure `{age,rate}[]` from d3-dsv string rows. Mirrors csvIngest's rate rules
//     exactly: a blank rate cell is MISSING (dropped), not zero — note `Number('') === 0`, so an
//     empty-string guard is load-bearing, not decorative (it's what drops BPC3's blank age-85–100 tail).
//   • `renderRateChart` — takes the lazily-loaded Plot module and returns a bare, self-contained
//     <svg>. It sets `style.color` (Plot bakes `fill="currentColor"` into axes/text — without this the
//     exported image renders black in dark mode) and keeps the title INSIDE the svg as a text mark, so
//     a downloaded PNG/SVG is self-explanatory. It deliberately uses no `title`/`caption`/legend
//     option, each of which would wrap the result in an HTML <figure> that can't export as one image.

import type * as PlotNS from '@observablehq/plot';

export interface RatePoint {
  age: number;
  rate: number;
}

/** Parse a d3-dsv cell to a finite number, or null when blank/whitespace/non-numeric. */
function parseCell(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim();
  if (s === '') return null; // blank ⇒ missing. Guard is essential: Number('') === 0, not NaN.
  const n = Number(s);
  return Number.isFinite(n) ? n : null; // Number() handles '4.9e-07' and '4.88E-03' alike.
}

/**
 * Map delimited `age,rate` rows to a clean, age-sorted series. Drops rows with a non-numeric age, a
 * blank/non-numeric rate, or a negative rate — matching `validateRatesTable` in csvIngest.ts (a blank
 * rate means "no coverage at this age", so it is omitted rather than plotted as 0).
 */
export function toRateSeries(rows: readonly Record<string, string | undefined>[]): RatePoint[] {
  const points: RatePoint[] = [];
  for (const row of rows) {
    const age = parseCell(row.age);
    const rate = parseCell(row.rate);
    if (age !== null && rate !== null && rate >= 0) points.push({ age, rate });
  }
  points.sort((a, b) => a.age - b.age);
  return points;
}

/** One half-open age band `[startAge, endAge)` with its (aggregate) rate, as entered in the CSV. */
export interface RateBand {
  startAge: number;
  endAge: number;
  rate: number;
}

/**
 * Map delimited `start_age,end_age,rate` rows to clean, start-sorted bands. Drops rows with a
 * non-numeric/negative field or `end_age ≤ start_age`; the authoritative validation (contiguity, the
 * [0,1] bound) lives in `validateRatesTable`, so this parser only needs to be robust.
 */
export function toRateBands(rows: readonly Record<string, string | undefined>[]): RateBand[] {
  const bands: RateBand[] = [];
  for (const row of rows) {
    const startAge = parseCell(row.start_age);
    const endAge = parseCell(row.end_age);
    const rate = parseCell(row.rate);
    if (
      startAge !== null &&
      endAge !== null &&
      rate !== null &&
      startAge >= 0 &&
      endAge > startAge &&
      rate >= 0
    ) {
      bands.push({ startAge, endAge, rate });
    }
  }
  bands.sort((a, b) => a.startAge - b.startAge);
  return bands;
}

/** Theme-resolved colors passed in from the section (Plot bakes colors in; it can't read CSS vars). */
export interface RateChartColors {
  /** Foreground: axis text, gridlines, tip text, title (drives `currentColor`). */
  fg: string;
  /** Muted ink: y-axis label emphasis, the cohort-band caption. */
  muted: string;
  /** Surface color: tooltip background. */
  surface: string;
}

export interface RateChartOptions {
  points: RatePoint[];
  /** Chart title, baked into the svg so downloads are self-describing (e.g. "Disease incidence rates"). */
  title: string;
  /** Resolved series color for the line + dots. */
  color: string;
  /** Multiplier applied to every rate (1 = per person-year, 100000 = per 100,000 person-years). */
  unitScale: number;
  /** Y-axis label including the unit (e.g. "Rate (per 100,000 person-years)"). */
  yLabel: string;
  /** Short unit shown in the tooltip (e.g. "per person-yr"). */
  unitShort: string;
  /** Cohort age span [min,max] to shade, if a study file is loaded. */
  band?: [number, number] | null;
  /** Age bands to render as a step, instead of `points`. When set (non-empty), overrides `points`. */
  intervals?: RateBand[] | null;
  /** Shared x-axis domain [min,max] so sibling charts align. Omit ⇒ Plot auto-fits this series. */
  xDomain?: [number, number] | null;
  colors: RateChartColors;
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
 * Render one incidence series as a bare <svg>. The caller (PlotFigure) supplies the lazily-imported
 * Plot module and the current container width.
 */
export function renderRateChart(Plot: typeof PlotNS, opts: RateChartOptions): SVGSVGElement {
  const {
    points,
    title,
    color,
    unitScale,
    yLabel,
    unitShort,
    band,
    intervals,
    xDomain,
    colors,
    width,
    height = 340,
    ariaLabel,
  } = opts;

  const bandList = intervals ?? [];
  const isBand = bandList.length > 0;

  // The plotted series, in display space (rate × unit scale) so axis, tooltip, and shading agree.
  // Age bands: plot the EFFECTIVE per-year value py-icare actually uses — the band's rate divided
  // across the years it spans — held constant across the band (a step). Per-age: the tabulated rate.
  const effective = (b: RateBand) => (b.rate / (b.endAge - b.startAge)) * unitScale;
  const data: { age: number; rate: number }[] = isBand
    ? [
        ...bandList.map((b) => ({ age: b.startAge, rate: effective(b) })),
        // Close the last step so `step-after` extends it to the final band's end age.
        {
          age: bandList[bandList.length - 1].endAge,
          rate: effective(bandList[bandList.length - 1]),
        },
      ]
    : points.map((p) => ({ age: p.age, rate: p.rate * unitScale }));

  const maxRate = data.reduce((m, d) => Math.max(m, d.rate), 0);
  const niceMax = niceCeil(maxRate);

  const ages = data.map((d) => d.age);
  const xMin = ages.length ? Math.min(...ages) : 0;
  const xMax = ages.length ? Math.max(...ages) : 1;

  // Clamp the cohort band to the shared x-domain (or this series' extent when no domain is given), so
  // both charts shade the same span and it never stretches the axis.
  const clampLo = xDomain ? xDomain[0] : xMin;
  const clampHi = xDomain ? xDomain[1] : xMax;
  const bandX: [number, number] | null =
    band && band[1] > band[0] ? [Math.max(band[0], clampLo), Math.min(band[1], clampHi)] : null;
  const hasBand = bandX !== null && bandX[1] > bandX[0];

  const marks: PlotNS.Markish[] = [];

  // Cohort age-range band (drawn first, under the series) + its in-svg caption.
  if (hasBand && bandX) {
    marks.push(
      Plot.rect([{ x1: bandX[0], x2: bandX[1], y1: 0, y2: niceMax }], {
        x1: 'x1',
        x2: 'x2',
        y1: 'y1',
        y2: 'y2',
        fill: colors.fg,
        fillOpacity: 0.06,
      }),
      Plot.text([{ x: (bandX[0] + bandX[1]) / 2, y: niceMax, t: 'study age range' }], {
        x: 'x',
        y: 'y',
        text: 't',
        dy: 9,
        fontSize: 10,
        fill: colors.muted,
        textAnchor: 'middle',
      }),
    );
  }

  // The series: a step for age bands (piecewise-constant hazard), a 2px line + per-age dots otherwise.
  marks.push(
    Plot.line(data, {
      x: 'age',
      y: 'rate',
      stroke: color,
      strokeWidth: 2,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
      curve: isBand ? 'step-after' : 'linear',
    }),
  );
  if (!isBand) {
    marks.push(Plot.dot(data, { x: 'age', y: 'rate', fill: color, r: 1.6 }));
  }
  // Title baked into the svg (top margin) so a downloaded image is self-describing.
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
  // Hover: a per-band tip (interval + effective per-year + raw band total) for bands; a per-age
  // crosshair otherwise.
  if (isBand) {
    const tips = bandList.map((b) => ({
      age: (b.startAge + b.endAge) / 2,
      rate: effective(b),
      label: `Ages ${b.startAge}–${b.endAge - 1}\n${formatRate(effective(b))} ${unitShort} (band total ${formatRate(b.rate * unitScale)})`,
    }));
    marks.push(
      Plot.tip(
        tips,
        Plot.pointerX({
          x: 'age',
          y: 'rate',
          fill: colors.surface,
          title: (d: { label: string }) => d.label,
        }),
      ),
    );
  } else {
    marks.push(
      Plot.tip(
        data,
        Plot.pointerX({
          x: 'age',
          y: 'rate',
          fill: colors.surface,
          title: (d: { age: number; rate: number }) =>
            `Age ${d.age}\n${formatRate(d.rate)} ${unitShort}`,
        }),
      ),
    );
  }

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
    throw new Error('renderRateChart expected a bare <svg> from Plot.plot (got a <figure>).');
  }
  return node;
}
