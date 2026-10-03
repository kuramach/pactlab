import { Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';

/**
 * Development environment: network, PostgreSQL and Redis only.
 * Synthesized in CI; never deployed by agents (local-first until T-007).
 */
export class PactlabDevStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly database: rds.DatabaseInstance;
  readonly redis: elasticache.CfnReplicationGroup;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    Tags.of(this).add('pactlab:environment', 'dev');

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
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

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Pactlab PostgreSQL',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(this.appSecurityGroup, ec2.Port.tcp(5432), 'app to postgres');

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_18 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      databaseName: 'pactlab',
      // Schema-owner credentials are generated into Secrets Manager; the runtime
      // login role is provisioned by migration tooling, never in code.
      credentials: rds.Credentials.fromGeneratedSecret('pactlab_owner'),
      storageEncrypted: true,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(7),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      iamAuthentication: true,
      cloudwatchLogsExports: ['postgresql'],
      parameters: { 'rds.force_ssl': '1', timezone: 'UTC' },
    });

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

    this.redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'Pactlab BullMQ queues (dev)',
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
    });
  }
}
