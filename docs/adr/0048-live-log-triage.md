# ADR 0048: Live log triage runs in production, independent of the Mac mini (T-150)

**Status:** accepted (Kumar, 2026-11-22)

## Context
- Errors in live were found only when someone went looking, or when a user hit one.
- The agent loop runs on the Mac mini. It is a development machine and may be asleep or off; anything that only runs there can silently stop.
- Kumar's direction (2026-11-22): detection and triage run in production itself, review reaches him where he already works (email and GitHub), and approved findings enter the normal task queue.

## Decision
1. **Everything runs in AWS or GitHub.** A daily EventBridge schedule invokes one Lambda in the live account (`infra/cdk/lib/log-triage.ts`, handler under `infra/cdk/lambda/log-triage`). Its pieces are pay-as-you-go and already enabled in live: Logs Insights, Lambda, EventBridge, DynamoDB on demand, Bedrock and SES. No standing compute.
2. **Deterministic grouping, AI verdicts.** Code sweeps the logs since a stored watermark, clusters by a normalized signature and decides reportability by documented thresholds. Bedrock (one Converse call per reportable cluster, capped per run, prompt `log-triage@1`) only classifies and summarizes: `likely_bug`, `likely_noise` or `needs_human_eyes`. It decides nothing.
3. **Least privilege.** The Lambda's role starts queries on the live app's log group only; invokes the one triage model; reads its services' deployment history; sends email as the app's identity to the configured recipient only (`ses:Recipients`); reads its GitHub token; reads and writes its own table. No write access to any application resource.
4. **Scrub before anything leaves AWS.** Samples come from an allow-list of log fields (never request bodies), are capped and truncated, and lose credentials, emails (other than the operator's) and long hex and base64 runs.
5. **GitHub through a narrow token.** A fine-grained token, one repository, Issues read/write only, in Secrets Manager (`pactlab/live/github-triage`), set by `scripts/github-triage-key.sh`. Issues dedupe by a signature marker in the body.
6. **A person approves every task.** Only Kumar's `triage-approved` label turns an issue into a task file (`.github/workflows/triage-to-task.yml`, the repository's own `GITHUB_TOKEN`). The workflow commits the task file to `main`; it never opens a fix PR. The filed task goes through the loop's normal gates, so the Mac enters only when a task is built, and if it is off, tasks wait in `tasks/ready/`.
7. **Dry run first.** The Lambda ships in dry run (drafts to its log; nothing sent, opened or stored). Kumar reviews a dry run against real live logs, loads the token, then switches it off in config.

## Consequences
- Detection no longer depends on anyone looking, or on the Mac being awake.
- A task-file commit lands on `main` directly. It touches only `tasks/ready/`; if `main` gains branch protection, the workflow must open a PR instead.
- The `Touches:` of a filed task is a guess from the failing service; the agent stops and reports when the root cause is elsewhere.
- **Rollback:** disable the schedule, or remove `logTriage` from the live config and release; the table and secret are retained. Disable the workflow to stop tasks being filed.

## Addendum (T-157, 2026-11-26): pre-production reuses the live pipeline

Kumar's direction (2026-11-25): dev, qa and stage get the same daily triage, so bugs surface where they are introduced.

- **Reuse, not a fork.** The same Lambda code, queries, clustering, scrubbing, thresholds, prompt and digest rules, parameterized by environment (`TRIAGE_ENVIRONMENTS`). Live's deployment and template are unchanged; without that variable the code runs exactly as T-150 built it.
- **One deployment per account.** The dev account's (in `PactlabDev`) sweeps dev and qa, which share that account; stage's sweeps stage. Each environment keeps its own log group, state (key prefix), issue labels (`env-triage`, `env:<env>`), dedupe marker (which names the environment, so dev and live never share an issue) and digest section. The CDK refuses a deployment that would reach another account's environment or live.
- **Cluster-only mode.** An account without Bedrock access (dev, for now) names no model: no Bedrock permission, no model call, verdicts shown as unclassified. Setting `modelId` in config is the whole flip; there are no cross-account Bedrock calls.
- **One approval workflow** for both label families; an env-triage task names its environment.
- **Rollback:** remove `logTriage` from `config/dev.ts` or `config/stage.ts` and deploy that environment; live is unaffected.
