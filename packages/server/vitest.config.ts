import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**'],
    globalSetup: ['test/helpers/globalBuild.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80 },
    },
  },
});
