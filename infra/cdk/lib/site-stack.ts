import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { SiteConfig } from '../config/site';

export interface PactlabSiteStackProps extends StackProps {
  readonly config: SiteConfig;
  /** The static export (`apps/site/out`). */
  readonly contentDir: string;
  /**
   * An environment's copy of the site (dev, qa, stage): its own domain, and
   * closed to search engines. Absent: the production site, pactlab.ai.
   */
  readonly environment?: {
    readonly name: string;
    readonly domain: string;
    /** us-east-1 certificate for the domain, requested with the CLI (CloudFront); absent: the CloudFront address only. */
    readonly certificateArn?: string;
    readonly indexing: 'public' | 'none';
  };
}

/** What the site's language routing needs at the edge: the build publishes it as /locales.json (T-171). */
export interface EdgeLocales {
  readonly cookie: string;
  readonly countryCookie: string;
  /** Every language prefix: detection never fires under one. */
  readonly prefixes: readonly string[];
  /** Languages a visitor may be sent to; empty until a translation passes its native review. */
  readonly published: readonly string[];
  /** ISO country → language. */
  readonly countries: Readonly<Record<string, string>>;
  readonly entryPaths: readonly string[];
}

/** A build without /locales.json (or an older one): no language routing, the directory index only. */
export const NO_LOCALES: EdgeLocales = {
  cookie: 'pactlab_locale',
  countryCookie: 'pactlab_country',
  prefixes: [],
  published: [],
  countries: {},
  entryPaths: [],
};

/** The language configuration the static export was built with. */
export function edgeLocales(contentDir: string): EdgeLocales {
  const file = join(contentDir, 'locales.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as EdgeLocales) : NO_LOCALES;
}

const functionSource = (name: string) => readFileSync(fileURLToPath(new URL(`../functions/${name}.js`, import.meta.url)), 'utf8');

/**
 * A CloudFront Function's code with the build's language configuration prepended. The same
 * source runs in the site's e2e server, so what the tests prove is what the edge runs.
 */
export const edgeFunctionCode = (name: 'site-viewer-request' | 'site-viewer-response', locales: EdgeLocales) =>
  `var LOCALES = ${JSON.stringify(locales)};\n${functionSource(name)}`;

/** The site loads only its own assets; Next's inline bootstrap needs inline scripts. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * pactlab.ai: a private, SSL-only bucket served only through CloudFront
 * (Origin Access Control), HTTPS everywhere, strict security headers, and
 * the static export uploaded with a cache invalidation on every publish.
 * Deployed in us-east-2 (organization guardrail); CloudFront is global.
 */
export class PactlabSiteStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: PactlabSiteStackProps) {
    const { config, contentDir, environment, ...stackProps } = props;
    super(scope, id, stackProps);
    Tags.of(this).add('pactlab:component', 'site');
    if (environment) Tags.of(this).add('pactlab:environment', environment.name);
    const label = environment ? environment.domain : 'pactlab.ai';

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Public content only; it is rebuilt from git on every publish.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
    });

    const locales = edgeLocales(contentDir);
    const rewrite = new cloudfront.Function(this, 'DirectoryIndex', {
      code: cloudfront.FunctionCode.fromInline(edgeFunctionCode('site-viewer-request', locales)),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Language by cookie or country on entry pages; /path from /path/index.html',
    });
    const country = new cloudfront.Function(this, 'ViewerCountry', {
      code: cloudfront.FunctionCode.fromInline(edgeFunctionCode('site-viewer-response', locales)),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Remember the viewer country for the pilot request',
    });
    // CloudFront-Viewer-Country reaches a function only when a policy lists it. The origin request
    // policy (not the cache key) does, so the cache is not split by country; S3 ignores the header.
    const viewerCountry = new cloudfront.OriginRequestPolicy(this, 'ViewerCountryHeader', {
      comment: `${label}: CloudFront-Viewer-Country for language routing`,
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('CloudFront-Viewer-Country'),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: `${label} security headers`,
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
      },
      // An environment's copy is never indexed, whatever a page says.
      ...(environment?.indexing === 'none'
        ? { customHeadersBehavior: { customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }] } }
        : {}),
    });

    // Requested in us-east-1 outside CloudFormation (see SiteConfig.domain).
    const certificateArn = environment ? environment.certificateArn : config.domain?.certificateArn;
    const certificate = certificateArn ? acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn) : undefined;
    const domainNames = environment ? [environment.domain] : config.domain ? [config.domain.name, `www.${config.domain.name}`] : [];

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: environment ? `Pactlab ${environment.name} site (${environment.domain})` : 'pactlab.ai marketing site',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      ...(certificate && domainNames.length > 0 ? { certificate, domainNames } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: viewerCountry,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations: [
          { function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          { function: country, eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE },
        ],
      },
      // Without list permission a missing key returns 403; both show the site's 404 page.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: '/404/index.html',
        ttl: Duration.minutes(5),
      })),
    });

    new s3deploy.BucketDeployment(this, 'Publish', {
      sources: [s3deploy.Source.asset(contentDir)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      memoryLimit: 512,
    });

    new CfnOutput(this, 'SiteUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    // Read by the deploy's plan: a new certificate means the site must be published again.
    new CfnOutput(this, 'CertificateArn', { value: certificateArn ?? 'none' });
  }
}
