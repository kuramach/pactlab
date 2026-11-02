import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, ENVIRONMENTS } from '../config';
import { PactlabRegistryStack } from '../lib/compute';
import { platformStack } from './helpers';

const synth = () => platformStack(devConfig, { imageTag: 'abc1234' }).template;
type Statement = { Action: string | string[]; Resource: unknown; Sid?: string };
const statements = (template: Template, rolePrefix: string): Statement[] =>
  Object.entries(template.findResources('AWS::IAM::Policy'))
    .filter(([, policy]) => JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles).includes(rolePrefix))
    .flatMap(([, policy]) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);

describe('dev: the running application (ADR 0019)', () => {
  const template = synth();

  it('runs web, api and worker on Fargate ARM64, with circuit-breaker rollback, in private subnets', () => {
    template.resourceCountIs('AWS::ECS::Service', 3);
    template.allResourcesProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({ DeploymentCircuitBreaker: { Enable: true, Rollback: true } }),
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'DISABLED' }) },
    });
    template.allResourcesProperties('AWS::ECS::TaskDefinition', { RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' } });
    // Five definitions: web, api, worker, and the one-off migrate and seed tasks.
    template.resourceCountIs('AWS::ECS::TaskDefinition', 5);
  });

  it('serves app.dev on the shared load balancer: host-scoped rules, /v1/* and /health to the API, HTTP redirected', () => {
    const base = platformStack(devConfig, { imageTag: 'abc1234' }).baseTemplate;
    base?.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'app.dev.pactlab.ai', ValidationMethod: 'DNS' });
    base?.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, Protocol: 'HTTPS', DefaultActions: [Match.objectLike({ Type: 'fixed-response' })] });
    base?.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect', RedirectConfig: Match.objectLike({ Protocol: 'HTTPS', StatusCode: 'HTTP_301' }) })],
    });
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 0);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 110,
      Conditions: [
        { Field: 'host-header', HostHeaderConfig: { Values: ['app.dev.pactlab.ai'] } },
        { Field: 'path-pattern', PathPatternConfig: { Values: ['/v1/*', '/health'] } },
      ],
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', { Priority: 120, Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['app.dev.pactlab.ai'] } }] });
  });

  it('gives each task only what it uses: scoped Bedrock and SES for the API, nothing for web', () => {
    const api = statements(template, 'ApiTaskRole');
    const bedrock = api.find((statement) => statement.Sid === 'Bedrock');
    expect(JSON.stringify(bedrock?.Resource)).toContain('foundation-model/anthropic.claude-*');
    expect(JSON.stringify(bedrock?.Resource)).toContain('inference-profile/us.anthropic.claude-*');
    expect(JSON.stringify(bedrock?.Resource)).not.toMatch(/"\*"/);
    expect(JSON.stringify(api.find((statement) => statement.Sid === 'SendSignInEmail')?.Resource)).toContain('identity/pactlab.ai');
    expect(statements(template, 'WebTaskRole')).toEqual([]);
    expect(statements(template, 'MigrateTaskRole')).toEqual([]);
    // The worker reads originals; it never writes or deletes them.
    const worker = JSON.stringify(statements(template, 'WorkerTaskRole'));
    expect(worker).toContain('s3:GetObject*');
    expect(worker).not.toContain('s3:PutObject');
  });

  it('passes credentials as secrets, never as plain environment, and uses the bucket, SES and Bedrock', () => {
    const definitions = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as { Properties: { ContainerDefinitions: { Name: string; Environment?: { Name: string; Value: unknown }[]; Secrets?: { Name: string }[] }[] } }[];
    const api = definitions.flatMap((definition) => definition.Properties.ContainerDefinitions).find((container) => container.Name === 'api');
    const environment = Object.fromEntries((api?.Environment ?? []).map((item) => [item.Name, item.Value]));
    expect(environment).toMatchObject({ APP_ENV: 'dev', DOCUMENT_STORE: 's3', EMAIL_PROVIDER: 'ses', AI_PROVIDER: 'bedrock', MALWARE_SCANNER: 'signature', APP_WEB_ORIGIN: 'https://app.dev.pactlab.ai' });
    // Dev: new organizations are active at once, so sign-up can be tested end to end.
    expect(environment['SIGNUP_REQUIRES_APPROVAL']).toBe('false');
    expect(Object.keys(environment).some((name) => /PASSWORD|SECRET/.test(name))).toBe(false);
    expect(api?.Secrets?.map((secret) => secret.Name).sort()).toEqual(['AUTH_TOKEN_SECRET', 'DB_PASSWORD']);
    const migrate = definitions.flatMap((definition) => definition.Properties.ContainerDefinitions).find((container) => container.Name === 'migrate');
    expect(migrate?.Secrets?.map((secret) => secret.Name).sort()).toEqual(['DB_OWNER_PASSWORD', 'DB_OWNER_USER', 'DB_PASSWORD']);
  });

  it('runs dev on the Claude models this account can call, and lets the role call only Claude', () => {
    const definitions = Object.values(template.findResources('AWS::ECS::TaskDefinition')) as { Properties: { ContainerDefinitions: { Name: string; Environment?: { Name: string; Value: unknown }[] }[] } }[];
    const api = definitions.flatMap((definition) => definition.Properties.ContainerDefinitions).find((container) => container.Name === 'api');
    const environment = Object.fromEntries((api?.Environment ?? []).map((item) => [item.Name, item.Value]));
    expect(environment).toMatchObject({ BEDROCK_MODEL_BALANCED: 'us.anthropic.claude-sonnet-4-6', BEDROCK_MODEL_DEEP_REVIEW: 'us.anthropic.claude-opus-4-6-v1', BEDROCK_MODEL_FAST: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' });
    const bedrock = JSON.stringify(statements(template, 'ApiTaskRole').find((statement) => statement.Sid === 'Bedrock')?.Resource);
    expect(bedrock).toContain('inference-profile/us.anthropic.claude-*');
    expect(bedrock).toContain('foundation-model/anthropic.claude-*');
    expect(bedrock).not.toContain('nova');
  });

  it('starts each program with its own tsx, never through pnpm', () => {
    const containers = Object.values(template.findResources('AWS::ECS::TaskDefinition')).flatMap((definition) => (definition as { Properties: { ContainerDefinitions: { Name: string; Command?: string[]; WorkingDirectory?: string }[] } }).Properties.ContainerDefinitions);
    const server = containers.filter((container) => container.Name !== 'web');
    expect(server.map((container) => [container.Name, container.WorkingDirectory, container.Command?.join(' ')]).sort()).toEqual([
      ['api', '/repo/apps/api', './node_modules/.bin/tsx src/main.ts'],
      ['migrate', '/repo/apps/api', './node_modules/.bin/tsx src/ops/migrate.ts'],
      ['seed', '/repo/apps/api', './node_modules/.bin/tsx src/ops/seed-deployed.ts'],
      ['worker', '/repo/apps/worker', './node_modules/.bin/tsx src/main.ts'],
    ]);
    expect(JSON.stringify(containers)).not.toContain('pnpm');
  });

  it('runs the images by commit SHA from the environment registry', () => {
    expect(JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'))).toContain('pactlab-dev-server:abc1234');
  });

  it('can ship a release to the migration task first, keeping services on the running image or at zero', () => {
    const staged = platformStack(devConfig, { imageTag: 'new0001', serviceImageTag: 'old0001' }).template;
    const containers = Object.values(staged.findResources('AWS::ECS::TaskDefinition')).flatMap((definition) => (definition as { Properties: { ContainerDefinitions: { Name: string; Image: unknown }[] } }).Properties.ContainerDefinitions);
    const tagOf = (name: string) => JSON.stringify(containers.find((container) => container.Name === name)?.Image);
    expect(tagOf('migrate')).toContain(':new0001-tools');
    expect(tagOf('seed')).toContain(':new0001-tools');
    expect(tagOf('worker')).toContain(':old0001');
    expect(tagOf('api')).toContain(':old0001');
    expect(tagOf('web')).toContain(':old0001');
    const first = platformStack(devConfig, { imageTag: 'new0001', serviceImageTag: 'none' }).template;
    first.allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
    first.hasOutput('ServiceImageTag', { Value: 'none' });
  });
});

describe('environments without a service block', () => {
  it.each(['stage', 'prod'] as const)('%s has the data layer only (slice 2 adds its service)', (name) => {
    const template = platformStack(ENVIRONMENTS[name]).template;
    template.resourceCountIs('AWS::ECS::Service', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });
});

describe('the image registry', () => {
  it('keeps immutable, scanned, encrypted repositories for the server and web images', () => {
    const template = Template.fromStack(new PactlabRegistryStack(new App(), 'PactlabDevRegistry', { config: devConfig }));
    template.resourceCountIs('AWS::ECR::Repository', 2);
    template.allResourcesProperties('AWS::ECR::Repository', { ImageTagMutability: 'IMMUTABLE', ImageScanningConfiguration: { ScanOnPush: true } });
    template.hasResourceProperties('AWS::ECR::Repository', { RepositoryName: 'pactlab-dev-server' });
  });
});

describe('environment deploy access', () => {
  it('trusts only that GitHub Environment and is scoped to its registry, cluster and stack', async () => {
    const { PactlabEnvironmentDeployAccessStack } = await import('../lib/deploy-access-stack');
    const template = Template.fromStack(
      new PactlabEnvironmentDeployAccessStack(new App(), 'PactlabDevDeployAccess', { environment: 'dev', githubSubjectPrefix: 'repo:owner/repo', appStackName: 'PactlabDev' }),
    );
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'pactlab-github-dev-deploy',
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:owner/repo:environment:dev' } } })],
      }),
    });
    const policy = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policy).toContain('repository/pactlab-dev-server');
    expect(policy).toContain('cluster/pactlab-dev');
    expect(policy).toContain('ecs-tasks.amazonaws.com');
    expect(policy).not.toContain('pactlab-prod');
  });
});

describe('qa on the shared base, beside dev', () => {
  const { template, baseTemplate } = platformStack(ENVIRONMENTS.qa, { imageTag: 'abc1234' });

  it('serves only app.qa, in its own priority block, wake rule included', () => {
    for (const [priority, values] of [
      [210, ['app.qa.pactlab.ai']],
      [220, ['app.qa.pactlab.ai']],
      [201, ['app.qa.pactlab.ai']],
    ] as const) {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', { Priority: priority, Conditions: Match.arrayWith([{ Field: 'host-header', HostHeaderConfig: { Values: values } }]) });
    }
    expect(JSON.stringify(template.findResources('AWS::ElasticLoadBalancingV2::ListenerRule'))).not.toContain('app.dev.pactlab.ai');
  });

  it('sends as the SES identity dev holds in the same account, without creating a second', () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 0);
    expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).toContain('identity/pactlab.ai');
    platformStack(devConfig, { imageTag: 'abc1234' }).template.resourceCountIs('AWS::SES::EmailIdentity', 1);
  });

  it('puts both app hosts on the shared listener', () => {
    baseTemplate?.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'app.dev.pactlab.ai' });
    baseTemplate?.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'app.qa.pactlab.ai' });
  });
});

describe('rollout speed', () => {
  it('releases quickly in dev and qa, and keeps the careful defaults elsewhere', () => {
    const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
    // The web and API groups (the wake page's group is a Lambda, with no health checks).
    const groups = Object.values(dev.findResources('AWS::ElasticLoadBalancingV2::TargetGroup')).map((group) => (group as { Properties: { TargetType?: string; HealthCheckIntervalSeconds?: number; HealthyThresholdCount?: number } }).Properties).filter((group) => group.TargetType !== 'lambda');
    expect(groups.map((group) => [group.HealthCheckIntervalSeconds, group.HealthyThresholdCount])).toEqual([
      [10, 2],
      [10, 2],
    ]);
    expect(JSON.stringify(dev.findResources('AWS::ElasticLoadBalancingV2::TargetGroup'))).toContain('"deregistration_delay.timeout_seconds","Value":"5"');
    const careful = platformStack({ ...ENVIRONMENTS.stage, service: { ...devConfig.service!, rollout: 'careful' } }, { imageTag: 'abc1234' }).template;
    const intervals = Object.values(careful.findResources('AWS::ElasticLoadBalancingV2::TargetGroup')).map((group) => (group as { Properties: { HealthCheckIntervalSeconds?: number } }).Properties.HealthCheckIntervalSeconds);
    expect(intervals.filter((value) => value !== undefined)).toEqual([30, 30]);
  });

  it('replaces the worker in place in dev and qa only; api and web start new before stopping old', () => {
    const rolloutOf = (template: Template) =>
      Object.entries(template.findResources('AWS::ECS::Service')).map(([id, resource]) => [id.replace(/[0-9A-F]{8}$/, ''), (resource as { Properties: { DeploymentConfiguration: { MinimumHealthyPercent: number; MaximumPercent: number } } }).Properties.DeploymentConfiguration]);
    const workerStop = (template: Template) => JSON.stringify(Object.values(template.findResources('AWS::ECS::TaskDefinition')).flatMap((definition) => (definition as { Properties: { ContainerDefinitions: { Name: string; StopTimeout?: number }[] } }).Properties.ContainerDefinitions).find((container) => container.Name === 'worker')?.StopTimeout);
    const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
    expect(Object.fromEntries(rolloutOf(dev))).toMatchObject({
      AppWorkerService: { MinimumHealthyPercent: 0, MaximumPercent: 100 },
      AppApiService: { MinimumHealthyPercent: 100, MaximumPercent: 200 },
      AppWebService: { MinimumHealthyPercent: 100, MaximumPercent: 200 },
    });
    expect(workerStop(dev)).toBe('10');
    dev.hasResourceProperties('AWS::ECS::Service', { DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 0, MaximumPercent: 100 }), AvailabilityZoneRebalancing: 'DISABLED' });
    const careful = platformStack({ ...ENVIRONMENTS.stage, service: { ...devConfig.service!, rollout: 'careful' } }, { imageTag: 'abc1234' }).template;
    expect(Object.fromEntries(rolloutOf(careful))).toMatchObject({ AppWorkerService: { MinimumHealthyPercent: 100, MaximumPercent: 200 } });
    expect(workerStop(careful)).toBeUndefined();
  });
});

