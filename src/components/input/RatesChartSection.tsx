import { useEffect, useState } from 'react';
import { readDelimited } from '../../lib/csvIngest';
import { fileKey, slotToFile } from '../../lib/slotFiles';
import { slotFilled, useInputStore } from '../../state/inputStore';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import {
  renderRateChart,
  toRateBands,
  toRateSeries,
  type RateBand,
  type RatePoint,
} from '../../viz/rateChart';

// Mode-A input display: one age-vs-rate line chart for a single incidence series. Rendered twice by
// InputBuilder — once for the disease incidence rates, once for the competing all-cause-mortality
// hazard — so it's a self-contained card driven by its `slotKey` prop. It reads the raw age,rate File
// slot, parses it lazily (SnpPanel pattern: `cancelled` flag, re-parse keyed on `fileKey`), resolves
// the current theme's colors (Plot bakes colors into the svg, so we pass hex in and re-render on a
// theme flip), and hands a pure `renderRateChart` closure to the shared PlotFigure (which owns the
// lazy Plot import + SVG/PNG download). The units toggle is lifted to InputBuilder so both charts stay
// in sync.

export type RateUnits = 'per-year' | 'per-100k';

type RateSlotKey = 'modelDiseaseIncidenceRates' | 'modelCompetingIncidenceRates';

/** The parsed series: either per-age points (drawn as a line) or age bands (drawn as a step). */
type RateSeries =
  | { kind: 'point'; points: RatePoint[] }
  | { kind: 'band'; intervals: RateBand[] };

export interface RatesChartSectionProps {
  slotKey: RateSlotKey;
  /** Title shown in the chart (and baked into downloads). */
  title: string;
  /** One-line epidemiologic caption under the chart. */
  caption: string;
  /** Series line/dot color, resolved per theme. */
  colorLight: string;
  colorDark: string;
  units: RateUnits;
  onUnitsChange: (u: RateUnits) => void;
  /** Shared x-axis domain (the union of both rate files' age ranges) so the two charts line up. */
  xDomain?: [number, number] | null;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  margin: '0 0 16px',
};

const captionStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--app-muted)',
  margin: '8px 0 0',
};

/** Read a resolved CSS custom property, with an SSR/test-safe fallback (light-theme value). */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chart'
  );
}

function miniToggle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
    borderRadius: 'var(--app-radius)',
    background: active ? 'var(--app-accent)' : 'var(--app-surface-2)',
    color: active ? 'var(--app-accent-fg)' : 'var(--app-fg)',
    padding: '4px 8px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function UnitsToggle({ units, onChange }: { units: RateUnits; onChange: (u: RateUnits) => void }) {
  const opt = (val: RateUnits, label: string) => (
    <button
      type="button"
      onClick={() => onChange(val)}
      aria-pressed={units === val}
      style={miniToggle(units === val)}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Rate units">
      {opt('per-year', 'per person-yr')}
      {opt('per-100k', 'per 100,000')}
    </div>
  );
}

export function RatesChartSection({
  slotKey,
  title,
  caption,
  colorLight,
  colorDark,
  units,
  onUnitsChange,
  xDomain,
}: RatesChartSectionProps) {
  const slot = useInputStore((s) => s.modelFiles[slotKey]);
  const mode = useInputStore((s) => s.mode);
  const study = useInputStore((s) => s.study);
  const datasetName = useInputStore((s) => s.datasetName);
  const theme = useAppStore((s) => s.theme);

  const [series, setSeries] = useState<RateSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = fileKey(slot);
  const filled = slotFilled(slot);

  // Parse the rate CSV lazily; re-parse when the referenced file changes. py-icare accepts two shapes,
  // so pick by header: `start_age,end_age,rate` ⇒ age bands (a step), else `age,rate` ⇒ per-age points.
  useEffect(() => {
    setSeries(null);
    setError(null);
    if (!filled) return;
    let cancelled = false;
    void (async () => {
      const { headers, rows } = await readDelimited(await slotToFile(slot));
      if (cancelled) return;
      const isBand =
        headers.includes('start_age') && headers.includes('end_age') && headers.includes('rate');
      setSeries(
        isBand
          ? { kind: 'band', intervals: toRateBands(rows) }
          : { kind: 'point', points: toRateSeries(rows) },
      );
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filled]);

  // Competing incidence rates only exist in Mode A; disease rates show in both modes. Either way, only
  // render once the file is present.
  const visible = filled && (slotKey !== 'modelCompetingIncidenceRates' || mode === 'A');
  if (!visible) return null;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const color = theme === 'dark' ? colorDark : colorLight;

  const ageMin = study.parse?.stats?.ageMin ?? null;
  const ageMax = study.parse?.stats?.ageMax ?? null;
  const band: [number, number] | null = ageMin !== null && ageMax !== null ? [ageMin, ageMax] : null;

  const unitScale = units === 'per-100k' ? 100000 : 1;
  const yLabel =
    units === 'per-100k' ? 'Rate (per 100,000 person-years)' : 'Rate (per person-year)';
  const unitShort = units === 'per-100k' ? 'per 100k p-yr' : 'per person-yr';

  const slug = `${slugify(datasetName || 'model')}-${slugify(title)}`;
  const fullCaption = band ? `${caption} Shaded band marks the study's age range.` : caption;

  const hasData =
    series !== null &&
    (series.kind === 'point' ? series.points.length > 0 : series.intervals.length > 0);
  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    series === null || !hasData
      ? null
      : renderRateChart(Plot, {
          points: series.kind === 'point' ? series.points : [],
          intervals: series.kind === 'band' ? series.intervals : null,
          title,
          color,
          unitScale,
          yLabel,
          unitShort,
          band,
          xDomain: xDomain ?? null,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  return (
    <figure style={cardStyle} aria-label={title}>
      {error ? (
        <p style={{ fontSize: 13, color: 'var(--app-danger)', margin: 0 }}>⚠ {error}</p>
      ) : series === null ? (
        <p style={{ fontSize: 13, color: 'var(--app-muted)', margin: 0 }}>Loading rates…</p>
      ) : (
        <PlotFigure
          render={render}
          deps={[series, units, theme, ageMin ?? -1, ageMax ?? -1, xDomain?.[0] ?? -1, xDomain?.[1] ?? -1]}
          exportName={slug}
          pngBackground={surface}
          toolbarExtras={<UnitsToggle units={units} onChange={onUnitsChange} />}
        />
      )}
      <figcaption style={captionStyle}>{fullCaption}</figcaption>
    </figure>
  );
}
