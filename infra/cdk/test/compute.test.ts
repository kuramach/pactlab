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
    expect(tagOf('worker')).toContain(':old0001');
    const first = platformStack(devConfig, { imageTag: 'new0001', serviceImageTag: 'none' }).template;
    first.allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
    first.hasOutput('ServiceImageTag', { Value: 'none' });
  });

  it('keeps an unchanged service on the image it runs, and records what each runs', () => {
    const { template: release } = platformStack(devConfig, { imageTag: 'new0001', imageTags: { web: 'web0001', worker: 'wrk0001', tools: 'tls0001' } });
    const containers = Object.values(release.findResources('AWS::ECS::TaskDefinition')).flatMap((definition) => (definition as { Properties: { ContainerDefinitions: { Name: string; Image: unknown }[] } }).Properties.ContainerDefinitions);
    const tagOf = (name: string) => JSON.stringify(containers.find((container) => container.Name === name)?.Image);
    expect(tagOf('web')).toContain('pactlab-dev-web:web0001');
    expect(tagOf('api')).toContain('pactlab-dev-server:new0001');
    expect(tagOf('worker')).toContain('pactlab-dev-server:wrk0001');
    expect(tagOf('migrate')).toContain(':tls0001-tools');
    expect(tagOf('seed')).toContain(':tls0001-tools');
    for (const [output, value] of [['WebImageTag', 'web0001'], ['ApiImageTag', 'new0001'], ['WorkerImageTag', 'wrk0001'], ['ToolsImageTag', 'tls0001'], ['ServiceImageTag', 'new0001']]) {
      release.hasOutput(output!, { Value: value });
    }
    release.hasOutput('WorkerServiceName', {});
    release.hasOutput('WorkerTaskFamily', {});
  });
});

describe('live (GitHub Environment live, CDK prod)', () => {
  const { template } = platformStack(ENVIRONMENTS.prod, { imageTag: 'abc1234' });

  it('is pinned to the skinny tier: single-AZ t4g database, one managed NAT gateway, micro Redis', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', { DBInstanceClass: 'db.t4g.medium', MultiAZ: false });
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    template.resourceCountIs('AWS::EC2::Instance', 0);
    template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', { CacheNodeType: 'cache.t4g.micro', NumCacheClusters: 1 });
  });

  it('keeps production\'s protections: 35-day backups, deletion protection, retained data', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', { BackupRetentionPeriod: 35, DeletionProtection: true });
    template.hasResource('AWS::RDS::DBInstance', { DeletionPolicy: 'Retain' });
  });

  it('runs the app always on, on its own load balancer, like stage but never paused', () => {
    template.resourceCountIs('AWS::ECS::Service', 3);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'app.pactlab.ai' });
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 0);
    expect(JSON.stringify(template.toJSON())).not.toContain('PactlabNonliveBase');
    expect(JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'))).toContain('"Name":"SIGNUP_REQUIRES_APPROVAL","Value":"true"');
    // Kumar hears about every sign-up waiting for him.
    expect(JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'))).toContain('"Name":"OPERATOR_EMAIL","Value":"kumar@pactlab.ai"');
    template.hasResourceProperties('AWS::SES::EmailIdentity', { MailFromAttributes: { MailFromDomain: 'mail.pactlab.ai', BehaviorOnMxFailure: 'USE_DEFAULT_VALUE' } });
  });

  it('keeps the full profile as a one-change scaled target', async () => {
    const { PROD_SCALED_TARGET } = await import('../config/prod');
    expect(PROD_SCALED_TARGET).toMatchObject({ network: { maxAzs: 3, natGateways: 3 }, database: { instanceClass: 'm7g', multiAz: true }, redis: { nodeType: 'cache.m7g.large', numCacheClusters: 2 } });
  });

  it('its deploy role trusts only the GitHub Environment live', async () => {
    const { PactlabEnvironmentDeployAccessStack } = await import('../lib/deploy-access-stack');
    const access = Template.fromStack(new PactlabEnvironmentDeployAccessStack(new App(), 'PactlabProdDeployAccess', { environment: 'prod', githubEnvironment: 'live', githubSubjectPrefix: 'repo:owner/repo', appStackName: 'PactlabProd' }));
    access.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'pactlab-github-prod-deploy',
      AssumeRolePolicyDocument: Match.objectLike({ Statement: [Match.objectLike({ Condition: { StringEquals: Match.objectLike({ 'token.actions.githubusercontent.com:sub': 'repo:owner/repo:environment:live' }) } })] }),
    });
    expect(JSON.stringify(access.findResources('AWS::IAM::Policy'))).toContain('repository/pactlab-prod-server');
  });
});

describe('stage, for customer testing', () => {
  const { template } = platformStack(ENVIRONMENTS.stage, { imageTag: 'abc1234' });

  it('runs the app on its own load balancer and network, never the shared non-live base', () => {
    template.resourceCountIs('AWS::ECS::Service', 3);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'app.stage.pactlab.ai' });
    expect(JSON.stringify(template.toJSON())).not.toContain('PactlabNonliveBase');
  });

  it('behaves like live: careful rollouts, CloudFormation moves the worker, sign-ups need approval', () => {
    const services = Object.values(template.findResources('AWS::ECS::Service')) as { Properties: { DeploymentConfiguration: { MinimumHealthyPercent: number; MaximumPercent: number }; TaskDefinition: unknown } }[];
    for (const service of services) expect(service.Properties.DeploymentConfiguration).toMatchObject({ MinimumHealthyPercent: 100, MaximumPercent: 200 });
    // The worker names a task definition revision, not its family: the deploy never moves it by hand here.
    for (const service of services) expect(typeof service.Properties.TaskDefinition).not.toBe('string');
    expect(JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'))).toContain('"Name":"SIGNUP_REQUIRES_APPROVAL","Value":"true"');
  });

  it('owns its SES identity and its deploy role trusts only the stage GitHub environment', async () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 1);
    const { PactlabEnvironmentDeployAccessStack } = await import('../lib/deploy-access-stack');
    const access = Template.fromStack(new PactlabEnvironmentDeployAccessStack(new App(), 'PactlabStageDeployAccess', { environment: 'stage', githubSubjectPrefix: 'repo:owner/repo', appStackName: 'PactlabStage' }));
    access.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'pactlab-github-stage-deploy',
      AssumeRolePolicyDocument: Match.objectLike({ Statement: [Match.objectLike({ Condition: { StringEquals: Match.objectLike({ 'token.actions.githubusercontent.com:sub': 'repo:owner/repo:environment:stage' }) } })] }),
    });
    const policy = JSON.stringify(access.findResources('AWS::IAM::Policy'));
    expect(policy).toContain('repository/pactlab-stage-server');
    expect(policy).not.toContain('pactlab-dev');
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
    // The deploy may move only this environment's worker service.
    expect(policy).toContain('ecs:UpdateService');
    // Outputs of the app stack and its siblings (the site's certificate, the registry), nothing else.
    expect(policy).toContain('stack/PactlabDev*/*');
    expect(policy).toContain('service/pactlab-dev/PactlabDev-AppWorkerService*');
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
    expect(Object.keys(template.toJSON().Outputs ?? {})).not.toContain('SesMailFromMx');
  });

  it('sends with pactlab.ai\'s own envelope domain, falling back to SES\'s until its DNS exists', () => {
    const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
    dev.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'pactlab.ai', MailFromAttributes: { MailFromDomain: 'mail.pactlab.ai', BehaviorOnMxFailure: 'USE_DEFAULT_VALUE' } });
    const outputs = dev.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(JSON.stringify(outputs['SesMailFromMx']?.Value)).toContain('mail.pactlab.ai MX 10 feedback-smtp.');
    expect(outputs['SesMailFromSpf']?.Value).toBe('mail.pactlab.ai TXT "v=spf1 include:amazonses.com ~all"');
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

  it('lets the deploy move the worker in dev and qa (the service names its task family), not elsewhere', () => {
    const workerService = (template: Template) => Object.entries(template.findResources('AWS::ECS::Service')).find(([id]) => id.startsWith('AppWorkerService'))![1] as { Properties: { TaskDefinition: unknown }; DependsOn?: string[] };
    const workerTaskId = (template: Template) => Object.keys(template.findResources('AWS::ECS::TaskDefinition')).find((id) => id.startsWith('AppWorkerTask'))!;
    const dev = platformStack(devConfig, { imageTag: 'abc1234' }).template;
    const fast = workerService(dev);
    const family = (dev.findResources('AWS::ECS::TaskDefinition')[workerTaskId(dev)] as { Properties: { Family: string } }).Properties.Family;
    expect(fast.Properties.TaskDefinition).toBe(family);
    expect(fast.DependsOn).toContain(workerTaskId(dev));
    const careful = platformStack({ ...ENVIRONMENTS.stage, service: { ...devConfig.service!, rollout: 'careful' } }, { imageTag: 'abc1234' }).template;
    expect(workerService(careful).Properties.TaskDefinition).toEqual({ Ref: workerTaskId(careful) });
  });
});


describe('the release shown in the app (T-100)', () => {
  const parameterValue = (template: Template) => {
    const parameter = Object.values(template.findResources('AWS::SSM::Parameter')).find((resource) => (resource as { Properties: { Name: string } }).Properties.Name === '/pactlab/dev/release') as { Properties: { Value: string } };
    return JSON.parse(parameter.Properties.Value) as { version: string | null; sha: string };
  };

  it('records the release tag and the commit the services run, and lets only the API read it', () => {
    const tagged = platformStack(devConfig, { imageTag: 'abc1234', releaseVersion: 'v2026.11.1' }).template;
    expect(parameterValue(tagged)).toEqual({ version: 'v2026.11.1', sha: 'abc1234' });
    expect(parameterValue(platformStack(devConfig, { imageTag: 'abc1234' }).template)).toEqual({ version: null, sha: 'abc1234' });
    expect(JSON.stringify(statements(tagged, 'ApiTaskRole').find((statement) => statement.Sid === 'Release'))).toContain('ssm:GetParameter');
    expect(JSON.stringify(tagged.findResources('AWS::ECS::TaskDefinition'))).toContain('"Name":"RELEASE_PARAMETER"');
  });

  it('a new version alone changes no task definition, so it rolls no service', () => {
    const definitions = (template: Template) => JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'));
    const before = platformStack(devConfig, { imageTag: 'abc1234', releaseVersion: 'v2026.11.1' }).template;
    const after = platformStack(devConfig, { imageTag: 'abc1234', releaseVersion: 'v2026.11.2' }).template;
    expect(definitions(after)).toBe(definitions(before));
    expect(parameterValue(after).version).toBe('v2026.11.2');
  });
});
