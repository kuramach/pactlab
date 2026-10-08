# ADR 0004 — Billing CSV import through a confirmed column mapping

- **Status:** Accepted (2026-10-09)
- **Builds on:** T-025 source checklist; the evidence spine and idempotent sync engine

## Context

Enterprise sellers rarely give a buyer API access to their billing or ERP
system before signing. Their data arrives as exports from Stripe, NetSuite,
Zuora, Chargebee, SAP, Oracle, QuickBooks and others, each with its own
columns, date and number formats. The revenue engine already reads one
standard record, `billing.invoice_line`, from any connection.

## Decision

1. **CSV import is for billing only.** Source control (GitHub and others)
   and delivery tools (Jira and others) connect through API adapters only:
   commit history and issue workflows cannot be trusted from a spreadsheet.
   The source catalog shows no upload option for them.
2. **One standard record, one mapping per upload.** Every export is mapped
   onto the Pactlab standard invoice line (the columns the Stripe adapters
   already produce). A mapping names a column or a fixed value per field
   plus deterministic transforms (date format, number format, major/minor
   units, sign flip). Money stays a decimal string throughout. No values are
   inferred; unreadable rows are reported with row numbers and skipped.
3. **Templates are verified before they claim anything.** A system's column
   aliases ship only when checked against the vendor's official
   documentation or a sanitized sample (Stripe: Sigma `invoice_line_items`).
   Other systems are offered with name-based suggestions, labelled
   "suggested mapping", and the user confirms every field. Adding a verified
   template changes data, not code or schema.
4. **Imports run through the sync engine.** Each upload imports on a
   `billing_upload` connection (one per deal, system and visibility) with
   idempotency key `connection + file sha256 + mapping hash`: the same file
   and mapping replay; a newer export adds only changed lines. Evidence is
   cited as `csv_row` in `uploads/<uploadId>/<fileName>`, and the citation
   quote is the canonical record, so unmapped columns never become evidence.
5. **Uploads are stored like documents.** Tenant-prefixed object keys,
   virus scan before storage (fail closed), 10 MB per file, UTF-8 only.
   Originals are retained as financial data under the deal's retention; the
   sha256 is re-checked on every read. Target contributors may upload; their
   uploads and evidence are SHARED, buyer uploads are BUYER_ONLY.
6. `billing_upload` connections are LIVE without a credential reference (an
   uploaded file needs none); the connections CHECK was widened for this one
   provider only.

## Consequences

- Any billing system can feed ARR, retention and reconciliation on day one,
  with the mapping kept for lineage.
- A billing system imported both through an upload and through a live
  connector would count the same lines twice; the Sources page shows both,
  and reviewers should keep one per system. De-duplication across
  connections is future work.
- Comma-separated files only; semicolon-delimited and XLSX exports must be
  re-saved as CSV for now.
