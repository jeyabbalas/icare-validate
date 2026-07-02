import { create } from 'zustand';
import type { ValidationResult } from '../lib/icareTypes';

// Phase 4 populates this with the normalized result; downstream phases read from it.
interface ResultsState {
  result: ValidationResult | null;
  setResult: (result: ValidationResult | null) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
}));
