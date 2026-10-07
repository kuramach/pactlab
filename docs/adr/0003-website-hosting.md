# ADR 0003 — Website hosting on S3 + CloudFront, published by GitHub Actions

- **Status:** Accepted (2026-10-07)

## Context

The marketing site (`apps/site`) is a static export and must be public on
pactlab.ai. Project rules: short-lived SSO credentials, `cdk diff` reviewed
before every deploy, and public/production deploys run in GitHub Actions,
never from a laptop.

## Decision

1. `PactlabSiteStack`: private, SSL-only, versioned S3 bucket reachable only
   through CloudFront Origin Access Control; HTTPS-only distribution with a
   viewer-request function for directory URLs, strict security headers
   (HSTS, CSP, frame deny, nosniff, referrer policy) and a 404 page. The
   static export is uploaded with a cache invalidation on every publish.
2. `PactlabDeployAccessStack`: GitHub OIDC provider and a role trusted only
   for this repository's `site-diff` and `site` Environments, allowed only
   to assume the CDK bootstrap roles. No long-lived AWS keys.
3. Workflow `site.yml`: a `diff` job prints the change set; the `deploy` job
   runs in the `site` Environment after the founder approves.
4. One-time bootstrap from the operator's SSO session: `cdk bootstrap` and
   `PactlabDeployAccess` only. No public content is deployed from a laptop.
5. Custom domain via config (`domainName`): DNS-validated ACM certificate in
   us-east-1 and CloudFront aliases.

## Consequences

- Rollback = re-run the workflow for an earlier commit.
- The site bucket holds only public, rebuildable content, so it is not under
  the stateful-resource protection that applies to customer data.
- The deploy role can do whatever the CDK bootstrap roles can in this
  account; it is limited by which GitHub jobs can assume it.
