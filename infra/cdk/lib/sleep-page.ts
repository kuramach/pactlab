import { ArnFormat, Duration, RemovalPolicy, SecretValue, Stack } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import type { EnvironmentName } from '../config';
import { hibernationParameterName, powerParameterName } from './idle-pause';

/** The fine-grained token (Actions read and write, this repository only) the Wake up button dispatches the workflow with. */
export const githubPowerSecretName = (env: EnvironmentName) => `pactlab/${env}/github-power`;

export interface SleepPageProps {
  readonly env: EnvironmentName;
  /** The app's host, e.g. app.dev.pactlab.ai. */
  readonly host: string;
  /** A us-east-1 ACM certificate for `host`, requested with the CLI (CloudFront's certificates live there). */
  readonly certificateArn: string;
  /** The repository whose env-power workflow wakes the environment (`owner/name`). */
  readonly githubRepo: string;
  readonly dataKey: kms.IKey;
  readonly protectedState: boolean;
}

/**
 * What app.<env> shows while hibernated (ADR 0063): a CloudFront distribution in front of a small
 * function that says the environment is asleep, offers Wake up (a POST, once per hibernation) and
 * shows the wake's progress. Kept in both shapes, so the name can point at it the moment the
 * environment sleeps and the certificate stays attached (and so renews).
 */
export class SleepPage extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SleepPageProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const { env } = props;
    // Created `unset` (the button then says how to wake from GitHub); scripts/github-power-key.sh sets it.
    const token = new secretsmanager.Secret(this, 'GitHubToken', {
      secretName: githubPowerSecretName(env),
      description: `Pactlab ${env}: GitHub token the sleep page's Wake up button dispatches env-power.yml with (unset: off)`,
      encryptionKey: props.dataKey,
      secretStringValue: SecretValue.unsafePlainText('unset'),
      removalPolicy: props.protectedState ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const page = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(fileURLToPath(new URL('../lambda/sleep-page', import.meta.url))),
      timeout: Duration.seconds(10),
      memorySize: 256,
      description: `Pactlab ${env}: the page shown while hibernated, and its Wake up button`,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        ENV_NAME: env,
        POWER_PARAMETER: powerParameterName(env),
        HIBERNATION_PARAMETER: hibernationParameterName(env),
        GITHUB_REPO: props.githubRepo,
        GITHUB_TOKEN_SECRET: token.secretName,
      },
    });
    const parameter = (name: string) => stack.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1), arnFormat: ArnFormat.SLASH_RESOURCE_NAME });
    page.addToRolePolicy(new iam.PolicyStatement({ sid: 'ReadState', actions: ['ssm:GetParameter'], resources: [parameter(powerParameterName(env)), parameter(hibernationParameterName(env))] }));
    // Only to claim a wake (hibernated → rebuilding) or give the claim back when GitHub refused it.
    page.addToRolePolicy(new iam.PolicyStatement({ sid: 'ClaimWake', actions: ['ssm:PutParameter'], resources: [parameter(powerParameterName(env))] }));
    token.grantRead(page);

    const url = page.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Pactlab ${env}: sleep page (ADR 0063)`,
      domainNames: [props.host],
      certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(url),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });
  }
}
