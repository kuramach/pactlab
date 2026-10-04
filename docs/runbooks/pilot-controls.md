# Pilot controls — limited design-partner pilot

What a design partner is promised, how each promise is enforced, and how we
pause or roll back. The same register is rendered in-app at
**Settings → Pilot controls**; keep both in step (the register's test fails
if a runbook it references is missing).

## Pilot shape

- **Who:** one to three buyer organizations, invite-only, each with named deal
  leads. No self-serve signup (`pilotMode: true`).
- **Where:** production environment (`PactlabProd`), single region `us-east-1`.
- **Data:** the partner's own deals. Sources start in `FIXTURE` mode for
  onboarding rehearsal on HealthyCo / TroubledCo / SparseCo; real deals use
  uploads. `LIVE` connectors stay **off** in production (`liveConnectors:
false`) until each adapter's live client is verified against the provider's
  documented API and passes stage dry-runs.
- **Out of scope for the pilot:** HRIS, Jira/Linear, people analytics,
  target sourcing, 100-day plans.

## End-to-end walk-through

1. **Onboard the organization.** Create the Auth0 organization and the
   Pactlab organization row; configure SSO ([sso-setup.md](sso-setup.md)).
   Record the organization id in the pilot tracker.
2. **Create the deal and memberships.** Deal lead invites analysts and
   reviewers; target contributors get `TARGET_CONTRIBUTOR` only. Every
   membership change is audited.
3. **Bring evidence.** Uploads (retention class chosen at upload), CSV, and —
   in fixture mode — Stripe, GitHub and VDR index adapters. Every evidence row
   carries organization and deal identity and resolves to its source.
4. **Review findings.** Claude drafts; reviewers accept or reject. An AI
   finding cannot be accepted without a resolvable citation and a named human
   reviewer.
5. **Value the deal.** Deterministic engines; accepted findings flow into the
   purchase-price bridge; changed findings mark scenarios stale; submissions
   are frozen and hashed.
6. **Evidence the controls.** On request, produce the audit export
   ([audit-export.md](audit-export.md)) and the latest access review
   ([access-review.md](access-review.md)).
7. **Close out.** At pilot end, apply the agreed retention outcome
   ([retention.md](retention.md)) and record it.

## Control register

| Control                    | Status             | Enforced by                                                            | Runbook                                                              |
| -------------------------- | ------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tenant isolation           | in place           | PostgreSQL RLS + allow/deny tests                                      | [suspected-cross-tenant-access.md](suspected-cross-tenant-access.md) |
| Single sign-on             | **gap**            | API validates Auth0 tokens + `org_id`; web sign-in not wired           | [sso-setup.md](sso-setup.md)                                         |
| Access review              | procedure          | Monthly, signed off                                                    | [access-review.md](access-review.md)                                 |
| Tamper-evident audit log   | in place           | Per-org hash chain; app role has SELECT/INSERT only                    | [audit-export.md](audit-export.md)                                   |
| Audit export               | **gap**            | Object Lock archive bucket provisioned; export endpoint not built      | [audit-export.md](audit-export.md)                                   |
| Document retention         | in place           | Retention class per upload; legal hold blocks purge; versioned storage | [retention.md](retention.md)                                         |
| VDR adapter                | in place (fixture) | Connector contract tests; live reads disabled                          | [connector-outage.md](connector-outage.md)                           |
| Pilot feature flags        | procedure          | `/pactlab/<env>/feature-flags` from CDK config                         | this file                                                            |
| Ephemeral code scans       | in place           | Workspace destroyed on success/failure/timeout/cancel                  | [failed-scan-cleanup.md](failed-scan-cleanup.md)                     |
| Per-deal AI metering       | **gap**            | Gateway emits usage per run; persistence not built                     | [metering.md](metering.md)                                           |
| Citation enforcement       | in place           | Domain + API tests                                                     | [invalid-ai-citations.md](invalid-ai-citations.md)                   |
| Protected production state | in place           | `StatefulProtectionAspect` fails synth                                 | [deploy.md](deploy.md)                                               |
| Deployment path            | procedure          | GitHub Actions + environment approval                                  | [deploy.md](deploy.md)                                               |
| Rollback                   | procedure          | —                                                                      | [rollback.md](rollback.md)                                           |
| Recovery drill             | procedure          | —                                                                      | [recovery-drill.md](recovery-drill.md)                               |
| Penetration test           | procedure          | —                                                                      | [penetration-test-checklist.md](penetration-test-checklist.md)       |

**Go/no-go:** the pilot may not open while any row is a **gap**, the latest
recovery drill is older than 90 days, or the penetration test has open
high/critical findings. The release owner records the decision and date.

## Feature flags (pilot guardrails)

Flags are data in `infra/cdk/config/<env>.ts` and are published to SSM
Parameter Store as `/pactlab/<env>/feature-flags` (JSON). There is no console
toggle: a flag change is a reviewed pull request deployed through the normal
release path, and rollback is a revert of that commit.

| Flag             | dev | qa  | stage | prod | Meaning                                   |
| ---------------- | --- | --- | ----- | ---- | ----------------------------------------- |
| `pilotMode`      | off | on  | on    | on   | Invite-only orgs; pilot guardrails active |
| `liveConnectors` | off | off | on    | off  | Whether a connection may switch to `LIVE` |

> Application wiring that reads these parameters at startup is a follow-up
> (outside T-007's scope). Until it lands, `LIVE` mode is unavailable because
> every live adapter is configuration-only.

## Pausing a pilot

1. Announce to the partner's named contact.
2. Revoke their deal memberships, or disable the Auth0 organization, so new
   sessions fail closed. Existing access tokens expire at their TTL.
3. Leave data and audit history untouched; record the pause in the tracker.
