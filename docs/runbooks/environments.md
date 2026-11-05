# Environments: dev on AWS (slice 1)

How the running application gets to AWS (ADR 0019). **Every step here is the
operator's (Kumar's).** Agents write the code, tests and this runbook; they
never create accounts, bootstrap, deploy or dispatch the workflow.

Today only **dev** has a running application. qa, stage and prod keep the
data-layer stack until slice 2 (T-070) adds their service blocks.

## What dev runs

| Piece | What | Size |
|---|---|---|
| Web | Next.js, Fargate ARM64 | 0.25 vCPU / 0.5 GB × 1 |
| API | NestJS, Fargate ARM64 | 0.5 vCPU / 1 GB × 1 |
| Worker | BullMQ imports, Fargate ARM64 | 0.25 vCPU / 0.5 GB × 1 |
| App host | `https://app.dev.pactlab.ai`: web; `/v1/*` and `/health` to the API | ALB + ACM certificate |
| Site | `https://dev.pactlab.ai`: the marketing site, Sign up / Sign in go to the app; never indexed | CloudFront + S3 (as `pactlab.ai`) |
| Data | Postgres 18 (t4g.medium), Redis (t4g.micro, TLS), S3 evidence bucket (KMS) | existing platform stack |
| Email | Amazon SES, `no-reply@pactlab.ai` | sandbox until you request production access |
| AI | Claude on Bedrock with the API's **task role**. No SSO, nothing expires. **Interim:** Sonnet 4.6, Opus 4.6 and Haiku 4.5 until AWS enables the app's default Claude 5.5 models for this account (ADR 0019 addendum) | |

Expected cost always on: about **$120–140 a month** (NAT ~$34, ALB ~$18, RDS t4g.medium ~$50, Redis micro ~$9, Fargate ~$20, logs and misc ~$5), plus Bedrock usage. Tear down when idle (below).

## Account and region facts

- Dev is the **PactLab Dev** account (`379959319207`). The CLI reaches it from the management login: `aws login --profile pactlab-mgmt`, then `--profile pactlab-dev` (role profile; its source profile is `pactlab-mgmt`).
- Region **us-east-2**. The organization's guardrail (SCP) allows CloudFormation only there (ADR 0003 amendment).
- Bedrock uses the **US cross-Region inference profiles** for Claude (`us.anthropic.claude-*`). These can route requests to other US Regions. If the guardrail also denies Bedrock in those Regions, AI calls fail. Step 7 checks this before you rely on it.
- This account already holds GitHub's OIDC provider (the site's deploy access). The dev deploy access reuses it (`-c pactlab:dev:githubOidc=existing`).

## First time (in order)

```bash
# 0. Sign in (opens a browser), then confirm the target account.
aws login --profile pactlab-mgmt
aws sts get-caller-identity --profile pactlab-dev        # must be 379959319207

# Shorthand for the commands below
CDK="pnpm --filter @pactlab/cdk exec cdk --profile pactlab-dev -c pactlab:dev:account=379959319207 -c pactlab:dev:githubOidc=existing"

# 1. CDK bootstrap in us-east-2 (already done for the site, so re-running is harmless).
pnpm --filter @pactlab/cdk exec cdk bootstrap aws://379959319207/us-east-2 --profile pactlab-dev

# 2. Image registry and the GitHub deploy role (no image tag needed yet).
$CDK diff PactlabDevRegistry PactlabDevDeployAccess
$CDK deploy PactlabDevRegistry PactlabDevDeployAccess
#    Note the output DeployRoleArn (role pactlab-github-dev-deploy).
```

3. **GitHub Environment `dev`** (Settings → Environments → New): add yourself as required reviewer, limited to `main`. Variables:

   | Variable | Value |
   |---|---|
   | `AWS_ACCOUNT_ID` | `379959319207` |
   | `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` output |
   | `APP_DOMAIN` | `dev.pactlab.ai` |
   | `APP_ENV` | `dev` |

4. **Bedrock model access** (console → Bedrock → Model access, us-east-2): enable the Anthropic Claude models the app uses (Sonnet, Opus and Haiku 5.5), if not already on.

5. **Deploy:** Actions → **deploy** → Run workflow → `dev`, then approve.
   - The first run creates the database, the services (at zero tasks), runs the migrations, then starts the services.
   - **While it runs**, it waits on the TLS certificate. Open ACM in us-east-2, find the certificate for `dev.pactlab.ai` and add its **CNAME** at Namecheap (step 6). The deploy continues once ACM validates it, usually within minutes.

6. **DNS at Namecheap** (pactlab.ai):

   | Record | Host | Value | Why |
   |---|---|---|---|
   | CNAME | the ACM validation name | the ACM validation value | certificate |
   | CNAME | `dev` | the `LoadBalancerDns` output | the app |
   | CNAME ×3 | the `SesDkimRecord1..3` names | their values | SES can send as pactlab.ai |

7. **Check AI from inside AWS.** After the deploy, open `https://dev.pactlab.ai`, sign in, open any document and run AI filing. If it reports AI unavailable, the API logs (CloudWatch `/pactlab/dev/app`, stream `api/…`) name the denied action. A guardrail denial on Bedrock in another Region means the SCP must allow `bedrock:*` in the US Regions the inference profile uses. That change is yours, in the management account.

8. **Email.** SES starts in the **sandbox**: it delivers only to verified addresses.
   - Now: SES → Verified identities → create identity → **Email address** for each inbox you'll use. With step 9, that's `you+charlie-lead@…` and `you+charlie-reviewer@…`, plus your own address for sign-up.
   - Later: SES → Account dashboard → **Request production access**, to email anyone (e.g. bidders).

9. **Seed the synthetic demo** (dev and qa only; refused elsewhere). Run the seed task once, with your inbox:

   ```bash
   OUT=$(aws cloudformation describe-stacks --stack-name PactlabDev --profile pactlab-dev --region us-east-2 --query 'Stacks[0].Outputs' --output json)
   get() { echo "$OUT" | node -e "let o=JSON.parse(require('fs').readFileSync(0));console.log(o.find(x=>x.OutputKey==='$1').OutputValue)"; }
   aws ecs run-task --profile pactlab-dev --region us-east-2 --cluster "$(get ClusterName)" \
     --task-definition "$(get SeedTaskDefinition)" --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[$(get AppSubnets)],securityGroups=[$(get AppTaskSecurityGroupId)],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"seed","environment":[{"name":"DEMO_INBOX","value":"you@example.com"}]}]}'
   ```

   Then sign in at `https://dev.pactlab.ai/login` as `you+charlie-lead@example.com`. The code arrives by email.

## Each environment's site and app (2026-10-30)

Every environment uses the same layout as live (ADR 0019 addendum):

| Environment | Site | App |
|---|---|---|
| live (prod) | `pactlab.ai` (+ `www`) | `app.pactlab.ai` |
| stage | `stage.pactlab.ai` | `app.stage.pactlab.ai` |
| qa | `qa.pactlab.ai` | `app.qa.pactlab.ai` |
| dev | `dev.pactlab.ai` | `app.dev.pactlab.ai` |

**Moving dev to this layout (one time, operator):**
1. **App DNS first.** At Namecheap, add a CNAME `app.dev` pointing to the load balancer, the same value as today's `dev` record.
2. **Site certificate** (CloudFront needs it in us-east-1):
   ```bash
   aws acm request-certificate --region us-east-1 --domain-name dev.pactlab.ai --validation-method DNS --profile pactlab-dev
   aws acm describe-certificate --region us-east-1 --profile pactlab-dev --certificate-arn <arn> \
     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   ```
   Add the validation CNAME at Namecheap.
3. **GitHub Environment `dev`:** set `APP_DOMAIN=app.dev.pactlab.ai`, `SITE_DOMAIN=dev.pactlab.ai`, `SITE_CERTIFICATE_ARN=<arn>`, and optionally `SITE_CONTACT_EMAIL`.
4. **Deploy.** The app's certificate is replaced for `app.dev.pactlab.ai`, so add its validation CNAME when ACM (us-east-2) shows it. The deploy then publishes the site and prints its CloudFront address.
5. **Site DNS:** change the `dev` CNAME to the site's CloudFront address (`d…cloudfront.net`).
6. **SES production access** (SES → Account dashboard) lets sign-up codes reach any address. Until then, only addresses verified in this account receive codes.

Sign-up in dev is approved automatically: a new organization is active once its email is confirmed.

## Idle pause (dev, qa, stage)

Only production runs all the time. Every other environment pauses after **an hour with no API request**:
- its services scale to zero and its database stops;
- its addresses, DNS, Redis and site stay as they are.

**Waking it** takes about 5–8 minutes, and the data is all there. Any of these works:
- **The wake page.** Open `https://app.<env>.pactlab.ai`. While paused it shows a page with a **Wake it up** button, which works from a phone, and refreshes until the app is back.
- **The wake workflow:** GitHub → Actions → **wake** → the environment.
- **A deploy.** Its first step wakes a paused environment.
- **The command line**, with the account's credentials: `AWS_REGION=us-east-2 scripts/wake-environment.sh dev`.

**Checking the state:**
```
aws ssm get-parameter --name /pactlab/dev/power --profile pactlab-dev --region us-east-2 --query Parameter.Value --output text
```
It returns `awake`, `paused` or `waking`. The Step Functions console shows each wake under `pactlab-dev-wake`. Pauses come from the idle check (Lambda `…IdlePausePowerSteps…`, every 5 minutes), whose logs say why it did or didn't pause.

AWS restarts a stopped database after 7 days. A daily run stops it again while the environment is still paused.

## Shared non-live base (dev and qa)

dev and qa share one network (with a NAT instance), one load balancer and one Redis, in `PactlabNonliveBase` in the dev account (ADR 0019). Each still has its own database, secrets, buckets, services and pause. Deploys of dev or qa deploy the base first; that's a no-op when it hasn't changed.

**Moving dev onto it (one time; synthetic data only).** The database moves to the new network, so dev is rebuilt and re-seeded:
1. `cdk deploy PactlabNonliveBase` (dev profile and account context). ACM shows a validation CNAME for `app.dev.pactlab.ai` on the new load balancer; add it at Namecheap.
2. `cdk destroy PactlabDev`. The database leaves a final snapshot.
3. Dispatch the deploy, then run the seed task.
4. Namecheap: point `app.dev` at the base's `LoadBalancerDns`, a new address.

**Monthly cost (estimates):**

| | Always on | Paused |
|---|---|---|
| live | ~$140 | never pauses |
| stage (own, NAT instance) | ~$110 | ~$40 |
| dev + qa (shared) | ~$150 | ~$50 together |

## Every later deploy

Actions → **deploy** → `dev` → approve. The workflow:
1. Builds and pushes the images for the commit: `server` (api and worker, slim), `server:<sha>-tools` (migrate and seed) and `web`. It skips images already pushed.
2. Ships the release to the migration task, with the services still on the old image.
3. Runs the migrations, and stops on failure.
4. Moves the services, waits for them, then smoke-tests `/health` and `/login`.

ECS circuit breakers roll a failing service back on their own. In dev and qa the worker is replaced in place (the old task stops first; queued jobs wait in Redis), while api and web start the new task before stopping the old one.

Only what changed moves. The plan compares each service's running commit (stack outputs `WebImageTag`, `ApiImageTag`, `WorkerImageTag`, `ToolsImageTag`) with the release (`scripts/service-changed.sh`); an unchanged service keeps its image and is not touched, and its image is not rebuilt. **Run with `full`** to rebuild and move everything.

In dev and qa the deploy moves the worker itself, alongside the stack update (`scripts/roll-worker.sh`): the worker service names its task family, so CloudFormation registers the new revision without waiting minutes for ECS to call the worker steady. If the stack update fails, the script puts the worker back on its previous revision.

**Rollback:** dispatch the workflow on the earlier commit. Migrations are expand-only (backward compatible), so the old code runs on the newer schema.

## Stage: customer testing

Stage is its own AWS account, shaped like live (own network, load balancer, Redis and SES; protected state; careful rollouts; sign-ups need approval) and paused when idle. Customers may test there with real documents, so its data never moves to dev or qa. It runs the signature malware scanner like dev and qa; only live gets the managed scanner.

### Testing a customer's branch

1. Work on a branch, for example `feat/acme-reports`. Customer-only behaviour goes behind the customer organization's feature flags, never behind the branch itself.
2. Actions → **deploy** → *Use workflow from* your branch → `dev`, and check it there.
3. The same with `stage`. It waits for your approval, warns that stage now runs a branch, and the customer tests on app.stage.pactlab.ai.
4. When they approve: merge the PR, then deploy `main` to dev → qa → stage (→ live).

Rules:
- **One customer branch on stage at a time.** Merge it, or redeploy `main`, before the next.
- **Migrations on a branch:** stage then has that schema until it merges. Migrations are expand-only, so `main` still runs on it.
- **qa takes `main` only**; the workflow refuses a branch.

### First time (Kumar; agents never create accounts)

1. **AWS account:** AWS Organizations → *Add an AWS account* → **PactLab Stage**. Note its 12-digit ID.
2. **Profile:** add it to `~/.aws/config`. Accounts created by Organizations already have `OrganizationAccountAccessRole`.
   ```
   [profile pactlab-stage]
   role_arn = arn:aws:iam::<STAGE_ACCOUNT_ID>:role/OrganizationAccountAccessRole
   source_profile = pactlab-mgmt
   region = us-east-2
   ```
   Check it with `aws sts get-caller-identity --profile pactlab-stage`.
3. **Prepare the account for CDK:** `scripts/bootstrap-account.sh stage`.
4. **Deploy role:** `scripts/deploy-access.sh stage`. Note the output `DeployRoleArn` (role `pactlab-github-stage-deploy`).
5. **GitHub:** Settings → Environments → **New environment** `stage`.
   - **Required reviewers:** you.
   - **Variables:**
     - `AWS_ACCOUNT_ID` = the stage account ID
     - `AWS_DEPLOY_ROLE_ARN` = the role from step 4
     - `APP_ENV` = `stage`
     - `APP_DOMAIN` = `app.stage.pactlab.ai`
     - `SITE_DOMAIN` = `stage.pactlab.ai`
     - `SITE_CERTIFICATE_ARN`: added once the site certificate exists, as for dev
6. **First deploy:** Actions → **deploy** → `main` → `stage` → approve. It stops at the certificate until DNS validates. In ACM (us-east-2) and in SES, copy the CNAME records it asks for into Namecheap: the certificate for `app.stage`, and SES's DKIM records for `pactlab.ai`, which sit beside dev's.
7. **Point the names:** in Namecheap, point `app.stage` at the stack output `LoadBalancerDns` and `stage` at the site's CloudFront domain. Then deploy again.
8. **AI:** in the stage account's Bedrock console, submit the Anthropic use-case form (as for dev), then run `pnpm ai:check` with that profile.
9. **Email:** request SES production access for the stage account (new accounts start in the SES sandbox).

## Logs and access

- Logs go to CloudWatch `/pactlab/dev/app`, with streams `web/`, `api/`, `worker/`, `migrate/` and `seed/`. They contain no secrets, codes or document text.
- Database credentials live in Secrets Manager: the RDS owner secret, `RuntimeDatabaseSecret` and `AuthTokenSecret`. ECS injects them; nothing is in the images.

## Cost control: tear dev down and bring it back

Dev is unprotected by design (`protectedState: false`).

```bash
$CDK destroy PactlabDev
```

This removes the services, load balancer, database (after a final snapshot), Redis and buckets. The registry and deploy role stay. To bring dev back, dispatch the deploy again; it behaves like the first run, then seed again.

## Known gaps (slice 2 and later)

- **Malware scanning:** dev, qa and stage use the built-in signature scanner (`MALWARE_SCANNER=signature`); the app refuses it in production. A managed scanner (GuardDuty Malware Protection for S3) is required before live.
- **Other environments:** qa, stage and prod get their service blocks, domains (`qa.`, `stage.`, `app.pactlab.ai`), deploy roles, Auth0 registration (prod on its own tenant) and cost band in slice 2 (T-070).
- **Auth0 in dev:** email-code sign-in works without it. To add Auth0, register `https://dev.pactlab.ai` callbacks on the dev tenant and add the web's Auth0 settings as secrets.
