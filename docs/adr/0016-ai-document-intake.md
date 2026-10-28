# ADR 0016 — AI document intake: the AI files clear files, a person answers the unclear ones

Status: accepted (T-098, 2026-10-28; decisions by Kumar)

## Context

Getting a deal's files into Pactlab was slow. Every upload had to be put in
the right place by hand: rent rolls to their import, balance sheets to the
debt-and-cash reader, contracts to extraction. Kumar's decisions
(2026-10-28):

- Pactlab is **not a data room**. It reads from the data room or drive the
  deal already uses (VDR, Google Drive, OneDrive/SharePoint and the like).
  Small pacts with no data room import everything at once, as many files or
  one zip, and the same process applies.
- **No per-file human labelling.** The AI reads each file and works out what
  it is. If that's clear, the file is digested as that. When the AI is
  confused, it asks a person.

## Decision

1. **One category per file.** The categories are the pack's import targets
   plus a fixed set of document categories (balance sheet, income statement,
   cash flow, customer and supplier contracts, lease, loan agreement, corporate
   record, policy, people record, other) — `@pactlab/domain` `intake`. The
   category fixes the route: IMPORT (the target's mapping), BALANCE_SHEET
   (T-094 B9 reader), EXTRACT (contract extraction into DRAFT findings) or
   FILE (kept and listed).
2. **The model proposes, code decides.** Prompt `document.classify` v1 reads
   the first 3 pages (≤ 12 000 characters), file name and folder. It returns a
   category, a calibrated confidence, a reason, close runners-up, the entity
   and, for contracts, the counterparty with an exact quote. `decideIntake`
   files the document only when:
   - the category is offered for the pack,
   - its confidence clears the bar for its route (IMPORT / BALANCE_SHEET 0.90,
     EXTRACT 0.80, FILE 0.75),
   - no offered runner-up is within 0.15, and
   - the model asked no question.

   Otherwise the file is NEEDS_YOU with a specific question. The thresholds are
   code, under test, and recorded with the prompt version.
3. **A person's answer is final.** `PUT …/category` files the document as
   PERSON. A later AI run never overwrites it.
4. **Counterparties are grounded.** A customer or supplier is tagged only when
   the quote naming them is in the pages the model read.
5. **Zip intake is server-side and bounded.** At most 10 MB of archive, 200
   files and 100 MB unpacked, all checked from the declared sizes before
   inflating. One level of nested zip is unpacked. Operating-system clutter is
   skipped. Every file goes through the normal upload path (scan, type check,
   pages). Each file's outcome is returned: uploaded, duplicate, refused with
   reason, or skipped with reason.
6. **The checklist** comes from each pack's expected inputs (derived, or
   `PackDefinition.expectedInputs`). Each input shows as received (filed
   documents only), connected (an active connection feeds it: Stripe →
   billing; GitHub, Jira → code and delivery), or missing. Missing inputs make
   a plain-text request for the counterparty.

## How this sits with rule 2 (Claude assists; humans decide)

Classifying a file is something rule 2 explicitly lets AI do. It decides
where a file goes, not what it means for the deal. Everything that becomes a
judgement keeps its existing human gate:

- extracted terms are DRAFT findings until a named reviewer accepts them;
- balance-sheet lines reach the bridge only when confirmed (T-094 B9);
- import rows go through the target's mapping.

A wrong category is visible (category, confidence, reason and who filed it,
on every row), correctable in one click, and audited (`document.classified`,
`document.categorized`).

## Rule 7 (people data)

AI-excluded and prohibited-class files are never sent for classification.
They wait for a person as NOT_READ. A file filed as PEOPLE_RECORD (by the AI
or a person) is excluded from all further AI processing. A database trigger
makes `ai_excluded` one-way, so nothing can lift it.

## Connected sources

7. **Document sources are read-only adapters behind one interface**
   (`@pactlab/connectors` `document-source`), fixture-first. They live in
   their own table (`document_sources`, buyer side). They are not evidence
   connections, because they produce documents, not evidence rows.
   - **Google Drive:** `files.list` recursively under the folder, then
     `files.get?alt=media`, or `files.export` to Word or Excel for Google Docs
     and Sheets (10 MB export limit). Scope: `drive.readonly`.
   - **OneDrive / SharePoint (Microsoft Graph):** driveItem `children`
     recursively, then `/content`. Its 302 points at a pre-authenticated URL,
     which is fetched without the token. Least privilege: `Files.Read`
     (delegated) or `Files.Read.All` (application).
   - **VDR:** live fails closed (`SOURCE_NOT_CONFIGURED`) until a partner is
     chosen. Synthetic rooms work in local and dev.

   A live connection takes a read-only access token, which is stored once
   in the secret store as a `secretref:` and never returned, logged or
   audited. Rotating or refreshing tokens through an OAuth consent flow is
   not built yet.
8. **Sync is incremental and never deletes.**
   - New and changed files (by provider version) go through the normal upload
     path.
   - A changed file becomes a new document; the old one is REPLACED.
   - A file gone at the source is REMOVED and stays, with its lineage.
   - Neither counts toward the checklist.
9. **Requests to the seller** (`document_requests`) name categories only,
   never buyer analysis, so both sides read them. Only the buyer side writes
   them. An item ticks off when a file of that category is filed after the
   request. Seller uploads are sorted as soon as a buyer with AI on opens
   Documents. Sellers see what their files were filed as, never the AI's
   reasoning.
10. **Customer contract gaps.**
    - The top 10 customers by billed revenue come from `billing.invoice_line`
      evidence, summed exactly as scaled integers.
    - Each is matched by normalized name to the counterparties read from
      filed customer contracts.
    - Unmatched customers appear by name on the checklist (PARTIAL) and in
      the request.
11. **Re-filing** a settled document records the previous category. Intake
    lists the drafts, accepted findings and balance-sheet lines built from
    the file, to recheck. Results are flagged, not rewritten.

## Consequences

- Migrations `20261112000000_document_intake` and
  `20261113000000_document_sources` only add tables and columns. Rollback is
  dropping them.
- Demo data: `scripts/demo-data/dataroom.py` arranges every dataset as a
  seller's data room (`dataroom/`, `dataroom.zip`). Each one has a misfiled
  balance sheet, a duplicate, an ambiguous summary and two gaps. Each README
  gains an "Intake test" section listing what intake should conclude. The
  synthetic rooms behind fixture sources (`fixture-rooms.ts`) carry the same
  kinds of test.
- Still open:
  - OAuth consent and token refresh for Drive and Graph;
  - a live VDR partner;
  - moving large rooms and zips onto the worker queue (today both run inside
    the request, bounded at 500 files per sync and 10 MB / 200 files per
    zip).
