import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { ENVIRONMENTS, type EnvironmentConfig, type EnvironmentName, type LogTriageConfig } from '../config';

const lambdaDir = fileURLToPath(new URL('../lambda/log-triage', import.meta.url));
export const logTriageRuleName = (env: EnvironmentName) => `pactlab-${env}-log-triage`;
/** The sender's bare address, from `Name <address>`. */
const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;

/** One environment a pre-production deployment sweeps (T-157). */
export interface TriageEnvironment {
  readonly name: EnvironmentName;
  readonly logGroupName: string;
  readonly cluster: string;
  /** The environment whose stack holds the deployment: its log group and services are this stack's own. */
  readonly own: boolean;
}

/**
 * The environments one account's deployment sweeps (T-157). Live's (no `environments`): itself, as
 * T-150 built it, so `undefined`. Otherwise each listed environment must be this one, or one on the
 * same shared base (so in the same account: the dev account sweeps dev and qa); never live, and
 * never one that runs a deployment of its own.
 */
export function triageEnvironments(config: EnvironmentConfig): readonly TriageEnvironment[] | undefined {
  const names = config.logTriage?.environments;
  if (!names) return undefined;
  if (!names.includes(config.name)) throw new Error(`${config.name}'s log triage must sweep ${config.name} itself`);
  if (new Set(names).size !== names.length) throw new Error(`${config.name}'s log triage lists an environment twice`);
  return names.map((name) => {
    const other = ENVIRONMENTS[name];
    if (name === 'prod') throw new Error('Live has its own log triage (T-150); a pre-production deployment never sweeps it');
    if (!other.service) throw new Error(`${name} runs no app to sweep`);
    if (name !== config.name) {
      if (!config.shared || other.shared?.base !== config.shared.base) throw new Error(`${name} is not in ${config.name}'s account; it needs its own deployment`);
      if (other.logTriage) throw new Error(`${name} has its own log triage; ${config.name}'s cannot sweep it too`);
    }
    return { name, logGroupName: `/pactlab/${name}/app`, cluster: `pactlab-${name}`, own: name === config.name };
  });
}

export interface LogTriageProps {
  readonly env: EnvironmentName;
  readonly config: LogTriageConfig;
  /** The app's log group (api, worker and web streams). */
  readonly logGroup: logs.ILogGroup;
  readonly cluster: ecs.ICluster;
  readonly services: readonly ecs.FargateService[];
  /** The app's sender (`Name <address>`) and its verified SES domain identity. */
  readonly email: { readonly from: string; readonly identityDomain: string };
  readonly dataKey: kms.IKey;
  readonly protectedState: boolean;
  /** Pre-production (T-157): the environments swept (triageEnvironments). Absent: live. */
  readonly environments?: readonly TriageEnvironment[];
}

/**
 * Log triage (T-150 live, T-157 dev, qa and stage; ADR 0048): runs in each
 * account, never on a developer's machine. A daily schedule invokes one Lambda that reads the
 * app's logs (Logs Insights), keeps its own state (DynamoDB), asks Bedrock for
 * a verdict per error cluster, emails the operator one digest (SES) and opens
 * deduplicated GitHub issues with a token held in Secrets Manager.
 *
 * Its role reads its environments' log groups, invokes the one triage model
 * (none in cluster-only mode), sends only to the configured recipient and
 * writes only its own table. It has no access to any application resource
 * and no cross-account role.
 *
 * Pre-production (`environments`): one deployment per account sweeps each of
 * its environments with separate state, labels and digest sections.
 */
export class LogTriage extends Construct {
  readonly function: lambda.Function;
  readonly table: dynamodb.Table;
  readonly githubToken: secretsmanager.Secret;
  readonly rule: events.Rule;

  constructor(scope: Construct, id: string, props: LogTriageProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const { env, config } = props;
    const environments = props.environments;
    const live = !environments;
    const what = live ? 'live log triage' : `pre-production log triage (${environments.map((e) => e.name).join(', ')})`;
    const removal = props.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Per signature: first and last seen, counts, status; plus the sweep watermark. Small, on demand.
    this.table = new dynamodb.Table(this, 'State', {
      tableName: `pactlab-${env}-log-triage`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removal,
    });

    // The fine-grained token (Issues read/write on one repository). Created `unset` (no issues opened);
    // scripts/github-triage-key.sh sets it, so its value never enters the repository or the template.
    this.githubToken = new secretsmanager.Secret(this, 'GithubToken', {
      secretName: config.githubTokenSecretName,
      description: `Pactlab ${env}: GitHub token for ${what} issues (unset: no issues opened)`,
      encryptionKey: props.dataKey,
      secretStringValue: SecretValue.unsafePlainText('unset'),
      removalPolicy: removal,
    });

    const logGroupPrefix = `/pactlab/${env}/`;
    // Every environment's log group: this stack's own, and (pre-production) the neighbours' by name.
    const swept = (environments ?? [{ name: env, logGroupName: props.logGroup.logGroupName, cluster: props.cluster.clusterName, own: true }]).map((e) => ({
      ...e,
      group: e.own ? props.logGroup : logs.LogGroup.fromLogGroupName(this, `${e.name}Logs`, e.logGroupName),
    }));
    // Live: the variables T-150 set, unchanged. Pre-production: one entry per swept environment (T-157).
    const targets: Record<string, string> = live
      ? {
          LOG_GROUPS: stack.toJsonString([props.logGroup.logGroupName]),
          LOG_GROUP_PREFIX: logGroupPrefix,
          CLUSTER: props.cluster.clusterName,
          SERVICES: stack.toJsonString(props.services.map((service) => service.serviceName)),
        }
      : {
          // Services are named only for this stack's own environment; a neighbour's deploy history is not read.
          TRIAGE_ENVIRONMENTS: stack.toJsonString(
            swept.map((e) => ({
              name: e.name,
              logGroups: [e.group.logGroupName],
              logGroupPrefix: `/pactlab/${e.name}/`,
              cluster: e.own ? props.cluster.clusterName : e.cluster,
              ...(e.own ? { services: props.services.map((service) => service.serviceName) } : {}),
            })),
          ),
          ACCOUNT_LABEL: `${env} account`,
        };
    const { LOG_GROUPS, LOG_GROUP_PREFIX, ...rest } = targets;
    this.function = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      // Four Logs Insights queries, up to 20 Bedrock calls, one email.
      timeout: Duration.minutes(12),
      memorySize: 512,
      // A failed run is not retried by Lambda: the next day's run sweeps the same window again.
      retryAttempts: 0,
      description: live ? `Pactlab ${env}: daily live log triage (T-150)` : `Pactlab ${env}: daily ${what} (T-157)`,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        // Same keys and order as T-150 for live, so its template is unchanged.
        ...(LOG_GROUPS && LOG_GROUP_PREFIX ? { LOG_GROUPS, LOG_GROUP_PREFIX } : {}),
        TABLE: this.table.tableName,
        // Empty: cluster-only (no model call).
        MODEL_ID: config.modelId ?? '',
        RECIPIENT: config.recipient,
        SENDER: props.email.from,
        GITHUB_REPO: config.githubRepo,
        GITHUB_TOKEN_SECRET_ARN: this.githubToken.secretArn,
        DRY_RUN: String(config.dryRun),
        MAX_CLUSTERS: String(config.maxClusters),
        ...rest,
      },
    });
    const fn = this.function;

    // Logs: queries on the swept app groups only. GetQueryResults and StopQuery have no resource-level permissions.
    const sid = (name: string) => (live ? `${name}LiveLogs` : `${name}EnvironmentLogs`);
    fn.addToRolePolicy(new iam.PolicyStatement({ sid: sid('Query'), actions: ['logs:StartQuery'], resources: swept.map((e) => e.group.logGroupArn) }));
    fn.addToRolePolicy(new iam.PolicyStatement({ sid: 'QueryResults', actions: ['logs:GetQueryResults', 'logs:StopQuery'], resources: ['*'] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: sid('Inventory'),
        actions: ['logs:DescribeLogGroups'],
        resources: swept.map((e) => `arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:/pactlab/${e.name}/*`),
      }),
    );

    // Bedrock: the one triage model, through its inference profile (which routes to the model in US Regions).
    // Cluster-only mode (no model configured): no Bedrock permission at all.
    if (config.modelId) {
      const foundationModel = config.modelId.replace(/^(us|eu|apac|global)\./, '');
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'TriageModel',
          actions: ['bedrock:InvokeModel'],
          resources: [
            `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${config.modelId}`,
            `arn:${stack.partition}:bedrock:*::foundation-model/${foundationModel}*`,
          ],
        }),
      );
    }

    // Deploy times, so a verdict can say "started right after deploy X". Read only, this cluster's services.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'DeployHistory',
        actions: ['ecs:ListServiceDeployments', 'ecs:DescribeServices'],
        resources: [`arn:${stack.partition}:ecs:${stack.region}:${stack.account}:service/${props.cluster.clusterName}/*`],
      }),
    );

    // Email: as the app's domain identity, to the configured recipient only.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'SendDigest',
        actions: ['ses:SendEmail'],
        resources: [`arn:${stack.partition}:ses:${stack.region}:${stack.account}:identity/${props.email.identityDomain}`],
        conditions: { 'ForAllValues:StringEquals': { 'ses:Recipients': [config.recipient] }, StringEquals: { 'ses:FromAddress': addressOf(props.email.from) } },
      }),
    );

    this.table.grantReadWriteData(fn);
    this.githubToken.grantRead(fn);

    this.rule = new events.Rule(this, 'Daily', {
      ruleName: logTriageRuleName(env),
      description: `Pactlab ${env}: daily ${what} (disable to pause)`,
      schedule: events.Schedule.cron({ minute: '0', hour: String(config.hourUtc) }),
      targets: [new eventTargets.LambdaFunction(fn, { retryAttempts: 0 })],
    });

    new CfnOutput(stack, 'LogTriageFunctionName', { value: fn.functionName });
    new CfnOutput(stack, 'LogTriageRuleName', { value: this.rule.ruleName });
  }
}
