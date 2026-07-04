// A tiny module-level registry of the mounted results figures, so the global "Download all" (Phase 13)
// can reach every chart's live <svg> to bundle it into the ZIP. Each `PlotFigure` registers itself on
// mount and removes itself on unmount; the ZIP orchestrator reads the registry at click time.
//
// Why a registry and not a DOM query? `document.querySelectorAll('svg')` is brittle — it also catches
// KaTeX / icon SVGs, carries no `exportName` or PNG-background association, and has no stable order. And
// re-rendering each chart from its builder at export time would duplicate all the section render logic
// (Plot module, width, resolved theme) outside React. The registry gives us exactly the mounted node,
// its filename, and its backdrop, in a deterministic order, for free.
//
// The getters read the LIVE refs each time (never a cached node), so a figure that has since re-rendered
// (theme flip, re-bin) exports its current node, and one that is still loading / errored returns null and
// is skipped by the caller.

export interface FigureEntry {
  /** The live <svg> node, or null while the figure is loading / empty / errored. */
  getSvg: () => SVGSVGElement | null;
  /** The resolved surface color to paint under the PNG (transparent if undefined). */
  getBackground: () => string | undefined;
}

/**
 * Canonical order of the results figures AND the allow-list of what "Download all" bundles. Iterating
 * this (rather than the raw Map) gives a stable ZIP layout and filters out any non-results figure that
 * happens to use `PlotFigure` (e.g. the input-step rate charts). Keep in sync with the `exportName` props
 * in `src/components/results/*Section.tsx`.
 */
export const RESULTS_FIGURE_ORDER = [
  'age-specific-incidence-rates',
  'absolute-risk-calibration',
  'relative-risk-calibration',
  'expected-observed-by-group',
  'discrimination-risk-density',
  'discrimination-roc-curve',
] as const;

export type ResultsFigureName = (typeof RESULTS_FIGURE_ORDER)[number];

const registry = new Map<string, FigureEntry>();

/** Register (or replace) the figure mounted under `name`. */
export function registerFigure(name: string, entry: FigureEntry): void {
  registry.set(name, entry);
}

/**
 * Remove `name`'s registration — but only if `entry` is still the current one. React 19 StrictMode
 * double-invokes effects (mount → unmount → mount), and a concurrent remount can register the new
 * instance before the old instance's cleanup runs; the identity check stops that stale cleanup from
 * deleting the live entry.
 */
export function unregisterFigure(name: string, entry: FigureEntry): void {
  if (registry.get(name) === entry) registry.delete(name);
}

/** The registered results figures, in `RESULTS_FIGURE_ORDER` (unregistered names are simply omitted). */
export function listResultsFigures(): { name: ResultsFigureName; entry: FigureEntry }[] {
  const out: { name: ResultsFigureName; entry: FigureEntry }[] = [];
  for (const name of RESULTS_FIGURE_ORDER) {
    const entry = registry.get(name);
    if (entry) out.push({ name, entry });
  }
  return out;
}
