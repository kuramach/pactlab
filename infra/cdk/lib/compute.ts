import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, SecretValue } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as rds from 'aws-cdk-lib/aws-rds';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
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
        // A hibernated environment's images are tagged keep-… (ADR 0063) and survive the count rule, so a long sleep
        // never expires what it wakes on.
        lifecycleRules: [
          { rulePriority: 1, description: 'Keep the images hibernated environments wake on', tagPrefixList: ['keep-'], maxImageCount: 50 },
          { rulePriority: 2, description: 'Keep the last 20 images', maxImageCount: 20 },
        ],
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
  /**
   * Per-image overrides: the deploy keeps an unchanged service on the tag it runs, so CloudFormation leaves it
   * alone. `tools` is the migrate and seed image (pushed as `<tag>-tools`).
   */
  readonly imageTags?: Partial<Record<'web' | 'api' | 'worker' | 'tools', string>>;
  /**
   * What only an awake environment has (ADR 0063): network, database, Redis and, on dev and qa, the
   * shared load balancer. Absent: hibernated, and only what is kept is built (secrets, roles, email,
   * logs, the load balancer's certificate), at the same construct paths as when awake.
   */
  readonly runtime?: PactlabRuntimeNetwork;
  readonly dataKey: kms.Key;
  readonly evidenceBucket: s3.Bucket;
  readonly featureFlagsParameterArn: string;
  /** The release the services run (T-100), read by the API for /health and the app's version line. */
  readonly releaseParameter: { readonly name: string; readonly arn: string };
  /** The state the Hosting cost page reads (ADR 0063): power, hibernation and the cost while hibernated. */
  readonly powerParameterArns?: readonly string[];
}

export interface PactlabRuntimeNetwork {
  readonly vpc: ec2.IVpc;
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly database: rds.IDatabaseInstance;
  /** The owner's login as the instance attached it (host and port filled in). */
  readonly databaseOwnerSecret: secretsmanager.ISecret;
  /** `rediss://host:port[/db]` — on shared infrastructure, the environment's own logical database. */
  readonly redisUrl: string;
  /**
   * The shared non-live load balancer (dev and qa; ADR 0019). The environment
   * attaches host-based rules in its own priority block. Absent: it has its own.
   */
  readonly shared?: {
    readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    readonly loadBalancerSecurityGroup: ec2.ISecurityGroup;
    readonly httpsListener: elbv2.ApplicationListener;
    readonly priorityBase: number;
  };
}

/** What runs, only while awake: for the idle pause and log triage. */
export interface PactlabRuntime {
  readonly cluster: ecs.Cluster;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  /** For the idle pause (ADR 0019): the HTTPS listener, the app's target groups and services with their running counts. */
  readonly httpsListener: elbv2.ApplicationListener;
  readonly targetGroups: { readonly web: elbv2.ApplicationTargetGroup; readonly api: elbv2.ApplicationTargetGroup };
  readonly services: readonly { readonly service: ecs.FargateService; readonly desiredCount: number }[];
  /** On a shared listener: the host and priority block this environment's rules use (the pause's wake rule too). */
  readonly ruleScope: { readonly host: string; readonly priorityBase: number } | null;
}

/**
 * The running application (ADR 0019): web, api and worker on Fargate (ARM64)
 * in private subnets, behind one HTTPS load-balancer host — the web app, with
 * `/v1/*` and `/health` routed to the API. One-off task definitions run
 * migrations (before every rollout) and, in dev and qa, the synthetic seed.
 * Every task runs with its own least-privilege role: no human credentials.
 */
export class PactlabCompute extends Construct {
  /** Every service's log group (streams api/, worker/, web/, migrate/, seed/); log triage reads it (T-150). Kept while hibernated, at 7 days' retention. */
  readonly logGroup: logs.LogGroup;
  /** The load balancer's certificate when the environment has its own (stage, live); dev and qa's is the shared base's. */
  readonly certificate?: acm.Certificate;
  /** Absent while hibernated. */
  readonly runtime?: PactlabRuntime;
  readonly roles: { readonly api: iam.Role; readonly worker: iam.Role; readonly web: iam.Role; readonly migrate: iam.Role; readonly seed: iam.Role };

  constructor(scope: Construct, id: string, props: PactlabComputeProps) {
    super(scope, id);
    const { config, service, dataKey, evidenceBucket } = props;
    const stack = Stack.of(this);
    const statefulRemoval = config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const origin = `https://${service.domain}`;

    // --- Secrets: the database owner's is the stack's (ADR 0063); the runtime login and the token key are generated here.
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

    // Other clouds' API keys (T-131, ADR 0034): created holding the placeholder `unset` (provider off). Kumar sets a real key
    // with scripts/ai-key.sh; CloudFormation never puts the placeholder back, because the template's value does not change.
    const aiKey = (id: string, provider: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: `pactlab/${config.name}/ai/${provider}`,
        description: `Pactlab ${config.name}: ${provider} API key for AI models (unset: provider off)`,
        encryptionKey: dataKey,
        secretStringValue: SecretValue.unsafePlainText('unset'),
        removalPolicy: statefulRemoval,
      });
    const anthropicKey = aiKey('AiAnthropicKey', 'anthropic');
    const openaiKey = aiKey('AiOpenAiKey', 'openai');
    const googleKey = aiKey('AiGoogleKey', 'google');
    // Pactlab signing (T-136, ADR 0036): the BoldSign API key, the webhook's signing secret and, until the
    // production go, the test recipients envelopes may go to. Created `unset` (BoldSign off; no webhook;
    // no recipients); scripts/signing-key.sh sets them, so personal addresses never enter the repository.
    const signingSecret = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: `pactlab/${config.name}/signing/${name}`,
        description: `Pactlab ${config.name}: ${description} (unset: off)`,
        encryptionKey: dataKey,
        secretStringValue: SecretValue.unsafePlainText('unset'),
        removalPolicy: statefulRemoval,
      });
    const boldsignKey = signingSecret('SigningBoldSignKey', 'boldsign-api-key', 'BoldSign API key for Pactlab signing');
    const boldsignWebhookSecret = signingSecret('SigningBoldSignWebhookSecret', 'boldsign-webhook-secret', 'BoldSign webhook signing secret');
    const signingTestRecipients = signingSecret('SigningTestRecipients', 'test-recipients', 'the only recipients envelopes may go to before the production go');
    // Document sources (T-147): Pactlab's OAuth clients for Google Drive and OneDrive / SharePoint. Created `unset`
    // (that provider's Connect hidden); scripts/doc-source-key.sh sets them.
    const documentSecret = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: `pactlab/${config.name}/documents/${name}`,
        description: `Pactlab ${config.name}: ${description} (unset: off)`,
        encryptionKey: dataKey,
        secretStringValue: SecretValue.unsafePlainText('unset'),
        removalPolicy: statefulRemoval,
      });
    const googleOauthId = documentSecret('DocumentsGoogleOauthId', 'google-client-id', 'Google OAuth client id for Drive document sources');
    const googleOauthSecret = documentSecret('DocumentsGoogleOauthSecret', 'google-client-secret', 'Google OAuth client secret for Drive document sources');
    const microsoftOauthId = documentSecret('DocumentsMicrosoftOauthId', 'microsoft-client-id', 'Microsoft Entra application id for OneDrive / SharePoint document sources');
    const microsoftOauthSecret = documentSecret('DocumentsMicrosoftOauthSecret', 'microsoft-client-secret', 'Microsoft Entra client secret for OneDrive / SharePoint document sources');
    // Google's file picker (Google Drive files are chosen in it): a browser API key and the Cloud project number.
    const googlePickerKey = documentSecret('DocumentsGooglePickerKey', 'google-picker-api-key', 'Google Picker API key (browser, restricted to the web origin)');
    const googleProjectNumber = documentSecret('DocumentsGoogleProjectNumber', 'google-project-number', 'Google Cloud project number (the picker app id)');
    // Market rents (T-158, ADR 0048): Pactlab's RentCast API key, a platform credential. Created `unset` (market rents
    // off; the Check rents against the market button says so); scripts/rentcast-key.sh sets it. Only the API reads it.
    const rentcastKey = new secretsmanager.Secret(this, 'RentCastApiKey', {
      secretName: `pactlab/${config.name}/credentials/rentcast-api-key`,
      description: `Pactlab ${config.name}: RentCast API key for market rents and property facts (unset: off)`,
      encryptionKey: dataKey,
      secretStringValue: SecretValue.unsafePlainText('unset'),
      removalPolicy: statefulRemoval,
    });
    const logGroup = (this.logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/pactlab/${config.name}/app`,
      // Hibernated: 7 days, and back to the usual retention on wake (ADR 0063).
      retention: !props.runtime ? logs.RetentionDays.ONE_WEEK : config.protectedState ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    }));

    // Hosting cost (admin console): live reads Cost Explorer through the payer account's read-only role
    // (`cost-read-stack.ts`). Its ARN comes from deploy context, never from code.
    const costRoleContext = config.name === 'prod' ? (this.node.tryGetContext('pactlab:prod:costExplorerRoleArn') as string | undefined) : undefined;
    if (costRoleContext && !/^arn:aws[a-z-]*:iam::\d{12}:role\/PactlabCostRead$/.test(costRoleContext)) throw new Error(`pactlab:prod:costExplorerRoleArn must be the payer account's PactlabCostRead role, got ${costRoleContext}`);
    const costRoleArn = costRoleContext || undefined;
    // The Hosting cost page's environment states (ADR 0063): each hibernatable environment's read-only power role,
    // `dev=<arn>,qa=<arn>,stage=<arn>`, from deploy context; absent, the page shows only this environment.
    const powerRoles = config.name === 'prod' ? ((this.node.tryGetContext('pactlab:prod:powerReadRoleArns') as string | undefined) ?? '') : '';
    const powerRoleArns = powerRoles
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [env, roleArn] = entry.split('=');
        if (!env || !['dev', 'qa', 'stage'].includes(env) || !roleArn || !/^arn:aws[a-z-]*:iam::\d{12}:role\/pactlab-(dev|qa|stage)-power-read$/.test(roleArn))
          throw new Error(`pactlab:prod:powerReadRoleArns must be env=<pactlab-<env>-power-read role ARN>, comma-separated; got ${entry}`);
        return roleArn;
      });

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
    // Admin → AI models → Add from Bedrock reads the account's model list (read only; no manage or provision actions).
    this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'BedrockList', actions: ['bedrock:ListFoundationModels', 'bedrock:ListInferenceProfiles'], resources: ['*'] }));
    // Connection credentials (T-007, T-147): the API keeps organizations' sign-ins under its own prefix only,
    // encrypted with the environment's data key; nothing else in Secrets Manager is reachable this way.
    this.roles.api.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ConnectionCredentials',
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:GetSecretValue', 'secretsmanager:DeleteSecret'],
        resources: [`arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:pactlab/${config.name}/credentials/*`],
      }),
    );
    dataKey.grantEncryptDecrypt(this.roles.api);
    if (costRoleArn) this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'ReadHostingCost', actions: ['sts:AssumeRole'], resources: [costRoleArn] }));
    // Foresight voice (Transcribe streaming and Polly) has no resource-level scoping.
    this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'Voice', actions: ['transcribe:StartStreamTranscription', 'polly:SynthesizeSpeech'], resources: ['*'] }));
    // An account holds a domain identity once: the owning environment creates it, others in the account send as it.
    // Its own envelope (MAIL FROM) domain, so SPF passes for pactlab.ai's mail, aligned with DKIM; until the
    // DNS records exist, SES keeps using its default envelope rather than failing.
    const mailFromDomain = `mail.${service.email.identityDomain}`;
    const identity =
      service.email.identityOwner === false
        ? null
        : new ses.EmailIdentity(this, 'EmailIdentity', {
            identity: ses.Identity.domain(service.email.identityDomain),
            mailFromDomain,
            mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
          });
    // Delivery events (T-109, ADR 0032): every send names this environment's configuration set, whose
    // bounce, complaint, delivery, reject and rendering-failure events go to this environment's topic.
    // The API subscribes its own HTTPS endpoint at startup (so a confirmation never reaches an older
    // release) and verifies every notification's SNS signature. SES account suppression stays the floor.
    const mailEvents = new sns.Topic(this, 'MailEvents', { displayName: `Pactlab ${config.name} SES events`, enforceSSL: true });
    const mailConfigurationSet = new ses.ConfigurationSet(this, 'MailConfigurationSet', { configurationSetName: `pactlab-${config.name}-mail` });
    mailConfigurationSet.addEventDestination('MailEventsToSns', {
      destination: ses.EventDestination.snsTopic(mailEvents),
      events: [ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.COMPLAINT, ses.EmailSendingEvent.DELIVERY, ses.EmailSendingEvent.REJECT, ses.EmailSendingEvent.RENDERING_FAILURE],
    });
    this.roles.api.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SendSignInEmail',
        actions: ['ses:SendEmail'],
        resources: [
          `arn:${stack.partition}:ses:${stack.region}:${stack.account}:identity/${service.email.identityDomain}`,
          // Naming a configuration set on a send needs permission on it too.
          `arn:${stack.partition}:ses:${stack.region}:${stack.account}:configuration-set/${mailConfigurationSet.configurationSetName}`,
        ],
      }),
    );
    this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'MailEventsSubscribe', actions: ['sns:Subscribe'], resources: [mailEvents.topicArn] }));
    for (const name of ['api', 'worker'] as const) {
      this.roles[name].addToPolicy(new iam.PolicyStatement({ sid: 'FeatureFlags', actions: ['ssm:GetParameter'], resources: [props.featureFlagsParameterArn] }));
    }
    this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'Release', actions: ['ssm:GetParameter'], resources: [props.releaseParameter.arn] }));
    // The Hosting cost page (ADR 0063) shows this environment's power state and its cost while hibernated.
    if (powerRoleArns.length) this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'ReadEnvironmentPower', actions: ['sts:AssumeRole'], resources: powerRoleArns }));
    if (props.powerParameterArns?.length) this.roles.api.addToPolicy(new iam.PolicyStatement({ sid: 'PowerState', actions: ['ssm:GetParameter'], resources: [...props.powerParameterArns] }));


    // The load balancer's certificate, kept while hibernated so a wake reattaches it (dev and qa: the shared base's).
    // DNS-validated: its validation record lives in the app's Route 53 zone (AppDns).
    if (!props.runtime?.shared && !config.shared) this.certificate = new acm.Certificate(this, 'Certificate', { domainName: service.domain, validation: acm.CertificateValidation.fromDns() });

    if (props.runtime) {
      this.runtime = this.buildRuntime(props, props.runtime, {
        origin,
        runtimeSecret,
        tokenSecret,
        logGroup,
        costRoleArn,
        powerRoles,
        mail: { configurationSet: mailConfigurationSet.configurationSetName, topicArn: mailEvents.topicArn },
        apiSecrets: {
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openaiKey),
          GOOGLE_API_KEY: ecs.Secret.fromSecretsManager(googleKey),
          ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicKey),
          BOLDSIGN_API_KEY: ecs.Secret.fromSecretsManager(boldsignKey),
          BOLDSIGN_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(boldsignWebhookSecret),
          SIGNING_TEST_RECIPIENTS: ecs.Secret.fromSecretsManager(signingTestRecipients),
          GOOGLE_OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(googleOauthId),
          GOOGLE_OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(googleOauthSecret),
          MICROSOFT_OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(microsoftOauthId),
          MICROSOFT_OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(microsoftOauthSecret),
          GOOGLE_PICKER_API_KEY: ecs.Secret.fromSecretsManager(googlePickerKey),
          GOOGLE_PROJECT_NUMBER: ecs.Secret.fromSecretsManager(googleProjectNumber),
          RENTCAST_API_KEY: ecs.Secret.fromSecretsManager(rentcastKey),
        },
      });
    }

    identity?.dkimRecords.forEach((record, index) => new CfnOutput(stack, `SesDkimRecord${index + 1}`, { value: `${record.name} CNAME ${record.value}` }));
    if (identity) {
      // The two records the MAIL FROM domain needs (the same in every account of this region).
      new CfnOutput(stack, 'SesMailFromMx', { value: `${mailFromDomain} MX 10 feedback-smtp.${stack.region}.amazonses.com` });
      new CfnOutput(stack, 'SesMailFromSpf', { value: `${mailFromDomain} TXT "v=spf1 include:amazonses.com ~all"` });
    }
  }

  /** Everything that runs (ADR 0019); only built while awake (ADR 0063). */
  private buildRuntime(
    props: PactlabComputeProps,
    net: PactlabRuntimeNetwork,
    kept: {
      readonly origin: string;
      readonly runtimeSecret: secretsmanager.ISecret;
      readonly tokenSecret: secretsmanager.ISecret;
      readonly logGroup: logs.LogGroup;
      readonly costRoleArn: string | undefined;
      readonly powerRoles: string;
      readonly mail: { readonly configurationSet: string; readonly topicArn: string };
      readonly apiSecrets: Record<string, ecs.Secret>;
    },
  ): PactlabRuntime {
    const { config, service, dataKey, evidenceBucket } = props;
    const { vpc, database } = net;
    const stack = Stack.of(this);
    const { origin, runtimeSecret, tokenSecret, logGroup, costRoleArn } = kept;
    const ownerSecret = net.databaseOwnerSecret;
    // --- Images by commit SHA: the slim server image (api, worker), its "-tools" variant (migrate, seed) and the web image.
    const repositories = {
      server: ecr.Repository.fromRepositoryName(this, 'ServerRepository', repositoryName(config.name, 'server')),
      web: ecr.Repository.fromRepositoryName(this, 'WebRepository', repositoryName(config.name, 'web')),
    };
    const image = (kind: 'server' | 'web', tag = props.imageTag) => ecs.ContainerImage.fromEcrRepository(repositories[kind], tag);
    const firstDeploy = props.serviceImageTag === 'none';
    const serviceTag = (name: 'web' | 'api' | 'worker') => props.imageTags?.[name] ?? (firstDeploy ? props.imageTag : props.serviceImageTag);
    const toolsTag = props.imageTags?.tools ?? props.imageTag;
    const serviceImage = (name: 'web' | 'api' | 'worker') => image(name === 'web' ? 'web' : 'server', serviceTag(name));
    const desired = (size: TaskSize) => (firstDeploy ? 0 : size.desiredCount);

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: `pactlab-${config.name}` });
    // --- Configuration every server task shares. Credentials arrive as separate secret fields (applyDatabaseUrls).
    const serverEnvironment: Record<string, string> = {
      APP_ENV: APP_ENV[config.name],
      LOG_LEVEL: 'info',
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_PORT: database.dbInstanceEndpointPort,
      DB_NAME: 'pactlab',
      DB_USER: 'pactlab_api',
      REDIS_URL: net.redisUrl,
      AWS_REGION: stack.region,
      DOCUMENT_STORE: 's3',
      DOCUMENT_BUCKET: evidenceBucket.bucketName,
      DOCUMENT_KMS_KEY_ID: dataKey.keyArn,
      MALWARE_SCANNER: service.malwareScanner,
      AI_PROVIDER: service.bedrock.provider ?? 'bedrock',
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
      RELEASE_PARAMETER: props.releaseParameter.name,
      APP_WEB_ORIGIN: origin,
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: service.email.from,
      SIGNUP_REQUIRES_APPROVAL: String(service.signupRequiresApproval),
      SIGNING_PROVIDER: service.signing.providers.join(','),
      ...(service.operatorEmail ? { OPERATOR_EMAIL: service.operatorEmail } : {}),
      ...(costRoleArn ? { COST_EXPLORER_ROLE_ARN: costRoleArn } : {}),
      ...(kept.powerRoles ? { ENVIRONMENT_POWER_ROLES: kept.powerRoles } : {}),
      // The Hosting cost page reads this environment's own power state directly (ADR 0063).
      ...(config.hibernate ? { POWER_ENVIRONMENT: config.name } : {}),
      // Connection credentials (T-007, T-147): organizations' OAuth refresh tokens and connection tokens.
      CREDENTIAL_STORE: 'secretsmanager',
      CREDENTIAL_STORE_PREFIX: `pactlab/${config.name}/credentials`,
      CREDENTIAL_STORE_KMS_KEY_ID: dataKey.keyArn,
      EMAIL_CONFIGURATION_SET: kept.mail.configurationSet,
      EMAIL_EVENTS_TOPIC_ARN: kept.mail.topicArn,
    };
    const runtimePassword = ecs.Secret.fromSecretsManager(runtimeSecret, 'password');
    const ownerFields = { DB_OWNER_USER: ecs.Secret.fromSecretsManager(ownerSecret, 'username'), DB_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(ownerSecret, 'password') };

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
      image: serviceImage('api'),
      ...run('apps/api', 'src/main.ts'),
      environment: apiEnvironment,
      secrets: { DB_PASSWORD: runtimePassword, AUTH_TOKEN_SECRET: ecs.Secret.fromSecretsManager(tokenSecret), ...kept.apiSecrets },
      portMappings: [{ containerPort: 4000 }],
      logging: logging('api'),
    });
    // Fast rollout (dev, qa): the worker is replaced in place and gets 10 seconds to close its queues.
    const fast = service.rollout === 'fast';
    const workerTask = definition('Worker', service.worker, this.roles.worker);
    workerTask.addContainer('worker', {
      image: serviceImage('worker'),
      ...run('apps/worker', 'src/main.ts'),
      ...(fast ? { stopTimeout: Duration.seconds(10) } : {}),
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
      image: image('server', `${toolsTag}-tools`),
      ...run('apps/api', 'src/ops/migrate.ts'),
      environment: { ...serverEnvironment },
      secrets: { DB_PASSWORD: runtimePassword, ...ownerFields },
      logging: logging('migrate'),
    });
    const seedTask = definition('Seed', { cpu: 1024, memoryMiB: 2048 }, this.roles.seed);
    seedTask.addContainer('seed', {
      image: image('server', `${toolsTag}-tools`),
      ...run('apps/api', 'src/ops/seed-deployed.ts'),
      environment: { ...apiEnvironment, EMAIL_PROVIDER: '', EMAIL_FROM: '' },
      secrets: { DB_PASSWORD: runtimePassword, AUTH_TOKEN_SECRET: ecs.Secret.fromSecretsManager(tokenSecret), ...ownerFields },
      logging: logging('seed'),
    });

    // --- Network: the load balancer is the only way in; web reaches nothing internal but the API through it.
    const { shared } = net;
    let albSecurityGroup: ec2.ISecurityGroup;
    if (shared) {
      albSecurityGroup = shared.loadBalancerSecurityGroup;
    } else {
      const own = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', { vpc, description: 'Pactlab public HTTPS' });
      own.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
      own.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP, redirected to HTTPS');
      albSecurityGroup = own;
    }
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', { vpc, description: 'Pactlab web tasks' });
    webSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), 'load balancer to web');
    net.appSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(4000), 'load balancer to api');

    let https: elbv2.ApplicationListener;
    let loadBalancer: elbv2.ApplicationLoadBalancer;
    if (shared) {
      // The shared listener carries this host's certificate (the base stack).
      loadBalancer = shared.loadBalancer;
      https = shared.httpsListener;
    } else {
      loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
        vpc,
        internetFacing: true,
        securityGroup: albSecurityGroup,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        dropInvalidHeaderFields: true,
      });
      if (!this.certificate) throw new Error('An environment with its own load balancer has its own certificate');
      const certificate = this.certificate;
      loadBalancer.addListener('Http', { port: 80, defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }) });
      https = loadBalancer.addListener('Https', { port: 443, certificates: [certificate], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS, open: false });
    }

    const appSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    // The shared demo pool (T-113): every 15 minutes on live, end shares whose time is up and
    // rebuild their demos, on the seed task (owner credentials and the document bucket). Stage
    // pauses when idle, so there it runs by hand (scripts/ops-task.sh stage src/ops/demo-pool.ts sweep).
    if (config.name === 'prod') {
      new events.Rule(this, 'DemoPoolSweep', {
        description: 'Pactlab shared demos: end expired shares and rebuild their demos',
        schedule: events.Schedule.rate(Duration.minutes(15)),
        targets: [
          new eventTargets.EcsTask({
            cluster: cluster,
            taskDefinition: seedTask,
            subnetSelection: appSubnets,
            securityGroups: [net.appSecurityGroup],
            containerOverrides: [{ containerName: 'seed', command: ['./node_modules/.bin/tsx', 'src/ops/demo-pool.ts', 'sweep'] }],
          }),
        ],
      });
    }
    const serviceProps = { cluster: cluster, vpcSubnets: appSubnets, circuitBreaker: { enable: true, rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 };
    const web = new ecs.FargateService(this, 'WebService', { ...serviceProps, taskDefinition: webTask, desiredCount: desired(service.web), securityGroups: [webSecurityGroup] });
    const api = new ecs.FargateService(this, 'ApiService', { ...serviceProps, taskDefinition: apiTask, desiredCount: desired(service.api), securityGroups: [net.appSecurityGroup] });
    // The worker serves no traffic and its jobs wait in Redis, so in fast rollout the old task stops before
    // the new one starts, instead of both running until ECS sees the new one stable. ECS allows that only
    // without Availability Zone rebalancing (which needs room above 100%); one worker task has nothing to rebalance.
    const workerRollout = fast ? { minHealthyPercent: 0, maxHealthyPercent: 100, availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.DISABLED } : {};
    const worker = new ecs.FargateService(this, 'WorkerService', { ...serviceProps, ...workerRollout, taskDefinition: workerTask, desiredCount: desired(service.worker), securityGroups: [net.appSecurityGroup] });
    if (fast) {
      // The deploy moves the worker itself (scripts/roll-worker.sh), alongside the stack update, so CloudFormation
      // does not wait minutes for ECS to call it steady. The service names its task family ("latest active
      // revision"), so a new revision leaves the service's template, and CloudFormation, untouched.
      const cfnWorker = worker.node.defaultChild as ecs.CfnService;
      cfnWorker.addPropertyOverride('TaskDefinition', workerTask.family);
      cfnWorker.addDependency(workerTask.node.defaultChild as ecs.CfnTaskDefinition);
    }
    const services = [
      { service: web, desiredCount: service.web.desiredCount },
      { service: api, desiredCount: service.api.desiredCount },
      { service: worker, desiredCount: service.worker.desiredCount },
    ];

    // Fast rollout (dev, qa): a new task serves after ~20 seconds of passing checks; old ones drain in 5.
    const health = (path: string, codes: string) =>
      fast
        ? { path, healthyHttpCodes: codes, interval: Duration.seconds(10), timeout: Duration.seconds(5), healthyThresholdCount: 2, unhealthyThresholdCount: 3 }
        : { path, healthyHttpCodes: codes, interval: Duration.seconds(30) };
    const drain = Duration.seconds(fast ? 5 : 15);
    // Target groups and rules live in this environment's stack, also when the listener is shared.
    const webTargets = new elbv2.ApplicationTargetGroup(this, 'WebTargets', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [web],
      healthCheck: health('/login', '200-399'),
      deregistrationDelay: drain,
    });
    const apiTargets = new elbv2.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc,
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: health('/health', '200'),
      deregistrationDelay: drain,
    });
    const apiPaths = elbv2.ListenerCondition.pathPatterns(['/v1/*', '/health']);
    if (shared) {
      // Host-scoped rules in this environment's priority block, so environments never see each other's traffic.
      const host = elbv2.ListenerCondition.hostHeaders([service.domain]);
      new elbv2.ApplicationListenerRule(this, 'ApiRule', { listener: https, priority: shared.priorityBase + 10, conditions: [host, apiPaths], targetGroups: [apiTargets] });
      new elbv2.ApplicationListenerRule(this, 'WebRule', { listener: https, priority: shared.priorityBase + 20, conditions: [host], targetGroups: [webTargets] });
    } else {
      https.addTargetGroups('Web', { targetGroups: [webTargets] });
      https.addTargetGroups('Api', { priority: 10, conditions: [apiPaths], targetGroups: [apiTargets] });
    }

    // --- What the deploy workflow and the operator need (no secrets).
    const outputs: Record<string, string> = {
      ClusterName: cluster.clusterName,
      LoadBalancerDns: loadBalancer.loadBalancerDnsName,
      MigrateTaskDefinition: migrateTask.family,
      SeedTaskDefinition: seedTask.family,
      AppSubnets: vpc.selectSubnets(appSubnets).subnetIds.join(','),
      AppTaskSecurityGroupId: net.appSecurityGroup.securityGroupId,
      Origin: origin,
      ServiceImageTag: firstDeploy ? 'none' : props.serviceImageTag,
      ReleaseImageTag: props.imageTag,
      // What each service (and the one-off tasks) runs, so the next deploy only moves what changed.
      WebImageTag: firstDeploy ? 'none' : serviceTag('web'),
      ApiImageTag: firstDeploy ? 'none' : serviceTag('api'),
      WorkerImageTag: firstDeploy ? 'none' : serviceTag('worker'),
      ToolsImageTag: toolsTag,
      WorkerServiceName: worker.serviceName,
      WorkerTaskFamily: workerTask.family,
      // scripts/ai-key.sh and scripts/signing-key.sh restart the API after setting a key (secrets are read at task start).
      ApiServiceName: api.serviceName,
    };
    // Stack-level outputs with fixed names, read by the deploy workflow.
    for (const [name, value] of Object.entries(outputs)) new CfnOutput(stack, name, { value });
    return { cluster, loadBalancer, httpsListener: https, targetGroups: { web: webTargets, api: apiTargets }, services, ruleScope: shared ? { host: service.domain, priorityBase: shared.priorityBase } : null };
  }
}
