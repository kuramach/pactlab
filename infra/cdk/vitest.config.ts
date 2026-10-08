import { defineConfig } from 'vitest/config';

// CDK synthesis is slow on shared CI runners: hooks get the same budget as tests.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 },
});
