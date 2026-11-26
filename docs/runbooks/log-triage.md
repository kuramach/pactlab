# Log triage

Errors are found by each environment's own account: live since T-150, and dev, qa and stage since T-157 (ADR 0048), so bugs surface where they are introduced. The live pipeline is described first; [Pre-production](#pre-production-dev-qa-and-stage) covers what differs for dev, qa and stage.

Errors in live are found by live itself (T-150, ADR 0048). Once a day a Lambda in the live account sweeps the app's logs, groups the errors, asks Bedrock for a verdict on each new or growing group, opens or updates one GitHub issue per group worth a look, and emails one digest to kumar@pactlab.ai. Nothing new or growing means no email: silence is healthy.

Nothing here depends on the Mac mini. Approved issues become task files in `tasks/ready/`; if the Mac is off, they wait there.

## How it works

1. **Schedule.** EventBridge rule `pactlab-prod-log-triage`, daily at 13:00 UTC (`logTriage.hourUtc` in `infra/cdk/config/prod.ts`).
2. **Window.** From the watermark (the end of the last successful run) to now. The first run covers the previous 24 hours. A failed run stores nothing, so the next run sweeps its window again.
3. **Log groups.** `/pactlab/prod/app` holds every service, one stream prefix each: `api/`, `worker/`, `web/` (and the one-off `migrate/`). CDK keeps it a year (at least 30 days is required). The Lambda's own log (`/aws/lambda/PactlabProd-LogTriageFunction…`) is kept a month.
4. **Queries** (Logs Insights; the exact text is in `infra/cdk/lambda/log-triage/triage.js`, `QUERIES`):
   - 5xx responses: `message = "request failed"` (the API's exception filter) or a status of 500 and up;
   - failed worker jobs: `message = "job failed"`;
   - unhandled exceptions: lines saying unhandled or uncaught, and plain (non-JSON) lines naming an `…Error`;
   - error-level entries: pino `level >= 50`.
   A line is counted once, under the first of these that found it. Each query returns at most 10,000 rows; when one is capped, the digest says so and its counts are a floor.
5. **Clusters.** By signature: service, kind, the message with ids, numbers, quoted values, emails, URLs and times replaced, and the top application stack frame without its line number (or the error name and code when there is no stack). Each cluster has its count, first and last seen, services and up to three samples.
6. **State** (DynamoDB `pactlab-prod-log-triage`): per signature, first seen, last seen, total count, the count at its last report, status (the last verdict, or `pending_issue`) and its issue number; and the watermark (`pk = WATERMARK`).
7. **Bedrock.** At most 20 reportable clusters per run (`maxClusters`), new ones first, then by count; the rest wait for the next run and the digest says how many. One Converse call each (`us.anthropic.claude-sonnet-5-5`, prompt `log-triage@1`) with the signature, counts, first seen, the last 14 days of live deploys (ECS deployment history) and the scrubbed samples. It answers `likely_bug`, `likely_noise` or `needs_human_eyes`, a headline, a one-paragraph summary and, for a likely bug, a one-line fix sketch. A failed or malformed answer becomes `needs_human_eyes`.
8. **Issues.** For each `likely_bug` and `needs_human_eyes` cluster: if an open issue labelled `live-triage` carries its marker (`<!-- live-triage-signature: … -->`), a comment with the new counts; otherwise one new issue, `[live-triage] <headline>`, labelled `live-triage`, with the counts, first and last seen, samples, verdict, fix sketch and the Logs Insights query to reproduce it. A closed issue is never reopened: the signature coming back opens a new one.
9. **Digest.** One email: clusters to look at (new first, then by count), each with its summary, count, first seen, verdict, fix sketch and issue link; then a short **Classified as noise** section to audit the classifier.

## Thresholds

A cluster is reportable when it is **new**, or when its count since its last report reaches **50 more**, or **at least doubles** with at least **10 more** (so a cluster of 1 does not come back at 2). A cluster whose issue could not be opened (`pending_issue`) is reported again on the next run. Defaults live in `THRESHOLDS` in `triage.js`; changing one is a reviewed change.

## What leaves AWS

Samples are at most three lines of 300 characters. From a JSON line, only `time, service, level, message, errorName, code, type, statusCode, jobId, requestId`, `err.type`, `err.message` and three stack frames are kept: never a request body, headers, query or payload. Then authorization headers, bearer and basic credentials, key=value secrets, JWTs, GitHub, AWS and API keys, emails (other than kumar@pactlab.ai), and long hex and base64 runs are removed. The same scrub runs over the model's answer.

## Activation (Kumar)

1. **Labels**, once: `gh label create live-triage --color d93f0b --description 'Live log triage finding'` and `gh label create triage-approved --color 5319e7 --description 'Kumar: file as a task'`. (The workflow creates `task-filed` itself.)
2. **Deploy** (dry run is the default): the next release to live creates the Lambda, table, schedule and the `pactlab/live/github-triage` secret holding `unset`.
3. **Dry run.** Run it now rather than waiting for the schedule:

   ```bash
   aws sts get-caller-identity --profile pactlab-prod
   FN=$(aws cloudformation describe-stacks --stack-name PactlabProd --profile pactlab-prod --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='LogTriageFunctionName'].OutputValue" --output text)
   aws lambda invoke --function-name "$FN" --payload '{"dryRun":true}' --cli-binary-format raw-in-base64-out --profile pactlab-prod --region us-east-2 /dev/stdout
   aws logs tail "/aws/lambda/$FN" --since 15m --profile pactlab-prod --region us-east-2 --format short
   ```

   The log carries `dry run: digest` (the email that would be sent) and one `dry run: issue` per issue it would open or comment on. Nothing is sent, opened or stored, and the watermark does not move. Review it.
4. **Token.** Create a fine-grained token: resource owner kuramach, repository kuramach/pactlab only, permission **Issues: read and write** and nothing else, with an expiry. Load it: `scripts/github-triage-key.sh`. Its value never transits the repository.
5. **Go live.** Set `logTriage.dryRun: false` in `infra/cdk/config/prod.ts` and release. The next run sends one digest and opens deduplicated issues.

## Approval becomes a task

Label a `live-triage` or `env-triage` issue **`triage-approved`** (one workflow, both label families). `.github/workflows/triage-to-task.yml` then, with the repository's own `GITHUB_TOKEN`:
- checks the label came from an approver (repository variable `TRIAGE_APPROVERS`, default `kuramach`);
- computes the next free T-number from every task file under `tasks/` (suffixed ids such as `T-084c` count as 84);
- writes `tasks/ready/T-NNN.md` (`scripts/triage-to-task.cjs`): the title from the issue, `Touches:` guessed from the failing service, the cluster detail quoted as data, an `Issue:` line linking back; for an `env-triage` issue, also an `Environment:` line, and the title and body name the environment;
- commits it to `main` (retrying from the new `main` if someone pushed first), comments the task id on the issue and labels it `task-filed`.

Re-running it for the same issue files nothing new. A label, not a comment, is the trigger: it is one deliberate act only people with triage rights can perform, and the workflow ignores every other label. To dismiss a finding, close the issue; nothing runs. This system never opens a fix PR: the filed task goes through the agent loop's normal gates. If `main` is ever protected against direct pushes, the workflow's push fails visibly; give `github-actions` a bypass or switch it to opening a PR.

## Pause

- **Pause the schedule:** `aws events disable-rule --name pactlab-prod-log-triage --profile pactlab-prod --region us-east-2`. Resume: `enable-rule`. While paused nothing runs; on resume, the first run covers everything since the last successful one (one larger window, capped per query as above).
- **Stop issues only:** `scripts/github-triage-key.sh off`. Clusters that needed an issue stay `pending_issue` and the digest says the token is not set.
- **Back to dry run:** `logTriage.dryRun: true`, release.
- **Stop approvals filing tasks:** disable the workflow in GitHub (Actions → triage-to-task → Disable).

## Rotate the GitHub token

Create the replacement token (same scope), run `scripts/github-triage-key.sh`, then revoke the old one in GitHub. The Lambda reads the secret on every run; nothing restarts. If the token expires unnoticed, the digest says issues were not opened and they are retried once a valid token is loaded.

## Cost shape

Pay as you go, nothing standing but the schedule: Logs Insights at $0.005 per GB scanned over the window only (live writes well under 1 GB a day); one Lambda run a day (seconds to a few minutes); at most 20 Bedrock calls a day of about 1,500 tokens in and 300 out (cents); DynamoDB on demand and SES at a few requests a day; one Secrets Manager secret ($0.40 a month). Expect under $5 a month.

## Failure modes

- **No email for a while:** healthy, or the schedule is paused, or runs are failing. Check the rule (`describe-rule`) and the Lambda's log for errors; a failing run moves nothing, so the next good run catches up.
- **`Logs Insights query … ended Failed`:** usually a query-syntax change in the app's log format. The run fails and retries the window the next day.
- **Bedrock unavailable:** clusters still reach the digest as `needs_human_eyes (automatic triage unavailable)`, and issues are opened for them.
- **Duplicate issue:** someone removed the marker or the `live-triage` label from the open issue. Close the duplicate; the remaining issue keeps the marker.

## Pre-production (dev, qa and stage)

The same pipeline (T-157): the same Lambda code, queries, clustering, scrubbing, thresholds, prompt and digest rules, parameterized by environment. Nothing was forked; live's deployment is unchanged.

### Deployments: one per account

| Account | Stack | Sweeps | Verdicts | Schedule | Table | Token secret |
|---|---|---|---|---|---|---|
| live | `PactlabProd` | prod | Bedrock | `pactlab-prod-log-triage`, 13:00 UTC | `pactlab-prod-log-triage` | `pactlab/live/github-triage` |
| dev | `PactlabDev` | **dev and qa** | cluster-only, until dev Bedrock is enabled | `pactlab-dev-log-triage`, 13:00 UTC | `pactlab-dev-log-triage` | `pactlab/dev/github-triage` |
| stage | `PactlabStage` | stage | Bedrock (verified 2026-11-20) | `pactlab-stage-log-triage`, 13:00 UTC | `pactlab-stage-log-triage` | `pactlab/stage/github-triage` |

- **Config:** `logTriage` in `infra/cdk/config/dev.ts` and `stage.ts`, with `environments` naming what the deployment sweeps. qa has no `logTriage` of its own: dev's covers it (`/pactlab/qa/app` read by name, in the same account). The CDK refuses a deployment that would sweep live, an environment in another account, or one that has its own.
- **Deployed with its environment:** the next `deploy.yml` run of dev (or stage) creates it, in dry run. A qa deploy changes nothing here.
- **Separate per environment:** log groups, triage state (keys prefixed `dev#`, `qa#`, `stage#`; watermark `<env>#WATERMARK`), issue labels and digest section. Bedrock calls are capped at the top **10** reportable clusters per environment per run (`maxClusters`).
- **Role** (per account): StartQuery on its environments' app log groups only; Bedrock invoke on the triage model only, and only where `modelId` is set; SES send to the recipient only; read and write on its own table; read its token. No application write access and no cross-account role.
- **Deploy history** goes into the prompt for the environment whose stack holds the deployment. qa's services live in qa's stack, so its prompts say no deploys are known (only once dev has Bedrock).
- **Retention:** each app log group is kept at least 30 days (dev and qa a month, stage a year), so the first sweep after a long pause still finds what a short wake logged.

### Issues and digest

- **Issues:** `[env-triage:<env>] <headline>`, labels `env-triage` and `env:<env>`, the same body as a live issue plus an `Environment` row. The dedupe marker carries the environment (`<!-- env-triage-signature: qa 0123456789abcdef -->`): the same signature in dev, in qa and in live is three separate issues. A run looks only at open issues carrying both of that environment's labels.
- **Digest:** one email per account per day, from that account's SES to kumar@pactlab.ai, only when one of its environments has something reportable. Subject `Pactlab pre-production triage <date>: to look at dev N, qa M`; then one section per environment (`=== dev ===`, `=== qa ===`), never mixed: to look at, unclassified, and classified as noise (to audit the classifier). An environment with nothing says "Nothing new or growing."

### Idle pause

dev, qa and stage pause after an hour without use. The schedule runs regardless: a paused environment writes no logs, so it yields nothing reportable and no email ("env was quiet" is never sent). The watermark still moves. When the environment wakes and logs errors, the next daily run finds them; after a long pause of the triage itself, the first run covers everything since its environment's watermark, capped per query as above.

### Dev's cluster-only mode, and the Bedrock flip

Bedrock is not enabled in the dev account yet (Kumar's open item: the first-use form plus one CLI Converse there). Until it is, the dev deployment names no `modelId`: its role has no Bedrock permission and it makes no model call, in that account or any other. Clusters, counts, first and last seen and scrubbed samples are reported as usual, each verdict shown as **Unclassified — Bedrock not enabled in this account**, and issues are opened for them (a person decides; nothing is filed as noise).

**The flip**, once `pnpm ai:check` (or one Converse) answers in the dev account:

1. In `infra/cdk/config/dev.ts`, add `modelId: 'us.anthropic.claude-sonnet-5-5'` to `logTriage` (the account's default Claude route).
2. Deploy dev (`deploy.yml`, environment `dev`). The diff touches only the triage Lambda's `MODEL_ID` and one `bedrock:InvokeModel` statement on that model; no service image, app or qa resource changes.
3. Check with a dry-run invoke (below): the digest shows verdicts, not "unclassified".

No code changes. A cluster first reported unclassified is not re-triaged until it grows past the thresholds.

### SES per account

- **dev account:** the `pactlab.ai` identity is held by `PactlabDev` (qa sends as it). **stage account:** its own `pactlab.ai` identity.
- While an account's SES is in its sandbox, it delivers only to verified identities. Verifying the recipient is an activation step there:
  `aws sesv2 create-email-identity --email-identity kumar@pactlab.ai --profile pactlab-<dev|stage> --region us-east-2`, then click the link in the one confirmation email. Check with `aws sesv2 get-account --profile … --query ProductionAccessEnabled`.

### Activation, per account (Kumar)

1. **Labels**, once: `gh label create env-triage --color fbca04 --description 'Pre-production log triage finding'`, and one per environment: `gh label create env:dev`, `env:qa`, `env:stage`. (`triage-approved` exists from T-150.) GitHub would also create them on the first issue.
2. **Deploy** dev and stage as usual; each arrives in dry run with its secret holding `unset`.
3. **Dry run**, per environment (`environments` narrows a run to one; omit it for the whole account):

   ```bash
   P=pactlab-dev   # or pactlab-stage
   aws sts get-caller-identity --profile $P
   FN=$(aws cloudformation describe-stacks --stack-name PactlabDev --profile $P --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='LogTriageFunctionName'].OutputValue" --output text)
   aws lambda invoke --function-name "$FN" --payload '{"dryRun":true,"environments":["qa"]}' --cli-binary-format raw-in-base64-out --profile $P --region us-east-2 /dev/stdout
   aws logs tail "/aws/lambda/$FN" --since 15m --profile $P --region us-east-2 --format short
   ```

   (Stage: stack `PactlabStage`, `"environments":["stage"]`.) The log carries `dry run: digest` and one `dry run: issue` per issue, each with its `environment`. dev and qa dry runs show cluster-only output; stage's shows verdicts. Review each.
4. **SES:** verify the recipient if the account is sandboxed (above).
5. **Token:** `scripts/github-triage-key.sh dev stage` stores one token value (fine-grained, kuramach/pactlab only, Issues read/write) in both accounts, asked once. Or one at a time: `scripts/github-triage-key.sh dev`.
6. **Go live** per account: `logTriage.dryRun: false` in that account's config, then deploy it.

### Pause, per schedule

- **One account:** `aws events disable-rule --name pactlab-<dev|stage>-log-triage --profile pactlab-<dev|stage> --region us-east-2` (dev's pauses dev and qa together); `enable-rule` resumes. The first run afterwards covers each environment since its own watermark.
- **Issues only, one account:** `scripts/github-triage-key.sh dev off` (or `stage off`).
- **Back to dry run:** `logTriage.dryRun: true` in that account's config, deploy.
- **Stop approvals filing tasks** (both families): disable the triage-to-task workflow, as for live.

### Rotate a token

Create the replacement, run `scripts/github-triage-key.sh dev stage` (or `live dev stage`, for one token everywhere), then revoke the old one. Each Lambda reads its secret on every run.

### Cost shape

Per account as for live, smaller: logs scanned over the window only (paused environments write almost nothing), one Lambda run a day, no Bedrock in the dev account, at most 10 Bedrock calls a day in stage, and one secret ($0.40 a month). Under $2 a month per account.
