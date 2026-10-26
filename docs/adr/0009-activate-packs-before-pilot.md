# ADR 0009 — Build the industry packs before the pilot

- **Status:** Accepted (2026-10-22)
- **Amends:** spec §19 (activation bar); **builds on** ADR 0008

## Context

Spec §19 parks every industry pack until the software baseline is proven in
pilot. The founder decided to build all eleven packs now, ahead of the
engineering-scale (T-055) and multi-repository (T-056) work, and asked how to
avoid a costly refactor later.

## Decision

1. **Packs are built now**, in this order: the pack framework (T-057); two
   deliberately different packs — fintech (closest to the software core) and
   multifamily (first non-revenue imports, first non-ARR valuation) — to
   stress it (T-058, T-059); a framework revision from what they teach
   (T-060); then the remaining nine (T-061–T-069).
2. **Every §19 guardrail stays.** A pack never forks the core; deterministic
   calculations, mandatory citations, humans decide, tenant isolation and the
   people-data rules apply unchanged. A pack that needs a core change gets it
   in the core, for every pack.
3. **The pack is the seller's company type** (`company_type`, chosen at Start
   a Pact). The deal lead changes it through the audited parties update.
   Code reads the pack's registry entries; it never branches on the pack.
4. Each pack still starts with its §19 spec amendment (targets, finding
   types, valuation adjustments, fixtures, acceptance journey).

## Consequences

- More surface to keep green: every core change is checked against twelve
  packs. The pack registry, the demo-data contract test and per-pack
  acceptance tests make a break fail loudly.
- Marketing already presents every pack as available (2026-10-22 copy
  decision); the app's source plan says a pack is "planned" until its task
  ships.

## Addendum — all twelve packs built (T-069, 2026-10-25)

- T-061 to T-069 shipped the remaining nine packs. Every company type except
  OTHER now has a built pack, so the "planned" source-plan note no longer
  appears for any seller type; the code path stays for any future pack.
- Shared rule factories (`packages/calculations/src/packs/common.ts`) carry
  the two recurring shapes, revenue concentration and a cited document
  clause, so a new pack's rules are mostly configuration.
- Hospitals added the first pack-specific valuation method through the
  method table: `PAYER_MIX_EBITDA` (spec §19 11a). It is deterministic,
  decimal-only and validated like every other method; existing methods and
  their outputs are unchanged, so the engine version stays `valuation-2`.
