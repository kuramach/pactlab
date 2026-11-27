import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ENVIRONMENTS, type EnvironmentConfig, type PowerShape } from '../config';
import { PactlabNonliveBaseStack } from '../lib/nonlive-base-stack';
import { PactlabPlatformStack, type PactlabPlatformStackProps } from '../lib/platform-stack';

/** A us-east-1 certificate for the sleep page, as the runbook requests it (placeholder account). */
export const SLEEP_CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';

/**
 * An environment's stack as the app builds it: dev and qa on the shared
 * non-live base (built alongside, with the hosts of every shared environment
 * that has a service), stage and live on their own. `basePower`: the base's
 * shape (hibernated only when every environment on it is).
 */
export function platformStack(config: EnvironmentConfig, props: Omit<PactlabPlatformStackProps, 'config' | 'sharedBase'> & { readonly basePower?: PowerShape } = {}) {
  const { basePower, ...stackProps } = props;
  const app = new App();
  const base = config.shared
    ? new PactlabNonliveBaseStack(app, 'PactlabNonliveBase', {
        hosts: Object.values(ENVIRONMENTS).flatMap((environment) => (environment.shared && environment.service ? [environment.service.domain] : [])),
        power: basePower ?? 'awake',
      })
    : undefined;
  const id = `Pactlab${config.name.charAt(0).toUpperCase()}${config.name.slice(1)}`;
  const stack = new PactlabPlatformStack(app, id, { config, ...stackProps, ...(base ? { sharedBase: base } : {}) });
  return { app, base, stack, template: Template.fromStack(stack), baseTemplate: base ? Template.fromStack(base) : undefined };
}
