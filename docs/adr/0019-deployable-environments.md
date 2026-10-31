# ADR 0019 — Deployable environments: containers on Fargate, workload identity, migration-first releases

Status: accepted (T-070 slice 1, 2026-10-29)

## Context

Kumar asked for dev, qa, stage and live environments to test on AWS. Some
local problems, such as an expired SSO sign-in turning AI off, only go away
when the app runs with its own identity.

The CDK built only the data layer (network, Postgres, Redis, S3, KMS). The
app had no container image, no file storage outside a laptop, and no email
delivery. T-070 as written (sizing, wiring, runbook) could not produce a
running app.

Decided with Kumar:
- **Dev first:** make the app deployable and running in dev. qa, stage and prod follow in slice 2 on the same pieces.
- **Email via Amazon SES.**

## Decision

1. **One image build, two images.**
   - `infra/docker/Dockerfile` builds a `server` image (API, worker, and the one-off migrate and seed tasks, each a different command) and a `web` image (Next.js standalone).
   - Images are tagged by commit SHA in per-environment, immutable, scanned ECR repositories. These live in their own `Pactlab<Env>Registry` stack, so images can be pushed before the app stack runs them.
2. **Fargate (ARM64) behind one HTTPS host.**
   - The ALB serves the web app. `/v1/*` and `/health` go to the API on the same origin.
   - HTTP redirects to HTTPS, and the ACM certificate is DNS-validated.
   - Tasks run in private subnets with no public IPs. Only the load balancer reaches web (3000) and the API (4000).
   - Circuit breakers roll a failing deployment back.
3. **Workload identity, never a human sign-in.** Each task has its own least-privilege role:
   - **API:** the evidence bucket (read and write) and its KMS key; Bedrock invoke and converse on the configured Claude foundation models and US inference profiles only; Transcribe and Polly for voice; SES `SendEmail` as the `pactlab.ai` identity only; the feature-flag parameter.
   - **Worker:** bucket read and flags.
   - **Seed** (dev and qa): bucket read and write.
   - **Web and migrate:** nothing.

   This is T-096 Part 1, done for dev.
4. **Adapters behind the existing ports.** Local behaviour is unchanged.
   - **`S3ObjectStore`** (`@pactlab/db`, used by the API and worker): tenant-prefixed keys, SSE-KMS with the environment key, and a write never overwrites (`If-None-Match: *`), as the file store's `wx` flag guarantees.
     - Deleting an object adds a delete marker in the versioned bucket. The prior version expires after the bucket's noncurrent-version window (7 days in dev).
   - **`SesEmailSender`**: never echoes addresses or bodies, even in errors.
   - Config (`packages/config`) fails closed: S3 needs the bucket, key and Region; SES needs a sender and Region.
5. **Credentials as secret fields.**
   - The RDS owner secret, a generated runtime login (`pactlab_api`) and the email-code token key are injected by ECS.
   - `applyDatabaseUrls` builds the database URLs at start, with TLS verified (`verify-full`) against the RDS certificate bundle baked into the image.
   - No URL with a password exists in config or code.
6. **Migration-first releases** (`.github/workflows/deploy.yml`, dispatched by a person behind the GitHub Environment gate):
   1. Push the images.
   2. Deploy the app stack with the release on the one-off tasks only (`serviceImageTag` keeps the services on what they run; `none` means zero tasks on a first deploy).
   3. Run the migration task, which creates the runtime roles idempotently (as `infra/local/postgres-init/01-roles.sql` does locally), sets the runtime password from its secret, and runs `prisma migrate deploy`. A non-zero exit stops the release.
   4. Move the services, then smoke-test.

   Migrations stay expand-only, so rollback means redeploying the earlier commit.
7. **Synthetic data only, only in dev and qa.**
   - The seed task refuses other environments.
   - `DEMO_INBOX` plus-addresses the demo's email-code people on a real inbox, so they can sign in where email is really sent.
8. **Deploy access per environment.**
   - `pactlab-github-<env>-deploy` is trusted only from that GitHub Environment.
   - It may assume the CDK bootstrap roles, push to its two repositories, run tasks on its cluster, pass its stack's task roles to ECS, and read its outputs and logs.
   - An account that already has GitHub's OIDC provider (dev holds the site's) reuses it.
9. **Region us-east-2 for every environment.** The organization's guardrail allows CloudFormation only there (ADR 0003 amendment).

## Consequences

- **Dev is runnable** after the operator's one-time steps (`docs/runbooks/environments.md`). Agents never bootstrap, deploy or dispatch.
- **Malware scanning is a known gap.** Dev uses the built-in signature scanner by explicit setting (`MALWARE_SCANNER=signature`). The app's config refuses it in stage and production, so those cannot go live until a managed scanner (GuardDuty Malware Protection for S3) is wired.
- **Bedrock cross-Region inference** may be denied by the organization's Region guardrail. The runbook checks it before AI is relied on in dev.
- **SES starts in its sandbox:** only verified recipients until production access is requested.
- **Images carry the full workspace** (tsx at runtime, dev dependencies included). That is acceptable for dev; bundling is a later optimisation.
- **Slice 2 (T-070):** qa, stage and prod service blocks at the skinny tier, their domains and deploy roles, the Auth0 checklist (prod on its own tenant), the managed scanner, and the documented scaled-target profile.

## Addendum (2026-10-30): interim Nova in dev

Claude model access for the PactLab Dev account is pending with AWS. Until it
is granted, dev's API runs on **Amazon Nova** through `BEDROCK_MODEL_*`
overrides: Nova Pro for `balanced` and `deep_review`, Nova Lite for `fast`,
all via US inference profiles. The task role may call those models besides
Claude. This was Kumar's decision, made so the AI flows can be exercised on
AWS in the meantime.

- **Dev only, temporary.** The settled stack stays Claude on Bedrock. Remove
  `modelOverrides` and the Nova patterns in `infra/cdk/config/dev.ts` once
  access is granted, and redeploy.
- The prompts and their evaluations were tuned for Claude. Nova output
  (extraction quality, citation discipline, refusals) is not evaluated, and
  findings it drafts are judged with that in mind. Every draft still needs a
  resolvable citation and a person's decision.
- Each prompt's `maxOutputTokens` (up to 6,000 for contract extraction) must be
  within the Nova model's output limit. A request above it fails visibly as an
  AI error, never silently.

## Addendum (2026-10-30): every environment has its own site and app

Kumar wants the whole journey testable before live: land on the site, click
Sign up or Sign in, use that environment's app. Decided the same day:

- **Same layout everywhere.** Live is the site at `pactlab.ai` with the app at
  `app.pactlab.ai`. Every other environment is the site at `<env>.pactlab.ai`
  with the app at `app.<env>.pactlab.ai`. The dev app moves from
  `dev.pactlab.ai` to `app.dev.pactlab.ai`.
- **Each environment's site uses production's hosting.** That's
  `PactlabSiteStack`, deployed as `Pactlab<Env>Site`: private bucket,
  CloudFront, the same security headers, and the static export built for that
  environment, with `NEXT_PUBLIC_APP_URL` pointing at its app.
  - Its CloudFront certificate is requested in us-east-1 with the CLI, as for
    `pactlab.ai` (ADR 0003), and passed as context.
  - `deploy.yml` publishes the site after the app's smoke test.
- **Only production is indexed.** Environment copies send
  `X-Robots-Tag: noindex, nofollow`, their `robots.txt` disallows everything,
  and pages carry `noindex` (`NEXT_PUBLIC_SITE_INDEXING=none`). Canonical URLs
  keep pointing at `pactlab.ai`.
- **Sign-up is approved automatically in dev and qa**
  (`signupRequiresApproval: false`), so a new organization can be tested end
  to end. Stage and live keep operator approval, through an AWS ops task that
  arrives with their slice.
- **Delivery to any address needs SES production access** in each
  environment's account. Until it's granted, only verified addresses receive
  codes.

