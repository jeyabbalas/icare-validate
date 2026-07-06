import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { PlotFigure } from '../../viz/PlotFigure';
import { buildIncidenceSeries, renderIncidenceChart } from '../../viz/incidenceRates';
import { POPULATION_COLOR, STUDY_COLOR, pickSeriesColor } from '../../viz/palette';
import { cardStyle, captionStyle, cssVar, miniToggle, type RateUnits } from '../../viz/chartChrome';
import type { IncidenceRates } from '../../services/resultNormalizer';

// Results-step calibration viz #1 (Phase 7): the age-specific incidence overlay. Synchronous — the
// normalized incidence arrays are already in memory (no CSV read), so it just builds the tidy series,
// resolves the current theme's colors (Plot bakes colors into the svg, so we pass hex in and re-render
// on a theme flip), and hands a pure `renderIncidenceChart` closure to the shared PlotFigure (which owns
// the lazy Plot import + SVG/PNG download). The units toggle is local (single chart here, unlike the
// input step where two rate charts share a lifted toggle). Defaults to per-100,000 — the epidemiologic
// convention for reporting incidence (raw per-person-year values ~0.004 are unreadable).

export interface IncidenceRatesSectionProps {
  incidence: IncidenceRates;
  /** Nested case-control: the observed rates are inverse-probability-weighted (noted in the caption). */
  isNcc?: boolean;
}

/** per-person-year ↔ per-100,000 units toggle, shown as the chart's toolbar extra. */
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

export function IncidenceRatesSection({ incidence, isNcc = false }: IncidenceRatesSectionProps) {
  const theme = useAppStore((s) => s.theme);
  const [units, setUnits] = useState<RateUnits>('per-100k');

  const points = useMemo(() => buildIncidenceSeries(incidence), [incidence]);
  const hasPopulation = incidence.populationRate !== null;
  const hasData = points.length > 0;

  const fg = cssVar('--app-fg', '#0f172a');
  const muted = cssVar('--app-muted', '#64748b');
  const surface = cssVar('--app-surface', '#f8fafc');
  const studyColor = pickSeriesColor(STUDY_COLOR, theme);
  const populationColor = pickSeriesColor(POPULATION_COLOR, theme);

  const unitScale = units === 'per-100k' ? 100000 : 1;
  const yLabel =
    units === 'per-100k'
      ? 'Incidence rate (per 100,000 person-years)'
      : 'Incidence rate (per person-year)';
  const unitShort = units === 'per-100k' ? 'per 100k p-yr' : 'per person-yr';
  const title = 'Age-specific incidence rates';

  const render = (Plot: typeof import('@observablehq/plot'), ctx: { width: number }) =>
    !hasData
      ? null
      : renderIncidenceChart(Plot, {
          points,
          title,
          studyColor,
          populationColor,
          unitScale,
          yLabel,
          unitShort,
          colors: { fg, muted, surface },
          width: ctx.width,
        });

  const caption =
    (hasPopulation
      ? 'Observed age-specific incidence in the validation cohort (red) versus the expected population incidence the model assumes (blue). Divergence by age reveals cohort selection effects (calibration-in-the-large by age).'
      : 'Observed age-specific incidence in the validation cohort (red). No population incidence rates were provided, so the expected reference line is omitted.') +
    (isNcc ? ' Observed rates are inverse-probability-weighted (nested case-control design).' : '');

  return (
    <figure style={cardStyle} aria-label={title}>
      <PlotFigure
        render={render}
        deps={[points, units, theme]}
        exportName="age-specific-incidence-rates"
        ariaLabel="Line chart comparing study and population age-specific incidence rates"
        pngBackground={surface}
        toolbarExtras={<UnitsToggle units={units} onChange={setUnits} />}
      />
      <figcaption style={captionStyle}>{caption}</figcaption>
    </figure>
  );
}
