# ADR 0039: Withdrawing an import, and re-importing: auditability beats tidiness (T-154)

**Status:** accepted (2026-11-24)

## Context
- **The need:** imports now land data that metrics, pack checks and valuation read (ADR 0004, 0010, 0038). People import the wrong file or the wrong version and need to take it back and import again.
- **Kumar's question** (2026-11-24): how does deleting an import work with the audit trail?
- **The constraint:** nothing silently disappears from Pactlab. Any number someone saw earlier has to stay explainable: which rows it came from, which file, who imported it and when it stopped counting (spec §5 invariant 5).

## Decision
1. **No hard delete.** Withdrawing is a change of state. The upload becomes `WITHDRAWN`, and the row records who did it, when and a required reason (3–500 characters, enforced by a CHECK).
   - **What stays readable:** the record, its stored file, its mapping and its row counts, in the import's history.
   - **Who can do it:** manage rights only (`DEAL_WRITE`: deal lead and analyst). Counterparties and readers cannot.
   - **What can be withdrawn:** only an imported upload. One that was never imported is cancelled (ADR 0004) instead.
2. **Derived data is voided, not removed.** Each sync run now records every evidence item it read (`sync_run_evidence`, backfilled from first and last runs). Withdrawing voids (`evidence_voids`) the items that this upload's run read and that no other imported upload still reads.
   - **What a void holds:** a pointer to the withdrawn upload, plus when and who.
   - **Never deleted.** A later import that reads the same record again restores it: `restored_at` and `restored_by_upload_id` are written on the void row, and the row stays as history.
3. **One read rule, enforced by a contract test.**
   - **The rule:** an item is void while it has an unrestored void. Every read path that turns evidence into numbers, checks or exports filters with `ACTIVE_EVIDENCE` (Prisma) or `ACTIVE_EVIDENCE_SQL` (raw SQL), from `@pactlab/db`. That covers metrics (and so valuation inputs), pack evidence for rules and pack metrics, customer gaps, engineering activity, the evidence browser, claim and finding citations, and source counts.
   - **The test:** `apps/api/src/voided-evidence.test.ts` fails the build on any `evidenceItem` read, or raw `evidence_items` SQL, that has neither the filter nor a `// void-ok: <why>` note.
   - **The allowed exceptions:** reading one item by id, lineage, and ingestion identity. These keep resolving so that citations still explain what was seen.
   - **Older versions come back:** filtering happens before the "newest version per record" step. If a withdrawn file had superseded a record, the earlier version, still held by an active import, counts again.
4. **Artefacts are flagged, never rewritten.**
   - **Findings:** a finding is flagged "source withdrawn" when it cited an item before that item's import was withdrawn (`voided_at ≥ link.created_at`). The flag stays after a restore, because what the finding rested on was withdrawn.
   - **Valuation runs:** a run is flagged when a finding behind one of its adjustments carries a withdrawal made after the run. The run's stored inputs and result stay untouched, so it can still be reproduced.
   - **Where it shows:** the flags appear on the finding (list and detail), on the valuation scenario, and in the pact report's findings.
   - **What is refused:** new findings and claims cannot cite voided evidence.
   - **Re-running** after a re-import produces fresh artefacts that carry no flag.
5. **A re-import is a new import with a lineage.**
   - **How it's recorded:** `source_uploads.supersedes_upload_id` points back at the withdrawn upload, and a unique index allows at most one successor. The inverse relation gives "superseded by".
   - **Where the data comes from:** a corrected file, or the stored original again (for example when the mapping was wrong). It keeps the predecessor's visibility.
   - **Mapping:** the withdrawn import's confirmed mapping is offered again wherever it still fits. A person confirms it before anything is imported.
   - **The import runs afresh:** an upload that re-imports, or that has the same bytes as a withdrawn file, gets its own idempotency key. That way it holds its own records instead of replaying the withdrawn run.
   - **What the history shows:** v1 withdrawn (with reason) → v2 active.
6. **Audit, in the existing chain and vocabulary:**
   - `source_upload.created`;
   - `source_upload.withdrawn`;
   - one `finding.source_withdrawn` and one `valuation_run.source_withdrawn` per affected artefact;
   - `source_upload.reimported` on the new upload and `source_upload.superseded` on the old one.

   The reason lives on the upload row, because audit events carry no free text.

## Consequences
- **Storage:** every sync run writes one `sync_run_evidence` row per record it reads, in batches of 5,000. That's the cost of voiding exactly. Without it, records shared by two imports could not be told apart.
- **Confidentiality:** unchanged. Both new tables are visible only together with their evidence (RLS subquery on `evidence_items`). Withdrawing never widens who sees an import or its history; the history needs manage rights.
- **Not in this task:**
  - bulk withdraw, purge tooling and time-based deletion;
  - withdrawing connector syncs (Stripe, GitHub). Only file imports can be withdrawn.
  - QoE still starts from cited document entries. T-149 makes it read `finance.pnl_line` through `loadPackEvidence`-style reads, which already exclude voided rows.
- **Rollback:** expand-only migrations (`20261230000000_import_withdrawal_status`, `20261230000100_import_withdrawal`). Set any `WITHDRAWN` upload back to `IMPORTED`, then drop `evidence_voids`, `sync_run_evidence`, and the four new `source_uploads` columns and their constraints. The enum value stays unused.
