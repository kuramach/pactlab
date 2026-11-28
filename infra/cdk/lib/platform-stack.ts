import { App, Aspects, CfnResource, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import type { EnvironmentConfig, PowerShape } from '../config';
import { siteConfig } from '../config/site';
import { AppDns } from './app-dns';
import { PactlabCompute } from './compute';
import { hibernatedCost } from './hibernation-cost';
import { hibernatedCostParameterName, hibernationParameterName, IdlePause, powerParameter, powerParameterName } from './idle-pause';
import { SleepPage } from './sleep-page';
import { LogTriage, triageEnvironments } from './log-triage';
import { pactlabVpc, type PactlabNonliveBaseStack } from './nonlive-base-stack';
import { StatefulProtectionAspect } from './protection';

export interface PactlabPlatformStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /** The release image tag (commit SHA); required to deploy an environment with a service. */
  readonly imageTag?: string;
  /** The tag the services run during a release (see PactlabCompute); defaults to `imageTag`. */
  readonly serviceImageTag?: string;
  /** Per-image overrides (see PactlabCompute): unchanged services stay on the tag they run. */
  readonly imageTags?: Partial<Record<'web' | 'api' | 'worker' | 'tools', string>>;
  /** The release tag (T-100, e.g. v2026.11.1) of the commit the services run; absent when untagged. */
  readonly releaseVersion?: string;
  /** The shared non-live base, for an environment whose config says `shared` (dev and qa). */
  readonly sharedBase?: PactlabNonliveBaseStack;
  /**
   * Which shape to build (ADR 0063): `awake` (the default) or `hibernated`, where everything that bills by the
   * hour is left out and everything that holds data or names is kept, at the same logical IDs.
   */
  readonly power?: PowerShape;
  /**
   * The snapshot the database was restored from (`/pactlab/<env>/database-source`). Once set it must be named on
   * every deploy: CloudFormation replaces a restored instance with an empty one when the snapshot is dropped.
   */
  readonly databaseSource?: string;
  /** The sleep page's us-east-1 certificate (`-c pactlab:<env>:sleepCertificateArn`); required to hibernate. */
  readonly sleepCertificateArn?: string;
}

/** A hibernated environment's name points at its sleep page; the stack refuses to hibernate without one. */
function requireSleepPage(sleep: SleepPage | undefined) {
  if (!sleep) throw new Error('A hibernated environment needs its sleep page');
  return sleep.distribution;
}

/**
 * The owner secret's logical IDs from when RDS generated it as the instance's child (`Postgres/Secret`), so
 * moving it to the stack (ADR 0063) keeps the very same resource, password and attachment.
 */
export function legacyOwnerSecretIds(stackId: string): { secret: string; attachment: string } {
  // Never auto-synthesized: inside `cdk` (CDK_OUTDIR set) every App writes its manifest on exit, and this scratch
  // one would overwrite the real app's, leaving only the last environment's stack visible (site deploy, 2026-11-28).
  const scratch = new Stack(new App({ autoSynth: false }), stackId);
  const holder = new Construct(scratch, 'Postgres');
  const secret = new rds.DatabaseSecret(holder, 'Secret', { username: 'pactlab_owner', replaceOnPasswordCriteriaChanges: true });
  const attachment = new CfnResource(new Construct(secret, 'Attachment'), 'Resource', { type: 'AWS::SecretsManager::SecretTargetAttachment' });
  return { secret: scratch.resolve((secret.node.defaultChild as secretsmanager.CfnSecret).logicalId) as string, attachment: scratch.resolve(attachment.logicalId) as string };
}

/**
 * One environment: network, PostgreSQL, Redis, a data KMS key, the evidence
 * bucket and the Object Lock audit archive. Every environment uses this stack;
 * only its config differs. Synthesized in CI; stage and production are
 * deployed exclusively by GitHub Actions.
 */
export class PactlabPlatformStack extends Stack {
  /** Absent while hibernated (ADR 0063), with the database, Redis and everything that runs. */
  vpc?: ec2.IVpc;
  appSecurityGroup?: ec2.SecurityGroup;
  readonly dataKey: kms.Key;
  database?: rds.DatabaseInstance | rds.DatabaseInstanceFromSnapshot;
  /** The database owner's login: kept while hibernated, and named by a restored instance (ADR 0063). */
  readonly ownerSecret: rds.DatabaseSecret;
  /** The environment's own Redis; absent on shared infrastructure, where it has a logical database on the base's. */
  redis?: elasticache.CfnReplicationGroup;
  redisUrl?: string;
  readonly power: PowerShape;
  evidenceBucket!: s3.Bucket;
  auditArchiveBucket!: s3.Bucket;
  compute?: PactlabCompute;

  constructor(scope: Construct, id: string, props: PactlabPlatformStackProps) {
    const { config, imageTag, serviceImageTag, imageTags, releaseVersion, sharedBase, power = 'awake', databaseSource, sleepCertificateArn, ...stackProps } = props;
    if (config.name === 'prod' && (config.hibernate || power !== 'awake')) throw new Error('Live never hibernates (ADR 0063)');
    if (power === 'hibernated' && !config.hibernate) throw new Error(`${config.name} does not hibernate (ADR 0063)`);
    if (config.hibernate && !config.idlePause) throw new Error(`${config.name} hibernates after the idle pause: it needs idlePause`);
    if (power === 'hibernated' && !sleepCertificateArn)
      throw new Error(`${config.name} cannot hibernate without its sleep page: pass -c pactlab:${config.name}:sleepCertificateArn (docs/runbooks/hibernate.md)`);
    if (databaseSource !== undefined && !/^[a-zA-Z][a-zA-Z0-9-]{0,254}$/.test(databaseSource)) throw new Error(`pactlab:${config.name}:databaseSource must be an RDS snapshot identifier`);
    if (config.shared && !sharedBase)
      throw new Error(`${config.name} runs on the shared non-live base: pass sharedBase`);
    if (!config.shared && sharedBase)
      throw new Error(`${config.name} has its own infrastructure; it takes no shared base`);
    if (config.shared && config.name === 'prod')
      throw new Error('Live never runs on shared infrastructure');
    super(scope, id, { ...stackProps, terminationProtection: config.protectedState });
    Tags.of(this).add('pactlab:environment', config.name);

    const statefulRemoval = config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.power = power;
    const awake = power === 'awake';

    this.dataKey = new kms.Key(this, 'DataKey', {
      description: `Pactlab ${config.name} data at rest`,
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: statefulRemoval,
    });

    // The owner's secret, at the stack (ADR 0063) under the logical ID it had as the instance's child: same resource, same password.
    this.ownerSecret = new rds.DatabaseSecret(this, 'DatabaseOwnerSecret', { username: 'pactlab_owner' });
    const legacy = legacyOwnerSecretIds(id);
    (this.ownerSecret.node.defaultChild as secretsmanager.CfnSecret).overrideLogicalId(legacy.secret);
    this.ownerSecret.applyRemovalPolicy(statefulRemoval);

    if (awake) this.buildNetworkAndData(config, sharedBase, databaseSource, legacy.attachment);

    this.buildRest(config, { imageTag, serviceImageTag, imageTags, releaseVersion, sharedBase, sleepCertificateArn, statefulRemoval });

    if (config.protectedState) Aspects.of(this).add(new StatefulProtectionAspect());
  }

  /** Network, PostgreSQL and Redis: only while awake (ADR 0063). */
  private buildNetworkAndData(config: EnvironmentConfig, sharedBase: PactlabNonliveBaseStack | undefined, databaseSource: string | undefined, attachmentId: string) {
    // Own network (stage, live), or the shared non-live one (dev, qa).
    const base = sharedBase?.awake();
    const vpc = (this.vpc = base
      ? base.vpc
      : pactlabVpc(this, 'Vpc', {
          maxAzs: config.network.maxAzs,
          natGateways: config.network.natGateways,
          nat: config.network.nat ?? 'gateway',
        }));

    // Application tasks (api, worker) join this group; data stores admit only it.
    const appSecurityGroup = (this.appSecurityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc,
      description: 'Pactlab application tasks',
    }));

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Pactlab PostgreSQL',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(
      appSecurityGroup,
      ec2.Port.tcp(5432),
      'app to postgres',
    );

    // A hibernatable environment's database is deleted only by the hibernate workflow, after a verified snapshot and
    // with a final one (ADR 0063); CloudFormation itself never deletes it.
    const removal = config.protectedState || config.hibernate ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT;
    const common = {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_18 }),
      instanceType: new ec2.InstanceType(`${config.database.instanceClass}.${config.database.instanceSize}`),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      allocatedStorage: config.database.allocatedStorageGiB,
      maxAllocatedStorage: config.database.maxAllocatedStorageGiB,
      multiAz: config.database.multiAz,
      publiclyAccessible: false,
      backupRetention: Duration.days(config.database.backupRetentionDays),
      deletionProtection: config.protectedState,
      removalPolicy: removal,
      iamAuthentication: true,
      cloudwatchLogsExports: ['postgresql'],
      // Each restored instance gets a log group of its own; none is kept forever (ADR 0063).
      ...(config.hibernate ? { cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH } : {}),
      parameters: { 'rds.force_ssl': '1', timezone: 'UTC' },
    };
    this.database = databaseSource
      ? // Restored on wake (ADR 0063): name, owner, encryption and key come from the snapshot; the owner's password is the kept secret's.
        new rds.DatabaseInstanceFromSnapshot(this, 'Postgres', { ...common, snapshotIdentifier: databaseSource, credentials: rds.SnapshotCredentials.fromSecret(this.ownerSecret) })
      : new rds.DatabaseInstance(this, 'Postgres', {
          ...common,
          databaseName: 'pactlab',
          // Schema-owner credentials live in the stack's owner secret; the runtime login role is provisioned by
          // migration tooling, never in code.
          credentials: rds.Credentials.fromSecret(this.ownerSecret, 'pactlab_owner'),
          storageEncrypted: true,
          storageEncryptionKey: this.dataKey,
        });
    // The attachment keeps the logical ID it had under the generated secret.
    const attachment = this.ownerSecret.node.tryFindChild('Attachment')?.node.defaultChild as CfnResource | undefined;
    attachment?.overrideLogicalId(attachmentId);
    if (config.hibernate) {
      // The subnet group goes with the network when the environment hibernates (a retained one would hold its subnets).
      for (const child of ['SubnetGroup', 'ParameterGroup']) (this.database.node.tryFindChild(child)?.node.defaultChild as CfnResource | undefined)?.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    if (base && config.shared) {
      // The shared Redis admits this environment's tasks; the environment uses its own logical database.
      new ec2.CfnSecurityGroupIngress(this, 'SharedRedisFromApp', {
        groupId: base.redisSecurityGroup.securityGroupId,
        sourceSecurityGroupId: appSecurityGroup.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 6379,
        toPort: 6379,
        description: `${config.name} app to shared redis`,
      });
      this.redisUrl = `rediss://${base.redis.attrPrimaryEndPointAddress}:${base.redis.attrPrimaryEndPointPort}/${config.shared.redisDb}`;
    } else {
      const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
        vpc,
        description: 'Pactlab Redis (BullMQ)',
        allowAllOutbound: false,
      });
      redisSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(6379), 'app to redis');

      const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
        description: 'Pactlab Redis isolated subnets',
        subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
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
      this.redisUrl = `rediss://${this.redis.attrPrimaryEndPointAddress}:${this.redis.attrPrimaryEndPointPort}`;
    }
  }

  /** What every shape has: buckets, flags, the release, the app's kept parts (and, awake, what runs), DNS and the sleep page. */
  private buildRest(
    config: EnvironmentConfig,
    props: {
      imageTag: string | undefined;
      serviceImageTag: string | undefined;
      imageTags: PactlabPlatformStackProps['imageTags'];
      releaseVersion: string | undefined;
      sharedBase: PactlabNonliveBaseStack | undefined;
      sleepCertificateArn: string | undefined;
      statefulRemoval: RemovalPolicy;
    },
  ) {
    const { imageTag, serviceImageTag, imageTags, releaseVersion, sharedBase, sleepCertificateArn, statefulRemoval } = props;

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
    const featureFlags = new ssm.StringParameter(this, 'FeatureFlags', {
      parameterName: `/pactlab/${config.name}/feature-flags`,
      description: 'Pactlab approved feature flags (pilot guardrails)',
      stringValue: JSON.stringify(config.featureFlags),
    });

    // The release the services run, shown in the app (T-100). A parameter, not a task setting, so a
    // new version alone never rolls the services.
    const release = config.service
      ? new ssm.StringParameter(this, 'Release', {
          parameterName: `/pactlab/${config.name}/release`,
          description: 'Pactlab: the release the services run (version tag and commit)',
          stringValue: JSON.stringify({ version: releaseVersion ?? null, sha: serviceImageTag ?? imageTag ?? 'unset' }),
        })
      : null;

    // The state the Hosting cost page shows (ADR 0063): this environment's power, hibernation and cost while asleep.
    const parameterArn = (name: string) => this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) });
    const powerArns = config.hibernate ? [powerParameterName, hibernationParameterName, hibernatedCostParameterName].map((name) => parameterArn(name(config.name))) : [];

    // The running application (ADR 0019), for environments that have one; while hibernated only its kept parts (ADR 0063).
    if (config.service && release) {
      const compute = (this.compute = new PactlabCompute(this, 'App', {
        config,
        service: config.service,
        imageTag: imageTag ?? 'unset',
        serviceImageTag: serviceImageTag ?? imageTag ?? 'unset',
        ...(imageTags ? { imageTags } : {}),
        dataKey: this.dataKey,
        evidenceBucket: this.evidenceBucket,
        featureFlagsParameterArn: featureFlags.parameterArn,
        releaseParameter: { name: release.parameterName, arn: release.parameterArn },
        powerParameterArns: powerArns,
        ...(this.vpc && this.appSecurityGroup && this.database && this.redisUrl
          ? {
              runtime: {
                vpc: this.vpc,
                appSecurityGroup: this.appSecurityGroup,
                database: this.database,
                // The tasks read the owner's login through its attachment, as before the secret moved (ADR 0063).
                databaseOwnerSecret: this.database.secret ?? this.ownerSecret,
                redisUrl: this.redisUrl,
                ...(sharedBase && config.shared
                  ? {
                      shared: {
                        loadBalancer: sharedBase.awake().loadBalancer,
                        loadBalancerSecurityGroup: sharedBase.awake().loadBalancerSecurityGroup,
                        httpsListener: sharedBase.awake().httpsListener,
                        priorityBase: config.shared.rulePriorityBase,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      }));
      const runtime = compute.runtime;
      // Only production runs all the time; the others pause when idle (ADR 0019). Hibernated, only the power state stays.
      if (config.idlePause && runtime && this.database) {
        new IdlePause(this, 'IdlePause', {
          env: config.name,
          idleMinutes: config.idlePause.idleMinutes,
          cluster: runtime.cluster,
          services: runtime.services,
          database: this.database,
          listener: runtime.httpsListener,
          targetGroups: runtime.targetGroups,
          loadBalancer: runtime.loadBalancer,
          ...(runtime.ruleScope ? { ruleScope: runtime.ruleScope } : {}),
        });
      } else if (config.idlePause) {
        powerParameter(new Construct(this, 'IdlePause'), config.name);
      }

      // Hibernatable environments (ADR 0063): the app's name in Route 53, and the sleep page it points at while asleep.
      if (config.hibernate) {
        const certificateArn = compute.certificate?.certificateArn ?? sharedBase?.certificateFor(config.service.domain).certificateArn;
        if (!certificateArn) throw new Error(`${config.name}: no load balancer certificate for ${config.service.domain}`);
        const sleep = sleepCertificateArn
          ? new SleepPage(this, 'SleepPage', {
              env: config.name,
              host: config.service.domain,
              certificateArn: sleepCertificateArn,
              githubRepo: siteConfig.githubRepository,
              dataKey: this.dataKey,
              protectedState: config.protectedState,
            })
          : undefined;
        new AppDns(this, 'Dns', {
          host: config.service.domain,
          certificateArn,
          target: runtime ? { loadBalancer: runtime.loadBalancer } : { sleepPage: requireSleepPage(sleep) },
        });
      }
    }

    // Log triage (T-150 live, T-157 pre-production): detection runs in each account itself, never on a developer's machine.
    // While hibernated it stays, and skips this environment (its power says so).
    if (config.logTriage && config.service && this.compute) {
      const environments = triageEnvironments(config);
      new LogTriage(this, 'LogTriage', {
        ...(environments ? { environments } : {}),
        env: config.name,
        config: config.logTriage,
        logGroup: this.compute.logGroup,
        cluster: this.compute.runtime?.cluster ?? { clusterName: `pactlab-${config.name}` },
        services: (this.compute.runtime?.services ?? []).map(({ service }) => service),
        email: { from: config.service.email.from, identityDomain: config.service.email.identityDomain },
        dataKey: this.dataKey,
        protectedState: config.protectedState,
      });
    }

    // What this environment costs while hibernated, from the secrets it really keeps (ADR 0063).
    if (config.hibernate) {
      const secrets = this.node.findAll().filter((node) => node instanceof secretsmanager.CfnSecret).length + (config.logTriage ? 1 : 0);
      const cost = hibernatedCost({ secrets, kmsKeys: 1, hostedZones: 1, snapshotMaxGiB: config.database.allocatedStorageGiB });
      new ssm.StringParameter(this, 'HibernatedCost', {
        parameterName: hibernatedCostParameterName(config.name),
        description: `Pactlab ${config.name}: estimated monthly cost while hibernated (ADR 0063)`,
        stringValue: JSON.stringify(cost),
      });
    }
  }
}
