import { Aspects, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config';
import { StatefulProtectionAspect } from './protection';

export interface PactlabPlatformStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * One environment: network, PostgreSQL, Redis, a data KMS key, the evidence
 * bucket and the Object Lock audit archive. Every environment uses this stack;
 * only its config differs. Synthesized in CI; stage and production are
 * deployed exclusively by GitHub Actions.
 */
export class PactlabPlatformStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly dataKey: kms.Key;
  readonly database: rds.DatabaseInstance;
  readonly redis: elasticache.CfnReplicationGroup;
  readonly evidenceBucket: s3.Bucket;
  readonly auditArchiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: PactlabPlatformStackProps) {
    const { config, ...stackProps } = props;
    super(scope, id, { ...stackProps, terminationProtection: config.protectedState });
    Tags.of(this).add('pactlab:environment', config.name);

    const statefulRemoval = config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: config.network.maxAzs,
      natGateways: config.network.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    this.vpc.addFlowLog('FlowLog');

    // Application tasks (api, worker) join this group; data stores admit only it.
    this.appSecurityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      description: 'Pactlab application tasks',
    });

    this.dataKey = new kms.Key(this, 'DataKey', {
      description: `Pactlab ${config.name} data at rest`,
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: statefulRemoval,
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Pactlab PostgreSQL',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(
      this.appSecurityGroup,
      ec2.Port.tcp(5432),
      'app to postgres',
    );

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_18 }),
      instanceType: new ec2.InstanceType(
        `${config.database.instanceClass}.${config.database.instanceSize}`,
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      databaseName: 'pactlab',
      // Schema-owner credentials are generated into Secrets Manager; the runtime
      // login role is provisioned by migration tooling, never in code.
      credentials: rds.Credentials.fromGeneratedSecret('pactlab_owner'),
      storageEncrypted: true,
      storageEncryptionKey: this.dataKey,
      allocatedStorage: config.database.allocatedStorageGiB,
      maxAllocatedStorage: config.database.maxAllocatedStorageGiB,
      multiAz: config.database.multiAz,
      publiclyAccessible: false,
      backupRetention: Duration.days(config.database.backupRetentionDays),
      deletionProtection: config.protectedState,
      removalPolicy: config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT,
      iamAuthentication: true,
      cloudwatchLogsExports: ['postgresql'],
      parameters: { 'rds.force_ssl': '1', timezone: 'UTC' },
    });
    // `database.secret` is the target attachment; protect the generated secret itself.
    (this.database.node.findChild('Secret') as secretsmanager.Secret).applyRemovalPolicy(
      statefulRemoval,
    );

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Pactlab Redis (BullMQ)',
      allowAllOutbound: false,
    });
    redisSecurityGroup.addIngressRule(this.appSecurityGroup, ec2.Port.tcp(6379), 'app to redis');

    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Pactlab Redis isolated subnets',
      subnetIds: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });

    const redisFailover = config.redis.numCacheClusters > 1;
    this.redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: `Pactlab BullMQ queues (${config.name})`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: config.redis.nodeType,
      numCacheClusters: config.redis.numCacheClusters,
      automaticFailoverEnabled: redisFailover,
      multiAzEnabled: redisFailover,
      snapshotRetentionLimit: config.redis.snapshotRetentionDays,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
    });

    // Uploaded and VDR-sourced documents. Never source code (scan workspaces
    // are ephemeral and live elsewhere). Versioned so deletes are recoverable.
    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(config.evidenceNoncurrentVersionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: statefulRemoval,
    });

    // Signed, tenant-scoped audit exports land here and cannot be altered or
    // deleted before their retention expires.
    this.auditArchiveBucket = new s3.Bucket(this, 'AuditArchiveBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: true,
      objectLockDefaultRetention:
        config.auditArchive.mode === 'COMPLIANCE'
          ? s3.ObjectLockRetention.compliance(Duration.days(config.auditArchive.days))
          : s3.ObjectLockRetention.governance(Duration.days(config.auditArchive.days)),
      removalPolicy: statefulRemoval,
    });

    // Approved feature flags for this environment. Changing one is a reviewed
    // config change deployed like any other; rollback is a revert.
    new ssm.StringParameter(this, 'FeatureFlags', {
      parameterName: `/pactlab/${config.name}/feature-flags`,
      description: 'Pactlab approved feature flags (pilot guardrails)',
      stringValue: JSON.stringify(config.featureFlags),
    });

    if (config.protectedState) Aspects.of(this).add(new StatefulProtectionAspect());
  }
}
