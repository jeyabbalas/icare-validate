// Centralized, theme-paired series colors for the results-step charts (Phases 7–11). Observable Plot
// bakes concrete color strings into the SVG (it can't read CSS custom properties), so every series ships
// an explicit light/dark pair and the section resolves it against the current theme before rendering —
// and re-renders on a theme flip. Hues are the validated data-viz categorical blue (cool) + red (warm):
// a colorblind-safe warm/cool pair (CVD separation ΔE ≈ 74.6 light / 66.4 dark, ≫ the ≥12 target; ≥3:1
// contrast on both app surfaces in both themes). The red is the CATEGORICAL red, deliberately NOT the
// reserved status/danger red (--app-danger #dc2626 / #f87171) — a data series must never impersonate an
// error state.

export interface SeriesColor {
  light: string;
  dark: string;
}

/** Resolve a themed series color to the concrete hex Plot needs. */
export function pickSeriesColor(c: SeriesColor, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? c.dark : c.light;
}

// Expected / population — reuses the input-step disease-incidence blue so a reader ties "expected here"
// back to "the rates I supplied". Later: the expected/control pole of the calibration scatters (8–9) and
// the control density (10).
export const POPULATION_COLOR: SeriesColor = { light: '#2a78d6', dark: '#3987e5' };

// Observed / study — categorical red, the warm counter-pole to the blue. Later: the observed/case pole.
export const STUDY_COLOR: SeriesColor = { light: '#e34948', dark: '#e66767' };

// Phase 8–11 aliases: the observed↔expected (and case↔control) calibration/discrimination series share
// the same blue↔red semantics as study↔population, so name them for what those charts plot.
export const EXPECTED_COLOR = POPULATION_COLOR;
export const OBSERVED_COLOR = STUDY_COLOR;
