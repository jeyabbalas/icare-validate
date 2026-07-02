import { create } from 'zustand';
import type { TabularInput } from '../lib/icareTypes';

// Phase 1 fleshes this out (mode A/B toggle, per-file drop state, config controls).
interface InputState {
  studyData: TabularInput | null;
  modelParams: Record<string, TabularInput | null>;
  reset: () => void;
}

export const useInputStore = create<InputState>((set) => ({
  studyData: null,
  modelParams: {},
  reset: () => set({ studyData: null, modelParams: {} }),
}));
