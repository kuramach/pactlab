# ADR 0021: Buyer personas price the findings

Status: accepted (2026-11-06)

## Context

Two buyers looking at identical accepted findings legitimately land on different prices and different terms. Until now, the step from findings to price and terms was one-size-fits-all:
- each finding linked to a scenario was priced at a LOW, MID or HIGH point picked by hand;
- term structure and negotiation framing were left to the user.

**Kumar's design and decisions (2026-11-06, T-105):**
- **Three named personas,** each shown in the picker with a one-line descriptor:
  - Quality Compounder: "A wonderful business at a fair price."
  - Value Investor (the default): "Value at a good price."
  - Grave Dancer: "Price to survive the bad case."
- **Labels are archetypes, never people.** "Shylock" is never used as a label.
- **Scope:** everything in one change, covering pricing, compare and adopt, versioned term proposals the seller sees, and the AI negotiation brief.
- **Weighting:** scenarios are weighted by a Downside, Base or Upside tag.
- **Starting numbers:** the defaults in the registry below.

## Decision

1. **One registry, all data.** `PERSONA_PROFILE` (`packages/calculations/src/valuation/personas.ts`, version `personas-1`) holds four knobs per persona:

   | Knob | Quality Compounder | Value Investor | Grave Dancer |
   |---|---|---|---|
   | **Drag translation:** range point | LOW | MID | HIGH |
   | **Drag translation:** materiality (share of the scenario's EV a price drag must clear to move the price) | 2% | 0.5% | 0% |
   | **Scenario weights,** downside / base / upside | 20 / 50 / 30 | 25 / 50 / 25 | 50 / 40 / 10 |
   | **Term levers** | structure first: remediation, indemnity, retention | price, escrow; 5% earnout | escrow first; 15% earnout, 10% seller note |
   | **Brief tone** | quality and risk | balanced | downside and leverage |

   A contract test fails the build if any knob is missing for any persona.

2. **Personas rewrite inputs, never the engine or the evidence.**
   - **`personaInputs`:** sets each linked priced risk's range point. A drag below the persona's materiality bar is carried as a holdback instead of a price chip. For the Compounder, a key-person drag becomes a retention holdback.
   - **Recorded:** the result is recorded per run as `persona_routing`, next to the finding's own priced-risk type.
   - **Unchanged:** the valuation engine (`valuation-2`), intake, extraction, findings and their −1/0/+1 directions are persona-invariant. A test shows the accepted findings are byte-identical before and after evaluating all three personas.

3. **Weighted price, capped at Base.**
   - **The weighting:** the evaluation's price is the persona-weighted equity purchase price across the tagged scenarios, with weights renormalised over the cases present.
   - **The cap:** it never exceeds the Base case's price. This keeps the standing asymmetry rule (2026-10-10): cushions never raise the price, so a Compounder's willingness to pay for quality stays in the buyer-only confirmed-value ledger.
   - **Price ordering:** with ordered cases, the price order Compounder ≥ Value Investor ≥ Grave Dancer follows. Two things guarantee it:
     - each persona's materiality set nests inside the next, and its points are ordered;
     - the weights stochastically dominate in persona order.
   - **Deferred consideration:** earnouts and seller notes defer part of the price. They lower cash at close, never the price.

4. **Immutable and auditable.**
   - **Evaluations** (`pricing_evaluations`) are insert-only. Each points to its persona-priced `valuation_runs`, stamped with `persona` and `persona_version`.
   - **Persona runs and scenarios:** these runs never count as a scenario's latest run, so they cannot be submitted, and scenario workflows are unchanged.
   - **Adoption:** `pricing_adoptions` is append-only; the latest adoption is the active pricing.
   - **Switching persona:** creates new rows and never updates earlier ones.
   - **Audit events:** `persona.default_changed`, `persona.pact_changed`, `pricing.evaluated`, `pricing.adopted`, `terms.drafted`, `terms.notes_updated`, `terms.proposed`, `brief.generated`.

5. **Proposed terms are sticky and versioned.**
   - **Batches:** a `term_proposal_batches` row is drafted from the active evaluation; only its seller notes may change while it is a draft.
   - **Proposing:** sets `proposed_at` once, after which a trigger freezes the batch and its terms.
   - **Adopting another evaluation** re-prices internally only; the seller sees nothing new until the buyer proposes again.

6. **Buyer-confidential.**
   - **Buyer-side only:** the persona, evaluations, adoptions and briefs are buyer-side tables (`app_is_buyer_side`), behind the same `BUYER_ANALYSIS_READ` permission as valuation.
   - **Seller-readable:** term proposals are the only seller-readable rows, and only once proposed. They carry no persona column: the stamp is reached through the buyer-only evaluation.
   - **The seller's API shape** (`GET /v1/deals/:id/terms/proposed`) is built field by field: version, date, and per term the lever, amount, currency and the buyer's note. A test asserts that no persona name, id, parameter, finding or evaluation appears in it.
   - **The deal:** `deals.persona` is never in the deal API's column list.

7. **The negotiation brief** (`negotiation.brief@1`) is a buyer-only AI draft.
   - **What the model sees:**
     - the persona's tone key;
     - the term levers, without amounts;
     - the findings the terms carry, as id, area and title. Findings about people (KEY_PERSON, PEOPLE) go as "People risk (details withheld)" (rule 7).
   - **Rejected sections:** any that cite a finding outside that set (rule 4), or that state any figure.
   - **Tone follows posture; the findings text is never rewritten.**

## Consequences

- **Re-evaluating is one action:** a buyer can re-price a pact through another lens and compare the deltas against the active pricing, with no re-upload or re-extraction.
- **Tuning:** each persona's numbers can be changed in one file; a change bumps `PERSONA_VERSION`, and earlier evaluations keep their stamp.
- **Seller-led sales:** these pacts have no buyer to price for, so pact setup offers the persona only on buyer-led pacts, and the Proposed terms page is hidden there.
- **Rollback:** the migration is expand-only. Dropping the five tables, the trigger function and the nullable columns restores the previous state.
