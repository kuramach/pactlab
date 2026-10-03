import { defineConfig, mergeConfig } from 'vitest/config';
import { unitConfig } from '@pactlab/config/vitest';

export default mergeConfig(
  unitConfig,
  defineConfig({
    test: { exclude: ['**/*.integration.test.ts', '**/*.fixtures.test.ts', '**/node_modules/**'] },
  }),
);
