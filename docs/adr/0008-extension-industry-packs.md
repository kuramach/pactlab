# ADR 0008 — Five extension packs: a real-estate cluster and healthcare extensions

Status: accepted (2026-10-22)

## Context

Spec §19 parks six industry packs behind the tech-M&A baseline. The founder
wants five more on the queue — hotels, multifamily, commercial property,
hospitals and small clinics — defined in the same pack format so they can be
sequenced and presented consistently. §19 requires an ADR to change the
pack queue.

## Decision

- **Five packs, in the §19 format** (evidence adapters, finding types,
  valuation tweaks) on the unchanged findings → valuation core. No core
  change; a pack that needs one is mis-scoped (§19 guardrails).
- **Two clusters.** Hotels, multifamily and commercial property form a new
  real-estate cluster, priced on income and capitalization rates.
  Hospitals and small clinics extend the healthcare services pack (2) with a
  real-estate-plus-operations hybrid profile; pack 2's reimbursement and
  compliance finding types apply to both.
- **Order after the existing six:** 7 multifamily (rent roll and T-12 map
  almost one to one onto the billing import), 8 commercial property,
  9 hotels, 10 small clinics, 11 hospitals — regulatory weight ascending.
  The founder may re-rank; a re-rank amends this ADR.
- **Valuation direction follows the existing rule:** capex obligations (PIP,
  per-door maintenance, regulatory capex) are −1 drags priced as
  remediation or price terms; upside such as multifamily loss-to-lease is a
  +1 cushion in the confirmed-value ledger, never a price increase.
- **People data:** provider and physician dependence uses key-person
  aggregates under rule 7 — named data gated, never sent to a model.
- **Still deferred to build.** These are definitions. Building any pack
  needs the §19 activation bar and its own spec amendment (adapters,
  fixtures, acceptance journeys).

## Consequences

- The site's industry registry (`apps/site/lib/content.ts`) lists all eleven
  packs with structured evidence, finding and valuation entries; a content
  test keeps the registry complete.
- An industry appears on the website only once it has a page (story and
  illustration). The five new pages arrive with T-051.

## Addendum (T-060, 2026-10-25): framework revision after fintech and multifamily

- **Rule types stay mirrored.** Rule code lives in `@pactlab/calculations`
  (decimal arithmetic), and its types mirror the domain registry's
  (`packs/rule-types.ts`). A new shared package would add a dependency edge
  for two small interfaces, so the mirror stays, kept honest by typechecking
  the API's composition (`apps/api/src/findings/pack-rules.ts`).
- **One evidence loader.** Rules and calculators read pack evidence through
  `apps/api/src/packs/pack-evidence.ts`: the newest version per record, in a
  bounded read.
- **Industry data is a source.** Pack extract uploads (`pack_upload`) count
  as the "Industry data" source in the source plan of a built pack.
- **Checks run on import.** An inline pack import runs the pack's rules
  (drafts only, idempotent). Background imports finish on the worker, and
  Sources then offers the run.
- **Needs pricing.** A −1 proposal without a defensible amount is labelled
  and filterable on Findings. Acceptance still requires a price.
- **Pack authors** follow `docs/agent/packs.md`; the `packs` lane loads it.

