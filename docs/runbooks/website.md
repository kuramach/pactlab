# Website (pactlab.ai)

Hosting: S3 + CloudFront (`infra/cdk/lib/site-stack.ts`, ADR 0003).
Publishing: `.github/workflows/site.yml`.

## Publish

1. Merge to `main` with changes under `apps/site/` (or run the `site`
   workflow manually).
2. Read the `diff` job's output: what changes in AWS.
3. Approve the `deploy` job in GitHub (Environment `site`).
4. The job prints the site URL. Check home, a product page, an industry page,
   `/product` (no slash) and a missing page (404).

## Roll back

Re-run the `site` workflow from an earlier commit (Actions → site → the run
for that commit → Re-run all jobs), and approve.

## Configuration (GitHub → Settings → Secrets and variables → Actions → Variables)

| Variable | Meaning |
|---|---|
| `AWS_ACCOUNT_ID` | 12-digit account hosting the site |
| `AWS_DEPLOY_ROLE_ARN` | Output `SiteDeployRoleArn` of `PactlabDeployAccess` |
| `SITE_APP_URL` | App origin for Log in / Sign up links (optional) |
| `SITE_CONTACT_EMAIL` | Address for "Request a pilot" (optional) |

## One-time bootstrap (operator, SSO)

```bash
aws sso login --profile pactlab-dev
aws sts get-caller-identity --profile pactlab-dev
pnpm --filter @pactlab/cdk exec cdk bootstrap aws://<account>/us-east-1 --profile pactlab-dev
pnpm --filter @pactlab/cdk exec cdk diff PactlabDeployAccess --profile pactlab-dev -c pactlab:site:account=<account>
pnpm --filter @pactlab/cdk exec cdk deploy PactlabDeployAccess --profile pactlab-dev -c pactlab:site:account=<account>
```

Then create GitHub Environments `site-diff` (no reviewers) and `site`
(required reviewer, `main` only) and set the variables above.

## Custom domain

1. Set `domainName: 'pactlab.ai'` in `infra/cdk/config/site.ts` and publish.
   The deploy waits for certificate validation: add the CNAME shown in ACM
   (console → Certificate Manager, us-east-1) at your DNS provider.
2. Point `pactlab.ai` and `www.pactlab.ai` at the CloudFront domain
   (ALIAS/ANAME or CNAME at your provider, or Route 53 alias records).
