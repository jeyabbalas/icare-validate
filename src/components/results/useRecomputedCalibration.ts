import { useMemo } from 'react';
import { recomputeCalibration, type RecomputedCalibration } from '../../math/calibrationMath';
import { buildRebinOptions, useRebinStore } from '../../state/rebinStore';
import type { NormalizedResult } from '../../services/resultNormalizer';

/**
 * The single client-side calibration recompute for the results view (Phase 12). It reads the results-
 * scoped `rebinStore`, translates the display-unit state into engine options (`buildRebinOptions` — the
 * one place absolute-risk cutpoints go from percent to proportion), and memoizes `recomputeCalibration`
 * over the normalized per-subject arrays. Lifting it into a shared hook keeps `CalibrationPanel` and any
 * future consumer (Phase 13 export) on ONE `rc`, so the plots, tables, tiles, and export can't diverge.
 *
 * At the run-seeded default (linear-predictor deciles) this reproduces `result.categorySpecificCalibration`
 * and `result.calibration` (proven by calibrationMath.parity.test.ts); changing the store re-bins instantly.
 */
export function useRecomputedCalibration(normalized: NormalizedResult): RecomputedCalibration {
  const scale = useRebinStore((s) => s.scale);
  const method = useRebinStore((s) => s.method);
  const numberOfPercentiles = useRebinStore((s) => s.numberOfPercentiles);
  const cutpoints = useRebinStore((s) => s.cutpoints);

  return useMemo(
    () =>
      recomputeCalibration(
        normalized.perSubject,
        normalized.isNcc,
        buildRebinOptions({ scale, method, numberOfPercentiles, cutpoints }),
      ),
    [normalized.perSubject, normalized.isNcc, scale, method, numberOfPercentiles, cutpoints],
  );
}
