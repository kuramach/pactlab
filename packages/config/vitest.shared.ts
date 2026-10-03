import { defineConfig } from 'vitest/config';

/** Unit tests: hermetic, no network, no external services. */
export const unitConfig = defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    environment: 'node',
  },
});
