import { create } from 'zustand';

interface BinSettingsState {
  numberOfPercentiles: number;
  seed: number;
  set: (patch: Partial<Pick<BinSettingsState, 'numberOfPercentiles' | 'seed'>>) => void;
}

export const useBinSettingsStore = create<BinSettingsState>((set) => ({
  numberOfPercentiles: 10,
  seed: 50,
  set: (patch) => set(patch),
}));
