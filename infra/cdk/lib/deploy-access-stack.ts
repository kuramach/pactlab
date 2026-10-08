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
