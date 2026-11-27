# ADR 0058: Pactlab Rinse: the seller rinses the set on their own machine; a manifest carries it into the pact (T-178)

**Status:** accepted for the first slice (Kumar directed the product, 2026-11-26: desktop, not web-first; the name Pactlab Rinse; a Pactlab login required).

## Context
- Most of the time the seller holds the documents. Until now they reached the pact half-clean: scans with no text layer, duplicates, corrupt files, statements that do not foot, and gaps the buyer discovered weeks later.
- Kumar's direction: a desktop app the seller runs. The whole set is dropped in and **rinsed**: converted to the form Pactlab reads, checked, audited against the originals, and listed against what the pact expects. The seller closes the gaps there, and uploads only a finished folder. The seller needs no Pactlab seat and never touches the pact.

## Decision
1. **One cross-platform app,** `apps/desktop`: a Tauri 2 shell (macOS, Windows, Linux) with the Tauri updater. Its screens are React with `@pactlab/ui`. The rinse engine is TypeScript on the machine (`src/engine`). Product name **Pactlab Rinse**, bundle id `ai.pactlab.rinse`, line "Rinse your deal documents clean before they go in the room."
2. **Deterministic first, on the machine** (`@pactlab/domain` `rinse/`). Rinse reads each file from its bytes, never its name. It checks corruption, legacy formats, exact duplicates (SHA-256), near duplicates (Jaccard ≥ 0.9 on five-word shingles) and pages with no text layer. These cost no model call and work offline. Spreadsheets and statements are never flattened: they travel as they are and go through guided import (T-152) at injection. Originals are never modified; canonical copies sit beside them under `rinsed/`.
3. **Converting is not trusting** (`rinse-audit-1`). For every converted document, Rinse re-reads the **original** independently: its own text layer, or for a scan the vision lane reading its image. The deterministic reader (`readDocument`, the same code for both readings; model output is never parsed for money) compares the two readings:
   - key figures and totals, dates and party names;
   - page-count parity, for fixed-page formats;
   - table presence;
   - footing: every table's lines must sum exactly to its stated total, on both sides.

   Two failures are kept apart:
   - **Conversion mismatch:** an **error**. It blocks ready until a re-run or a replacement clears it, and stays in the manifest as resolved.
   - **Source discrepancy:** the original itself does not foot. A **warning** that travels as a noted gap and becomes diligence signal at injection.
4. **The gap list** is the pack's own expected-input list (`expectedInputs`, the same one the intake checklist uses). Each gap shows as present, present but flagged, hand-sourced, not applicable, noted, or missing.
   - The seller closes a gap by adding a file, entering the data by hand, or giving a note.
   - **Ready** means no open error and no required gap left missing. Warnings and noted gaps travel; errors never do.
   - The manifest schema enforces this a second time: a manifest carrying an unresolved error or an open required gap does not parse.
5. **Hand-sourced entries** (`hand-entry-1`) are typed forms with the fields each document type is expected to have: vacancy and occupancy schedule, key lease terms, debt schedule, and an attested note. Rinse generates a canonical PDF stamped "Hand-sourced — entered by [name, org] on [date]" on every page. The entry stays editable by revision until upload.
   - **The integrity rule:** a hand-sourced entry closes the completeness gap but is never documentary evidence.
   - **At injection** it is not ingested as a document. It becomes a seller claim (origin `MANUAL`, status UNVERIFIED) whose source names the enterer, the organization and the date, labelled "Pactlab Rinse; not documentary evidence".
6. **`pactlab-manifest.json`** (`@pactlab/contracts` `rinse.ts`, schema `pactlab-rinse-manifest`, version 1) lists every document with:
   - its original and canonical copy, by path and SHA-256, with page anchors;
   - the route, classification, metadata and checks with their resolutions;
   - the conversion log and the audit (figures compared and matched, resolved mismatches, source discrepancies, how the original was read);
   - any hand entry.

   It also carries the gaps with the seller's notes, the preparer's verified identity, and the pact a prep invite bound it to. Paths are relative and inside the folder; unknown fields are refused.
7. **Injection reads the manifest at sync time** (path (a)), in `DocumentSourcesService.sync`, through `readRinsedFolder` (`@pactlab/connectors`).
   - **Untrusted input:** the manifest is schema-checked, and every file is matched by path and SHA-256 before its entry is used. A file the manifest does not name, or one changed since the rinse, is refused. Nothing half-clean comes in.
   - **What is ingested:** canonical copies and as-is spreadsheets go through the normal upload path. Originals stay at the source, named in the copy's intake reason.
   - **Classification:** the seller's classification is a **proposal**. It is filed through `decideIntake` (an offered category, the route's confidence bar), never over a pact-side person's category, and only on the deal team's sync. Filed files are not sent for AI sorting again.
   - **Hand entries** become claims once, on the deal team's sync.
   - **Notes and discrepancies:** gap notes and source discrepancies are returned and shown on the Documents page, and counted on the source.
   - Injection stays the pact-side user's explicit act (connect, then sync).
8. **AI on the machine** runs only under the signed-in preparer account, as metered gateway jobs under ADR 0034. Anonymous AI access is never offered. Offline, the jobs queue durably on disk and run on reconnect. Results are cached by SHA-256, so re-rinsing costs nothing.
9. **Destinations** are the seller's own: a local or network folder (built). Their own OneDrive, Google Drive or Box goes through their own sign-in in the app, a separate auth from the Pactlab login (the port is defined; the adapters are T-178d). Pactlab needs no write access to anyone's cloud.

## Consequences
- **No migration in this slice.** Provenance on the pact lives in the intake reason, the claim's source and the source's sync summary. A first-class provenance record (original ↔ canonical copy ↔ manifest entry) and the hand-sourced label on findings and Deal Criticals (T-179) need tables: T-178d.
- **Preparer accounts and prep invites** need tables, a new deal-free account kind and an auth flow in the desktop shell. They are T-178b; until then the manifest carries the preparer as the app signs them in, and `intendedPact` is null.
- **The download page** `pactlab.ai/rinse` lives in `apps/site` (T-178c). The Rinse name joins the trademark-clearance list there.
- **Builds, signing and auto-update** are not produced in this slice: there is no Rust toolchain or signing identity on the build machine. `docs/runbooks/rinse.md` records the status honestly.
- **New UI pattern:** the Rinse bench (flask header, checklist, review queue with side-by-side mismatches) awaits Kumar's approval (`docs/ui-patterns.md`).
- **Rollback:** a code revert. A rinsed folder synced by an earlier release comes in as an ordinary folder, with its manifest skipped as an unsupported file.
