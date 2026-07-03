// Reproduces py-icare's risk-score binning in TypeScript. This is the parity-critical core: a cut edge
// that drifts by one ULP can move a subject sitting on a decile boundary into the neighbouring bin and
// visibly shift that bin's observed/predicted mean, so the quantile arithmetic mirrors numpy exactly.
//
// py-icare has TWO distinct binning paths, and they are NOT the same function:
//
//   • Default / N-percentiles (`weighted_quantcut`): edges are weighted (or, for a cohort, plain R-7)
//     quantiles at `linspace(0, 1, q+1)`, then `pd.cut(..., include_lowest=True, duplicates='drop')
//     .cat.remove_unused_categories()` — duplicate edges AND empty bins are dropped, so the realized bin
//     count can fall below `q` (and the goodness-of-fit `df` shrinks with it).
//
//   • Custom cutoffs (`pd.cut(score, bins=[min]+cutoffs+[max], include_lowest=True)`): pandas' defaults
//     (`duplicates='raise'`, no `remove_unused`) mean empty bins are KEPT (NaN stats, still counted in
//     `df`) and colliding edges would raise. We never throw — invalid cutoffs are dropped with a warning
//     the UI can surface — but otherwise keep py-icare's semantics.
//
// The asymmetry lives in `quantileEdges` (drops duplicate edges) vs `cutoffEdges` (does not) and in the
// `dropEmpty` flag threaded into `assignBins`. Pure module, no I/O; total (never throws).

import { cumsumKahan, linspace, sumKahan } from './numeric';

// ---- Quantiles -------------------------------------------------------------

/**
 * R-7 (numpy `np.quantile` default `method='linear'`) at probability `p` over an already-sorted array:
 * virtual index `h = (n−1)·p`, then linear interpolation between the bracketing order statistics.
 */
export function r7Quantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  if (lo >= n - 1) return sorted[n - 1];
  return sorted[lo] + (h - lo) * (sorted[lo + 1] - sorted[lo]);
}

/**
 * `np.interp(x, xp, fp)` — piecewise-linear interpolation with the exact-knot guarantee
 * (`interp(xp[i]) === fp[i]`) and end-clamping. `xp` must be non-decreasing; ties in `xp` resolve to the
 * lower knot's `fp`, which is exactly what the prepended `(x0, ecdf=0)` point in `weightedEcdf` needs.
 */
export function interp(x: number, xp: ArrayLike<number>, fp: ArrayLike<number>): number {
  const n = xp.length;
  if (n === 0) return NaN;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xp[lo];
  const x1 = xp[hi];
  if (x1 === x0) return fp[lo];
  return fp[lo] + ((fp[hi] - fp[lo]) / (x1 - x0)) * (x - x0);
}

// ---- Weighted empirical CDF (nested case-control path) ---------------------

export interface WeightedTable {
  x: Float64Array; // sorted unique values
  w: Float64Array; // summed weight per unique value
}

/**
 * py-icare `weighted_table`: drop NaN `x`/`w`, sort by `x`, and collapse duplicate `x` (Kahan-summing
 * their weights). The weight sums gate discrete bin membership, hence the compensated summation.
 */
export function weightedTable(x: ArrayLike<number>, w: ArrayLike<number>): WeightedTable {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i];
    const wi = w[i];
    if (Number.isNaN(xi) || Number.isNaN(wi)) continue;
    pairs.push([xi, wi]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const xs: number[] = [];
  const ws: number[] = [];
  let i = 0;
  while (i < pairs.length) {
    const xv = pairs[i][0];
    const group: number[] = [];
    let j = i;
    while (j < pairs.length && pairs[j][0] === xv) {
      group.push(pairs[j][1]);
      j += 1;
    }
    xs.push(xv);
    ws.push(sumKahan(group));
    i = j;
  }
  return { x: Float64Array.from(xs), w: Float64Array.from(ws) };
}

export interface WeightedEcdf {
  x: Float64Array;
  ecdf: Float64Array;
}

/**
 * py-icare `weighted_ecdf` with `type='i/n'`: cumulative normalized weights over the sorted unique values,
 * with a leading `(x0, 0)` point prepended so `interp(0) === min` and small quantiles interpolate from 0.
 */
export function weightedEcdf(x: ArrayLike<number>, w: ArrayLike<number>): WeightedEcdf {
  const table = weightedTable(x, w);
  const m = table.x.length;
  if (m === 0) return { x: new Float64Array(0), ecdf: new Float64Array(0) };
  const cumu = cumsumKahan(table.w);
  const total = cumu[m - 1];
  const cdf = new Float64Array(m);
  for (let i = 0; i < m; i += 1) cdf[i] = cumu[i] / total;
  if (!(cdf[0] > 0)) return { x: table.x, ecdf: cdf };
  const xOut = new Float64Array(m + 1);
  const cdfOut = new Float64Array(m + 1);
  xOut[0] = table.x[0];
  cdfOut[0] = 0;
  xOut.set(table.x, 1);
  cdfOut.set(cdf, 1);
  return { x: xOut, ecdf: cdfOut };
}

// ---- Edge construction -----------------------------------------------------

/** Drop duplicate (consecutive, since edges are monotonic) values — pandas `duplicates='drop'`. */
function dropDuplicateEdges(edges: number[]): number[] {
  const out: number[] = [];
  for (const e of edges) {
    if (out.length === 0 || e !== out[out.length - 1]) out.push(e);
  }
  return out;
}

/**
 * Default quantile edges at `linspace(0, 1, q+1)`. `weights == null` (cohort) ⇒ R-7 quantiles (numpy's
 * short-circuit ignores the `type='i/n'` that `weighted_quantcut` passes); otherwise (nested case-control)
 * ⇒ inverse-probability-weighted `i/n` ecdf + `interp`. Duplicate edges are dropped; a fully-degenerate
 * (constant) score collapses to a single zero-width `[v, v]` bin rather than an empty edge list.
 */
export function quantileEdges(
  score: ArrayLike<number>,
  weights: ArrayLike<number> | null,
  q: number,
): number[] {
  const probs = linspace(0, 1, q + 1);
  let edges: number[];
  if (weights == null) {
    const sorted = Float64Array.from(score);
    sorted.sort();
    edges = Array.from(probs, (p) => r7Quantile(sorted, p));
  } else {
    // py-icare's `weighted_quantile` drops zero / NaN weights before computing cutoffs.
    const xs: number[] = [];
    const ws: number[] = [];
    for (let i = 0; i < score.length; i += 1) {
      const wi = weights[i];
      if (wi === 0 || Number.isNaN(wi)) continue;
      xs.push(score[i]);
      ws.push(wi);
    }
    const { x, ecdf } = weightedEcdf(xs, ws);
    edges = Array.from(probs, (p) => interp(p, ecdf, x));
  }
  const deduped = dropDuplicateEdges(edges);
  if (deduped.length === 1) return [deduped[0], deduped[0]];
  return deduped;
}

export interface CutoffEdges {
  edges: number[];
  warnings: string[];
}

/**
 * Explicit-cutoff edges `[min(score), …interior…, max(score)]`. Mirrors py-icare's
 * `[min] + cutoffs + [max]`, but where pandas would raise (a cutoff on/outside the data range, or a
 * duplicate), we drop it with a warning so interactive re-binning never throws.
 */
export function cutoffEdges(score: ArrayLike<number>, interiorCutoffs: number[]): CutoffEdges {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < score.length; i += 1) {
    const v = score[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const warnings: string[] = [];
  const valid: number[] = [];
  const sortedCuts = interiorCutoffs.filter((c) => Number.isFinite(c)).sort((a, b) => a - b);
  for (const c of sortedCuts) {
    if (c <= min || c >= max) {
      warnings.push(`Cutoff ${c} lies outside the data range (${min}, ${max}) and was dropped.`);
      continue;
    }
    if (valid.length > 0 && c === valid[valid.length - 1]) {
      warnings.push(`Duplicate cutoff ${c} was dropped.`);
      continue;
    }
    valid.push(c);
  }
  return { edges: [min, ...valid, max], warnings };
}

// ---- Assignment ------------------------------------------------------------

export interface BinMeta {
  lo: number;
  hi: number;
  label: string; // "[lo, hi]" for the first bin, "(lo, hi]" otherwise
  firstBin: boolean;
  count: number; // realized subject count (unweighted)
}

export interface BinAssignment {
  binIndex: Int32Array; // realized bin per subject; -1 for a NaN / unbinnable score
  nBins: number;
  bins: BinMeta[];
}

/** First index `i` with `arr[i] >= v` — equivalently, the count of entries strictly `< v`. */
function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function formatEdge(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(4))) : String(x);
}

/**
 * Assign each score to a bin defined by `edges`, replicating `pd.cut(..., include_lowest=True)`: bin 0 is
 * the closed interval `[e0, e1]`, every later bin is right-closed `(e_j, e_{j+1}]`, and a subject sitting
 * exactly on an interior edge falls into the LOWER bin. `dropEmpty` mirrors `remove_unused_categories`:
 * `true` for the quantile path (empty bins removed, remaining bins renumbered), `false` for the
 * explicit-cutoff path (empty bins kept — they get NaN stats and still count toward `df`).
 */
export function assignBins(
  score: ArrayLike<number>,
  edges: number[],
  opts: { dropEmpty: boolean },
): BinAssignment {
  const nRaw = Math.max(edges.length - 1, 0);
  const interior = edges.slice(1, -1);
  const rawIndex = new Int32Array(score.length);
  const rawCounts = new Array<number>(nRaw).fill(0);
  for (let i = 0; i < score.length; i += 1) {
    const v = score[i];
    if (Number.isNaN(v) || nRaw === 0) {
      rawIndex[i] = -1;
      continue;
    }
    let b = lowerBound(interior, v);
    if (b >= nRaw) b = nRaw - 1;
    rawIndex[i] = b;
    rawCounts[b] += 1;
  }

  // Which raw bins survive, and how they renumber.
  const remap = new Int32Array(nRaw).fill(-1);
  const bins: BinMeta[] = [];
  for (let b = 0; b < nRaw; b += 1) {
    if (opts.dropEmpty && rawCounts[b] === 0) continue;
    const lo = edges[b];
    const hi = edges[b + 1];
    const firstBin = b === 0;
    remap[b] = bins.length;
    bins.push({
      lo,
      hi,
      firstBin,
      count: rawCounts[b],
      label: `${firstBin ? '[' : '('}${formatEdge(lo)}, ${formatEdge(hi)}]`,
    });
  }

  const binIndex = new Int32Array(score.length);
  for (let i = 0; i < score.length; i += 1) {
    binIndex[i] = rawIndex[i] < 0 ? -1 : remap[rawIndex[i]];
  }
  return { binIndex, nBins: bins.length, bins };
}
