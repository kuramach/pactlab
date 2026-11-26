# ADR 0043: Energy generation & rights: one pack, two evidence families, third-party reserves only (T-142)

**Status:** accepted (Kumar, 2026-11-19 and 2026-11-20).

## Context
- Energy assets — coal, gas and renewable plants, and oil & gas mineral, royalty and working interests — trade on evidence the loop handles well: title chains, production and reserve data, contracts, and large, quantifiable liabilities (environmental remediation, coal ash, decommissioning) that map directly onto price reductions, remediation terms and escrows.
- The diligence is specialised but structured. No pack covered it.

## Decision
1. **A new company type, `ENERGY_GENERATION`** (label "Energy generation & rights", slug `energy-generation`, cluster `energy`). One pact, two parties: the buyer acquires assets from the seller (utility, independent power producer, E&P company or mineral owners), who is a target contributor. Released on merge (`RELEASED_COMPANY_TYPES`, `RELEASED_INDUSTRY_SLUGS`).
2. **Two evidence families in one pack**, because they share the title and liability core:
   - **Generation:** `ENERGY_PLANTS` (→ `energy.plant`: capacity, fuel, age, capacity factor, PPA counterparty and expiry).
   - **Oil & gas interests:** `ENERGY_INTERESTS` (→ `energy.interest`: lease, interest type and share, the division-order decimal, operator) and `ENERGY_LEASES` (→ `energy.lease`: net acres, lessor and overriding royalty, primary term, held by production). Lessors appear only as pseudonymous references.
   - **Shared:** `ENERGY_PRODUCTION` (→ `energy.production`: volume and gross revenue by asset and period, contracted or merchant for a plant) and `ENERGY_LIABILITIES` (→ `energy.liability`: the seller's booked figure per obligation). Billing holds the power sales.
   - Six document categories offered only by this pack: title opinion, oil and gas lease, division order, reserve report, power purchase agreement, environmental report or permit.
3. **Third-party reserves only.** Reserves (PDP / PDNP / PUD), their discounted values and the decline the report assumes enter only as entries a person confirms from the engineering report (`energy.extract@1`; an entry is kept only if its quote is on the page and its figure is in the quote). Pactlab never generates a reserve estimate. A producing portfolio with no report in the evidence is an explicit gap finding (`energy-reserve-report-missing`).
4. **Deterministic models** (`@pactlab/calculations` `packs/energy`, `energy-assets-1`), decimal only, each returning its conventions:
   - **Production and decline:** trailing and prior-year BOE (gas ÷ 6) per interest and for the portfolio; decline = 1 − trailing ÷ prior. Compared with the report's assumption, never replacing it.
   - **Decimals:** NRI recomputed from the lease chain (working: share × (1 − royalty − ORRI); mineral or royalty: share × royalty) against the division order; the yearly over- or underpayment is the difference × the trailing gross revenue.
   - **Leases:** net acres not held by production whose primary term ends inside the hold (stated, else 5 years) ÷ all net acres.
   - **Liabilities:** estimates from confirmed entries and from document sentences (an estimate, an obligation and an amount) against the seller's schedule, by kind and asset; unbooked, or (for the ARO) short beyond a 10% margin.
   - **Plants:** capacity factor from twelve months of generation; contract coverage = contracted ÷ trailing revenue; a PPA ending inside the hold.
5. **Nine rules** (drafts only, cited): unbooked environmental liability (−1, REMEDIATION_COST at the evidence's estimate); ARO shortfall (−1, ESCROW at the gap); decline mismatch (−1, more than 5 points steeper); lease expiry (−1, at 10% of acreage or more, the share quantified); royalty decimal error (−1 overpaid, 0 underpaid, with direction and yearly size); PPA cliff (0, the contracted share turning merchant); title defect (−1, a cure period or holdback); compliance capex gap (−1, REMEDIATION_COST at the stated cost); reserve report missing (0).
6. **Valuation through the core methods, named by the pack** (`methodLabels`): **Reserve-based DCF** (the core DCF, fed from the report's categories and the production history) and **Capacity value ($/kW)** (the core ARR-multiple engine: net capacity in kW × a price per kW, with contract coverage beside it on the Assets tab). Verified cushions (clean title, over-booked ARO, contracted revenue) go to the confirmed-value ledger only.
7. **Guardrail.** Diligence support only: not legal, engineering or regulatory advice; no title determination; no certified reserves. Shown on the Assets tab, carried by its API view and stated on the site page.

## Consequences
- The Assets tab (`/deals/:id/energy`) is the buyer's own side (RLS `app_is_buyer_side` on `energy_register_items`, `BUYER_ANALYSIS_READ` on every route); the asset register and the entries are keyset-paged (T-126).
- Demo data: `pactlab-demo-data/energy-generation/{USD,EUR,GBP}` (Cinder Ridge Energy: one 600 MW coal plant and 20 interests) with planted defects — (a) an ash-pond closure estimate absent from the liability schedule, (b) an ARO booked at 60% of the decommissioning study, (c) 25% of net acres not held by production expiring within 18 months, (d) a division-order decimal of 0.125 against 0.09375 — plus a PPA ending inside the hold. `apps/api/src/packs/energy-generation.acceptance.api.test.ts` runs it end to end with scripted model responses.
- Capacity value runs on the revenue-multiple engine with kW as its input: the bridge shows the input under that engine's field. A dedicated `CAPACITY_VALUE` method (and a reserve-category DCF input) would widen the shared API contract (`packages/contracts`); it is a follow-up if wanted.
- **Migration** `20270104000000_energy_generation_pack` is expand-only: six enum values and one table. Rollback: drop the table; the enum values stay unused.
