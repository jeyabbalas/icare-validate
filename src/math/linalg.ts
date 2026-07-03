// Small dense linear algebra for the relative-risk delta-method. The matrices are k×k with k = number of
// calibration bins (≤ ~20), so a plain `number[][]` and O(k³) elimination are entirely adequate.
//
// The one non-obvious contract: `solve` returns a vector of `NaN` on a singular or non-finite system
// instead of throwing. A degenerate calibration bin (observed rate exactly 0 or 1) makes the RR
// variance matrix singular and injects `Infinity` (via `1/observed`); numpy's `linalg.inv` *raises*
// there, but this engine must stay total under interactive re-binning, so we degrade to NaN and let the
// caller flag the goodness-of-fit test as undefined.

/** Matrix product `A·B` (A is n×k, B is k×m). */
export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const inner = b.length;
  const m = inner === 0 ? 0 : b[0].length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(m).fill(0);
    for (let p = 0; p < inner; p += 1) {
      const aip = a[i][p];
      const bp = b[p];
      for (let j = 0; j < m; j += 1) row[j] += aip * bp[j];
    }
    out.push(row);
  }
  return out;
}

/** Transpose. */
export function transpose(a: number[][]): number[][] {
  const n = a.length;
  const m = n === 0 ? 0 : a[0].length;
  const out: number[][] = [];
  for (let j = 0; j < m; j += 1) {
    const row = new Array<number>(n);
    for (let i = 0; i < n; i += 1) row[i] = a[i][j];
    out.push(row);
  }
  return out;
}

/** Diagonal matrix from a vector. */
export function diagFromVec(v: ArrayLike<number>): number[][] {
  const n = v.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(n).fill(0);
    row[i] = v[i];
    out.push(row);
  }
  return out;
}

/** Matrix·vector product. */
export function matVec(a: number[][], x: ArrayLike<number>): number[] {
  return a.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j += 1) s += row[j] * x[j];
    return s;
  });
}

/**
 * Solve `A·x = b` for a square `A` by Gauss–Jordan elimination with partial pivoting. Returns a vector of
 * `NaN` (never throws) when `A` is singular or carries a non-finite pivot, so the calibration engine
 * degrades gracefully on degenerate bins instead of crashing.
 */
export function solve(a: number[][], b: ArrayLike<number>): number[] {
  const n = a.length;
  if (n === 0) return [];
  const nan = (): number[] => new Array<number>(n).fill(NaN);
  // augmented working copy
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (!(best > 0) || !Number.isFinite(best)) return nan();
    if (piv !== col) {
      const tmp = m[piv];
      m[piv] = m[col];
      m[col] = tmp;
    }
    const pivVal = m[col][col];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i += 1) x[i] = m[i][n] / m[i][i];
  return x;
}

/** Quadratic form `xᵀ·A⁻¹·x`, computed by solving rather than inverting; `NaN` if `A` is singular. */
export function quadraticFormInverse(a: number[][], x: number[]): number {
  const y = solve(a, x);
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * y[i];
  return s;
}
