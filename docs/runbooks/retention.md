# Retention

## In place

- Uploaded documents carry a retention class chosen at upload:
  `DEAL_TERM`, `SHORT_90D` (expires 90 days after upload) or `LEGAL_HOLD`
  (never expires). Purge removes the original and page text; legal hold blocks
  purge with a conflict error.
- Deleting a source never erases approved decision history: hashes, provenance
  and audit records remain.
- Evidence storage is versioned; noncurrent versions expire per environment
  (prod 90 days) so deletes are recoverable for that window.
- Audit archives are Object Lock–retained (prod: compliance, 7 years).
- Scan workspaces are destroyed after every scan; source code is never retained.

## Open items

Organization-level retention policy settings (defaults for evidence, AI
traces and scan artifacts) are a spec open question and need schema work
outside T-007. Until decided, pilot agreements state the classes above.

## Requests

- **Purge a document:** deal lead requests in-app; legal hold must be lifted
  first by the organization admin, with the reason recorded.
- **Legal hold:** set `LEGAL_HOLD` on affected documents; record matter and
  requester.
- **End of pilot:** agree with the partner which deals to purge; purge
  through the application so audit events are written; confirm noncurrent
  object versions age out per the lifecycle rule.
