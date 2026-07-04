import { create } from 'zustand';
import { subscribe as subscribeIcare, type IcareStatus } from '../services/icareService';

export type Step = 'input' | 'results';
export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'icv-theme';

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
  // renderToStaticMarkup smoke test, any future SSR). Prefer a previously persisted choice, then the OS
  // preference, then light when there's no window.
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode / disabled) — fall through to the OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore persistence failures (private mode / disabled storage) */
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  step: 'input',
  theme: initialTheme(),
  icareStatus: 'idle',
  icareError: null,
  setStep: (step) => set({ step }),
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// Apply the initial theme attribute, and mirror the engine boot lifecycle into the store.
applyTheme(useAppStore.getState().theme);
subscribeIcare((s) => useAppStore.setState({ icareStatus: s.status, icareError: s.error }));
