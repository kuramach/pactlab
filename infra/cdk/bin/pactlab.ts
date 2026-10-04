import { App } from 'aws-cdk-lib';
import { ENVIRONMENT_NAMES, ENVIRONMENTS } from '../config';
import { PactlabPlatformStack } from '../lib/platform-stack';
import { assertTargetAccount } from '../lib/protection';

// One stack per environment from the same code; only config differs.
// Without `-c pactlab:<env>:account=<id>` stacks synthesize environment-agnostic
// (CI, local review). With it, the stack is bound to that account and region and
// synthesis fails closed if the active credentials resolve to another account.
const app = new App();
for (const name of ENVIRONMENT_NAMES) {
  const config = ENVIRONMENTS[name];
  const declared = app.node.tryGetContext(`pactlab:${name}:account`) as string | undefined;
  assertTargetAccount(name, declared, declared ? process.env['CDK_DEFAULT_ACCOUNT'] : undefined);
  const stackId = `Pactlab${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  new PactlabPlatformStack(app, stackId, {
    config,
    ...(declared ? { env: { account: declared, region: config.region } } : {}),
  });
}
app.synth();
