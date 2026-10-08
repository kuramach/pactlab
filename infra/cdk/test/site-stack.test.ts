import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { siteConfig, type SiteConfig } from '../config/site';
import { PactlabDeployAccessStack } from '../lib/deploy-access-stack';
import { CONTENT_SECURITY_POLICY, PactlabSiteStack, REWRITE_FUNCTION_CODE } from '../lib/site-stack';

function siteTemplate(config: SiteConfig = siteConfig) {
  const contentDir = mkdtempSync(join(tmpdir(), 'pactlab-site-'));
  writeFileSync(join(contentDir, 'index.html'), '<!doctype html><title>t</title>');
  return Template.fromStack(new PactlabSiteStack(new App(), 'Site', { config, contentDir }));
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
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
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

  it('adds no domain until one is configured, then a DNS-validated certificate and aliases', () => {
    siteTemplate().resourceCountIs('AWS::CertificateManager::Certificate', 0);
    const withDomain = siteTemplate({ ...siteConfig, domainName: 'pactlab.ai' });
    withDomain.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'pactlab.ai',
      SubjectAlternativeNames: ['www.pactlab.ai'],
      ValidationMethod: 'DNS',
    });
    withDomain.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['pactlab.ai', 'www.pactlab.ai'] }),
    });
  });

  it('maps directory URLs onto index.html', () => {
    const handler = new Function(`${REWRITE_FUNCTION_CODE}; return handler;`)() as (event: {
      request: { uri: string };
    }) => { uri: string };
    const rewrite = (uri: string) => handler({ request: { uri } }).uri;
    expect(rewrite('/')).toBe('/index.html');
    expect(rewrite('/product')).toBe('/product/index.html');
    expect(rewrite('/product/')).toBe('/product/index.html');
    expect(rewrite('/industries/fintech')).toBe('/industries/fintech/index.html');
    expect(rewrite('/brand/pactlab-logo.png')).toBe('/brand/pactlab-logo.png');
    expect(rewrite('/_next/static/chunk.js')).toBe('/_next/static/chunk.js');
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
                  'repo:kuramach/pactlab:environment:site-diff',
                  'repo:kuramach/pactlab:environment:site',
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
