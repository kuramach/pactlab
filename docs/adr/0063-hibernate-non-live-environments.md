# ADR 0063: Hibernate dev, qa and stage: delete what bills by the hour, keep what holds data and names, rebuild on demand (T-189)

**Status:** proposed (2026-11-27). This is the plan, for Kumar's approval; nothing is built yet. It amends ADR 0019 (idle pause; cheaper non-live environments).

## Context
- Kumar (2026-11-27): *"stage is still using hosting $. can we minimize it to zero?"* He chose **hibernate**, for **dev, qa and stage**. Live is untouched.
- **Today's pause** (ADR 0019, `infra/cdk/lib/idle-pause.ts`): after 60 idle minutes the services scale to zero and the database stops. Everything else keeps billing by the hour: Redis, the load balancer and its public addresses, the NAT instance and its Elastic IP, database storage and backups. AWS also restarts a stopped database after 7 days (a daily run stops it again).
- **What the code shows** (and the plan has to deal with):
  - **DNS is at Namecheap, not Route 53.** `app.<env>.pactlab.ai` is a CNAME to the load balancer's AWS name. A rebuilt load balancer gets a new name, so today's DNS can't survive a rebuild.
  - **Everything is in one stack per environment** (`Pactlab<Env>`): data key, buckets, all 16 secrets, the SES identity, the log group, the certificate, the database and the compute. dev and qa share `PactlabNonliveBase` (network, NAT, load balancer, Redis, both certificates).
  - **The database owner secret is the RDS-generated child of the instance** (`Credentials.fromGeneratedSecret`). Removing the instance removes its secret.
  - Stage is `protectedState`: termination protection, RETAIN on every stateful resource, RDS deletion protection, enforced by `StatefulProtectionAspect`.

## Decision (proposed)

### 1. One stack, two shapes
- Each non-live environment's stack synthesizes in one of two shapes, chosen by deploy context `pactlab:<env>:power=hibernated` (default `awake`):
  - **awake:** today's template, plus the always-kept pieces below;
  - **hibernated:** the same stack with the hourly resources left out.
- **Kept resources have the same construct paths, and so the same logical IDs, in both shapes.** Hibernating and waking are ordinary CloudFormation updates that only add or remove the hourly resources; nothing kept is ever replaced. A CDK test compares the two templates and fails if a kept resource's logical ID or properties differ between them.
- `PactlabNonliveBase` gets the same two shapes. It hibernates **only when both dev and qa are hibernated**, and wakes before whichever of them wakes first.
- `prod` has no hibernated shape: the config type doesn't allow it, the stack throws if asked, and a test asserts live's template is byte-identical to today's.

### 2. What is torn down and what stays

| | Torn down when hibernated | Kept |
|---|---|---|
| Compute | ECS cluster, services, task definitions, idle-pause machinery (power Lambda, wake state machine, idle and keep-stopped rules, the load-balancer wake page) | ECR repositories and images (`PactlabXRegistry`); the release images are pinned (§4) |
| Network | VPC, subnets, NAT instance and its Elastic IP, flow log, security groups | — |
| Load balancer | ALB (stage's own; dev and qa's shared one only when both sleep), listeners, rules, target groups | ACM certificates (stage's in its stack, dev's and qa's in the base) |
| Database | the RDS instance, its subnet group and parameter group, and its automated backups (deleted with `--delete-automated-backups`) | the **hibernate snapshot** and a **final snapshot**, both encrypted with the environment's data key and tagged `pactlab:environment` |
| Redis | the replication group and its subnet group (queues are emptied first, §4) | — |
| Data | — | evidence bucket and audit archive (versioned, retained), data KMS key, every Secrets Manager secret (the owner secret moved so it no longer belongs to the instance, §5), SSM parameters |
| Email | — | SES identity (DKIM unchanged), mail configuration set, SNS events topic |
| Names | — | the new Route 53 zone for the app host (§6), the environment's site (`<env>.pactlab.ai`), the new sleep page |
| Logs | — | the app log group, with retention cut to 7 days while hibernated (restored on wake); the RDS log group, with retention set (it has none today); log triage, which skips a hibernated environment |

### 3. Hibernate: `env-power.yml`, action `hibernate`
1. **Refuse live.** The workflow's environment input offers only dev, qa and stage, and the script refuses `prod`/`live` again. The role's trust (§8) never covers live.
2. **Quiesce.** If the environment is awake, run today's pause first (wake page on, services to zero). Set power to `hibernating`.
3. **Check the queues.** A one-off tools task reports BullMQ's waiting, delayed and active jobs. If any are found, the hibernate stops and nothing is deleted (`--drop-queues` overrides, and the summary records it). *This needs a small ops script in `apps/api/src/ops`, outside this task's `Touches:`; see decision 6.*
4. **Snapshot.**
   - Start the database if it is stopped, and wait.
   - Create the manual snapshot `pactlab-<env>-hibernate-<UTC timestamp>`, tagged `pactlab:environment=<env>`, and wait for `available`.
   - Verify: status is `available`, it's encrypted with the data key, and the engine version is recorded.
   - **If any of this fails, the run stops here: nothing has been deleted.** Power goes back to `paused`, and the summary says why.
5. **Record.** Write `/pactlab/<env>/hibernation` (SSM), holding:
   - the snapshot id;
   - the time it was taken;
   - the engine version;
   - the image tags the services ran (from `/pactlab/<env>/release`);
   - the latest migration name.

   Tag those images `keep-<env>-hibernated` (§4).
6. **Delete the database:**
   - stage: turn off deletion protection;
   - `delete-db-instance --final-db-snapshot-identifier pactlab-<env>-final-<ts> --delete-automated-backups`.

   The database's DeletionPolicy is RETAIN in every hibernatable environment, so CloudFormation never deletes it itself; this step is the only path that does, and it can't run without a verified snapshot (step 4). `protectedState` databases are therefore never deleted without a final snapshot.
7. **Deploy the hibernated shape.** For dev and qa, the base is deployed hibernated too only when the other environment's power is `hibernated`.
8. **Finish.** Set power to `hibernated`. Delete hibernate snapshots older than the last two. Write the run summary (`$GITHUB_STEP_SUMMARY`):
   - every resource deleted (from the change set);
   - every resource kept;
   - the snapshot ids;
   - the images pinned;
   - the estimated monthly cost from now on.

**Dry run** (`--dry-run`, or `dry_run: true` on the workflow) makes no AWS change.
- It lists, per environment, exactly what would be deleted and kept: the difference between the awake and hibernated templates, which needs no AWS call, plus the snapshot and database steps.
- With credentials it also shows the live change set (`cdk diff`).
- The same listing is produced by a pure function the CDK tests cover.

### 4. Wake: `env-power.yml`, action `wake`
1. Refuse live. Read `/pactlab/<env>/hibernation` and set power to `rebuilding`.
2. dev or qa: deploy the base awake if it's hibernated.
3. **Deploy the awake shape restored from the snapshot.**
   - The context includes `pactlab:<env>:restoreSnapshot=<id>`, so the stack uses `rds.DatabaseInstanceFromSnapshot` with the same logical ID and `SnapshotCredentials.fromSecret(<owner secret>)`.
   - The services run the **recorded image tags**, so code and schema match, and no migration is needed to serve.
   - Redis comes back empty. CloudFormation builds the network, NAT, Redis, database, load balancer and services in parallel where it can.
4. Wait for the targets to be healthy and run the smoke test. The DNS record flips back to the load balancer as part of the same deploy (§6).
5. **Record the restore.** Write `/pactlab/<env>/database-source` = the snapshot id. CloudFormation's documented rule: once an instance is restored with `DBSnapshotIdentifier`, every later update must name the same snapshot, or CloudFormation creates an empty instance and deletes the restored one. So:
   - `deploy.yml` always reads `database-source` and passes it;
   - the deploy **refuses** to run when the parameter exists but the context is missing;
   - a CDK test covers both.
6. Set power to `awake` (the idle pause then applies as today), and release the `keep-` tags of earlier hibernations.

- **Wake time, estimated:**
  - network and NAT instance: about 3–5 min;
  - database restore: about 10–20 min for 20–50 GiB;
  - Redis creation: about 8–12 min, alongside;
  - load balancer: about 3 min;
  - services healthy: about 3–5 min;
  - DNS: 60 s.

  About **30–40 minutes** end to end. It is measured on Kumar's first wake and written in the runbook.
- **Data and names come back unchanged:**
  - the database holds exactly what the snapshot held;
  - the buckets and secrets were never touched;
  - `app.<env>.pactlab.ai` and `<env>.pactlab.ai` keep their names.
- **Ways to wake:**
  - the sleep page's button;
  - `scripts/env-wake.sh <env>`;
  - `wake.yml` (extended to stage and to hibernated environments: it starts today's quick wake when paused, and this rebuild when hibernated).

### 5. The owner secret leaves the instance
- Today the RDS-generated owner secret is a child of the instance, so removing the instance would remove it (DESTROY in dev and qa).
- The fix: the secret becomes a stack-level `rds.DatabaseSecret`, with `overrideLogicalId` set to its **current** logical ID, and the instance uses `Credentials.fromSecret` with it. That keeps:
  - the same CloudFormation resource;
  - the same password;
  - no replacement.
- A test pins the logical ID. This ships, deployed and verified, before any hibernate runs.

### 6. DNS: a Route 53 zone per app host; a sleep page while hibernated
- **One hosted zone per app host,** kept in each shape: `app.dev.pactlab.ai`, `app.qa.pactlab.ai`, `app.stage.pactlab.ai`. Namecheap delegates each one with NS records, a one-time step for Kumar. The ACM validation records for the app hosts move into the zones first, so certificate renewal never breaks.
- **The zone apex is an alias A record,** part of the stack:
  - **awake:** it points to the load balancer;
  - **hibernated:** it points to the **sleep page**.

  Hibernate and wake flip it in their deploys. Alias queries to ELB and CloudFront are free.
- **The sleep page:**
  - a small CloudFront distribution, kept in both shapes, with its us-east-1 certificate requested by CLI (as for the environment sites, ADR 0003);
  - in front of a Lambda function URL that renders: *"This environment is asleep; it takes about 30–40 minutes to wake"* and a **Wake it up** button;
  - while rebuilding, it shows the wake's progress from the GitHub run's steps.
- **The button:**
  - **POST only** (crawlers never wake anything);
  - **one dispatch per hibernation** (keyed by the hibernation record's version);
  - dispatches `env-power.yml` through a fine-grained GitHub token (Actions: read and write, this repository only), kept in Secrets Manager as `pactlab/<env>/github-power`.
- **Rejected: CloudFront permanently in front of the app.** Its DNS would never change, but stage's request path would differ from live's, and stage is live's rehearsal.

### 7. Automatic hibernate after N idle days
- `env-power-idle.yml` runs daily. It dispatches a hibernate for any environment whose power has been `paused` for N days (read from the power parameter's last-modified time).
- **Proposed N:**
  - **dev and qa: 3 days;**
  - **stage: 7 days.** Customer testing on stage runs week to week, and a paused stage still costs about $3 a day.
- **Deploys to a hibernated environment** are refused by `deploy.yml` with "wake it first" (decision 4). A merge must never start a 40-minute rebuild by itself.

### 8. Who may run it
- **A new role per account,** `pactlab-github-<env>-power`, in the deploy-access stack:
  - trusted **only from the GitHub Environment `<env>-power` and only for the workflow `.github/workflows/env-power.yml` on `main`**, through GitHub's customizable OIDC subject, which can include `job_workflow_ref`. The exact claim template is to be verified against GitHub's docs at build time;
  - **allowed:** the database snapshot, delete and restore actions on this environment's instance and snapshots, and its power and hibernation parameters;
  - **may assume** the CDK bootstrap roles, as the deploy role does.
- **No role is created for live.**
- **Agents never run these workflows or touch AWS.** Kumar runs the first real hibernate and wake by following the runbook.

### 9. Cheaper while awake (dev, qa, stage; live unchanged)

| | Today | Proposed | Why |
|---|---|---|---|
| Stage database | `db.t4g.large`, Multi-AZ, 50 GiB, 14 days of backups | **`db.t4g.medium`, Single-AZ**, 50 GiB, **3 days** | Live itself is a single-AZ `t4g.medium` (ADR 0019, live skinny). Stage is live's rehearsal and carries less load (one task each, customer tests), so matching live's size is the honest rehearsal. Storage stays at 50 GiB, because RDS can't shrink allocated storage or restore a snapshot into less. The new class and Single-AZ apply on the first wake (a restore takes any class), with no extra outage. |
| Stage Redis | 2 × `cache.t4g.small`, failover | **1 × `cache.t4g.small`** | The queues are rebuildable (`protection.ts` already excludes Redis); a lost node means a restart, not lost data. |
| dev and qa backups | 7 days | **3 days** | |

### 10. Hosting cost page
- Admin → Hosting cost gains, per environment: its state (**awake**, **paused** or **hibernated**, with the time it entered it), the estimated monthly cost while hibernated (the §11 line items, published by CDK as `/pactlab/<env>/hibernated-cost`), and Cost Explorer's actual figure for that environment. Snapshots are tagged so that Cost Explorer counts them.
- The page runs on live, so a read-only role in the dev and stage accounts (`PactlabPowerRead`: `ssm:GetParameter` on those parameters only, trusted by live's API task role) lets it read their state.
- **This is `apps/api` and `apps/web` work, outside this task's `Touches:`** (decision 6).

## Cost while hibernated (us-east-2)
**Prices.** These come from AWS's Price List files for US East (Ohio) (`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/us-east-2/index.json`, published 2026-11-25, effective 2026-11-01), or from the service's pricing page where the price is the same in every region. All were read 2026-11-27.

| Item | Price | Source | Checked for us-east-2 |
|---|---|---|---|
| Secrets Manager secret | $0.40 / secret-month | AWSSecretsManager file, `USE2-AWSSecretsManager-Secrets` | yes |
| KMS customer managed key | $1.00 / key version-month (rotation adds $1 for each of the first two rotations, capped at $3) | awskms file, `us-east-2-KMS-Keys`; aws.amazon.com/kms/pricing | yes |
| ECR storage | $0.10 / GB-month | AmazonECR file, `USE2-TimedStorage-ByteHrs` | yes |
| S3 Standard (first 50 TB) | $0.023 / GB-month | AmazonS3 file, `USE2-TimedStorage-ByteHrs` | yes |
| CloudWatch Logs storage | $0.03 / GB-month (ingestion $0.50 / GB) | AmazonCloudWatch file, `USE2-TimedStorage-ByteHrs`, `USE2-DataProcessing-Bytes` | yes |
| DynamoDB storage | first 25 GB-month free, then $0.25 | AmazonDynamoDB file | yes |
| Route 53 hosted zone | $0.50 / zone-month (first 25; not prorated); alias queries to ELB and CloudFront free | aws.amazon.com/route53/pricing (global) | n/a, global |
| CloudFront | always-free tier: 1 TB out, 10 M requests, 2 M function invocations a month | aws.amazon.com/cloudfront/pricing/pay-as-you-go (global) | n/a, global |
| Lambda | free tier: 1 M requests and 400,000 GB-s a month | aws.amazon.com/lambda/pricing | yes (account-wide) |
| ACM public certificate | no cost | aws.amazon.com/certificate-manager/pricing | yes |
| Public IPv4 | $0.005 / address-hour, in use or idle | aws.amazon.com/vpc/pricing ("all commercial regions") | yes; none remain when hibernated |
| **RDS snapshot (backup) storage** | **$0.095 / GB-month: not confirmed for us-east-2.** AWS's blog cites it for US East; the RDS pricing page's table didn't render; the RDS price file is over the fetch limit | aws.amazon.com/blogs/database/demystifying-amazon-rds-backup-storage-costs | **no: confirm (below)** |
| SES domain identity | the pricing page lists no per-identity charge | aws.amazon.com/ses/pricing | not stated explicitly |
| SSM standard parameters, EventBridge scheduled rules | believed free; not checked | — | **no: confirm** |

**Line items while hibernated.** The amounts are estimates; data sizes are taken at their upper bound where they are unknown.

| Line | dev | qa | stage | Basis |
|---|---|---|---|---|
| Secrets | 17 × $0.40 = $6.80 | 16 × $0.40 = $6.40 | 17 × $0.40 = $6.80 | 16 per environment (owner, runtime, token, 3 AI keys, 3 signing, 6 document sources, RentCast), +1 log-triage token in dev and stage, + `credentials/*` per connected OAuth source (variable) |
| GitHub power token (new, §6) | $0.40 | $0.40 | $0.40 | |
| KMS data key | $1.00 | $1.00 | $1.00 | ECR uses the AWS-managed key (free); rises to $3 after two yearly rotations |
| Route 53 zone (new) | $0.50 | $0.50 | $0.50 | |
| RDS snapshot | ≤ $1.90 | ≤ $1.90 | ≤ $4.75 | ≤ allocated storage (20 / 20 / 50 GiB) × $0.095; actual is the data held, likely well under. Snapshots are incremental, so the final snapshot adds little. In the dev account, an awake neighbour's provisioned storage covers the other's snapshot (free backup storage up to the region's provisioned storage, per the same blog; to confirm) |
| ECR images | ≈ $0.30–1.50 | ≈ $0.30–1.50 | ≈ $0.30–1.50 | up to 20 images per repository (lifecycle), layers shared; measured in the runbook (`describe-images`) |
| S3, logs, DynamoDB, Lambda, CloudFront, ACM, SES | ≈ $0.00–0.20 | ≈ $0.00–0.20 | ≈ $0.00–0.20 | a few GB of documents, 7-day log retention, all within free tiers |
| **Total, estimated** | **≈ $9–12** | **≈ $9–12** | **≈ $9–15** | the low end with a small snapshot, the high end at allocated storage |

- **For comparison, today's pause costs** (confirmed prices; RDS storage and the NAT instance are not confirmed):
  - **stage:** Redis 2 × $0.032 × 730 h = $46.72; ALB $0.0225 × 730 = $16.43; 3 public IPv4 addresses = $10.95; secrets $6.80; KMS $1.00. That's **$81.90** before database storage, the NAT instance and backups, consistent with the brief's $90–110.
  - **dev and qa:** Redis $0.016 × 730 = $11.68; ALB $16.43; IPv4 $10.95; secrets $13.20; KMS $2.00. That's **$54.26** before database storage and the NAT instance.
  - **So hibernating all three takes roughly $150–180 a month down to roughly $27–39.**
- **Secrets are now the largest line.** Decision 5 would fold the 13 provider-configuration secrets (AI keys, signing, document sources, RentCast) into one JSON secret per environment. ECS reads fields by name, so the app is unchanged; the `scripts/*-key.sh` helpers would write fields. That brings each environment to about **$4–10 hibernated** (about $11–23 for all three).
- **Confirm before approving.** Kumar can check these with his profile, since the pricing API is read-only. RDS and EC2 couldn't be read here: their Price List files are over the fetch limit, and the pages render their tables in the browser.
  ```bash
  aws pricing get-products --region us-east-1 --service-code AmazonRDS --filters \
    Type=TERM_MATCH,Field=regionCode,Value=us-east-2 Type=TERM_MATCH,Field=productFamily,Value="Storage Snapshot"
  aws pricing get-products --region us-east-1 --service-code AmazonRDS --filters \
    Type=TERM_MATCH,Field=regionCode,Value=us-east-2 Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL \
    Type=TERM_MATCH,Field=instanceType,Value=db.t4g.medium   # and db.t4g.large; Single-AZ and Multi-AZ
  aws pricing get-products --region us-east-1 --service-code AmazonEC2 --filters \
    Type=TERM_MATCH,Field=regionCode,Value=us-east-2 Type=TERM_MATCH,Field=instanceType,Value=t4g.nano \
    Type=TERM_MATCH,Field=operatingSystem,Value=Linux Type=TERM_MATCH,Field=tenancy,Value=Shared \
    Type=TERM_MATCH,Field=preInstalledSw,Value=NA Type=TERM_MATCH,Field=capacitystatus,Value=Used
  ```
  The runbook records the confirmed figures, and the measured bill after the first full hibernated month.

## What breaks, and how each is handled

| What | Breaks because | Handling |
|---|---|---|
| **DNS** | The Namecheap CNAME points at the load balancer's AWS name, which changes on every rebuild | Route 53 zone per app host, delegated once from Namecheap; the stack flips its alias record (§6). The site (`<env>.pactlab.ai`) is unaffected |
| **Certificates** | The ALB certificate is detached while hibernated; ACM's managed renewal covers certificates that are in use, so a very long hibernation could let it lapse | Kept as a resource, so a wake inside its 13 months reattaches it. If it has lapsed, the wake replaces it and validates automatically in the Route 53 zone. The sleep page's us-east-1 certificate stays attached to CloudFront, so it renews |
| **OAuth redirect URIs** (Google, Microsoft, DocuSign, MCP and API clients) | — | Host names are unchanged, so registrations need no change. A sign-in while asleep lands on the sleep page |
| **SES identity** | Removing it would regenerate the DKIM tokens and need new Namecheap records | Kept in both shapes, along with the configuration set and the SNS topic. Nothing is sent while asleep. SNS events can't be delivered and are dropped after SNS's retries, as during today's pause; the API re-subscribes at startup (ADR 0032) |
| **Webhooks** (BoldSign, DocuSign Connect, Stripe test mode, SES via SNS) | No endpoint while asleep | Providers retry for a limited time, then give up. Signing converges on wake through the polling fallback (ADR 0036). Stripe events missed while asleep are resent from the Stripe dashboard if needed (runbook). Nothing customer-facing depends on them in dev, qa or stage |
| **Log triage** | No cluster to describe, no logs to sweep | The triage Lambda reads each environment's power and skips a hibernated one (a section in the digest says "hibernated"). The app log group is kept, with 7-day retention while hibernated |
| **Queues** (BullMQ in Redis) | Redis is deleted | Hibernate refuses while jobs are waiting, delayed or active (§3 step 3). Repeatable jobs re-register when the worker starts |
| **Sessions and sign-in** | — | Kept in the database. Trusted sessions expire after 24 idle hours anyway (ADR 0027) |
| **Deploys** | `deploy.yml` step 0 would try to wake a stack that has no wake machine | It refuses on a hibernated environment ("wake it first") and always passes `database-source` after a restore (§4) |
| **Images** | ECR keeps 20 images; a long sleep plus releases could expire the recorded ones | The recorded images are tagged `keep-<env>-hibernated`, and a lifecycle rule ahead of the count rule keeps that tag |
| **Engine versions** | A long sleep may outlive the snapshot's minor version | The wake restores on PostgreSQL 18 as configured. If RDS asks for a snapshot upgrade, the run stops and says so; the runbook gives the `modify-db-snapshot` step |
| **Cost Explorer** | Snapshots aren't CloudFormation resources, so they'd be untagged | The workflow tags them `pactlab:environment` |

## Guardrails (each with a test)
- **Refuse live everywhere:**
  - the config type has no hibernated shape for `prod`;
  - the stack throws;
  - the workflow input has no `live`;
  - the scripts refuse `prod` and `live`;
  - no power role is created in live's account.
- **CDK tests prove the hibernated shape:**
  - no VPC, NAT, ALB, ECS, RDS instance or ElastiCache resource;
  - every kept resource has the same logical ID and properties as when awake;
  - the zone alias points to the sleep page;
  - stage's template keeps termination protection and RETAIN everywhere;
  - live's template is unchanged.
- **Workflows create no live resources:**
  - a test parses `env-power.yml`, `env-power-idle.yml` and `wake.yml` and asserts that no `live` or `prod` value can reach them;
  - the role trust tests cover the rest.
- **Snapshot first:**
  - a failed or unverified snapshot stops the run before any delete;
  - the database's DeletionPolicy is RETAIN, so only the script deletes it, always with `--final-db-snapshot-identifier`.
- **Every run writes its summary:** deleted, kept, snapshot ids, pinned images, estimated cost.

## Decisions for Kumar
1. **DNS:** delegate `app.dev`, `app.qa` and `app.stage` to Route 53 zones ($0.50 each a month; one-time NS records at Namecheap). The proposal, against fronting the app with CloudFront permanently.
2. **Idle days before automatic hibernate:** dev and qa 3, stage 7 (proposed).
3. **Stage approval:** let the hibernate and wake workflows run without a reviewer through an `<env>-power` GitHub Environment whose role trusts only `env-power.yml` on `main` (proposed, so the sleep-page button works for a customer). The alternative is that stage's button waits for your approval.
4. **Deploy to a hibernated environment:** refuse with "wake it first" (proposed), or rebuild automatically.
5. **Fold the 13 provider-configuration secrets into one secret per environment:** 13 × $0.40 = $5.20 a month saved per environment. The values you set must be copied over, and a deleted secret's recovery window applies. Optional, its own PR.
6. **Scope:** the queue check (`apps/api/src/ops`) and the Hosting cost page (`apps/api`, `apps/web`) fall outside this task's `Touches:`. Widen `Touches:` to those paths, or file them as T-189b (proposed), with hibernate refusing until the queue check exists unless `--drop-queues` is given.
7. **Stage database:** `db.t4g.medium` Single-AZ, matching live; storage stays at 50 GiB.
8. **Snapshots kept:** the last two hibernations per environment (proposed).

## Build, once approved
- **PR 1 (CDK):**
  - the owner secret moved without replacement (§5);
  - the two shapes, the Route 53 zones, the sleep page;
  - database DeletionPolicy RETAIN;
  - stage's smaller database, single Redis node and 3-day backups;
  - log retention while hibernated;
  - the `keep-` lifecycle rule;
  - the power role;
  - tests.
- **PR 2 (operations):**
  - `env-power.yml` and `env-power-idle.yml`;
  - `wake.yml` and `deploy.yml` changes;
  - `scripts/hibernate-environment.sh` and `scripts/wake-hibernated.sh` (run in CI);
  - `scripts/env-hibernate.sh` and `scripts/env-wake.sh` (Kumar's one-liners over `gh workflow run`, with `--dry-run`);
  - the log-triage skip;
  - `docs/runbooks/hibernate.md`: the one-time Namecheap delegation, the first hibernate and wake step by step, the confirmed prices, and the measured wake time and bill.
- **T-189b (if decision 6 is accepted):** the queue check and the Hosting cost page.

## Consequences
- **Cost:** a hibernated environment costs about $9–15 a month (about $4–10 with decision 5) instead of the $55–110 it costs paused today.
- **Wake time:** about 30–40 minutes instead of 5–8.
- **Floor:** what remains is what holds data and names: secrets, the data key, snapshots, images and the DNS zones.
- **Rollback:**
  - wake every hibernated environment;
  - remove `pactlab:<env>:power` from the workflows;
  - the Route 53 delegation can stay, or Namecheap can go back to a CNAME pointing at the load balancer.

  Every CDK change in PR 1 is additive or keeps logical IDs, so the awake shape is today's stack plus the zone, the sleep page and the moved secret.
