/**
 * The public marketing site (pactlab.ai). One instance, not per environment.
 * The account id is supplied as CDK context (`pactlab:site:account`), never
 * committed. Published by GitHub Actions only (ADR 0003).
 */
export interface SiteConfig {
  /**
   * The organization's guardrail (service control policy) allows CloudFormation
   * only in us-east-2; CloudFront itself is global.
   */
  readonly region: 'us-east-2';
  /** The one AWS CLI profile used for the one-time bootstrap. */
  readonly profile: 'pactlab-dev';
  readonly githubRepository: string;
  /** GitHub Environment that deploys (required reviewer). */
  readonly githubEnvironment: string;
  /** GitHub Environment that only plans (`cdk diff`) so the change is visible before approval. */
  readonly githubPlanEnvironment: string;
  /**
   * Custom domain (phase 2). Unset: served on the CloudFront address.
   * CloudFront needs its certificate in us-east-1, where the guardrail allows
   * ACM but not CloudFormation, so the certificate is requested with the CLI
   * (runbook) and referenced here by ARN.
   */
  readonly domain?: { readonly name: string; readonly certificateArn: string };
}

export const siteConfig: SiteConfig = {
  region: 'us-east-2',
  profile: 'pactlab-dev',
  githubRepository: 'kuramach/pactlab',
  githubEnvironment: 'site',
  githubPlanEnvironment: 'site-diff',
};
