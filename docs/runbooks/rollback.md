# Rollback

Pick the narrowest rollback that removes the fault. Never roll back by
deleting or replacing stateful resources.

| Change type                   | Rollback                                                                                                                                                                                         | Owner                       | Data impact   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------- |
| Application release           | Redeploy the previous release tag's recorded image digests via the release workflow. Web/API blue/green restores the last healthy task set automatically on failed health checks or bake alarms. | Release owner               | None          |
| Feature flag                  | Revert the config commit in `infra/cdk/config/<env>.ts`; release normally.                                                                                                                       | Release owner               | None          |
| Expand migration              | Leave it in place — expand steps are backward-compatible by rule. Roll back the application only.                                                                                                | Release owner + DB owner    | None          |
| Contract migration            | Not reversible by rollback. Must ship with a written compensating procedure reviewed before release; follow that procedure.                                                                      | DB owner                    | Per procedure |
| Infrastructure (non-stateful) | Revert the CDK commit; run `cdk diff`; release through the workflow.                                                                                                                             | Infra owner                 | None          |
| Infrastructure (stateful)     | Not via rollback. Termination protection, `Retain` and deletion protection keep the resource; restore from backup per [recovery-drill.md](recovery-drill.md) if data was harmed.                 | Infra owner + incident lead | Restore       |
| Connector misbehaviour        | Switch the deal connection back to `FIXTURE` (audited) or stop syncs; findings already accepted keep their lineage.                                                                              | Deal lead                   | None          |

## Procedure

1. Declare the incident; name the incident lead.
2. Identify the last known-good release tag from the deployment log.
3. Confirm no contract migration ran since that tag. If one did, stop and
   follow its compensating procedure instead.
4. Run `cdk diff` for the rollback target and review it like a release.
5. Dispatch the release workflow for the known-good tag; obtain approval.
6. Verify health checks, error rate, queue depth and a fixture smoke on the
   affected environment (QA/stage) or a read-only probe (production).
7. Record the rollback in the deployment log and incident ticket.

## Triggers

Roll back without waiting for root cause when: health checks fail after
bake; error rate or p95 latency breaches its alarm; any authorization,
tenancy or citation-enforcement test fails in post-deploy smoke; or audit
event writes fail.
