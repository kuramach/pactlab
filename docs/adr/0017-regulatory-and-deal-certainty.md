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
- Not yet built: the Foresight government-posture link (one posture record).

## Addendum (2026-10-28): candidate packages and the regulator export

- **Every package is a candidate.** Each imported revision and each
  analyst-built scenario runs through the same checks side by side
  (`comparePackages`). One new measure answers what a package is for:
  *presumed markets left* re-runs the 2023 presumption with the divested
  sites held by the remedy buyer. A package beyond the agreement's cap is
  flagged (`over-cap`). The verdict (`RESOLVES`, `RESOLVES_WITH_DEFECTS`,
  `LEAVES_OVERLAP`) describes the inputs; it is not a clearance prediction.
  Findings and bridge lines still come from the latest imported revision
  only — a scenario is analysis, not a fact about the deal.
- **Scenarios store explicit site lists.** A recipe (start revision, add
  markets or every residual market, add and remove sites, transfer
  operations) is resolved once, when saved, into `regulatory_scenarios`.
  The recipe is kept beside the list, so a re-imported footprint never
  silently changes a saved scenario. The table is append-only and buyer-side,
  under the same RLS as `regulatory_entries`. Migration
  `20261119000000_regulatory_scenarios` only adds things; rollback is
  dropping the table.
- **The regulator export is the deal lead's deliberate, audited act.** The
  lead confirms that it leaves the pact; the API builds a Markdown file and
  records `regulatory.exported` against the package. The file carries the
  package, its markets before and after, coherence, the remedy buyer with its
  citation, and only the pledges graded VERIFIABLE or PARTIAL. It never
  carries price, multiple, fees, remedy cost or internal findings. Analysts
  and counterparties are refused.
- **Money is decimal throughout.** Remedy cost and fee exposure moved into
  `@pactlab/calculations` (`remedyCost`, `acquirerFeeExposure`), computed and
  rounded once in decimals. This replaces float arithmetic in the first
  slice.
