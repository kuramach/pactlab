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
5. Languages (T-171): `/locales.json` lists the published languages. Check
   `/de/` (or any published language) and that the language menu offers it.
   Writing, reviewing and publishing a language: `docs/runbooks/site-translations.md`.

## Edge functions (T-171)

- **Viewer request** (`infra/cdk/functions/site-viewer-request.js`): a first
  visit to an entry page with no language prefix is sent (302) to the
  language chosen in the menu (cookie `pactlab_locale`, always wins) or,
  without one, to the visitor's market (CloudFront-Viewer-Country: DE/AT/CH →
  de, FR/BE → fr, JP → ja; everyone else stays on English). Then the
  directory index rewrite (`/product` → `/product/index.html`).
- **Viewer response** (`site-viewer-response.js`): sets `pactlab_country`
  for a day so the pilot request pre-fills the country.
- Their configuration comes from the export's `/locales.json` at synth; a
  language is routed to only once its native review is complete.
- A redirect loop or a wrong language: set `NATIVE_REVIEW.<locale>.complete`
  back to `false` and republish; the function stops routing to it.

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

## Pactlab Rinse download page (T-178c)

`/rinse` (every site language) reads the Rinse release feed **at build time** from `RINSE_RELEASE_FEED_URL` (https; `file:` for local and end-to-end builds only). The feed is `{ schema: 'pactlab-rinse-releases', version: 1, releases: [...] }`, newest first, each with `version`, `publishedAt`, `notes`, and one installer per platform (`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`) with an https `url` and a lowercase hex `sha256`. The contract is `apps/site/lib/rinse.ts`.

- Unset or no release yet: the page says installers are not published. It never links a placeholder.
- Set but unreachable or malformed: the build fails, so a wrong download is never published.
- The deploy workflow does not pass this variable yet, and the feed is not yet published (T-178b: the release pipeline). Wire both in the same change that publishes the first signed build.
- Release notes come from the feed in English in every language.
- The name "Pactlab Rinse" is on the open list in `trademark-clearance.md`.

## Accounts and region

- Site account: **PactLab Dev** (`379959319207`). The CLI reaches it from the
  management account's console login through `OrganizationAccountAccessRole`:
  `aws login --profile pactlab-mgmt` (choose the Management Account session),
  then use `--profile pactlab-dev`.
- Region: **us-east-2**. The organization's guardrail (SCP
  `AdvancedModeRegionRestrictionSecurityControlPolicy`) allows CloudFormation
  only there; us-east-1 is limited to global services (IAM, CloudFront, ACM).

## One-time bootstrap (operator)

```bash
aws login --profile pactlab-mgmt --region us-east-2
aws sts get-caller-identity --profile pactlab-dev
pnpm --filter @pactlab/cdk exec cdk bootstrap aws://<account>/us-east-2 --profile pactlab-dev
pnpm --filter @pactlab/cdk exec cdk diff PactlabDeployAccess --profile pactlab-dev -c pactlab:site:account=<account>
pnpm --filter @pactlab/cdk exec cdk deploy PactlabDeployAccess --profile pactlab-dev -c pactlab:site:account=<account>
```

Then create GitHub Environments `site-diff` (no reviewers) and `site`
(required reviewer, `main` only) and set the variables above.

## Custom domain (DNS at Namecheap)

1. Request the certificate in **us-east-1** (CloudFront requires it there;
   the guardrail allows ACM but not CloudFormation in that region):
   ```bash
   aws acm request-certificate --profile pactlab-dev --region us-east-1 \
     --domain-name pactlab.ai --subject-alternative-names www.pactlab.ai \
     --validation-method DNS
   aws acm describe-certificate --profile pactlab-dev --region us-east-1 \
     --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[].ResourceRecord'
   ```
2. Namecheap → Domain List → pactlab.ai → **Advanced DNS** → add each
   validation record as a **CNAME** (host = name without `.pactlab.ai.`).
   Leave the Google Workspace **MX** records alone.
3. When the certificate is `ISSUED`, set
   `domain: { name: 'pactlab.ai', certificateArn: '<arn>' }` in
   `infra/cdk/config/site.ts` and publish.
4. Namecheap: **ALIAS** record `@` → the CloudFront domain, and **CNAME**
   `www` → the CloudFront domain.
