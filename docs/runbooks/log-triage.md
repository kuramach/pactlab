# Live log triage

Errors in live are found by live itself (T-150, ADR 0045). Once a day a Lambda in the live account sweeps the app's logs, groups the errors, asks Bedrock for a verdict on each new or growing group, opens or updates one GitHub issue per group worth a look, and emails one digest to kumar@pactlab.ai. Nothing new or growing means no email: silence is healthy.

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

Label a `live-triage` issue **`triage-approved`**. `.github/workflows/triage-to-task.yml` then, with the repository's own `GITHUB_TOKEN`:
- checks the label came from an approver (repository variable `TRIAGE_APPROVERS`, default `kuramach`);
- computes the next free T-number from every task file under `tasks/` (suffixed ids such as `T-084c` count as 84);
- writes `tasks/ready/T-NNN.md` (`scripts/triage-to-task.cjs`): the title from the issue, `Touches:` guessed from the failing service, the cluster detail quoted as data, an `Issue:` line linking back;
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
