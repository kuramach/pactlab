import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { ENVIRONMENT_NAMES, ENVIRONMENTS } from '../config';
import { siteConfig } from '../config/site';
import { PactlabDeployAccessStack } from '../lib/deploy-access-stack';
import { PactlabPlatformStack } from '../lib/platform-stack';
import { assertTargetAccount } from '../lib/protection';
import { PactlabSiteStack } from '../lib/site-stack';

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
// The public site (ADR 0003): one instance, its own account context.
const siteAccount = app.node.tryGetContext('pactlab:site:account') as string | undefined;
assertTargetAccount('site', siteAccount, siteAccount ? process.env['CDK_DEFAULT_ACCOUNT'] : undefined);
const siteEnv = siteAccount ? { env: { account: siteAccount, region: siteConfig.region } } : {};
new PactlabDeployAccessStack(app, 'PactlabDeployAccess', { config: siteConfig, ...siteEnv });
// Needs the static export (`pnpm --filter @pactlab/site build`); skipped otherwise so
// a plain synth (CI) does not depend on building the site.
const siteContent = fileURLToPath(new URL('../../../apps/site/out', import.meta.url));
if (existsSync(siteContent)) {
  new PactlabSiteStack(app, 'PactlabSite', { config: siteConfig, contentDir: siteContent, ...siteEnv });
}

app.synth();
