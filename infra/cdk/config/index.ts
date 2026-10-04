import { devConfig } from './dev';
import { prodConfig } from './prod';
import { qaConfig } from './qa';
import { stageConfig } from './stage';
import type { EnvironmentConfig, EnvironmentName } from './types';

export * from './types';
export { devConfig, prodConfig, qaConfig, stageConfig };

export const ENVIRONMENTS: Readonly<Record<EnvironmentName, EnvironmentConfig>> = {
  dev: devConfig,
  qa: qaConfig,
  stage: stageConfig,
  prod: prodConfig,
};
