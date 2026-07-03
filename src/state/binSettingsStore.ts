import { create } from 'zustand';

interface BinSettingsState {
  numberOfPercentiles: number;
  seed: number;
  set: (patch: Partial<Pick<BinSettingsState, 'numberOfPercentiles' | 'seed'>>) => void;
  reset: () => void;
}

const DEFAULTS = { numberOfPercentiles: 10, seed: 50 };

export const useBinSettingsStore = create<BinSettingsState>((set) => ({
  ...DEFAULTS,
  set: (patch) => set(patch),
  reset: () => set({ ...DEFAULTS }),
}));
