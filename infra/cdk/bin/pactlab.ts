import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { ENVIRONMENT_NAMES, ENVIRONMENTS } from '../config';
import { siteConfig } from '../config/site';
import { PactlabDeployAccessStack, PactlabEnvironmentDeployAccessStack } from '../lib/deploy-access-stack';
import { PactlabRegistryStack } from '../lib/compute';
import { PactlabNonliveBaseStack } from '../lib/nonlive-base-stack';
import { PactlabPlatformStack } from '../lib/platform-stack';
import { assertTargetAccount } from '../lib/protection';
import { PactlabSiteStack } from '../lib/site-stack';

// One stack per environment from the same code; only config differs.
// Without `-c pactlab:<env>:account=<id>` stacks synthesize environment-agnostic
// (CI, local review). With it, the stack is bound to that account and region and
// synthesis fails closed if the active credentials resolve to another account.
const app = new App();
// The static site export (`pnpm --filter @pactlab/site build`); site stacks are skipped without it,
// so a plain synth (CI) does not depend on building the site.
const siteContent = fileURLToPath(new URL('../../../apps/site/out', import.meta.url));

// The shared non-live base (ADR 0019): dev and qa's network, NAT instance, load balancer and Redis, in the
// dev account. An environment on it is bound to the same account (its own context may only repeat it).
const sharedNames = ENVIRONMENT_NAMES.filter((name) => ENVIRONMENTS[name].shared);
// Whichever shared environment is being deployed names the account (dev's, today; qa's is the same account).
const baseAccount = sharedNames.map((name) => app.node.tryGetContext(`pactlab:${name}:account`) as string | undefined).find(Boolean);
assertTargetAccount('nonlive-base', baseAccount, baseAccount ? process.env['CDK_DEFAULT_ACCOUNT'] : undefined);
const baseEnv = baseAccount ? { env: { account: baseAccount, region: ENVIRONMENTS.dev.region } } : {};
const sharedBase = sharedNames.length
  ? new PactlabNonliveBaseStack(app, 'PactlabNonliveBase', {
      hosts: sharedNames.flatMap((name) => (ENVIRONMENTS[name].service ? [ENVIRONMENTS[name].service.domain] : [])),
      ...baseEnv,
    })
  : undefined;

for (const name of ENVIRONMENT_NAMES) {
  const config = ENVIRONMENTS[name];
  const own = app.node.tryGetContext(`pactlab:${name}:account`) as string | undefined;
  if (config.shared && own && baseAccount && own !== baseAccount) throw new Error(`${name} runs on the shared base in ${baseAccount}; it cannot be bound to ${own}`);
  const declared = own ?? (config.shared ? baseAccount : undefined);
  assertTargetAccount(name, declared, declared ? process.env['CDK_DEFAULT_ACCOUNT'] : undefined);
  const stackId = `Pactlab${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const env = declared ? { env: { account: declared, region: config.region } } : {};
  // A deployable environment runs images by commit SHA. Binding to an account to deploy it requires the tag;
  // environment-agnostic synthesis (CI, review) uses a placeholder.
  const imageTag = app.node.tryGetContext(`pactlab:${name}:imageTag`) as string | undefined;
  // Bound to an account without a tag, the application stack is left out (so it cannot be deployed by mistake
  // with no image); its registry and deploy access can still be deployed first.
  const withoutApp = Boolean(config.service && declared && !imageTag);
  if (config.service) new PactlabRegistryStack(app, `${stackId}Registry`, { config, ...env });
  if (config.service) {
    // An account that already holds GitHub's OIDC provider (PactLab Dev holds the site's) reuses it:
    // `-c pactlab:<env>:githubOidc=existing`.
    const reuseOidc = app.node.tryGetContext(`pactlab:${name}:githubOidc`) === 'existing';
    const existingOidcProviderArn = reuseOidc && declared ? `arn:aws:iam::${declared}:oidc-provider/token.actions.githubusercontent.com` : undefined;
    new PactlabEnvironmentDeployAccessStack(app, `${stackId}DeployAccess`, {
      environment: name,
      githubSubjectPrefix: siteConfig.githubSubjectPrefix,
      appStackName: stackId,
      ...(existingOidcProviderArn ? { existingOidcProviderArn } : {}),
      ...env,
    });
  }
  // During a release the services may stay on the running tag (or `none` on a first deploy) while migrations run.
  const serviceImageTag = app.node.tryGetContext(`pactlab:${name}:serviceImageTag`) as string | undefined;
  if (!withoutApp) {
    new PactlabPlatformStack(app, stackId, {
      config,
      ...(imageTag ? { imageTag } : {}),
      ...(serviceImageTag ? { serviceImageTag } : {}),
      ...(config.shared && sharedBase ? { sharedBase } : {}),
      ...env,
    });
  }
  // The environment's copy of the site, published by deploy.yml after it builds apps/site for this environment.
  if (config.site && existsSync(siteContent)) {
    const certificateArn = app.node.tryGetContext(`pactlab:${name}:siteCertificateArn`) as string | undefined;
    new PactlabSiteStack(app, `${stackId}Site`, {
      config: siteConfig,
      contentDir: siteContent,
      environment: { name, domain: config.site.domain, indexing: config.site.indexing, ...(certificateArn ? { certificateArn } : {}) },
      ...env,
    });
  }
}
// The public site (ADR 0003): one instance, its own account context.
const siteAccount = app.node.tryGetContext('pactlab:site:account') as string | undefined;
assertTargetAccount('site', siteAccount, siteAccount ? process.env['CDK_DEFAULT_ACCOUNT'] : undefined);
const siteEnv = siteAccount ? { env: { account: siteAccount, region: siteConfig.region } } : {};
new PactlabDeployAccessStack(app, 'PactlabDeployAccess', { config: siteConfig, ...siteEnv });
// Needs the static export (`pnpm --filter @pactlab/site build`); skipped otherwise so
// a plain synth (CI) does not depend on building the site.
if (existsSync(siteContent)) {
  new PactlabSiteStack(app, 'PactlabSite', { config: siteConfig, contentDir: siteContent, ...siteEnv });
}

app.synth();
