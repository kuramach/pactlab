import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as rds from 'aws-cdk-lib/aws-rds';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import type { EnvironmentConfig, EnvironmentName, ServiceConfig, TaskSize } from '../config';

/** The app's own name for each environment (packages/config `APP_ENV`). */
export const APP_ENV: Readonly<Record<EnvironmentName, string>> = { dev: 'dev', qa: 'qa', stage: 'stage', prod: 'production' };
export const repositoryName = (env: EnvironmentName, image: 'server' | 'web') => `pactlab-${env}-${image}`;

/**
 * The image registry for one environment, in its own stack so the deploy can
 * push images before the application stack that runs them. Tags are
 * immutable (a tag is a commit SHA); old images expire.
 */
export class PactlabRegistryStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { readonly config: EnvironmentConfig }) {
    const { config, ...stackProps } = props;
    super(scope, id, { ...stackProps, terminationProtection: config.protectedState });
    for (const image of ['server', 'web'] as const) {
      const repository = new ecr.Repository(this, `${image === 'server' ? 'Server' : 'Web'}Repository`, {
        repositoryName: repositoryName(config.name, image),
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        encryption: ecr.RepositoryEncryption.KMS,
        lifecycleRules: [{ description: 'Keep the last 20 images', maxImageCount: 20 }],
        removalPolicy: config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        emptyOnDelete: !config.protectedState,
      });
      new CfnOutput(this, `${image === 'server' ? 'Server' : 'Web'}RepositoryUri`, { value: repository.repositoryUri });
    }
  }
}

export interface PactlabComputeProps {
  readonly config: EnvironmentConfig;
  readonly service: ServiceConfig;
  /** The image the one-off tasks (migrate, seed) run: the release being deployed. */
  readonly imageTag: string;
  /**
   * The image the long-running services run. A deploy first ships the new
   * release to the one-off tasks only (services stay on what they run, or at
   * zero on a first deploy: `none`), runs migrations, then moves the services.
   */
  readonly serviceImageTag: string;
  readonly vpc: ec2.Vpc;
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly dataKey: kms.Key;
  readonly database: rds.DatabaseInstance;
  readonly redis: elasticache.CfnReplicationGroup;
  readonly evidenceBucket: s3.Bucket;
  readonly featureFlagsParameterArn: string;
}

/**
 * The running application (ADR 0019): web, api and worker on Fargate (ARM64)
 * in private subnets, behind one HTTPS load-balancer host — the web app, with
 * `/v1/*` and `/health` routed to the API. One-off task definitions run
 * migrations (before every rollout) and, in dev and qa, the synthetic seed.
 * Every task runs with its own least-privilege role: no human credentials.
 */
export class PactlabCompute extends Construct {
  readonly cluster: ecs.Cluster;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly roles: { readonly api: iam.Role; readonly worker: iam.Role; readonly web: iam.Role; readonly migrate: iam.Role; readonly seed: iam.Role };

  constructor(scope: Construct, id: string, props: PactlabComputeProps) {
    super(scope, id);
    const { config, service, vpc, dataKey, database, redis, evidenceBucket } = props;
    const stack = Stack.of(this);
    const statefulRemoval = config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const origin = `https://${service.domain}`;

    // --- Secrets: the RDS-generated owner secret, plus the runtime login and the token key, generated here.
    if (!database.secret) throw new Error('The database must have a generated owner secret');
    const ownerSecret = database.secret;
    const runtimeSecret = new secretsmanager.Secret(this, 'RuntimeDatabaseSecret', {
      description: `Pactlab ${config.name}: runtime database login (pactlab_api)`,
      encryptionKey: dataKey,
      generateSecretString: { secretStringTemplate: JSON.stringify({ username: 'pactlab_api' }), generateStringKey: 'password', excludePunctuation: true, passwordLength: 40 },
      removalPolicy: statefulRemoval,
    });
    const tokenSecret = new secretsmanager.Secret(this, 'AuthTokenSecret', {
      description: `Pactlab ${config.name}: email-code session signing key`,
      encryptionKey: dataKey,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy: statefulRemoval,
    });

    // --- Images: one server image (api, worker, migrate, seed) and the web image, by commit SHA.
    const repositories = {
      server: ecr.Repository.fromRepositoryName(this, 'ServerRepository', repositoryName(config.name, 'server')),
      web: ecr.Repository.fromRepositoryName(this, 'WebRepository', repositoryName(config.name, 'web')),
    };
    const image = (kind: 'server' | 'web', tag = props.imageTag) => ecs.ContainerImage.fromEcrRepository(repositories[kind], tag);
    const firstDeploy = props.serviceImageTag === 'none';
    const serviceImage = (kind: 'server' | 'web') => image(kind, firstDeploy ? props.imageTag : props.serviceImageTag);
    const desired = (size: TaskSize) => (firstDeploy ? 0 : size.desiredCount);

    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: `pactlab-${config.name}` });
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/pactlab/${config.name}/app`,
      retention: config.protectedState ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // --- Configuration every server task shares. Credentials arrive as separate secret fields (applyDatabaseUrls).
    const serverEnvironment: Record<string, string> = {
      APP_ENV: APP_ENV[config.name],
      LOG_LEVEL: 'info',
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_PORT: database.dbInstanceEndpointPort,
      DB_NAME: 'pactlab',
      DB_USER: 'pactlab_api',
      REDIS_URL: `rediss://${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}`,
      AWS_REGION: stack.region,
      DOCUMENT_STORE: 's3',
      DOCUMENT_BUCKET: evidenceBucket.bucketName,
      DOCUMENT_KMS_KEY_ID: dataKey.keyArn,
      MALWARE_SCANNER: service.malwareScanner,
      AI_PROVIDER: 'bedrock',
      ...(service.bedrock.modelOverrides
        ? {
            BEDROCK_MODEL_BALANCED: service.bedrock.modelOverrides.balanced,
            BEDROCK_MODEL_DEEP_REVIEW: service.bedrock.modelOverrides.deep_review,
            BEDROCK_MODEL_FAST: service.bedrock.modelOverrides.fast,
          }
        : {}),
    };
    const apiEnvironment: Record<string, string> = {
      ...serverEnvironment,
      API_PORT: '4000',
      APP_WEB_ORIGIN: origin,
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: service.email.from,
      SIGNUP_REQUIRES_APPROVAL: String(service.signupRequiresApproval),
    };
    const runtimePassword = ecs.Secret.fromSecretsManager(runtimeSecret, 'password');
    const ownerFields = { DB_OWNER_USER: ecs.Secret.fromSecretsManager(ownerSecret, 'username'), DB_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(ownerSecret, 'password') };

    // --- Roles: each task gets exactly what it uses.
    const role = (name: string, description: string) => new iam.Role(this, `${name}TaskRole`, { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'), description });
    this.roles = {
      api: role('Api', 'Pactlab API: documents, Bedrock, voice, sign-in email'),
      worker: role('Worker', 'Pactlab worker: background imports read uploaded originals'),
      web: role('Web', 'Pactlab web: no AWS permissions'),
      migrate: role('Migrate', 'Pactlab migrations: no AWS permissions beyond its secrets'),
      seed: role('Seed', 'Pactlab synthetic seed (dev and qa): writes demo originals'),
    };
    evidenceBucket.grantReadWrite(this.roles.api);
    evidenceBucket.grantRead(this.roles.worker);
    evidenceBucket.grantReadWrite(this.roles.seed);
    const bedrockArns = [
      ...service.bedrock.foundationModels.map((pattern) => `arn:${stack.partition}:bedrock:*::foundation-model/${pattern}`),
      ...service.bedrock.inferenceProfiles.map((pattern) => `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${pattern}`),
    ];
    this.roles.api.addToPolicy(
      new iam.PolicyStatement({ sid: 'Bedrock', actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Converse', 'bedrock:ConverseStream'], resources: bedrockArns }),
    );
    // Foresight voice (Transcribe streaming and Polly) has no resource-level scoping.
    this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'Voice', actions: ['transcribe:StartStreamTranscription', 'polly:SynthesizeSpeech'], resources: ['*'] }));
    const identity = new ses.EmailIdentity(this, 'EmailIdentity', { identity: ses.Identity.domain(service.email.identityDomain) });
    this.roles.api.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SendSignInEmail',
        actions: ['ses:SendEmail'],
        resources: [`arn:${stack.partition}:ses:${stack.region}:${stack.account}:identity/${service.email.identityDomain}`],
      }),
    );
    for (const name of ['api', 'worker'] as const) {
      this.roles[name].addToPolicy(new iam.PolicyStatement({ sid: 'FeatureFlags', actions: ['ssm:GetParameter'], resources: [props.featureFlagsParameterArn] }));
    }

    // --- Task definitions.
    // Programs start with their own tsx, not through pnpm: pnpm checks and reinstalls dependencies
    // before running, which a read-only, non-root container must not do.
    const run = (dir: string, script: string) => ({ workingDirectory: `/repo/${dir}`, command: ['./node_modules/.bin/tsx', script] });
    const definition = (name: string, size: TaskSize | { cpu: 256 | 512 | 1024; memoryMiB: 512 | 1024 | 2048 }, taskRole: iam.Role) =>
      new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: size.cpu,
        memoryLimitMiB: size.memoryMiB,
        taskRole,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
    const logging = (prefix: string) => ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix });

    const apiTask = definition('Api', service.api, this.roles.api);
    apiTask.addContainer('api', {
      image: serviceImage('server'),
      ...run('apps/api', 'src/main.ts'),
      environment: apiEnvironment,
      secrets: { DB_PASSWORD: runtimePassword, AUTH_TOKEN_SECRET: ecs.Secret.fromSecretsManager(tokenSecret) },
      portMappings: [{ containerPort: 4000 }],
      logging: logging('api'),
    });
    const workerTask = definition('Worker', service.worker, this.roles.worker);
    workerTask.addContainer('worker', {
      image: serviceImage('server'),
      ...run('apps/worker', 'src/main.ts'),
      environment: serverEnvironment,
      secrets: { DB_PASSWORD: runtimePassword },
      logging: logging('worker'),
    });
    const webTask = definition('Web', service.web, this.roles.web);
    webTask.addContainer('web', {
      image: serviceImage('web'),
      environment: { APP_BASE_URL: origin, NEXT_PUBLIC_APP_ENV: APP_ENV[config.name], NEXT_PUBLIC_API_ORIGIN: origin },
      portMappings: [{ containerPort: 3000 }],
      logging: logging('web'),
    });
    // One-off tasks, run by the deploy workflow: migrations as the schema owner, before any rollout.
    const migrateTask = definition('Migrate', { cpu: 512, memoryMiB: 1024 }, this.roles.migrate);
    migrateTask.addContainer('migrate', {
      image: image('server'),
      ...run('apps/api', 'src/ops/migrate.ts'),
      environment: { ...serverEnvironment },
      secrets: { DB_PASSWORD: runtimePassword, ...ownerFields },
      logging: logging('migrate'),
    });
    const seedTask = definition('Seed', { cpu: 1024, memoryMiB: 2048 }, this.roles.seed);
    seedTask.addContainer('seed', {
      image: image('server'),
      ...run('apps/api', 'src/ops/seed-deployed.ts'),
      environment: { ...apiEnvironment, EMAIL_PROVIDER: '', EMAIL_FROM: '' },
      secrets: { DB_PASSWORD: runtimePassword, AUTH_TOKEN_SECRET: ecs.Secret.fromSecretsManager(tokenSecret), ...ownerFields },
      logging: logging('seed'),
    });

    // --- Network: the load balancer is the only way in; web reaches nothing internal but the API through it.
    const albSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', { vpc, description: 'Pactlab public HTTPS' });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP, redirected to HTTPS');
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', { vpc, description: 'Pactlab web tasks' });
    webSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), 'load balancer to web');
    props.appSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(4000), 'load balancer to api');

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
    });
    // DNS-validated: the deploy waits until the CNAME (shown in ACM) is added at the registrar.
    const certificate = new acm.Certificate(this, 'Certificate', { domainName: service.domain, validation: acm.CertificateValidation.fromDns() });
    this.loadBalancer.addListener('Http', { port: 80, defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }) });
    const https = this.loadBalancer.addListener('Https', { port: 443, certificates: [certificate], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS, open: false });

    const appSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    const serviceProps = { cluster: this.cluster, vpcSubnets: appSubnets, circuitBreaker: { enable: true, rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 };
    const web = new ecs.FargateService(this, 'WebService', { ...serviceProps, taskDefinition: webTask, desiredCount: desired(service.web), securityGroups: [webSecurityGroup] });
    const api = new ecs.FargateService(this, 'ApiService', { ...serviceProps, taskDefinition: apiTask, desiredCount: desired(service.api), securityGroups: [props.appSecurityGroup] });
    new ecs.FargateService(this, 'WorkerService', { ...serviceProps, taskDefinition: workerTask, desiredCount: desired(service.worker), securityGroups: [props.appSecurityGroup] });

    https.addTargets('Web', { port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [web], healthCheck: { path: '/login', healthyHttpCodes: '200-399', interval: Duration.seconds(30) }, deregistrationDelay: Duration.seconds(15) });
    https.addTargets('Api', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v1/*', '/health'])],
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(30) },
      deregistrationDelay: Duration.seconds(15),
    });

    // --- What the deploy workflow and the operator need (no secrets).
    const outputs: Record<string, string> = {
      ClusterName: this.cluster.clusterName,
      LoadBalancerDns: this.loadBalancer.loadBalancerDnsName,
      MigrateTaskDefinition: migrateTask.family,
      SeedTaskDefinition: seedTask.family,
      AppSubnets: vpc.selectSubnets(appSubnets).subnetIds.join(','),
      AppTaskSecurityGroupId: props.appSecurityGroup.securityGroupId,
      Origin: origin,
      ServiceImageTag: firstDeploy ? 'none' : props.serviceImageTag,
      ReleaseImageTag: props.imageTag,
    };
    // Stack-level outputs with fixed names, read by the deploy workflow.
    for (const [name, value] of Object.entries(outputs)) new CfnOutput(stack, name, { value });
    identity.dkimRecords.forEach((record, index) => new CfnOutput(stack, `SesDkimRecord${index + 1}`, { value: `${record.name} CNAME ${record.value}` }));
  }
}
