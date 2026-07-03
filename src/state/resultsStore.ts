import { create } from 'zustand';
import type { ValidationResult } from '../lib/icareTypes';
import type { NormalizedResult } from '../services/resultNormalizer';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

// Populated by `runValidation` (services/validationRunner). Holds the raw `ValidationResult` (scalar
// metrics are already camelCased on it and read straight from here) plus the decoded `NormalizedResult`
// (per-subject / per-bin / incidence arrays) that the downstream phases bind to. The run lifecycle
// (`status`/`error`) drives the Validate-step progress UI. `reset` clears everything to the idle slate.
interface ResultsState {
  result: ValidationResult | null;
  normalized: NormalizedResult | null;
  status: RunStatus;
  error: string | null;
  reset: () => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  result: null,
  normalized: null,
  status: 'idle',
  error: null,
  reset: () => set({ result: null, normalized: null, status: 'idle', error: null }),
}));
