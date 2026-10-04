# TroubledCo (synthetic)

**Purpose:** trigger the core diligence findings so detection, review and
pricing paths are exercised.

Expected findings once seeded (T-002+):

- **ARR:** management-reported ARR exceeds what billing transactions support.
- **Ghost commits:** commit activity attributed to identities with no matching
  employee or contractor record.
- **Key person:** critical systems dominated by a single contributor.
- **License:** copyleft or incompatible licenses in shipped dependencies.

Each finding must resolve to its source evidence and require a human reviewer.

## Billing fixtures (T-003)

- `stripe-invoice-lines.csv` — invoice lines 2025-07 → 2026-09, USD plus one
  GBP customer (Kestrel). Management ARR (`1450000.00` USD) counts a void
  enterprise invoice, an uncollectible one and a one-time services charge;
  the ledger supports `176118.71` USD, so the ARR reconciliation proposes a
  CRITICAL draft finding citing the KPI row and the excluded lines.
- `fx-rates.csv` — EUR-based reference rates in ECB form, last business day of
  each month. **Values are synthetic**, not published ECB fixings.
