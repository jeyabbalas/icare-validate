// Statistics primitives for calibration: Wald confidence intervals and the chi-square distribution behind
// the Hosmer–Lemeshow / relative-risk goodness-of-fit p-values.
//
// There is no stats dependency in this project, so the chi-square CDF is built from the regularized lower
// incomplete gamma `P(a, x)` — a Lanczos log-gamma plus the Numerical-Recipes series / continued-fraction
// split. Pure module, total: `df < 1` (a single-bin relative-risk GOF has df = 0) yields `NaN` rather than
// throwing.

const Z_95 = 1.96;

/** 95% Wald CI `[estimate ± 1.96·se]` — matches py-icare's `wald_confidence_interval` (z = 1.96). */
export function waldCi(estimate: number, standardError: number): [number, number] {
  return [estimate - Z_95 * standardError, estimate + Z_95 * standardError];
}

/** Log-scale Wald CI, exponentiated: `[exp(log(estimate) ± 1.96·seLog)]`. */
export function logWaldCi(estimate: number, standardErrorLog: number): [number, number] {
  const [lo, hi] = waldCi(Math.log(estimate), standardErrorLog);
  return [Math.exp(lo), Math.exp(hi)];
}

// ---- Gamma & chi-square ----------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function (Lanczos approximation); valid for `x > 0`, incl. half-integers. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // reflection: Γ(x)·Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const xx = x - 1;
  const t = xx + LANCZOS_G + 0.5;
  let a = LANCZOS_C[0];
  for (let i = 1; i < LANCZOS_G + 2; i += 1) a += LANCZOS_C[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularized lower incomplete gamma `P(a, x) = γ(a, x)/Γ(a)` for `a > 0`, `x ≥ 0`. Uses the power series
 * for `x < a + 1` and, for larger `x`, computes the upper tail `Q(a, x)` by continued fraction and returns
 * `1 − Q` — matching Cephes/scipy, so the derived chi-square CDF (and hence py-icare's `1 − cdf` p-value)
 * agrees in the tail.
 */
export function gammpLower(a: number, x: number): number {
  if (!(a > 0) || x < 0 || Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  const prefactor = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    // series representation of P(a, x)
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 500; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * prefactor;
  }
  // Lentz continued fraction for Q(a, x); return P = 1 − Q
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - prefactor * h;
}

/** χ²(df) cumulative distribution at `x`: `P(df/2, x/2)`. `NaN` for `df < 1`. */
export function chi2Cdf(x: number, df: number): number {
  if (!(df >= 1)) return NaN;
  if (x <= 0) return 0;
  return gammpLower(df / 2, x / 2);
}

/**
 * Upper-tail p-value computed the SAME lossy way py-icare does — `1 − chi2.cdf` — so our p-values match
 * the SDK's exposed `.pValue` even in the tail, where `1 − cdf` loses precision. Deliberately does NOT use
 * the numerically-superior upper incomplete gamma: that would be "more correct" than the oracle and fail
 * parity. `NaN` for `df < 1` (a single-bin relative-risk GOF has df = 0).
 */
export function chi2SurvivalLossy(x: number, df: number): number {
  const cdf = chi2Cdf(x, df);
  return Number.isNaN(cdf) ? NaN : 1 - cdf;
}
