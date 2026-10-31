import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ENVIRONMENTS, type EnvironmentConfig } from '../config';
import { PactlabNonliveBaseStack } from '../lib/nonlive-base-stack';
import { PactlabPlatformStack, type PactlabPlatformStackProps } from '../lib/platform-stack';

/**
 * An environment's stack as the app builds it: dev and qa on the shared
 * non-live base (built alongside, with the hosts of every shared environment
 * that has a service), stage and live on their own.
 */
export function platformStack(config: EnvironmentConfig, props: Omit<PactlabPlatformStackProps, 'config' | 'sharedBase'> = {}) {
  const app = new App();
  const base = config.shared
    ? new PactlabNonliveBaseStack(app, 'PactlabNonliveBase', {
        hosts: Object.values(ENVIRONMENTS).flatMap((environment) => (environment.shared && environment.service ? [environment.service.domain] : [])),
      })
    : undefined;
  const id = `Pactlab${config.name.charAt(0).toUpperCase()}${config.name.slice(1)}`;
  const stack = new PactlabPlatformStack(app, id, { config, ...props, ...(base ? { sharedBase: base } : {}) });
  return { app, base, stack, template: Template.fromStack(stack), baseTemplate: base ? Template.fromStack(base) : undefined };
}
