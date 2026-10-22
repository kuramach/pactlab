# AWS environments

On-demand detail for `CLAUDE.md`. Agents never deploy, create accounts or assume credentials.

| Profile | Local rights | Deploy path |
|---|---|---|
| `pactlab-dev` | Broad | Local or CI |
| `pactlab-qa` | Moderate | Local or CI |
| `pactlab-stage` | Read/plan | GitHub Actions |
| `pactlab-prod` | Read/plan | GitHub Actions |

- Use short-lived SSO credentials; never store long-lived AWS keys.
- Name one profile per command; verify account and region first.
- Run and inspect `cdk diff --profile <profile>` before every deploy; rerun after any revision, config, digest, context, or target change.
- Dev and QA deploy automatically after required checks and diff review.
- Stage and production require human approval; GitHub Actions owns deployment.
- Never deploy production locally.
- Promote signed artifacts by commit SHA and image digest without rebuilding.
- Run backward-compatible migrations as one-off tasks before rollout.
- Block deletion or replacement of protected production state.

### Local-first rule

Build and test locally until AWS is genuinely needed. Postgres and Redis run
in Docker; CDK stacks are synthesized (`cdk synth`) but never deployed before
T-007. Agents must not create AWS accounts, deploy stacks, or assume AWS
credentials exist. The only AWS touchpoint before T-007 is the optional EC2
box hosting the agent loop itself — and that is operator-run, never agent-run.
