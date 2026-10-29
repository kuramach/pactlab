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
    },
  ) {
    const { environment, githubSubjectPrefix, appStackName, existingOidcProviderArn, ...stackProps } = props;
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
          'token.actions.githubusercontent.com:sub': `${githubSubjectPrefix}:environment:${environment}`,
        },
      }),
    });
    const account = this.account;
    const arn = (service: string, resource: string, region = this.region) => `arn:${this.partition}:${service}:${region}:${account}:${resource}`;

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
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassTaskRoles',
        actions: ['iam:PassRole'],
        resources: [`arn:${this.partition}:iam::${account}:role/${appStackName}-*`],
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadStackOutputs', actions: ['cloudformation:DescribeStacks'], resources: [arn('cloudformation', `stack/${appStackName}/*`)] }));
    this.role.addToPolicy(new iam.PolicyStatement({ sid: 'ReadTaskLogs', actions: ['logs:GetLogEvents', 'logs:FilterLogEvents'], resources: [arn('logs', `log-group:/pactlab/${environment}/app:*`)] }));

    new CfnOutput(this, 'DeployRoleArn', { value: this.role.roleArn });
  }
}
