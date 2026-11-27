# Hibernate and wake dev, qa and stage

ADR 0063 (amends ADR 0019). Live is never hibernated: it isn't an option in any workflow, every script refuses it, and live's account has no power role.

## What happens

| After | State | What runs | Cost |
|---|---|---|---|
| use | **awake** | everything | as today |
| 60 idle minutes | **paused** (ADR 0019) | load balancer, NAT, Redis; database stopped, services at zero | stage about $82+, dev with qa about $54+ a month |
| 3 idle hours | **hibernated** | nothing that bills by the hour | about $9–15 a month per environment (below) |

- **Hibernate** (the `env-power` workflow, action `hibernate`):
  1. Pause the environment if it's awake.
  2. Run the queue check.
  3. Snapshot the database and verify the snapshot. **If anything fails here, the run stops before anything is deleted** and the environment stays paused.
  4. Record what the environment sleeps on: its images, schema and snapshot. Pin those images with `keep-…` tags.
  5. Delete the database, taking a final snapshot.
  6. Deploy the hibernated shape. The network, NAT instance, load balancer, ECS, database instance, Redis and the idle-pause machinery are removed. The buckets, data key, every secret, the SES identity, the DNS zone, the certificates, the log group (at 7 days) and the sleep page are kept.
  7. Keep the last two hibernations' snapshots and delete older ones.
- **dev and qa share a base.** It hibernates only when both are hibernated, and wakes with whichever wakes first.
- **Wake** (action `wake`):
  1. Restore the database from the hibernate snapshot.
  2. Redeploy the stacks on the images the environment slept on, so code and schema match and no migration runs.
  3. Smoke-test it and mark it awake.

  It takes **about 30–40 minutes** (estimate; measure it on the first wake and record it below). Data and DNS names come back unchanged.
- **The sleep page.** While hibernated, `app.<env>.pactlab.ai` shows *"This environment is asleep; it takes about 30–40 minutes to wake"* with a **Wake it up** button. The button starts the wake straight away with no approval (Kumar, 2026-11-27), at most once per hibernation, and then shows progress.
- **Deploys are refused** while hibernated: wake it first. A merge never starts a 40-minute rebuild on its own.

## Kumar's commands

```bash
scripts/env-hibernate.sh stage --dry-run            # what would be deleted and kept; offline, changes nothing
scripts/env-hibernate.sh stage --dry-run --remote   # the same in the workflow, with the live CloudFormation diff
scripts/env-hibernate.sh stage                      # hibernate now
scripts/env-hibernate.sh stage --drop-queues        # hibernate even with jobs queued (they're lost)
scripts/env-wake.sh stage                           # wake (rebuild if hibernated, the quick wake if paused)
```

Both use `gh workflow run …`, so you need `gh auth login` with access to the repository. Follow a run with `gh run watch`. Each run's summary lists what was deleted and kept, the snapshot ids, the images it pinned, and the time it took.

## One-time setup (Kumar)

Agents never run these steps or touch AWS.

1. **Merge and deploy** dev, qa and stage once as usual. That creates the Route 53 zones (`app.dev`, `app.qa`, `app.stage`.pactlab.ai), copies each load balancer certificate's validation record into its zone, and publishes `/pactlab/<env>/hibernated-cost`.
   - **Stage's first deploy is disruptive.** It moves stage's database from `db.t4g.large` Multi-AZ to `db.t4g.medium` Single-AZ with 3 days of backups, and Redis to one node. Those are in-place modifications with a few minutes of downtime. dev and qa only drop to 3 days of backups.
2. **Delegate the zones at Namecheap.**
   - For each app host, add NS records for `app.<env>` with the four name servers in the stack output `AppZoneNameServers` (`aws cloudformation describe-stacks --stack-name PactlabStage --query "Stacks[0].Outputs[?OutputKey=='AppZoneNameServers'].OutputValue"`).
   - Then remove the old `app.<env>` CNAME and its `_…` ACM validation CNAME at Namecheap. The zone answers for both now.
   - Check: `dig NS app.stage.pactlab.ai +short` lists the AWS name servers, and `curl -sI https://app.stage.pactlab.ai/health` answers.
3. **Request the sleep page certificate** in us-east-1, per environment, with that account's profile:
   ```bash
   aws acm request-certificate --region us-east-1 --profile pactlab-stage --domain-name app.stage.pactlab.ai --validation-method DNS
   aws acm describe-certificate --region us-east-1 --profile pactlab-stage --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   ```
   - The validation record is usually the same one the zone already holds (ACM reuses it per account and domain). If it differs, add it to the zone in the Route 53 console.
   - Wait for `ISSUED`.
4. **GitHub Environments.**
   - **`<env>` (dev, qa, stage):** add the variable `SLEEP_CERTIFICATE_ARN` (step 3's ARN), so every deploy keeps the sleep page.
   - **New `<env>-power` (dev-power, qa-power, stage-power):**
     - deployment branches: `main` only;
     - no required reviewers (wake needs no approval);
     - variables: `AWS_POWER_ROLE_ARN` (step 5), `AWS_ACCOUNT_ID` (the environment's account), `SLEEP_CERTIFICATE_ARN`.
5. **Deploy access.** This creates `pactlab-github-<env>-power`, and the read-only `pactlab-<env>-power-read` for live's Hosting cost page:
   ```bash
   PACTLAB_LIVE_ACCOUNT=<live account id> scripts/deploy-access.sh dev qa
   PACTLAB_LIVE_ACCOUNT=<live account id> scripts/deploy-access.sh stage
   ```
   - Take `PowerRoleArn` from each stack's outputs into its `<env>-power` environment.
   - On the GitHub Environment `live`, set `POWER_READ_ROLE_ARNS=dev=<arn>,qa=<arn>,stage=<arn>` (the `PowerReadRoleArn` outputs).
   - Then deploy live once, so its API may read them. That change only adds the read permission and an environment variable.
6. **The Wake up button's token.** Create a fine-grained GitHub token: repository `kuramach/pactlab` only, permission **Actions: read and write**, nothing else. Then run, per environment:
   ```bash
   scripts/github-power-key.sh stage < token.txt
   ```
   Until it's set, the button explains how to wake the environment from GitHub instead.

The scheduled check (`env-power-idle`, every 30 minutes) hibernates an environment once it has been paused for 2 hours (3 idle hours in all). Disable that workflow to stop automatic hibernation; manual hibernate and wake still work.

## The first hibernate and wake (Kumar)

1. `scripts/env-hibernate.sh dev --dry-run` and read the list. Then `--dry-run --remote` to see the CloudFormation diff.
2. `scripts/env-hibernate.sh dev`, then watch the run (about 15–25 minutes: the snapshot, the delete, the stack update).
3. Check:
   - `aws ssm get-parameter --name /pactlab/dev/power` is `hibernated`;
   - `https://app.dev.pactlab.ai` shows the sleep page;
   - the RDS console shows `pactlab-dev-hibernate-…` and `pactlab-dev-final-…`;
   - EC2 has no NAT instance (unless qa is awake: the shared base stays).
4. Press **Wake it up** on the sleep page (or `scripts/env-wake.sh dev`). Time it.
5. Check:
   - you can sign in;
   - a pact you had is there with its documents;
   - `/health` reports the release it slept on.
6. Record the measured times in the table below, then repeat for qa and stage.

| Environment | Hibernate took | Wake took | Date |
|---|---|---|---|
| dev | — | — | — |
| qa | — | — | — |
| stage | — | — | — |

## Cost while hibernated

Prices are from AWS's Price List files for US East (Ohio): `pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/us-east-2/index.json`, published 2026-11-25, effective 2026-11-01, read 2026-11-27. Where a price is the same everywhere, it's from the service's pricing page.

| Item | Price | Source |
|---|---|---|
| Secrets Manager secret | $0.40 / month | AWSSecretsManager file, `USE2-AWSSecretsManager-Secrets` |
| KMS key | $1.00 / month (up to $3 after two rotations) | awskms file, `us-east-2-KMS-Keys` |
| ECR storage | $0.10 / GB-month | AmazonECR file, `USE2-TimedStorage-ByteHrs` |
| S3 Standard | $0.023 / GB-month | AmazonS3 file |
| CloudWatch Logs storage | $0.03 / GB-month | AmazonCloudWatch file |
| Route 53 hosted zone | $0.50 / month; alias queries to ELB and CloudFront free | aws.amazon.com/route53/pricing |
| CloudFront, Lambda | free tier (1 TB, 10 M requests; 1 M requests) | their pricing pages |
| ACM public certificate | free | aws.amazon.com/certificate-manager/pricing |
| **RDS snapshot storage** | **$0.095 / GB-month: to confirm** | AWS database blog; the RDS price file was too large to read here |

Estimated monthly cost while hibernated. The CDK computes it from the secrets each stack really keeps (`infra/cdk/lib/hibernation-cost.ts`), and the Hosting cost page shows it per environment:

| | dev | qa | stage |
|---|---|---|---|
| Secrets (count × $0.40) | 19 → $7.60 | 17 → $6.80 | 19 → $7.60 |
| KMS key | $1.00 | $1.00 | $1.00 |
| Route 53 zone | $0.50 | $0.50 | $0.50 |
| Database snapshot | ≤ $1.90 (20 GiB) | ≤ $1.90 | ≤ $4.75 (50 GiB) |
| Images | $0.30–1.50 | $0.30–1.50 | $0.30–1.50 |
| S3, logs, Lambda, CloudFront | $0–0.20 | $0–0.20 | $0–0.20 |
| **Total** | **≈ $9.40–12.70** | **≈ $8.60–11.90** | **≈ $9.40–15.55** |

- **Secrets** include the sleep page's token and, in dev and stage, the log-triage token. The figures are what `scripts/env-hibernate.sh <env> --dry-run` prints.
- **Connected OAuth sources** each add $0.40 (`pactlab/<env>/credentials/*`).
- **The snapshot** is at most the allocated storage; usually it's far less.

Confirm the unconfirmed prices with your profile (the pricing API is read-only):

```bash
aws pricing get-products --region us-east-1 --service-code AmazonRDS --filters \
  Type=TERM_MATCH,Field=regionCode,Value=us-east-2 Type=TERM_MATCH,Field=productFamily,Value="Storage Snapshot"
```

After the first full hibernated month, record the measured bill from the Hosting cost page or `scripts/aws.sh cost`:

| Environment | Measured month | Amount |
|---|---|---|
| dev | — | — |
| qa | — | — |
| stage | — | — |

## What breaks, and how it's handled

- **DNS:** the app name is a Route 53 alias, flipped by the same deploy that changes the shape. The site, `<env>.pactlab.ai`, is unaffected.
- **Certificates** are kept. A wake reattaches the load balancer's. The sleep page's stays attached to CloudFront, so it renews.
- **OAuth redirect URIs:** the host names don't change, so nothing needs re-registering.
- **SES:** the identity and DKIM are kept. SNS events sent while asleep are dropped after retries, as during a pause.
- **Webhooks** (BoldSign, DocuSign, Stripe test mode) aren't answered while asleep. Signing catches up on wake through polling. Resend Stripe test events from its dashboard if needed.
- **Log triage** skips a hibernated environment, and its digest says so.
- **Queues:** a hibernate refuses while jobs are waiting, delayed or running. Use `drop_queues` to override.

## When something goes wrong

- **The hibernate stopped before the delete.** The summary says *"Stopped before deleting anything"*. The environment is paused, with its database as it was. Fix the cause (often a busy queue) and run it again.
- **The hibernate failed after the delete.** Run the hibernate again: it sees the database is gone and finishes from the recorded snapshot. To get the environment back now instead, set `/pactlab/<env>/power` to `hibernated` and wake it.
- **The wake failed.** Nothing was deleted, and the snapshot is untouched. The environment stays `rebuilding`, so the idle pause leaves it alone. Run `scripts/env-wake.sh <env>` again.
  - If CloudFormation rolled back after creating the restored database, that instance is retained (its policy is Retain). Delete it in the RDS console before waking again, or it keeps billing.
- **A snapshot needs an engine upgrade.** RDS refuses the restore. Upgrade the snapshot (`aws rds modify-db-snapshot --db-snapshot-identifier <id> --engine-version <v>`), then wake.
- **Never deploy a woken environment without its snapshot.** `deploy.yml` reads `/pactlab/<env>/database-source` and passes it on every run (`scripts/power-context.sh`). CloudFormation would replace a restored instance with an empty one without it. Don't delete that parameter while the environment is awake.

## Rollback

1. Wake every hibernated environment.
2. Disable `env-power-idle`.
3. Optionally, point `app.<env>` back at the load balancer with a CNAME at Namecheap, and remove the NS delegation.

The CDK changes keep every existing resource's logical ID, so the awake stacks are today's stacks plus the zone, the sleep page and the hibernated-cost parameter.

## Not done yet

- **Folding the 13 provider-configuration secrets into one per environment** (ADR 0063, decision 5, about $5 a month saved per environment). It's left for its own change. The values have to be copied over, the `scripts/*-key.sh` helpers have to write fields, and stage's retained secrets have to be deleted by hand.
- **The role trust.** The power role trusts the GitHub Environment `<env>-power`. It doesn't also check that the workflow is `env-power.yml`, because AWS conditions on GitHub's `job_workflow_ref` claim only after the repository's OIDC subject template is changed, and that would change the subject for every existing role. The Environment's deployment-branch rule (`main` only) carries that check instead.
