# Runbooks

Operator procedures for the design-partner pilot. Each pilot control in
**Settings → Pilot controls** (`apps/web/app/(app)/settings`) links to one of
these files; a control marked _gap_ names the follow-up it needs.

Start with [pilot-controls.md](pilot-controls.md): the end-to-end description
of what a pilot partner gets, which controls protect them, and how we roll back.

| Runbook                                                              | Use when                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| [pilot-controls.md](pilot-controls.md)                               | Describing, starting or pausing a pilot               |
| [deploy.md](deploy.md)                                               | Any stage or production release                       |
| [rollback.md](rollback.md)                                           | A release, migration, flag or infra change misbehaves |
| [recovery-drill.md](recovery-drill.md)                               | Scheduled backup-restore drill, or real data loss     |
| [penetration-test-checklist.md](penetration-test-checklist.md)       | Before the pilot opens and after major changes        |
| [sso-setup.md](sso-setup.md)                                         | Onboarding a pilot organization's identity provider   |
| [access-review.md](access-review.md)                                 | Monthly membership review                             |
| [audit-export.md](audit-export.md)                                   | A partner or auditor requests audit evidence          |
| [retention.md](retention.md)                                         | Retention questions, purge requests, legal hold       |
| [metering.md](metering.md)                                           | Per-deal AI usage questions                           |
| [connector-outage.md](connector-outage.md)                           | A provider (Stripe, GitHub, VDR) is failing           |
| [stuck-queue.md](stuck-queue.md)                                     | Jobs not progressing or piling into dead-letter       |
| [failed-scan-cleanup.md](failed-scan-cleanup.md)                     | A scan workspace may not have been destroyed          |
| [suspected-cross-tenant-access.md](suspected-cross-tenant-access.md) | Any hint that one tenant saw another's data           |
| [invalid-ai-citations.md](invalid-ai-citations.md)                   | AI output cites something that does not resolve       |
| [object-store-exposure.md](object-store-exposure.md)                 | A bucket policy, ACL or presigned URL may expose data |

## Conventions

- Every command names exactly one AWS profile (`pactlab-dev`, `pactlab-qa`,
  `pactlab-stage`, `pactlab-prod`) and starts with
  `aws sts get-caller-identity --profile <profile>`.
- Local `pactlab-stage` and `pactlab-prod` sessions are read-and-plan only.
  Nothing in these runbooks deploys stage or production from a laptop.
- Never paste secrets, tokens, document text, source code or compensation data
  into tickets, chat or these files. Reference request ids and audit event ids.
- Record every incident action with UTC timestamps in the incident ticket.
