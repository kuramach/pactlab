import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, ENVIRONMENT_NAMES, ENVIRONMENTS, prodConfig, qaConfig, stageConfig, type EnvironmentName } from '../config';
import { siteConfig } from '../config/site';
import { PactlabEnvironmentDeployAccessStack } from '../lib/deploy-access-stack';
import { hibernatedCost } from '../lib/hibernation-cost';
import { hibernationPlan, planText, stackPlan } from '../lib/hibernation-plan';
import { legacyOwnerSecretIds } from '../lib/platform-stack';
import { platformStack, SLEEP_CERTIFICATE_ARN } from './helpers';

const require = createRequire(import.meta.url);
type Json = { Resources: Record<string, { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string }> };
const HOURLY = [
  'AWS::EC2::VPC',
  'AWS::EC2::Instance',
  'AWS::EC2::NatGateway',
  'AWS::EC2::EIP',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::ECS::Cluster',
  'AWS::ECS::Service',
  'AWS::RDS::DBInstance',
  'AWS::ElastiCache::ReplicationGroup',
];
const HIBERNATABLE = ['dev', 'qa', 'stage'] as const;
const shapes = (name: (typeof HIBERNATABLE)[number], basePower: 'awake' | 'hibernated' = 'awake') => {
  const config = ENVIRONMENTS[name];
  const awake = platformStack(config, { imageTag: 'abc1234', sleepCertificateArn: SLEEP_CERTIFICATE_ARN });
  const asleep = platformStack(config, { imageTag: 'abc1234', power: 'hibernated', sleepCertificateArn: SLEEP_CERTIFICATE_ARN, basePower });
  return { awake, asleep, a: awake.template.toJSON() as Json, h: asleep.template.toJSON() as Json };
};

describe('which environments hibernate (Kumar, 2026-11-27; ADR 0063)', () => {
  it('hibernates dev, qa and stage after 3 idle hours, keeps two snapshots, and never hibernates live', () => {
    for (const name of ENVIRONMENT_NAMES) {
      if (name === 'prod') expect(ENVIRONMENTS[name].hibernate, name).toBeUndefined();
      else expect(ENVIRONMENTS[name].hibernate, name).toEqual({ idleHours: 3, snapshotsKept: 2 });
    }
  });

  it('refuses to build live hibernated, or to give live a power role', () => {
    expect(() => platformStack(prodConfig, { imageTag: 'abc1234', power: 'hibernated', sleepCertificateArn: SLEEP_CERTIFICATE_ARN })).toThrow(/Live never hibernates/);
    expect(() => platformStack({ ...prodConfig, hibernate: { idleHours: 3, snapshotsKept: 2 } }, { imageTag: 'abc1234' })).toThrow(/Live never hibernates/);
    const app = new App();
    expect(
      () => new PactlabEnvironmentDeployAccessStack(app, 'PactlabProdDeployAccess', { environment: 'prod', githubEnvironment: 'live', githubSubjectPrefix: siteConfig.githubSubjectPrefix, appStackName: 'PactlabProd', hibernate: true }),
    ).toThrow(/Live never hibernates/);
  });

  it('cannot hibernate without the sleep page', () => {
    expect(() => platformStack(stageConfig, { imageTag: 'abc1234', power: 'hibernated' })).toThrow(/sleep page/);
  });

  it('leaves live exactly as it was: no zone, no sleep page, no hibernated cost', () => {
    const live = platformStack(prodConfig, { imageTag: 'abc1234' }).template;
    live.resourceCountIs('AWS::Route53::HostedZone', 0);
    live.resourceCountIs('AWS::CloudFront::Distribution', 0);
    expect(JSON.stringify(live.toJSON())).not.toContain('hibernated-cost');
  });
});

describe.each(HIBERNATABLE)('%s hibernated (ADR 0063)', (name) => {
  const { a, h, asleep } = shapes(name);

  it('has nothing that bills by the hour: no network, NAT, load balancer, ECS, database instance or Redis', () => {
    for (const type of HOURLY) asleep.template.resourceCountIs(type, 0);
  });

  it('keeps every kept resource at the same logical ID, type and properties as when awake', () => {
    // Differences allowed, with the reason: log retention drops to 7 days while asleep; log triage loses its service list;
    // the app's name points at the sleep page instead of the load balancer; the data key's policy drops its grants to
    // the task execution roles that no longer exist.
    const allowed = new Map<string, string>();
    for (const [id, resource] of Object.entries(h.Resources)) {
      expect(a.Resources[id], `${id} only exists hibernated`).toBeDefined();
      expect(a.Resources[id]!.Type).toBe(resource.Type);
      if (JSON.stringify(a.Resources[id]) === JSON.stringify(resource)) continue;
      const reason =
        resource.Type === 'AWS::Logs::LogGroup'
          ? 'retention'
          : /^LogTriage/.test(id)
            ? 'triage'
            : resource.Type === 'AWS::Route53::RecordSet' && /^DnsApex/.test(id)
              ? 'alias'
              : resource.Type === 'AWS::KMS::Key' && JSON.stringify({ ...resource, Properties: { ...resource.Properties, KeyPolicy: null } }) === JSON.stringify({ ...a.Resources[id], Properties: { ...a.Resources[id]!.Properties, KeyPolicy: null } })
                ? 'grants'
                : null;
      expect(reason, `${id} (${resource.Type}) changed between shapes`).not.toBeNull();
      allowed.set(id, reason!);
    }
    expect([...allowed.values()]).toContain('alias');
  });

  it('keeps the data, names and keys: buckets, the data key, every secret, the SES identity, the zone and the sleep page', () => {
    for (const type of ['AWS::S3::Bucket', 'AWS::KMS::Key', 'AWS::SecretsManager::Secret', 'AWS::Route53::HostedZone', 'AWS::CloudFront::Distribution', 'AWS::SNS::Topic', 'AWS::SES::ConfigurationSet']) {
      const kept = Object.values(h.Resources).filter((resource) => resource.Type === type).length;
      expect(kept, type).toBeGreaterThan(0);
      expect(kept, type).toBe(Object.values(a.Resources).filter((resource) => resource.Type === type).length);
    }
    asleep.template.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: `/pactlab/${name}/app`, RetentionInDays: 7 });
    asleep.template.hasResourceProperties('AWS::SSM::Parameter', { Name: `/pactlab/${name}/power`, Value: 'awake' });
    if (name !== 'qa') asleep.template.resourceCountIs('AWS::SES::EmailIdentity', 1);
  });

  it('points the app name at the sleep page while asleep and at the load balancer while awake', () => {
    const apex = (template: Json) => Object.entries(template.Resources).find(([id]) => /^DnsApex/.test(id))![1].Properties!['AliasTarget'];
    expect(JSON.stringify(apex(h))).toContain('SleepPageDistribution');
    expect(JSON.stringify(apex(a))).toMatch(/LoadBalancer/);
    asleep.template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ Aliases: [ENVIRONMENTS[name].service!.domain], ViewerCertificate: Match.objectLike({ AcmCertificateArn: SLEEP_CERTIFICATE_ARN }) }) });
    asleep.template.hasResourceProperties('AWS::Route53::HostedZone', { Name: `${ENVIRONMENTS[name].service!.domain}.` });
  });

  it('never lets CloudFormation delete the database: hibernate deletes it, after its snapshot', () => {
    const db = Object.values(a.Resources).find((resource) => resource.Type === 'AWS::RDS::DBInstance')!;
    expect(db.DeletionPolicy).toBe('Retain');
    expect(db.UpdateReplacePolicy).toBe('Retain');
    expect(db.Properties!['BackupRetentionPeriod']).toBe(3);
  });

  it('keeps the owner secret, unchanged, as the stack resource it was under the instance', () => {
    const { secret } = legacyOwnerSecretIds(asleep.stack.stackName);
    expect(secret).toMatch(new RegExp(`^${asleep.stack.stackName}PostgresSecret[0-9A-F]{8}3fdaad7efa858a3daf9490cf0a702aeb$`));
    expect(h.Resources[secret]).toEqual(a.Resources[secret]);
    expect(h.Resources[secret]!.Properties!['GenerateSecretString']).toMatchObject({ SecretStringTemplate: JSON.stringify({ username: 'pactlab_owner' }), PasswordLength: 30 });
  });
});

describe('stage hibernated stays protected', () => {
  const { asleep } = shapes('stage');
  it('keeps termination protection and RETAIN on every stateful resource', () => {
    expect(asleep.stack.terminationProtection).toBe(true);
    for (const type of ['AWS::S3::Bucket', 'AWS::KMS::Key', 'AWS::SecretsManager::Secret']) {
      for (const resource of Object.values((asleep.template.toJSON() as Json).Resources).filter((r) => r.Type === type)) expect(resource.DeletionPolicy, type).toBe('Retain');
    }
  });
});

describe('waking restores the database from its snapshot (ADR 0063)', () => {
  it('restores from the named snapshot, keeps the owner secret, and stays deletion-protected in stage', () => {
    const { template, stack } = platformStack(stageConfig, { imageTag: 'abc1234', databaseSource: 'pactlab-stage-hibernate-20261128t0300z', sleepCertificateArn: SLEEP_CERTIFICATE_ARN });
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBSnapshotIdentifier: 'pactlab-stage-hibernate-20261128t0300z',
      DeletionProtection: true,
      DBInstanceClass: 'db.t4g.medium',
      MultiAZ: false,
      MasterUserPassword: Match.anyValue(),
    });
    const db = Object.values((template.toJSON() as Json).Resources).find((resource) => resource.Type === 'AWS::RDS::DBInstance')!;
    expect(db.Properties!['DBName']).toBeUndefined();
    expect(db.Properties!['KmsKeyId']).toBeUndefined();
    const { secret, attachment } = legacyOwnerSecretIds(stack.stackName);
    template.hasResource('AWS::SecretsManager::Secret', {});
    expect(Object.keys((template.toJSON() as Json).Resources)).toEqual(expect.arrayContaining([secret, attachment]));
  });

  it('refuses a snapshot name that is not one', () => {
    expect(() => platformStack(devConfig, { imageTag: 'abc1234', databaseSource: 'not a snapshot' })).toThrow(/snapshot identifier/);
  });
});

describe('the dev and qa base (ADR 0063)', () => {
  it('keeps only its certificates when both environments sleep', () => {
    const { asleep, awake } = shapes('qa', 'hibernated');
    const base = asleep.baseTemplate!;
    for (const type of HOURLY) base.resourceCountIs(type, 0);
    base.resourceCountIs('AWS::CertificateManager::Certificate', 2);
    const plan = stackPlan('PactlabNonliveBase', awake.baseTemplate!.toJSON() as Json, base.toJSON() as Json);
    expect(plan.kept.map((entry) => entry.type)).toEqual(['AWS::CertificateManager::Certificate', 'AWS::CertificateManager::Certificate']);
  });

  it('stays awake while one of them is awake', () => {
    const { asleep } = shapes('dev', 'awake');
    asleep.baseTemplate!.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  it('cannot run an awake environment on a sleeping base', () => {
    expect(() => platformStack(devConfig, { imageTag: 'abc1234', basePower: 'hibernated' })).toThrow(/shared base must be awake/);
  });
});

describe('the dry run (ADR 0063)', () => {
  it('lists exactly what would be deleted and kept, per environment', () => {
    for (const name of HIBERNATABLE) {
      const plan = hibernationPlan(name);
      const [own] = plan.stacks;
      expect(own!.deleted.map((entry) => entry.type)).toEqual(expect.arrayContaining(['AWS::RDS::DBInstance', 'AWS::ECS::Cluster']));
      expect(own!.kept.map((entry) => entry.type)).toEqual(expect.arrayContaining(['AWS::S3::Bucket', 'AWS::KMS::Key', 'AWS::SecretsManager::Secret', 'AWS::Route53::HostedZone']));
      expect(own!.kept.some((entry) => entry.type === 'AWS::RDS::DBInstance')).toBe(false);
      expect(planText(plan)).toContain('dry run: nothing is changed');
      // dev and qa list the base: torn down only with the neighbour asleep.
      expect(plan.stacks.length).toBe(name === 'stage' ? 1 : 2);
      if (name !== 'stage') expect(plan.stacks[1]!.deleted).toEqual([]);
    }
    expect(hibernationPlan('dev', { neighbourHibernated: true }).stacks[1]!.deleted.map((entry) => entry.type)).toContain('AWS::ElasticLoadBalancingV2::LoadBalancer');
  });

  it('refuses live', () => {
    expect(() => hibernationPlan('prod')).toThrow(/live is always on/);
  });
});

describe('the cost while hibernated (ADR 0063)', () => {
  it('itemizes from the published us-east-2 prices, in whole cents', () => {
    const cost = hibernatedCost({ secrets: 17, kmsKeys: 1, hostedZones: 1, snapshotMaxGiB: 50 });
    expect(cost.lines.find((line) => line.item === 'Secrets Manager')).toMatchObject({ low: '6.80', high: '6.80' });
    expect(cost.lines.find((line) => line.item === 'Database snapshot')).toMatchObject({ low: '0.00', high: '4.75' });
    expect(cost).toMatchObject({ low: '8.60', high: '14.75', currency: 'USD' });
  });

  it('is published for the Hosting cost page, counted from the secrets the stack really keeps', () => {
    const { template } = platformStack(stageConfig, { imageTag: 'abc1234', sleepCertificateArn: SLEEP_CERTIFICATE_ARN });
    const parameter = Object.values((template.toJSON() as Json).Resources).find((resource) => resource.Properties?.['Name'] === '/pactlab/stage/hibernated-cost')!;
    const cost = JSON.parse(parameter.Properties!['Value'] as string) as ReturnType<typeof hibernatedCost>;
    const secrets = Object.values((template.toJSON() as Json).Resources).filter((resource) => resource.Type === 'AWS::SecretsManager::Secret').length;
    expect(cost.lines[0]).toMatchObject({ item: 'Secrets Manager', basis: `${secrets + 1} secrets × $0.40` });
  });
});

describe('who may hibernate and wake (ADR 0063)', () => {
  const access = (environment: EnvironmentName) =>
    Template.fromStack(new PactlabEnvironmentDeployAccessStack(new App(), `X${environment}`, { environment, githubSubjectPrefix: siteConfig.githubSubjectPrefix, appStackName: 'PactlabStage', hibernate: true, powerReadAccount: '222222222222' }));

  it('trusts only the GitHub Environment <env>-power, and limits the database to its own', () => {
    const template = access('stage');
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'pactlab-github-stage-power',
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${siteConfig.githubSubjectPrefix}:environment:stage-power` } } })],
      }),
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('"rds:db-tag/pactlab:environment":"stage"');
    expect(policies).toContain('snapshot:pactlab-stage-*');
    expect(policies).not.toMatch(/"rds:DeleteDBInstance"[^\]]*\]\s*,\s*"Resource":"\*"/);
    template.hasResourceProperties('AWS::IAM::Role', { RoleName: 'pactlab-stage-power-read' });
  });

  it('pins hibernated images: keep- tags outlive the 20-image rule', () => {
    const registry = readFileSync(new URL('../lib/compute.ts', import.meta.url), 'utf8');
    expect(registry).toContain("tagPrefixList: ['keep-']");
  });
});

describe('the sleep page (ADR 0063)', () => {
  const { makeHandler } = require('../lambda/sleep-page/index.js') as {
    makeHandler: (deps: object) => (event: object) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
  };
  const deps = (power: string, token = 'ghp_x') => {
    const state = { power, dispatched: [] as object[] };
    return {
      state,
      deps: {
        env: { ENV_NAME: 'stage' },
        now: () => 1_000_000,
        log: () => undefined,
        getPower: async () => state.power,
        setPower: async (value: string) => void (state.power = value),
        githubToken: async () => token,
        dispatch: async (_token: string, body: object) => void state.dispatched.push(body),
        latestRun: async () => ({ startedAt: 1_000_000 - 5 * 60_000, step: 'Restore the database' }),
      },
    };
  };
  const get = { requestContext: { http: { method: 'GET' } }, rawPath: '/' };
  const post = { requestContext: { http: { method: 'POST' } }, rawPath: '/wake' };

  it('says the environment is asleep and how long waking takes, with a Wake up button that POSTs', async () => {
    const response = await makeHandler(deps('hibernated').deps)(get);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('This environment is asleep');
    expect(response.body).toContain('about 30–40 minutes');
    expect(response.body).toContain('<form method="post" action="/wake">');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('starts one wake per hibernation, with no approval, and shows progress', async () => {
    const { deps: d, state } = deps('hibernated');
    const handler = makeHandler(d);
    expect((await handler(post)).statusCode).toBe(303);
    expect((await handler(post)).statusCode).toBe(303);
    expect(state.dispatched).toEqual([{ ref: 'main', inputs: { environment: 'stage', action: 'wake' } }]);
    expect(state.power).toBe('rebuilding');
    const progress = await handler(get);
    expect(progress.body).toContain('Started 5 minutes ago');
    expect(progress.body).toContain('Restore the database');
  });

  it('gives the wake back when GitHub refuses it, and says how to wake without the button', async () => {
    const { deps: d, state } = deps('hibernated');
    const failing = makeHandler({ ...d, dispatch: async () => Promise.reject(Object.assign(new Error('no'), { name: 'GitHubError' })) });
    expect((await failing(post)).statusCode).toBe(502);
    expect(state.power).toBe('hibernated');
    const unset = await makeHandler(deps('hibernated', 'unset').deps)(post);
    expect(unset.statusCode).toBe(503);
    expect(unset.body).toContain('scripts/env-wake.sh stage');
  });

  it('never wakes on a GET', async () => {
    const { deps: d, state } = deps('hibernated');
    await makeHandler(d)(get);
    expect(state.dispatched).toEqual([]);
  });
});

it('keeps qa, dev and stage on the same hibernate settings as the runbook says', () => {
  for (const config of [devConfig, qaConfig, stageConfig]) expect(config.idlePause).toEqual({ idleMinutes: 60 });
});
