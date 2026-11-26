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
import type { EnvironmentName, LogTriageConfig } from '../config';

const lambdaDir = fileURLToPath(new URL('../lambda/log-triage', import.meta.url));
export const logTriageRuleName = (env: EnvironmentName) => `pactlab-${env}-log-triage`;
/** The sender's bare address, from `Name <address>`. */
const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;

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
}

/**
 * Live log triage (T-150, ADR 0048): runs in the live account, never on a
 * developer's machine. A daily schedule invokes one Lambda that reads the
 * app's logs (Logs Insights), keeps its own state (DynamoDB), asks Bedrock for
 * a verdict per error cluster, emails the operator one digest (SES) and opens
 * deduplicated GitHub issues with a token held in Secrets Manager.
 *
 * Its role reads the live log group, invokes the one triage model, sends only
 * to the configured recipient and writes only its own table. It has no access
 * to any application resource.
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
      description: `Pactlab ${env}: GitHub token for live log triage issues (unset: no issues opened)`,
      encryptionKey: props.dataKey,
      secretStringValue: SecretValue.unsafePlainText('unset'),
      removalPolicy: removal,
    });

    const logGroupPrefix = `/pactlab/${env}/`;
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
      description: `Pactlab ${env}: daily live log triage (T-150)`,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        LOG_GROUPS: stack.toJsonString([props.logGroup.logGroupName]),
        LOG_GROUP_PREFIX: logGroupPrefix,
        TABLE: this.table.tableName,
        MODEL_ID: config.modelId,
        RECIPIENT: config.recipient,
        SENDER: props.email.from,
        GITHUB_REPO: config.githubRepo,
        GITHUB_TOKEN_SECRET_ARN: this.githubToken.secretArn,
        DRY_RUN: String(config.dryRun),
        MAX_CLUSTERS: String(config.maxClusters),
        CLUSTER: props.cluster.clusterName,
        SERVICES: stack.toJsonString(props.services.map((service) => service.serviceName)),
      },
    });
    const fn = this.function;

    // Logs: queries on the live app's group only. GetQueryResults and StopQuery have no resource-level permissions.
    fn.addToRolePolicy(new iam.PolicyStatement({ sid: 'QueryLiveLogs', actions: ['logs:StartQuery'], resources: [props.logGroup.logGroupArn] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ sid: 'QueryResults', actions: ['logs:GetQueryResults', 'logs:StopQuery'], resources: ['*'] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InventoryLiveLogs',
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:${logGroupPrefix}*`],
      }),
    );

    // Bedrock: the one triage model, through its inference profile (which routes to the model in US Regions).
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
      description: `Pactlab ${env}: daily live log triage (disable to pause)`,
      schedule: events.Schedule.cron({ minute: '0', hour: String(config.hourUtc) }),
      targets: [new eventTargets.LambdaFunction(fn, { retryAttempts: 0 })],
    });

    new CfnOutput(stack, 'LogTriageFunctionName', { value: fn.functionName });
    new CfnOutput(stack, 'LogTriageRuleName', { value: this.rule.ruleName });
  }
}
