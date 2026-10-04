import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { devConfig } from '../config';
import { PactlabPlatformStack } from './platform-stack';

/**
 * Development environment: the shared platform stack with dev config.
 * Synthesized in CI; never deployed by agents.
 */
export class PactlabDevStack extends PactlabPlatformStack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, { ...props, config: devConfig });
  }
}
