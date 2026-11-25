# A customer asks where their numbers went

Use when a customer says figures changed or vanished after someone removed an import, or asks what a "source withdrawn" flag means. Background: ADR 0039.

## What happened
Someone on the deal team (deal lead or analyst) **withdrew an import**.
- **Nothing was deleted.** The import, its file, its mapping and the reason stay in the import's history.
- **Its rows stopped counting.** They're kept in storage but excluded from metrics, valuation inputs, checks and the evidence browser.
- **Findings and valuation runs built on those rows were flagged**, not changed. A run's stored inputs and result are exactly as they were.

## Answer the customer
1. **Find the import.** Open the pact → **Sources** → **Imports**. A withdrawn import shows **Withdrawn** with its reason. Open it for the history: who withdrew it, when and why, how many records were voided, and the re-import that replaced it, if any.
2. **Explain the flagged artefacts.** A finding or a valuation scenario marked **Source withdrawn** links to the import it rested on.
   - **Its numbers are still the ones the customer saw.** The cited rows still open by id, and the run's inputs are stored.
   - **To get numbers on current data,** re-run: re-run the valuation, and run the checks again on Findings.
3. **Confirm it in the audit log** (Audit page, or the audit export). Look for:
   - `source_upload.withdrawn` (the import);
   - `finding.source_withdrawn` and `valuation_run.source_withdrawn` (one per flagged artefact);
   - `source_upload.reimported` and `source_upload.superseded` (the re-import and the import it replaced).

## If the withdrawal was a mistake
- **Re-import it.** On the withdrawn import's page, choose **Re-import** with no file: the stored original is read again under a new import, with the mapping offered again.
- **What comes back:** records it reads again are restored, and each restore is recorded on the void.
- **What is never done:** a withdrawal is never undone by editing the database. The history must show both steps.

## Never
- Delete `evidence_voids`, `sync_run_evidence` or withdrawn uploads, or flip an upload's status by hand. The audit chain and the flags depend on them.
- Read a customer's file contents out to support channels. Point to the pact's own screens.
