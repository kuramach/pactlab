# ADR 0017 — Regulatory & deal certainty: checks over evidence, results through the findings register

Status: accepted (T-091, 2026-10-28)

## Context

T-091 asks Pactlab to surface, during Pre and Diligence, the defects that
sank Kroger/Albertsons:
- local-market overlap and labor exposure
- a remedy package with unused headroom, cherry-picked and incoherent, sold to a weak buyer
- regulator feedback left unanswered
- unverifiable pledges

It also asks for certainty risk to be priced into the bridge. The rules:
- Every result traces to evidence and a reviewer (CLAUDE.md).
- There is no probability of clearance and no legal advice (task guardrail).

## Decision

1. **Deterministic checks** live in `@pactlab/calculations/regulatory`. The
   local-market screen uses the **2023 Merger Guidelines** structural
   presumption, verified against the DOJ/FTC text (18 December 2023,
   Guideline 1): post-merger HHI above 1,800 with a rise above 100, or a
   share above 30% with a rise above 100. Every check returns its inputs.
2. **Structured data comes in as evidence.** The site footprint and the
   divestiture package are two import targets (`REGULATORY_FOOTPRINT`,
   `REMEDY_PACKAGE`), offered by every pack whose regulator profile runs at
   FULL depth. Findings cite those evidence items.
3. **Everything else is a cited entry** (`regulatory_entries`, append-only,
   buyer side):
   - **Kinds:** agreement certainty terms, the remedy buyer, regulator
     feedback rounds, package revisions and pledges.
   - **Citation:** each entry cites a document page. The quote is checked on
     write and re-checked when a finding citing it is accepted.
   - **Latest wins:** for TERMS and BUYER, the latest entry applies.
4. **Results become DRAFT findings in the one register** (domain REGULATORY,
   origin HEURISTIC, actor `regulatory-checks@1`). They are idempotent by
   fingerprint, and reviewed and priced like any finding.
   - **Bridge lines:** two certainty lines carry a proposed price. The
     termination fee the acquirer could owe is a range from zero to the fee.
     The divested sites' value (EBITDA × the analyst's cited multiple) is
     proposed only when a multiple is given.
   - **Into the valuation:** accepted and priced, both reach the valuation
     bridge through the existing finding-to-scenario path. There is no
     second bridge.
5. **The band is not a probability.**
   - **GO:** nothing in the Pre-screen.
   - **GO WITH REMEDY PRICED:** the Pre-screen flags overlap; price the remedy
     from day one.
   - **NO-GO as it stands:** the remedy as offered has a CRITICAL defect.

   Screening shows the band and its reasons beside the human verdict.
6. **The regulator registry** names authorities and theories of harm per
   pack (`@pactlab/domain` `regulatory/registry.ts`). It is a checklist,
   never a prediction. Depth is proportional: Venture Raise gets the LIGHT
   screen, with no local-market or remedy machinery; feedback, pledges and
   covenants still apply.

## Consequences

- Migrations: `20261118000000_regulatory_targets` (enum values, on their own)
  and `20261118000100_regulatory_entries`. Both only add things; rollback is
  dropping them.
- T-092 Case 1 loads through the same path (imports, documents, cited
  entries). The demo seed creates it as **Case 1: Meridian / Harvest Lane
  (synthetic)**, with its regulatory drafts.
- Not yet built:
  - A scenario builder for comparing several candidate packages side by side
    (today: the latest imported revision).
  - The Foresight government-posture link (one posture record).
  - Regulator-facing exports.
