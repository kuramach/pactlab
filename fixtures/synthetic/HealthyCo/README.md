# HealthyCo (synthetic)

**Purpose:** prove the happy path through the whole loop — source evidence →
normalized evidence → reviewable finding → explicit assumption → valuation
scenario → proposed deal term → approved integration action.

Expected properties once seeded (T-002+):

- Management ARR reconciles to billing transactions within tolerance.
- Clean retention cohorts and low customer concentration.
- Repositories with consistent authorship and permissive, compatible licenses.
- Complete, fresh data from every connected source with full permissions.

Any finding raised against HealthyCo is a regression unless a test says otherwise.

## Billing fixtures (T-003)

- `stripe-invoice-lines.csv` — itemized invoice-line export, 2025-07 → 2026-09,
  all USD. One annual plan (Fjord) normalizes to monthly; one one-time
  implementation fee is excluded as non-recurring.
- Ledger ARR at 2026-09 is exactly `402840.00` USD, matching management ARR;
  NRR is `1.1201` (management reports 1.12). No reconciliation finding fires.
