// Shared, component-free chrome primitives for the chart sections that wrap a <PlotFigure>: the
// card/caption styles, the CSS-var resolver (Plot bakes colors in, so chrome colors are read to hex at
// render time), and a mini segmented-toggle button style. Extracted so the results-step viz sections
// (Phases 7–11) share one home (cf. Phase 6's format.ts consolidation). Kept a pure .ts module (no
// component exports) so it doesn't trip react-refresh; each section builds its own specific toggle from
// `miniToggle` (as the input-step RatesChartSection already does with its local UnitsToggle). That
// section still carries its own copies for now — it has no dedicated test, so migrating it is deferred
// to the Phase 14 polish pass.

import type { CSSProperties } from 'react';

export type RateUnits = 'per-year' | 'per-100k';

/** Card wrapper for a chart <figure>: border + radius + surface, matching the app's flat card idiom. */
export const cardStyle: CSSProperties = {
  border: '1px solid var(--app-border)',
  borderRadius: 'var(--app-radius)',
  padding: 12,
  background: 'var(--app-surface)',
  margin: '0 0 16px',
};

/** Muted one-line caption under a chart. */
export const captionStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--app-muted)',
  margin: '8px 0 0',
};

/** Read a resolved CSS custom property, with an SSR/test-safe fallback (light-theme value). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Style for one button in a small segmented toggle (accent fill when active). */
export function miniToggle(active: boolean): CSSProperties {
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

/**
 * Label naming a toolbar control group (e.g. "Bin by", "Overlay", "Axis"), shown above the group's toggle
 * buttons. One shared style — the re-binning toolbar (RebinControls) and the per-chart toggles both use it —
 * so the calibration controls read as one system rather than drifting into different label treatments.
 */
export const toolbarGroupLabel: CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--app-fg)',
  whiteSpace: 'nowrap',
};
