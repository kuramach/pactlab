# Penetration-test checklist

Scope a test against **stage** with synthetic tenants (HealthyCo, TroubledCo,
SparseCo) seeded into two separate organizations. No production data, no
production targets. The external vendor is still to be chosen (spec open
question); record vendor, dates and tester identities here per engagement.

## Before the test

- [ ] Written authorization naming vendor, stage endpoints, test window and
      emergency contact.
- [ ] Two test organizations with users in every role, including
      `TARGET_CONTRIBUTOR` and an organization admin.
- [ ] Alarms on; the on-call knows the window. No WAF or rate-limit changes
      to make the test pass.

## Test cases

**Tenancy and authorization**

- [ ] Cross-organization access by id guessing on every `/v1/deals/:dealId/*`
      route (deals, members, evidence, lineage, connections, sync runs,
      findings, documents, pages, questions, valuation, submissions).
- [ ] Cross-deal access within one organization without membership.
- [ ] `TARGET_CONTRIBUTOR` reaching buyer-only findings, valuation or terms.
- [ ] Token with a forged or missing organization claim; expired token;
      token from another Auth0 tenant.
- [ ] Direct database role checks: the app role cannot bypass RLS or update
      or delete audit events.

**Evidence and AI**

- [ ] Prompt injection embedded in an uploaded document and in VDR metadata
      (names, folder paths).
- [ ] Citation forgery: model output citing pages or documents from another
      deal or tenant.
- [ ] Accepting an AI finding without citation or without a human reviewer.
- [ ] Upload abuse: oversized, mislabelled media type, path traversal in
      names, malformed PDFs.

**Connectors**

- [ ] Connection config smuggling credentials or unexpected keys (configs are
      strict schemas).
- [ ] Switching a connection to `LIVE` when `liveConnectors` is off.
- [ ] Dry-run used to write evidence or exceed its bound.

**Infrastructure**

- [ ] Public reachability of RDS, Redis or S3 buckets.
- [ ] TLS enforcement on RDS (`rds.force_ssl`), Redis and S3 (`enforceSSL`).
- [ ] Presigned URL scope and lifetime.
- [ ] Secrets in logs, error bodies, bug records or client bundles.

## After the test

- [ ] Every finding triaged with severity, owner and due date.
- [ ] High and critical findings fixed and retested before the pilot opens.
- [ ] Report stored with restricted access; summary added to pilot controls.
