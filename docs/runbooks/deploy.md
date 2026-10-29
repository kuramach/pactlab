# Deploy

Stage and production are deployed **only** by GitHub Actions after the GitHub
Environment approval gate. Local `pactlab-stage` / `pactlab-prod` profiles are
read-and-plan only; a laptop cannot and must not deploy them.

## What the CDK app enforces

`infra/cdk` builds one `PactlabPlatformStack` per environment from
`config/{dev,qa,stage,prod}.ts`. For stage and production
(`protectedState: true`) synthesis **fails** unless:

- stack termination protection is on;
- every RDS instance/cluster, S3 bucket, KMS key and Secrets Manager secret has
  `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`;
- RDS deletion protection is on.

Account IDs are never committed. The workflow passes
`-c pactlab:<env>:account=<12-digit id>`; synthesis fails closed if the
active credentials resolve to a different account.

## Release procedure

1. Merge to `main` with green CI (lint, typecheck, unit, fixtures,
   integration, `cdk synth`).
2. Tag the release. Resolve the tag to its commit SHA and image digests.
3. Plan, read-only, with the target profile:

   ```bash
   aws sso login --profile pactlab-prod
   aws sts get-caller-identity --profile pactlab-prod
   pnpm --filter @pactlab/cdk exec cdk diff PactlabProd --profile pactlab-prod \
     -c pactlab:prod:account=<id>
   ```

4. Review the diff: resources added/changed/**replaced**/removed, IAM and
   security changes, stateful-resource risk. Any deletion, replacement or
   weakened protection of a stateful production resource stops the release —
   it is not approved through the ordinary workflow.
5. Store the full diff with the release record.
6. Dispatch the release workflow for the tag; an authorized reviewer approves
   the GitHub Environment gate.
7. The workflow runs the one-off migration task first; non-zero exit stops the
   release. Then application rollout with health checks and bake alarms.
8. Record environment, tag, SHA, digests, diff, run URL, operator, approver,
   timestamps, migration result and outcome in the deployment log.

If the code, config, context, digest or target account changes after the
diff was reviewed, rerun and re-review the diff.

## Application environments (ADR 0019)

The running application (web, api and worker on Fargate behind one HTTPS host)
is deployed by `.github/workflows/deploy.yml`, dispatched per environment
behind its GitHub Environment gate. The order is: images, then the release on
the one-off tasks only, then migrations, then the services. Dev is wired today;
the operator steps are in `docs/runbooks/environments.md`.

Stage and production get their service blocks in T-070 slice 2. Until then,
and until a managed malware scanner is wired (the app refuses the signature
scanner there), nothing runs in stage or production.
