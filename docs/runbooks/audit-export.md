# Audit export

## What exists

- Every sensitive read, write, export, approval and denial appends an
  `audit_events` row: organization, deal, actor, action, target, outcome,
  request id, UTC timestamp.
- Rows form a per-organization **hash chain** (`chain_seq`, `prev_hash`,
  `hash`) assigned by a database trigger. `verifyAuditChain` in `@pactlab/db`
  recomputes a chain and reports the first broken link.
- The application database role has `SELECT, INSERT` only on `audit_events`;
  it cannot update or delete history.
- Each environment has an **audit archive bucket**: KMS-encrypted, versioned,
  S3 Object Lock with default retention (prod: compliance mode, 7 years).

## Gap

A signed, tenant-scoped export endpoint is not built (needs API and DB work
outside T-007). Until it lands, exports are an operator procedure.

## Interim export procedure

1. Confirm the request comes from the partner's named owner; record it.
2. With the read-only reporting role, select the organization's events for
   the requested window ordered by `chain_seq`. RLS scopes the session to one
   organization; never export across organizations.
3. Run `verifyAuditChain` over the full chain (not just the window). A broken
   chain is an incident — stop and escalate.
4. Write the export as JSON Lines with a manifest: organization id, window,
   first/last `chain_seq`, last `hash`, row count, export time, operator.
5. Compute SHA-256 of the file and the manifest; write both to the audit
   archive bucket under `exports/<organization-id>/<utc-timestamp>/`. Object
   Lock makes them immutable.
6. Deliver via a short-lived presigned URL to the named owner only. Record
   the delivery as an audit event.

Exports never contain document text, source code, secrets or compensation
data — audit rows hold identifiers, not content.
