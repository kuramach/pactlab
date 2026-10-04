# SparseCo (synthetic)

**Purpose:** exercise the unhappy data paths connectors and normalization must
survive without inventing conclusions.

Expected conditions once seeded (T-002+):

- Missing optional and required fields.
- Multi-page provider responses (pagination and resumable cursors).
- Stale data past freshness thresholds.
- Duplicate display names that must not be joined by name alone.
- Partial permissions: some scopes granted, others denied.

The product should surface gaps explicitly rather than fill them.

## Billing fixtures (T-003)

- `stripe-invoice-lines.csv` — only two months (2026-08, 2026-09), so
  twelve-month retention is reported as unavailable. Lines with a missing
  amount, missing currency, missing period end, an unconvertible currency
  (CAD), and the same subscription period billed twice are excluded with
  their reason. Two distinct customers share the name "Northwind Supply".
- `fx-rates.csv` — synthetic EUR/USD fixings that stop at 2026-07, so EUR
  lines in later months are excluded as stale rather than converted.
- Management ARR for 2026-Q3 has no value: the reconciliation reports it as
  missing and there is nothing to approve.
