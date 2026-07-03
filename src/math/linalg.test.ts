import { describe, it, expect } from 'vitest';
import { matMul, transpose, diagFromVec, matVec, solve, quadraticFormInverse } from './linalg';

describe('matMul / transpose / diag / matVec', () => {
  it('multiplies matrices', () => {
    expect(
      matMul(
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ),
    ).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it('multiplies non-square (2×3 · 3×2)', () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const b = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    expect(matMul(a, b)).toEqual([
      [4, 5],
      [10, 11],
    ]);
  });

  it('transposes', () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it('builds a diagonal matrix and applies it', () => {
    expect(diagFromVec([2, 3])).toEqual([
      [2, 0],
      [0, 3],
    ]);
    expect(
      matVec(
        [
          [2, 0],
          [0, 3],
        ],
        [5, 7],
      ),
    ).toEqual([10, 21]);
  });
});

describe('solve', () => {
  it('solves a diagonal system', () => {
    expect(
      solve(
        [
          [2, 0],
          [0, 4],
        ],
        [2, 8],
      ),
    ).toEqual([1, 2]);
  });

  it('solves a general 2×2', () => {
    const x = solve(
      [
        [1, 2],
        [3, 4],
      ],
      [5, 6],
    );
    expect(x[0]).toBeCloseTo(-4, 10);
    expect(x[1]).toBeCloseTo(4.5, 10);
  });

  it('solves a 3×3 and reproduces b', () => {
    const A = [
      [2, 1, 1],
      [1, 3, 2],
      [1, 0, 0],
    ];
    const b = [4, 5, 6];
    const x = solve(A, b);
    expect(matVec(A, x)[0]).toBeCloseTo(4, 9);
    expect(matVec(A, x)[1]).toBeCloseTo(5, 9);
    expect(matVec(A, x)[2]).toBeCloseTo(6, 9);
  });

  it('returns NaN (no throw) on a singular system', () => {
    const x = solve(
      [
        [1, 2],
        [2, 4],
      ],
      [1, 2],
    );
    expect(x.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('returns NaN (no throw) on a non-finite matrix (degenerate bin)', () => {
    const x = solve(
      [
        [Infinity, 0],
        [0, 1],
      ],
      [1, 1],
    );
    expect(x.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('quadraticFormInverse', () => {
  it('computes xᵀ·A⁻¹·x', () => {
    // A = diag(2,4); A⁻¹ = diag(0.5,0.25); x=[2,4] → 0.5·4 + 0.25·16 = 2 + 4 = 6
    expect(
      quadraticFormInverse(
        [
          [2, 0],
          [0, 4],
        ],
        [2, 4],
      ),
    ).toBeCloseTo(6, 10);
  });

  it('is NaN for a singular A', () => {
    expect(
      Number.isNaN(
        quadraticFormInverse(
          [
            [1, 1],
            [1, 1],
          ],
          [1, 2],
        ),
      ),
    ).toBe(true);
  });
});
