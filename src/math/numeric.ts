// Small numeric primitives shared by the calibration engine. Summation order matters here: several of
// these sums gate *discrete* bin membership — a quantile cutoff that drifts by one ULP can push a subject
// sitting on a decile boundary into the neighbouring bin and visibly shift that bin's observed/predicted
// mean — so the accumulators are Kahan-compensated. Pure module, no I/O.

/** Kahan (compensated) summation — resists the drift a naive running sum accrues over many terms. */
export function sumKahan(xs: ArrayLike<number>): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const y = xs[i] - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

/** Running Kahan cumulative sum (like `np.cumsum`), returned as a `Float64Array` of the same length. */
export function cumsumKahan(xs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(xs.length);
  let sum = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const y = xs[i] - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
    out[i] = sum;
  }
  return out;
}

/** Arithmetic mean; `NaN` for an empty input. */
export function mean(xs: ArrayLike<number>): number {
  return xs.length === 0 ? NaN : sumKahan(xs) / xs.length;
}

/** Weighted mean `Σ(xᵢ·wᵢ) / Σwᵢ`; `NaN` when the weights sum to zero (or the input is empty). */
export function weightedMean(xs: ArrayLike<number>, ws: ArrayLike<number>): number {
  let num = 0;
  let cn = 0;
  let den = 0;
  let cd = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const yn = xs[i] * ws[i] - cn;
    const tn = num + yn;
    cn = tn - num - yn;
    num = tn;
    const yd = ws[i] - cd;
    const td = den + yd;
    cd = td - den - yd;
    den = td;
  }
  return num / den;
}

/**
 * `[min, max]` over the input; `[NaN, NaN]` for an empty input. A single left-to-right pass (never
 * `Math.min(...xs)`) so it stays safe for the large per-subject arrays. Non-finite entries are skipped by
 * the strict `<`/`>` comparisons, so a stray NaN doesn't poison the extent (the descriptive columns this
 * serves — `followup`, `study_entry_age` — are finite anyway).
 */
export function extent(xs: ArrayLike<number>): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const v = xs[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // All entries non-finite (or none passed the comparisons) → report NaN rather than ±Infinity.
  if (min === Infinity || max === -Infinity) return [NaN, NaN];
  return [min, max];
}

/**
 * `np.linspace(start, stop, num)` reproduced bit-for-bit: `y[i] = i·step + start` with
 * `step = (stop − start)/(num − 1)`, then the last point forced exactly to `stop`. This is deliberately
 * NOT the decimal sequence `[0, 0.1, 0.2, …]` — `i·step` differs from those literals in IEEE-754, and the
 * difference flows into the R-7 virtual index, so it must match numpy exactly for bin-edge parity.
 */
export function linspace(start: number, stop: number, num: number): Float64Array {
  const out = new Float64Array(num);
  if (num === 1) {
    out[0] = start;
    return out;
  }
  const step = (stop - start) / (num - 1);
  for (let i = 0; i < num; i += 1) {
    out[i] = i * step + start;
  }
  out[num - 1] = stop;
  return out;
}

/**
 * Round up to a clean 1/2/5 × 10ⁿ ceiling, so a chart's axis-domain top and its ticks stay tidy. Shared by
 * the calibration scatters (Phases 8–9) to pick a square axis maximum; `x ≤ 0` → 1.
 */
export function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const frac = x / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Symmetric 1-2-5 ticks within `[1/m, m]`, always including 1 — for a log axis centered on 1 (a ratio
 * such as relative risk or Expected/Observed). E.g. `m = 5` → `[0.2, 0.5, 1, 2, 5]`. Shared by the
 * relative-risk calibration (Phase 9) and the E/O-by-group (Phase 12) plots.
 */
export function logTicks(m: number): number[] {
  const ticks = new Set<number>([1]);
  for (let decade = 1; decade <= m + 1e-9; decade *= 10) {
    for (const base of [1, 2, 5]) {
      const v = base * decade;
      if (v <= m + 1e-9) {
        ticks.add(v);
        ticks.add(1 / v);
      }
    }
  }
  return [...ticks].sort((a, b) => a - b);
}
