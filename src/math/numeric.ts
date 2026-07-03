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
