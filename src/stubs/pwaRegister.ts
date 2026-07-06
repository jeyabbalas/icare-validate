// Test-time stub for `virtual:pwa-register/react`. The real virtual module is provided by
// vite-plugin-pwa only in the app build; the standalone vitest config excludes that plugin, so tests
// that render a component using `useRegisterSW` (e.g. App) resolve to this no-op instead. It mirrors
// the hook's return shape (two [value, setter] tuples + an updater) with the SW machinery stubbed out.

type Setter = (value: boolean) => void;
const noop: Setter = () => {};

export function useRegisterSW(): {
  offlineReady: [boolean, Setter];
  needRefresh: [boolean, Setter];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    offlineReady: [false, noop],
    needRefresh: [false, noop],
    updateServiceWorker: async () => {},
  };
}
