import { CfnOutput, Duration, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { SiteConfig } from '../config/site';

export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

/**
 * Lets GitHub Actions publish the site without long-lived AWS keys: an OIDC
 * trust limited to one repository's `site` Environment, and permission only
 * to assume the CDK bootstrap roles (which perform the deploy). Only the
 * `site-diff` (plan) and `site` (approval-gated deploy) Environments qualify. Deployed once
 * from the operator's SSO session; everything after runs in GitHub.
 */
export class PactlabDeployAccessStack extends Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: StackProps & { readonly config: SiteConfig }) {
    const { config, ...stackProps } = props;
    super(scope, id, stackProps);
    Tags.of(this).add('pactlab:component', 'deploy-access');

    const provider = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    this.role = new iam.Role(this, 'SiteDeployRole', {
      roleName: 'pactlab-github-site-deploy',
      description: 'GitHub Actions: publish the pactlab.ai site via CDK',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // The plan job (cdk diff) and the approval-gated deploy job; nothing else.
          'token.actions.githubusercontent.com:sub': [config.githubPlanEnvironment, config.githubEnvironment].map(
            (environment) => `${config.githubSubjectPrefix}:environment:${environment}`,
          ),
        },
      }),
    });

    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
      }),
    );

    new CfnOutput(this, 'SiteDeployRoleArn', { value: this.role.roleArn });
  }
}

/**
 * Lets GitHub Actions deploy one application environment (ADR 0019): an OIDC
 * trust limited to that repository's GitHub Environment of the same name, and
 * permission to (1) assume the CDK bootstrap roles, (2) push images to that
 * environment's two repositories, and (3) run its one-off migrate and seed
 * tasks and watch the services roll out. Deployed once per account from the
 * operator's session; the account already holding GitHub's OIDC provider
 * (e.g. the site's) passes its ARN instead of creating a second one.
 */
export class PactlabEnvironmentDeployAccessStack extends Stack {
  readonly role: iam.Role;

  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      readonly environment: string;
      readonly githubSubjectPrefix: string;
      /** The application stack's name (e.g. `PactlabDev`): task roles it may pass are named from it. */
      readonly appStackName: string;
      readonly existingOidcProviderArn?: string;
      /** The GitHub Environment that may assume the role, when it is named differently (live → `prod`). */
      readonly githubEnvironment?: string;
      /**
       * The monthly model-scorecard refresh (docs/agent/scorecard-refresh.md): a separate role the GitHub
       * Environment `scorecard` may assume, allowed only to call Claude on this account's Bedrock. Live only.
       */
      readonly scorecardRefresh?: boolean;
      /**
       * Hibernation (ADR 0063): the role the env-power workflows assume, trusted only from the GitHub Environment
       * `<env>-power` (deployment branch: main). Never for live.
       */
      readonly hibernate?: boolean;
      /** The live account whose API reads this environment's power state for the Hosting cost page (ADR 0063). */
      readonly powerReadAccount?: string;
    },
  ) {
    const { environment, githubSubjectPrefix, appStackName, existingOidcProviderArn, githubEnvironment = environment, scorecardRefresh = false, hibernate = false, powerReadAccount, ...stackProps } = props;
    if (hibernate && (environment === 'prod' || githubEnvironment === 'live')) throw new Error('Live never hibernates (ADR 0063): no power role');
    super(scope, id, stackProps);
    Tags.of(this).add('pactlab:component', 'deploy-access');
    Tags.of(this).add('pactlab:environment', environment);

    const provider = existingOidcProviderArn
      ? iam.OidcProviderNative.fromOidcProviderArn(this, 'GitHubOidc', existingOidcProviderArn)
      : new iam.OidcProviderNative(this, 'GitHubOidc', { url: GITHUB_OIDC_URL, clientIds: ['sts.amazonaws.com'] });

    this.role = new iam.Role(this, 'DeployRole', {
      roleName: `pactlab-github-${environment}-deploy`,
      description: `GitHub Actions: deploy the Pactlab ${environment} environment via CDK`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${githubSubjectPrefix}:environment:${githubEnvironment}`,
        },
      }),
    });
    const account = this.account;
    const arn = (service: string, resource: string, region = this.region) => `arn:${this.partition}:${service}:${region}:${account}:${resource}`;

    // The monthly scorecard refresh: its own role, trusted only from the `scorecard` GitHub Environment, and able
    // only to call Claude on Bedrock (the agent's model). It cannot deploy, read data or touch any other resource.
    if (scorecardRefresh) {
      const scorecard = new iam.Role(this, 'ScorecardRefreshRole', {
        roleName: `pactlab-github-${environment}-scorecard`,
        description: 'GitHub Actions: the monthly model-scorecard refresh (Claude on Bedrock only)',
        maxSessionDuration: Duration.hours(1),
        assumedBy: new iam.OpenIdConnectPrincipal(provider, {
          StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${githubSubjectPrefix}:environment:scorecard` },
        }),
      });
      scorecard.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ClaudeOnBedrock',
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Converse', 'bedrock:ConverseStream'],
          resources: [`arn:${this.partition}:bedrock:*::foundation-model/anthropic.claude-*`, `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-*`],
        }),
      );
      new CfnOutput(this, 'ScorecardRefreshRoleArn', { value: scorecard.roleArn });
    }

    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'CdkBootstrapRoles', actions: ['sts:AssumeRole'], resources: [`arn:${this.partition}:iam::${account}:role/cdk-hnb659fds-*-${account}-${this.region}`] }));
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'EcrLogin', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPush',
        actions: ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:CompleteLayerUpload', 'ecr:InitiateLayerUpload', 'ecr:PutImage', 'ecr:UploadLayerPart', 'ecr:DescribeImages'],
        resources: ['server', 'web'].map((image) => arn('ecr', `repository/pactlab-${environment}-${image}`)),
      }),
    );
    // One-off tasks (migrate, seed) and the rollout wait; only on this environment's cluster.
    const cluster = arn('ecs', `cluster/pactlab-${environment}`);
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RunOneOffTasks',
        actions: ['ecs:RunTask'],
        resources: [arn('ecs', `task-definition/${appStackName}*`)],
        conditions: { ArnEquals: { 'ecs:cluster': cluster } },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({ sid: 'WatchRollout', actions: ['ecs:DescribeTasks', 'ecs:DescribeServices', 'ecs:ListTasks'], resources: ['*'], conditions: { ArnEquals: { 'ecs:cluster': cluster } } }),
    );
    // dev and qa: the deploy moves the worker to its new task revision itself (scripts/roll-worker.sh).
    this.role.addToPolicy(
      new iam.PolicyStatement({ sid: 'RollWorker', actions: ['ecs:UpdateService'], resources: [arn('ecs', `service/pactlab-${environment}/${appStackName}-AppWorkerService*`)] }),
    );
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadTaskDefinitions', actions: ['ecs:DescribeTaskDefinition', 'ecs:ListTaskDefinitions'], resources: ['*'] }));
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassTaskRoles',
        actions: ['iam:PassRole'],
        resources: [`arn:${this.partition}:iam::${account}:role/${appStackName}-*`],
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
    // The app stack and its siblings (…Site, …Registry): the plan reads their outputs (e.g. the site's certificate).
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadStackOutputs', actions: ['cloudformation:DescribeStacks'], resources: [arn('cloudformation', `stack/${appStackName}*/*`)] }));
    // Idle pause (ADR 0019): a deploy wakes a paused environment first; the wake workflow does the same.
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadPower', actions: ['ssm:GetParameter'], resources: [`arn:${this.partition}:ssm:${this.region}:${account}:parameter/pactlab/${environment}/power`] }));
    // Hibernation (ADR 0063): every deploy passes each environment's shape and restored snapshot (scripts/power-context.sh),
    // its own and, on the dev and qa base, its neighbour's in the same account.
    if (environment !== 'prod')
      this.role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReadHibernation',
          actions: ['ssm:GetParameter'],
          resources: ['power', 'hibernation', 'database-source'].map((name) => `arn:${this.partition}:ssm:${this.region}:${account}:parameter/pactlab/*/${name}`),
        }),
      );
    this.role.addToPolicy(
      new iam.PolicyStatement({ sid: 'Wake', actions: ['states:StartExecution'], resources: [arn('states', `stateMachine:pactlab-${environment}-wake`)] }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({ sid: 'WatchWake', actions: ['states:DescribeExecution'], resources: [arn('states', `execution:pactlab-${environment}-wake:*`)] }),
    );
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadTaskLogs', actions: ['logs:GetLogEvents', 'logs:FilterLogEvents'], resources: [arn('logs', `log-group:/pactlab/${environment}/app:*`)] }));

    new CfnOutput(this, 'DeployRoleArn', { value: this.role.roleArn });

    if (hibernate) this.powerRole(provider, { environment, githubSubjectPrefix, appStackName, arn });
    if (powerReadAccount) {
      if (!/^\d{12}$/.test(powerReadAccount)) throw new Error('pactlab:powerRead:liveAccount must be a 12-digit AWS account id');
      // Read only, and only this environment's state: live's API shows it on the Hosting cost page.
      const read = new iam.Role(this, 'PowerReadRole', {
        roleName: `pactlab-${environment}-power-read`,
        description: `Live's Hosting cost page: read the ${environment} environment's power state (ADR 0063)`,
        maxSessionDuration: Duration.hours(1),
        assumedBy: new iam.AccountPrincipal(powerReadAccount),
      });
      read.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReadPowerState',
          actions: ['ssm:GetParameter'],
          resources: ['power', 'hibernation', 'hibernated-cost'].map((name) => `arn:${this.partition}:ssm:${this.region}:${account}:parameter/pactlab/${environment}/${name}`),
        }),
      );
      new CfnOutput(this, 'PowerReadRoleArn', { value: read.roleArn });
    }
  }

  /**
   * What hibernating and waking need (ADR 0063): deploy the stacks (through the CDK bootstrap roles), snapshot and
   * delete this environment's database, restore it, run the queue check, pin the images it sleeps on and record the
   * state. Every database action is limited to instances and snapshots tagged or named for this environment.
   */
  private powerRole(provider: iam.IOidcProvider, names: { environment: string; githubSubjectPrefix: string; appStackName: string; arn: (service: string, resource: string) => string }) {
    const { environment, githubSubjectPrefix, appStackName, arn } = names;
    const account = this.account;
    const role = new iam.Role(this, 'PowerRole', {
      roleName: `pactlab-github-${environment}-power`,
      description: `GitHub Actions: hibernate and wake the Pactlab ${environment} environment (env-power.yml)`,
      maxSessionDuration: Duration.hours(2),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': `${githubSubjectPrefix}:environment:${environment}-power` },
      }),
    });
    const ownDb = { StringEquals: { 'rds:db-tag/pactlab:environment': environment } };
    const snapshot = arn('rds', `snapshot:pactlab-${environment}-*`);
    role.addToPolicy(new iam.PolicyStatement({ sid: 'CdkBootstrapRoles', actions: ['sts:AssumeRole'], resources: [`arn:${this.partition}:iam::${account}:role/cdk-hnb659fds-*-${account}-${this.region}`] }));
    role.addToPolicy(new iam.PolicyStatement({ sid: 'DescribeDatabases', actions: ['rds:DescribeDBInstances', 'rds:DescribeDBSnapshots', 'rds:ListTagsForResource'], resources: ['*'] }));
    role.addToPolicy(
      new iam.PolicyStatement({ sid: 'OwnDatabase', actions: ['rds:StartDBInstance', 'rds:StopDBInstance', 'rds:ModifyDBInstance', 'rds:DeleteDBInstance', 'rds:CreateDBSnapshot'], resources: [arn('rds', 'db:*')], conditions: ownDb }),
    );
    role.addToPolicy(new iam.PolicyStatement({ sid: 'OwnSnapshots', actions: ['rds:CreateDBSnapshot', 'rds:DeleteDBSnapshot', 'rds:AddTagsToResource'], resources: [snapshot] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PowerState',
        actions: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
        resources: ['power', 'hibernation', 'database-source', 'release', 'hibernated-cost'].map((name) => `arn:${this.partition}:ssm:${this.region}:${account}:parameter/pactlab/${environment}/${name}`),
      }),
    );
    role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadStackOutputs', actions: ['cloudformation:DescribeStacks', 'cloudformation:DescribeStackResources'], resources: [arn('cloudformation', `stack/${appStackName}*/*`), arn('cloudformation', 'stack/PactlabNonliveBase/*')] }));
    // The images the environment sleeps on get a keep- tag, which the registry's lifecycle never expires.
    role.addToPolicy(new iam.PolicyStatement({ sid: 'EcrLogin', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
    role.addToPolicy(
      new iam.PolicyStatement({ sid: 'PinImages', actions: ['ecr:BatchGetImage', 'ecr:PutImage', 'ecr:DescribeImages', 'ecr:ListImages', 'ecr:BatchDeleteImage'], resources: ['server', 'web'].map((image) => arn('ecr', `repository/pactlab-${environment}-${image}`)) }),
    );
    // The queue check (src/ops/queue-check.ts) runs as a one-off task on this environment's cluster.
    const cluster = arn('ecs', `cluster/pactlab-${environment}`);
    role.addToPolicy(new iam.PolicyStatement({ sid: 'QueueCheck', actions: ['ecs:RunTask'], resources: [arn('ecs', `task-definition/${appStackName}*`)], conditions: { ArnEquals: { 'ecs:cluster': cluster } } }));
    role.addToPolicy(new iam.PolicyStatement({ sid: 'WatchTasks', actions: ['ecs:DescribeTasks', 'ecs:DescribeServices'], resources: ['*'], conditions: { ArnEquals: { 'ecs:cluster': cluster } } }));
    role.addToPolicy(new iam.PolicyStatement({ sid: 'QuiesceServices', actions: ['ecs:UpdateService'], resources: [arn('ecs', `service/pactlab-${environment}/*`)] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassTaskRoles',
        actions: ['iam:PassRole'],
        resources: [`arn:${this.partition}:iam::${account}:role/${appStackName}-*`],
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
    role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadTaskLogs', actions: ['logs:GetLogEvents'], resources: [arn('logs', `log-group:/pactlab/${environment}/app:*`)] }));
    // A paused environment is quiesced through its own pause machinery first (the same wake page rule and steps).
    role.addToPolicy(new iam.PolicyStatement({ sid: 'Pause', actions: ['lambda:InvokeFunction'], resources: [arn('lambda', `function:${appStackName}-IdlePausePowerSteps*`)] }));
    new CfnOutput(this, 'PowerRoleArn', { value: role.roleArn });
  }
}
