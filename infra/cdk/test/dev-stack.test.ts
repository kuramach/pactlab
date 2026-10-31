import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { devConfig, ENVIRONMENTS, prodConfig, stageConfig } from '../config';
import { platformStack } from './helpers';

/** dev and qa on the shared non-live base; stage and live on their own (ADR 0019). */
describe('dev on the shared non-live base', () => {
  const { template, baseTemplate } = platformStack(devConfig, { imageTag: 'abc1234' });
  const base = baseTemplate as NonNullable<typeof baseTemplate>;

  it('keeps its own encrypted, private PostgreSQL with generated credentials, TLS and UTC', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', { Engine: 'postgres', StorageEncrypted: true, PubliclyAccessible: false, EnableIAMDatabaseAuthentication: true });
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', { Parameters: Match.objectLike({ 'rds.force_ssl': '1', timezone: 'UTC' }) });
    // The RDS owner secret, plus the app's runtime login and token key.
    template.resourceCountIs('AWS::SecretsManager::Secret', 3);
  });

  it('creates no network, load balancer or Redis of its own: the base has them, with a NAT instance and no NAT gateway', () => {
    for (const type of ['AWS::EC2::VPC', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::ElastiCache::ReplicationGroup', 'AWS::EC2::NatGateway']) template.resourceCountIs(type, 0);
    base.resourceCountIs('AWS::EC2::VPC', 1);
    base.resourceCountIs('AWS::EC2::NatGateway', 0);
    base.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't4g.nano', SourceDestCheck: false });
    base.resourceCountIs('AWS::EC2::FlowLog', 1);
    base.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', { CacheNodeType: 'cache.t4g.micro', AtRestEncryptionEnabled: true, TransitEncryptionEnabled: true });
  });

  it('runs a NAT instance that forwards on Amazon Linux 2023 and accepts nothing from the internet', () => {
    const instance = Object.values(base.findResources('AWS::EC2::Instance'))[0] as { Properties: { UserData: { 'Fn::Base64': string } } };
    const script = JSON.stringify(instance.Properties.UserData);
    expect(script).toContain('ip route show default');
    expect(script).toContain('MASQUERADE');
    expect(script).not.toContain('$(route ');
    const ingress = JSON.stringify(Object.values(base.findResources('AWS::EC2::SecurityGroup')).map((group) => (group as { Properties: { SecurityGroupIngress?: unknown } }).Properties.SecurityGroupIngress));
    // The NAT instance admits the VPC's own range (its CIDR, by reference) and nothing else.
    expect(ingress).toContain('CidrBlock');
    // Only the load balancer accepts traffic from anywhere, and only on 80 and 443.
    const open = Object.values(base.findResources('AWS::EC2::SecurityGroup')).flatMap((group) => ((group as { Properties: { SecurityGroupIngress?: { CidrIp?: string; IpProtocol: string; FromPort?: number }[] } }).Properties.SecurityGroupIngress ?? []).filter((rule) => rule.CidrIp === '0.0.0.0/0'));
    expect(open.map((rule) => rule.FromPort).sort()).toEqual([443, 80]);
  });

  it('uses its own Redis logical database: dev /0, qa /1', () => {
    const redisUrl = (environment: typeof devConfig) => {
      const { stack } = platformStack(environment, { imageTag: 'abc1234' });
      return stack.resolve(stack.redisUrl) as unknown;
    };
    expect(JSON.stringify(redisUrl(devConfig))).toMatch(/\/0"?\]?\]?\}?$/);
    expect(JSON.stringify(redisUrl(ENVIRONMENTS.qa))).toMatch(/\/1"?\]?\]?\}?$/);
  });

  it('admits traffic to its data stores only from its own task security group', () => {
    const ingress = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')) as { Properties: Record<string, unknown> & { FromPort: number } }[];
    // Database (5432) and shared Redis (6379) from dev's tasks; web (3000) and api (4000) from the load balancer only.
    expect(ingress.map((resource) => resource.Properties.FromPort).sort()).toEqual([3000, 4000, 5432, 6379]);
    for (const resource of ingress) {
      expect(resource.Properties).toHaveProperty('SourceSecurityGroupId');
      expect(resource.Properties).not.toHaveProperty('CidrIp');
    }
  });
});

describe('stage and live keep their own infrastructure', () => {
  it('stage: its own network with a NAT instance; live: managed NAT gateways, never shared', () => {
    const stage = platformStack(stageConfig).template;
    stage.resourceCountIs('AWS::EC2::VPC', 1);
    stage.resourceCountIs('AWS::EC2::NatGateway', 0);
    stage.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't4g.nano' });
    stage.resourceCountIs('AWS::ElastiCache::ReplicationGroup', 1);
    const live = platformStack(prodConfig).template;
    // Managed NAT gateways, one per zone (without an account bound, CDK synthesizes two zones).
    expect(Object.keys(live.findResources('AWS::EC2::NatGateway')).length).toBeGreaterThanOrEqual(2);
    live.resourceCountIs('AWS::EC2::Instance', 0);
    expect(prodConfig.shared).toBeUndefined();
  });

  it('only dev and qa share, each in its own priority block', () => {
    const shared = Object.values(ENVIRONMENTS).filter((environment) => environment.shared);
    expect(shared.map((environment) => environment.name).sort()).toEqual(['dev', 'qa']);
    const blocks = shared.map((environment) => environment.shared?.rulePriorityBase ?? 0);
    expect(new Set(blocks).size).toBe(blocks.length);
    expect(new Set(shared.map((environment) => environment.shared?.redisDb)).size).toBe(shared.length);
  });
});
