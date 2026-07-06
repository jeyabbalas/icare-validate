import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone test config so the unit tests don't pull in the app's Vite plugins
// (React refresh, the PWA service-worker generator). The ingest validators are pure
// string functions, so the default Node environment is all they need.
export default defineConfig({
  // The PWA plugin (and thus its `virtual:pwa-register/react` module) is excluded here, so alias that
  // import to a no-op stub for any test that renders a component using useRegisterSW.
  resolve: {
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/stubs/pwaRegister.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
