import { create } from 'zustand';
import type { ValidationResult } from '../lib/icareTypes';
import type { NormalizedResult } from '../services/resultNormalizer';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Reproducibility settings captured at run time and frozen with the result, so the exported provenance
 * (metrics.json) reflects what actually produced the result — not the live input stores, which can drift
 * if the user edits inputs afterward without re-running.
 */
export interface RunProvenance {
  mode: 'A' | 'B'; // 'A' builds the model from parameters (imputes missing covariates); 'B' uses precomputed risks
  numImputations: number | null; // as configured; null → py-icare's default of 5. Imputation applies in Mode A only.
  seed: number; // RNG seed for imputation reproducibility
}

// Populated by `runValidation` (services/validationRunner). Holds the raw `ValidationResult` (scalar
// metrics are already camelCased on it and read straight from here) plus the decoded `NormalizedResult`
// (per-subject / per-bin / incidence arrays) that the downstream phases bind to. The run lifecycle
// (`status`/`error`) drives the Input-tab inline progress bar (RunActionBar) — the run now happens on the
// Input tab and auto-advances to Results only on success. `reset` clears everything to the idle slate.
interface ResultsState {
  result: ValidationResult | null;
  normalized: NormalizedResult | null;
  provenance: RunProvenance | null; // reproducibility settings frozen at run time (for metrics.json)
  status: RunStatus;
  error: string | null;
  reset: () => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  result: null,
  normalized: null,
  provenance: null,
  status: 'idle',
  error: null,
  reset: () =>
    set({ result: null, normalized: null, provenance: null, status: 'idle', error: null }),
}));
