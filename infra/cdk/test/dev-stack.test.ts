import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { PactlabDevStack } from '../lib/dev-stack';

describe('PactlabDevStack', () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(new PactlabDevStack(new App(), 'PactlabDev'));
  });

  it('creates an encrypted, private PostgreSQL instance with generated credentials', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      EnableIAMDatabaseAuthentication: true,
    });
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('enforces TLS and UTC on PostgreSQL', () => {
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: Match.objectLike({ 'rds.force_ssl': '1', timezone: 'UTC' }),
    });
  });

  it('creates Redis with encryption in transit and at rest', () => {
    template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
    });
  });

  it('admits data-store traffic only from the application security group', () => {
    const ingress = template.findResources('AWS::EC2::SecurityGroupIngress');
    const ports = Object.values(ingress).map((resource) => (resource as { Properties: { FromPort: number } }).Properties.FromPort);
    expect(ports.sort()).toEqual([5432, 6379]);
    for (const resource of Object.values(ingress)) {
      expect((resource as { Properties: Record<string, unknown> }).Properties).toHaveProperty('SourceSecurityGroupId');
      expect((resource as { Properties: Record<string, unknown> }).Properties).not.toHaveProperty('CidrIp');
    }
  });

  it('enables VPC flow logs', () => {
    template.resourceCountIs('AWS::EC2::FlowLog', 1);
  });
});
