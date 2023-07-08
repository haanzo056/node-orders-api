import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // all files share one database and truncate between tests
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
