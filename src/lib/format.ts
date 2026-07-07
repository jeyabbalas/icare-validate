// Shared display formatters for the results UI. Centralizes the finite-guarded number / count / p-value /
// range / goodness-of-fit rendering the cohort-summary panel (and later export phases) use, so there is a
// single home for the "toFixed with an em-dash fallback" idiom instead of re-deriving it per component.
// (`ResultsPanel`'s local `fmt`/`pval`/`gof` were lifted here; `patsyToLatex.ts`'s own `formatNumber` is
// left untouched — coefficient-table formatting is out of this phase's scope.)

import type { GoodnessOfFitTest } from './icareTypes';

const EM_DASH = '—';
const EN_DASH = '–';

/** Fixed-decimal number, finite-guarded → `—`. */
export function formatNumber(x: number | undefined | null, digits = 3): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) : EM_DASH;
}

/**
 * A proportion (0–1) rendered as a percentage, finite-guarded → `—` (e.g. `0.0324` → `3.24%`).
 * Guards before scaling so a non-finite input never yields a stray `—%`. Used by the calibration
 * charts/tables where absolute risks are probabilities but read best as clinical percentages.
 */
export function formatPercent(x: number | undefined | null, digits = 2): string {
  return typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : EM_DASH;
}

/**
 * A percent-scale bin interval carrying the bin's inclusive/exclusive brackets, matching the
 * linear-predictor `bin.label` convention (`[lo, hi]` for the first bin, `(lo, hi]` otherwise). On the
 * absolute-risk scale `bin.lo`/`bin.hi` are proportions, so we reformat them as percentages but keep the
 * authoritative opening bracket carried in `bin.label` — robust to a dropped empty first bin, where the
 * surviving bin at index 0 correctly reads `(`.
 */
export function formatPercentInterval(bin: { label: string; lo: number; hi: number }): string {
  const open = bin.label.startsWith('[') ? '[' : '(';
  return `${open}${formatPercent(bin.lo)}, ${formatPercent(bin.hi)}]`;
}

/** Integer count with thousands separators (`5285` → `5,285`); non-finite → `—`. Rounds (for weighted Σ). */
export function formatCount(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : EM_DASH;
}

/** p-value: `<0.001` below the threshold, else 3 dp; non-finite → `—`. */
export function formatPValue(p: number | undefined | null): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return EM_DASH;
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

// Fixed decimal with trailing zeros trimmed, so integer-valued ages read "50" not "50.0". Only strips
// zeros that follow a decimal point (a bare "100" is never touched).
function trimFixed(x: number, digits: number): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return EM_DASH;
  return x.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** `min–max` (en-dash), each trailing-zero-trimmed and finite-guarded. */
export function formatRange(min: number, max: number, digits = 1): string {
  return `${trimFixed(min, digits)}${EN_DASH}${trimFixed(max, digits)}`;
}

/** `95% CI lo–hi` (en-dash), each endpoint fixed-decimal and finite-guarded → `—`. */
export function formatCi(lower: number, upper: number, digits = 3): string {
  return `95% CI ${formatNumber(lower, digits)}${EN_DASH}${formatNumber(upper, digits)}`;
}

/** SDK goodness-of-fit test → `χ² … · df … · p …`, reading the nested SDK fields. */
export function formatGof(g: GoodnessOfFitTest): string {
  const chi = formatNumber(g.statistic?.chiSquare, 2);
  const df = g.parameter?.degreesOfFreedom ?? EM_DASH;
  return `χ² ${chi} · df ${df} · p ${formatPValue(g.pValue)}`;
}

/**
 * Same `χ² … · df … · p …` rendering for the recompute engine's FLAT `GofResult`
 * ({ chiSquare, degreesOfFreedom, pValue }). Used by the calibration plots/tiles under interactive
 * re-binning, where the goodness-of-fit is recomputed client-side rather than read from the SDK's
 * nested shape. An undefined GOF carries NaN χ²/p, which the finite guards render as em-dashes.
 */
export function formatGofResult(g: {
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
}): string {
  return `χ² ${formatNumber(g.chiSquare, 2)} · df ${g.degreesOfFreedom} · p ${formatPValue(g.pValue)}`;
}
