import { create } from 'zustand';
import { subscribe as subscribeIcare, type IcareStatus } from '../services/icareService';

export type Step = 'input' | 'validate' | 'results';
export type Theme = 'light' | 'dark';

interface AppState {
  step: Step;
  theme: Theme;
  icareStatus: IcareStatus;
  icareError: string | null;
  setStep: (step: Step) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function initialTheme(): Theme {
  // SSR-safe: this module is evaluated at import time, including in non-DOM contexts (the
  // renderToStaticMarkup smoke test, any future SSR). Fall back to light when there's no window.
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export const useAppStore = create<AppState>((set, get) => ({
  step: 'input',
  theme: initialTheme(),
  icareStatus: 'idle',
  icareError: null,
  setStep: (step) => set({ step }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// Apply the initial theme attribute, and mirror the engine boot lifecycle into the store.
applyTheme(useAppStore.getState().theme);
subscribeIcare((s) => useAppStore.setState({ icareStatus: s.status, icareError: s.error }));
