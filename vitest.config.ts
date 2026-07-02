import { defineConfig } from 'vitest/config';

// Standalone test config so the unit tests don't pull in the app's Vite plugins
// (React refresh, the PWA service-worker generator). The ingest validators are pure
// string functions, so the default Node environment is all they need.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
