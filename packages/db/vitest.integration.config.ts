import { defineConfig } from 'vitest/config';

/** Integration tests run against real PostgreSQL (`pnpm local:up`, or CI services). */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
