import { App, Aspects, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import type * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_NAMES, ENVIRONMENTS, prodConfig, stageConfig } from '../config';
import { PactlabPlatformStack } from '../lib/platform-stack';
import {
  assertTargetAccount,
  STATEFUL_RESOURCE_TYPES,
  StatefulProtectionAspect,
} from '../lib/protection';

function synth(name: (typeof ENVIRONMENT_NAMES)[number]) {
  const stack = new PactlabPlatformStack(new App(), `Pactlab-${name}`, {
    config: ENVIRONMENTS[name],
  });
  return { stack, template: Template.fromStack(stack) };
}

function statefulResources(template: Template) {
  return STATEFUL_RESOURCE_TYPES.flatMap((type) => Object.values(template.findResources(type)));
}

describe('environment configs', () => {
  it('declares one named profile per environment and protects only stage and prod', () => {
    for (const name of ENVIRONMENT_NAMES) {
      expect(ENVIRONMENTS[name].profile).toBe(`pactlab-${name}`);
      expect(ENVIRONMENTS[name].protectedState).toBe(name === 'stage' || name === 'prod');
    }
  });

  it('keeps production on Multi-AZ, long backups and compliance-mode audit retention', () => {
    expect(prodConfig.database.multiAz).toBe(true);
    expect(prodConfig.database.backupRetentionDays).toBeGreaterThanOrEqual(35);
    expect(prodConfig.auditArchive.mode).toBe('COMPLIANCE');
    expect(stageConfig.database.multiAz).toBe(true);
  });

  it('keeps pilot guardrails on and LIVE connectors off in production', () => {
    expect(prodConfig.featureFlags).toEqual({ pilotMode: true, liveConnectors: false });
  });
});

describe.each(['stage', 'prod'] as const)('%s stack', (name) => {
  const { stack, template } = synth(name);

  it('enables termination protection and passes the protection policy check', () => {
    expect(stack.terminationProtection).toBe(true);
    Annotations.fromStack(stack).hasNoError('*', Match.anyValue());
  });

  it('retains every stateful resource on deletion and replacement', () => {
    const resources = statefulResources(template);
    expect(resources.length).toBeGreaterThanOrEqual(5);
    for (const resource of resources) {
      expect(resource).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    }
  });

  it('protects the database from deletion and runs it Multi-AZ', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: true,
      MultiAZ: true,
      StorageEncrypted: true,
      KmsKeyId: Match.anyValue(),
    });
  });

  it('versions the evidence bucket and blocks public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('locks the audit archive with the configured retention', () => {
    const { mode, days } = ENVIRONMENTS[name].auditArchive;
    template.hasResourceProperties('AWS::S3::Bucket', {
      ObjectLockEnabled: true,
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: mode, Days: days } },
      },
    });
  });

  it('rotates the data key', () => {
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('publishes approved feature flags', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/pactlab/${name}/feature-flags`,
      Value: JSON.stringify(ENVIRONMENTS[name].featureFlags),
    });
  });
});

describe.each(['dev', 'qa'] as const)('%s stack', (name) => {
  it('is not termination-protected and can be torn down', () => {
    const { stack, template } = synth(name);
    expect(stack.terminationProtection).toBe(false);
    template.hasResourceProperties('AWS::RDS::DBInstance', { DeletionProtection: false });
  });
});

describe('StatefulProtectionAspect', () => {
  it('rejects a stack without termination protection or retained state', () => {
    const stack = new Stack(new App(), 'Unprotected');
    new s3.Bucket(stack, 'Bucket', { removalPolicy: RemovalPolicy.DESTROY });
    Aspects.of(stack).add(new StatefulProtectionAspect());
    const annotations = Annotations.fromStack(stack);
    annotations.hasError('/Unprotected', Match.stringLikeRegexp('termination protection'));
    annotations.hasError('/Unprotected/Bucket/Resource', Match.stringLikeRegexp('must RETAIN'));
  });

  it('rejects a protected stack whose database lost deletion protection', () => {
    const stack = new PactlabPlatformStack(new App(), 'Weakened', { config: prodConfig });
    (stack.database.node.defaultChild as rds.CfnDBInstance).deletionProtection = false;
    Annotations.fromStack(stack).hasError(
      '/Weakened/Postgres/Resource',
      Match.stringLikeRegexp('deletion protection'),
    );
  });
});

describe('assertTargetAccount', () => {
  it('fails closed when credentials resolve to another account', () => {
    expect(() => assertTargetAccount('prod', '111111111111', '222222222222')).toThrow(
      /different account/,
    );
  });

  it('accepts a matching account and environment-agnostic synthesis', () => {
    expect(() => assertTargetAccount('prod', '111111111111', '111111111111')).not.toThrow();
    expect(() => assertTargetAccount('prod', undefined, '222222222222')).not.toThrow();
  });

  it('rejects malformed account ids', () => {
    expect(() => assertTargetAccount('stage', 'prod-account', undefined)).toThrow(/12-digit/);
  });
});
