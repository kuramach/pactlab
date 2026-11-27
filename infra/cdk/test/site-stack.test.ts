import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { siteConfig, type SiteConfig } from '../config/site';
import { PactlabDeployAccessStack } from '../lib/deploy-access-stack';
import { CONTENT_SECURITY_POLICY, edgeFunctionCode, edgeLocales, NO_LOCALES, PactlabSiteStack, type EdgeLocales } from '../lib/site-stack';

function siteTemplate(config: SiteConfig = siteConfig, environment?: ConstructorParameters<typeof PactlabSiteStack>[2]['environment']) {
  const contentDir = mkdtempSync(join(tmpdir(), 'pactlab-site-'));
  writeFileSync(join(contentDir, 'index.html'), '<!doctype html><title>t</title>');
  return Template.fromStack(new PactlabSiteStack(new App(), 'Site', { config, contentDir, ...(environment ? { environment } : {}) }));
}

describe('PactlabSiteStack', () => {
  it('keeps the bucket private and SSL-only, reachable only through CloudFront', () => {
    const template = siteTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('serves HTTPS only with the rewrite function, security headers and a 404 page', () => {
    const template = siteTemplate();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        HttpVersion: 'http2and3',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' }), Match.objectLike({ EventType: 'viewer-response' })],
        }),
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404/index.html' }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { ContentSecurityPolicy: CONTENT_SECURITY_POLICY, Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true }),
          FrameOptions: { FrameOption: 'DENY', Override: true },
        }),
      }),
    });
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it('adds no domain until one is configured, then the us-east-1 certificate and aliases', () => {
    const { domain: _domain, ...withoutDomain } = siteConfig;
    siteTemplate(withoutDomain).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
    });
    const certificateArn = 'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';
    const withDomain = siteTemplate({ ...siteConfig, domain: { name: 'pactlab.ai', certificateArn } });
    withDomain.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    withDomain.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['pactlab.ai', 'www.pactlab.ai'],
        ViewerCertificate: Match.objectLike({ AcmCertificateArn: certificateArn }),
      }),
    });
  });

  it('gives each environment its own copy: its domain only, never indexed; production stays open', () => {
    const certificateArn = 'arn:aws:acm:us-east-1:111111111111:certificate/11111111-1111-1111-1111-111111111111';
    const dev = siteTemplate(siteConfig, { name: 'dev', domain: 'dev.pactlab.ai', indexing: 'none', certificateArn });
    dev.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['dev.pactlab.ai'], ViewerCertificate: Match.objectLike({ AcmCertificateArn: certificateArn }) }),
    });
    dev.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CustomHeadersConfig: { Items: [{ Header: 'X-Robots-Tag', Value: 'noindex, nofollow', Override: true }] },
      }),
    });
    // The deploy's plan reads which certificate the site serves, to republish when it changes.
    dev.hasOutput('CertificateArn', { Value: certificateArn });
    // Without its certificate yet, an environment's site is served on its CloudFront address only.
    const bare = siteTemplate(siteConfig, { name: 'dev', domain: 'dev.pactlab.ai', indexing: 'none' });
    bare.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
    });
    bare.hasOutput('CertificateArn', { Value: 'none' });
    siteTemplate().hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({ CustomHeadersConfig: Match.absent() }),
    });
  });

  it('deploys where the organization allows CloudFormation', () => {
    expect(siteConfig.region).toBe('us-east-2');
  });

  it('serves pactlab.ai with a CloudFront certificate from us-east-1', () => {
    expect(siteConfig.domain?.name).toBe('pactlab.ai');
    expect(siteConfig.domain?.certificateArn).toMatch(/^arn:aws:acm:us-east-1:379959319207:certificate\//);
  });

  it('maps directory URLs onto index.html', () => {
    const rewrite = (uri: string) => (viewerRequest(NO_LOCALES)(request(uri)) as { uri: string }).uri;
    expect(rewrite('/')).toBe('/index.html');
    expect(rewrite('/product')).toBe('/product/index.html');
    expect(rewrite('/product/')).toBe('/product/index.html');
    expect(rewrite('/industries/fintech')).toBe('/industries/fintech/index.html');
    expect(rewrite('/brand/pactlab-logo.svg')).toBe('/brand/pactlab-logo.svg');
    expect(rewrite('/_next/static/chunk.js')).toBe('/_next/static/chunk.js');
    expect(rewrite('/de')).toBe('/de/index.html');
  });
});

/** The language configuration a build with every translation published writes to /locales.json. */
const LOCALES: EdgeLocales = {
  cookie: 'pactlab_locale',
  countryCookie: 'pactlab_country',
  prefixes: ['de', 'fr', 'ja'],
  published: ['de', 'fr', 'ja'],
  countries: { DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', JP: 'ja' },
  entryPaths: ['/', '/how-it-works', '/guides', '/faq', '/industries', '/about', '/case-studies'],
};

type EdgeRequest = { uri: string; method: string; headers: Record<string, { value: string }>; cookies: Record<string, { value: string }>; querystring: Record<string, { value: string; multiValue?: { value: string }[] }> };
type EdgeResponse = { statusCode: number; headers: Record<string, { value: string }>; cookies?: Record<string, { value: string; attributes?: string }> };

const request = (uri: string, { country, cookie, query = {}, method = 'GET' }: { country?: string; cookie?: string; query?: EdgeRequest['querystring']; method?: string } = {}): { request: EdgeRequest } => ({
  request: {
    uri,
    method,
    headers: country ? { 'cloudfront-viewer-country': { value: country } } : {},
    cookies: cookie ? { pactlab_locale: { value: cookie } } : {},
    querystring: query,
  },
});
const viewerRequest = (locales: EdgeLocales) => new Function(`${edgeFunctionCode('site-viewer-request', locales)}; return handler;`)() as (event: { request: EdgeRequest }) => EdgeRequest | EdgeResponse;
const redirectOf = (result: EdgeRequest | EdgeResponse) => ('statusCode' in result ? { status: result.statusCode, location: result.headers['location']?.value } : null);

describe('site language routing at the edge (T-171)', () => {
  const route = viewerRequest(LOCALES);

  it('sends a first visit from Germany, Austria, Switzerland, France, Belgium or Japan to its language with a 302', () => {
    expect(redirectOf(route(request('/', { country: 'DE' })))).toEqual({ status: 302, location: '/de/' });
    expect(redirectOf(route(request('/', { country: 'AT' })))).toEqual({ status: 302, location: '/de/' });
    expect(redirectOf(route(request('/', { country: 'CH' })))).toEqual({ status: 302, location: '/de/' });
    expect(redirectOf(route(request('/faq/', { country: 'FR' })))).toEqual({ status: 302, location: '/fr/faq/' });
    expect(redirectOf(route(request('/industries', { country: 'BE' })))).toEqual({ status: 302, location: '/fr/industries/' });
    expect(redirectOf(route(request('/how-it-works/', { country: 'JP' })))).toEqual({ status: 302, location: '/ja/how-it-works/' });
  });

  it('keeps the query string', () => {
    const query = { utm_source: { value: 'news' }, tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] } };
    expect(redirectOf(route(request('/', { country: 'JP', query })))?.location).toBe('/ja/?utm_source=news&tag=a&tag=b');
  });

  it('leaves the US, the UK, India and everyone else on English', () => {
    for (const country of ['US', 'GB', 'IN', 'BR', 'CN']) expect(redirectOf(route(request('/', { country })))).toBeNull();
    expect(redirectOf(route(request('/')))).toBeNull();
  });

  it('lets a manual choice win over the country, in both directions', () => {
    expect(redirectOf(route(request('/', { country: 'DE', cookie: 'en' })))).toBeNull();
    expect(redirectOf(route(request('/', { country: 'US', cookie: 'ja' })))).toEqual({ status: 302, location: '/ja/' });
    expect(redirectOf(route(request('/faq', { country: 'JP', cookie: 'fr' })))).toEqual({ status: 302, location: '/fr/faq/' });
  });

  it('never redirects a prefixed URL, a deeper page, an asset or a non-GET request', () => {
    expect(redirectOf(route(request('/de/', { country: 'JP' })))).toBeNull();
    expect(redirectOf(route(request('/ja/faq/', { country: 'DE', cookie: 'fr' })))).toBeNull();
    expect(redirectOf(route(request('/fr', { country: 'DE' })))).toBeNull();
    expect(redirectOf(route(request('/industries/fintech/', { country: 'DE' })))).toBeNull();
    expect(redirectOf(route(request('/pricing/', { country: 'DE' })))).toBeNull();
    expect(redirectOf(route(request('/brand/pactlab-logo.svg', { country: 'DE' })))).toBeNull();
    expect(redirectOf(route(request('/', { country: 'DE', method: 'POST' })))).toBeNull();
  });

  it('never sends anyone to a translation still awaiting its native review', () => {
    const reviewedGerman = viewerRequest({ ...LOCALES, published: ['de'] });
    expect(redirectOf(reviewedGerman(request('/', { country: 'JP' })))).toBeNull();
    expect(redirectOf(reviewedGerman(request('/', { country: 'US', cookie: 'fr' })))).toBeNull();
    expect(redirectOf(reviewedGerman(request('/', { country: 'AT' })))).toEqual({ status: 302, location: '/de/' });
    expect(redirectOf(viewerRequest(NO_LOCALES)(request('/', { country: 'DE' })))).toBeNull();
  });

  it('remembers the viewer country for the pilot request, once, and nothing else', () => {
    const respond = new Function(`${edgeFunctionCode('site-viewer-response', LOCALES)}; return handler;`)() as (event: { request: EdgeRequest; response: EdgeResponse }) => EdgeResponse;
    const response = (): EdgeResponse => ({ statusCode: 200, headers: {}, cookies: {} });
    expect(respond({ ...request('/', { country: 'DE' }), response: response() }).cookies).toEqual({
      pactlab_country: { value: 'DE', attributes: 'Path=/; Max-Age=86400; SameSite=Lax; Secure' },
    });
    const returning = request('/', { country: 'DE' });
    returning.request.cookies['pactlab_country'] = { value: 'DE' };
    expect(respond({ ...returning, response: response() }).cookies).toEqual({});
    expect(respond({ ...request('/'), response: response() }).cookies).toEqual({});
    expect(respond({ ...request('/', { country: 'XX1' }), response: response() }).cookies).toEqual({});
  });

  it('reads the language configuration from the static export, and routes nothing without it', () => {
    const contentDir = mkdtempSync(join(tmpdir(), 'pactlab-site-'));
    expect(edgeLocales(contentDir)).toEqual(NO_LOCALES);
    writeFileSync(join(contentDir, 'locales.json'), JSON.stringify(LOCALES));
    expect(edgeLocales(contentDir)).toEqual(LOCALES);
  });

  it('gives both functions the viewer country through the origin request policy, never the cache key', () => {
    const template = siteTemplate();
    template.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['CloudFront-Viewer-Country'] },
        CookiesConfig: { CookieBehavior: 'none' },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
      }),
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          OriginRequestPolicyId: Match.anyValue(),
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' }), Match.objectLike({ EventType: 'viewer-response' })],
        }),
      }),
    });
  });
});

describe('PactlabDeployAccessStack', () => {
  const template = Template.fromStack(new PactlabDeployAccessStack(new App(), 'Access', { config: siteConfig }));

  it('trusts only this repository’s site environment through GitHub OIDC', () => {
    template.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': [
                  'repo:kuramach@1686280/pactlab@1403595223:environment:site-diff',
                  'repo:kuramach@1686280/pactlab@1403595223:environment:site',
                ],
              },
            },
          }),
        ],
      },
    });
  });

  it('can only assume the CDK bootstrap roles', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) => (policy as { Properties: { PolicyDocument: { Statement: { Action: unknown }[] } } }).Properties.PolicyDocument.Statement,
    );
    expect(statements.map((statement) => statement.Action)).toEqual(['sts:AssumeRole']);
    expect(JSON.stringify(statements)).toContain('cdk-hnb659fds-');
  });
});
