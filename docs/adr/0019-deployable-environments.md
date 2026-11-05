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

1. **One image build, three images.**
   - `infra/docker/Dockerfile` builds a slim `server` image (API and worker: their production dependencies only), a `tools` image tagged `<sha>-tools` in the same repository (the full workspace, for the one-off migrate and seed tasks) and a `web` image (Next.js standalone).
   - A deploy builds and moves only the services whose code changed; the others keep the image they run. In dev and qa the deploy moves the worker itself, outside CloudFormation's stabilization wait.
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
- **The server image still runs TypeScript with tsx** (about 137 MB compressed, down from 561 MB for the full workspace). Bundling is a later optimisation. Only the `tools` image carries the full workspace.
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

## Addendum (2026-10-31): only production runs all the time

Kumar's rule: production is the only environment always on. dev, qa and stage
**pause after an hour without use**. A pause keeps everything that gives an
environment its addresses and data, so nothing has to be rebuilt or
re-pointed.

- **Idle** means no request reached the API for 60 minutes. That's a CloudWatch
  alarm on the API target group's `RequestCount`, which excludes health
  checks. The web app calls the API when a person uses it; bots browsing pages
  don't count.
- **Pause** (the power function, run by a check every 5 minutes; see the 2026-11-01 addendum):
  1. The load balancer's top-priority rule switches from a path nothing uses
     to `/*`, so every request reaches the wake page.
  2. The services scale to zero.
  3. The database stops.
  4. `/pactlab/<env>/power` is set to `paused`.

  The load balancer, NAT, Redis and the site stay up.
- **Wake** (`pactlab-<env>-wake`, one execution per pause):
  1. Start the database and wait for it.
  2. Start the services and wait until web and API are healthy.
  3. Route back to the app and set `power` to `awake`.

  It takes about 5–8 minutes.
- **Ways to wake:**
  - the wake page's **Wake it up** button, a POST, so crawlers that only GET
    never wake an environment;
  - the **wake** workflow;
  - every deploy, whose first step wakes a paused environment.
- **AWS restarts a stopped database after 7 days.** A daily run stops it again
  while the environment is still paused.
- **Steps are code, waits are Step Functions.** Each step is one call to a
  small function tested against fake AWS clients. The state machines only wait
  and loop.
- **Cost:** about $65–70 a month while paused, against about $135 always on.
  Production has no pause; a test fails if it ever gets one.

## Addendum (2026-10-31): cheaper non-live environments

Decided with Kumar the same day:

- **NAT instance outside live.** dev, qa and stage get outbound internet
  through one t4g.nano NAT instance (`NatProvider.instanceV2`, about $3–4 a
  month) instead of a managed NAT gateway (about $33). If the instance stops,
  outbound access stops until it's replaced. That's acceptable outside live.
  Live keeps managed NAT gateways, one per zone.
- **dev and qa share a base** (`PactlabNonliveBase`, in the dev account): one
  network, NAT instance, load balancer and Redis.
  - Each environment keeps its own database, secrets, KMS key, buckets, task
    roles, services and pause.
  - **Traffic:** its rules on the shared listener match its own host,
    `app.<env>.pactlab.ai`, in its own priority block (dev 100s, qa 200s). The
    pause's wake rule is host-scoped too, so pausing one environment never
    touches the other.
  - **Data:** its database admits only its own tasks' security group.
  - **Redis:** it uses its own logical database (dev `/0`, qa `/1`), so queues
    and keys never cross. The shared node admits both environments' task
    groups.
- **Stage stays separate,** shaped like live: its own network, load balancer
  and Redis, but with the NAT instance. It's the rehearsal for live, so it
  mustn't differ from live in ways that matter. Live never runs on shared
  infrastructure; the platform stack refuses it.
- **Cost (estimates):** dev and qa together about $50 a month while paused,
  stage about $40, live about $140. That's about $230 in total, against about
  $350 without these changes.

## Addendum (2026-11-01): the idle check replaces the alarm

The first version paused through a CloudWatch alarm on 60 idle minutes.
Re-arming that alarm at the end of a wake made it look back over the hour
the environment had just slept through, so it fired again at once. Dev paused
two minutes after waking up. A click during that pause then started a wake
while the database was still stopping: AWS refused the start, and the wake
waited for a database that never came.

- **Idle check every 5 minutes** (EventBridge → the power function). It
  pauses only if `power` is `awake` **and** has been for the whole idle
  window, **and** the API target group received no request in that window
  (CloudWatch `RequestCount`, which excludes health checks). An environment
  that has just woken can't be paused. There's no alarm and no pause state
  machine any more.
- **The wake recovers from a database that was still stopping.** If the
  database has stopped, the wake starts it again instead of waiting forever.

## Addendum (2026-11-02): Claude replaces Nova in dev and qa

Claude is now callable from the PactLab Dev account (the Anthropic use-case
form is on file), but not every model: the app's default routes (Sonnet,
Opus and Haiku 5.5), the rest of the Claude 5 family and Opus 4.7/4.8 return
"not available for this account". Until AWS enables them, dev and qa route
`balanced` to Sonnet 4.6, `deep_review` to Opus 4.6 and `fast` to Haiku 4.5
through `BEDROCK_MODEL_*` overrides, and the task role may call Claude only
(the Nova patterns are removed). The prompts were written for Claude, so the
Nova caveats above no longer apply. Remove `modelOverrides` in
`infra/cdk/config/{dev,qa}.ts` once `pnpm ai:check` passes on the defaults.

## Addendum (2026-11-04): stage for customer testing, and branch deploys

Decided with Kumar:
- **Stage runs in its own AWS account**, because customers may test there with real documents.
  - **Like live:** its own network (with a NAT instance), load balancer, Redis and SES identity; protected state; careful rollouts; sign-ups need approval.
  - **Unlike live:** it pauses when idle.
- **Branches:**
  - dev and stage deploy any branch;
  - qa (and live, later) deploy `main` only;
  - the deploy refuses otherwise, and warns when stage runs a branch.
  - **Promotion:** branch → dev → stage (customer tests) → merge → `main` → dev → qa → stage → live.
  - **One customer branch on stage at a time.** Behaviour for a single customer goes behind that organization's feature flags, never behind a long-lived branch.
- **Malware scanning: only live gets the managed scanner.** Stage runs the signature scanner like dev and qa. Real customer documents uploaded to stage get only the signature check; that is accepted for customer testing.
- **Real customer data never moves from stage to dev or qa.**

