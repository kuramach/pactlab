import { defineConfig } from 'vitest/config';

/** Fixture suite: synthetic companies load, normalize and seed idempotently (hermetic, in-process PostgreSQL). */
export default defineConfig({
  test: {
    include: ['src/**/*.fixtures.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
