# ADR 0060: Deal Criticals: the buyer organization's red lines, confirmed as structure, rated on every pact (T-179)

**Status:** accepted for the first slice (Kumar directed the feature, 2026-11-26).

## Context
- Buyers walk in with deal breakers: a multifamily cap rate must clear a floor, occupancy must have held 90% for three years. Those lived in partners' heads and were checked by hand, late.
- The platform already holds the evidence (imports, multi-year history, documents) and the machinery (findings with directions, the bridge, the confirmed-value ledger, the investment committee). What it lacked was the buyer's own criteria, made machine-checkable.

## Decision
1. **Two levels, one append-only table** (`deal_criticals`).
   - **Org standards** (`deal_id` NULL) are the firm's policy, scoped to one company type or all types (only metrics every pack can evidence).
   - **Pact criticals** belong to one pact: a pact-only critical, or an **override** of an org standard (`overrides_key`) that tightens, loosens (same metric) or switches it off (`DISABLED`), always with a reason (CHECK). Who and when are the row.
   - Every change, a person's confirmation included, is the next version of the same key; the latest counts. Retiring is a version too. Nothing is updated or deleted (no grant).
2. **Words → structure → a person confirms.** The organization writes the critical in its own words; `critical.structure@1` (job `classification`) proposes the metric, comparator, threshold, lookback and Even band, which code checks against the metric vocabulary and the company type. A `PROPOSED` version is inert; only a `CONFIRMED` one evaluates, and the confirmed structure, shown next to the words, is the only thing the engine runs. A form confirmed unchanged stays "proposed by AI"; a corrected one is the person's. A person may also enter the structure directly; it still needs confirming. Without AI, the words are kept and the person enters the structure.
3. **The metric vocabulary** (`CRITICAL_METRICS`, `@pactlab/domain`, a `satisfies` registry the database CHECK mirrors) names, per metric, the company types that can evidence it, how it is looked for and what document would settle it:
   - recomputed from the pack's calculator (`PACK_METRIC`: occupancy average and low point, NOI and rent growth, expense ratio) — with a lookback, its year-by-year history (ADR 0057), each year naming the rows it rests on;
   - **cap rate** = net operating income (latest year) ÷ the recorded asking price;
   - read from documents (`DOCUMENT`: DSCR for every type, an anchor lease's remaining term for property, NRR for SaaS) by `critical.extract@1` (job `extraction`) over the pages that name the metric; code keeps a figure only when its quote is on the cited page and the figure is in the quote.
   A critical can only target a metric listed for its company type.
4. **Ratings are deterministic** (`criticals-1`, `@pactlab/calculations`, decimal only):
   - **Good**: the threshold is met on the evidence (every required year, for a lookback).
   - **Even**: a miss inside the Even band; a lookback met on only the years the pact holds ("met in 2 of the last 3 years; FY2024 not in the pact"); or sources that disagree.
   - **Bad**: the threshold is missed on the evidence — for a lookback, any year the pact holds that misses beyond the band. *Interpretation:* the brief's "met on part of the required period (2 of the last 3 years)" is read as the evidence covering part of the period; an evidenced year that misses is a miss on the evidence, so Bad. The demo's planted trend (93.1%, 91.1%, 88.5%) therefore rates Bad, as its acceptance requires.
   - **No evidence**: a distinct fourth state, never folded into Even, naming what would settle it (the metric's `settles`, with what is missing) and the intake category to request, which the panel's "Ask the seller" sends as a document request.
   Every rating stores its receipts: the figures by period with their outcome, the formula or the cited pages, and the evidence ids. A rating without figures behind it is No evidence.
5. **Explicit re-evaluation, stamped.** Each run writes one `critical_evaluations` row per critical with the critical's version, the override's version, a snapshot of what was rated and an evidence mark (active evidence, documents, asking price). The panel marks a rating **stale** when the mark changes and **rated under an older version** when the policy or override changed; it never re-runs on its own. A document critical whose AI is unavailable is skipped and reported, never rated No evidence.
6. **Consequences through the existing machinery** (`CRITICAL_DIRECTION_MAP`, the `VALUATION_DIRECTION_MAP` rule shape, kept in the domain as QoE's are, since the connectors package is outside this change):
   - Bad → a −1 DRAFT finding (HIGH and titled "Policy breach" on an org standard), citing the very rows or pages, unpriced: a person prices and accepts it, and only then does it reach the bridge.
   - Good → a +1 DRAFT finding with a value confirmation: confirmed value in the buyer-confidential ledger, never a price increase.
   - Even and No evidence → 0, no finding, rationale shown.
   Findings are idempotent by fingerprint (critical, versions, rating, figures), so re-rating the same evidence raises nothing new.
7. **Policy breach.** A Bad on an org standard (overridden or not) is a policy breach (CHECK: Bad and org origin only), flagged in the panel and on the investment-committee page. A Bad on a pact critical is a deal-specific miss.
8. **Promotion.** "Make this an org critical" copies a confirmed pact critical's words and structure into the library for the pact's company type (`promoted_from_key`). Pact criticals never apply to another pact otherwise.
9. **The wall.** Both tables are buyer-confidential under RLS: org standards to the organization's buy-side people (`app_is_org_member() AND app_is_buyer_analyst()`, as comparables), pact rows and ratings to the pact's own side (`app_is_buyer_side`). Every route needs `BUYER_ANALYSIS_READ`; the tab is own-side only. Personas never alter criticals or ratings.
10. **Who may.** Org owners and admins change the library and promote; the deal lead and analysts add, confirm and rate pact criticals; only the deal lead overrides or removes an override.

## Consequences
- **Migration** `20270118000000_deal_criticals` is expand-only: two tables. Rollback: drop `critical_evaluations`, then `deal_criticals`.
- The multifamily history now carries each year's evidence ids (`PackMetric.history[].evidenceIds`, optional), so a rating cites its rows.
- **Demo:** the demo organization writes three Multifamily standards (cap rate ≥ 5%, occupancy ≥ 90% in each of the last 3 years, expense ratio ≤ 55% in each of the last 3 years) and rates the Multifamily pact.
- **Not in this slice:** the IC pack PDF carrying the breaches (the IC page shows them); calculated retention for SaaS (NRR is read from documents for now); document metrics per period with a lookback; a first-class link from a rating to the document request it raised.
- **Hand-sourced entries (T-178d note).** A rating rests only on imported evidence rows and verified document pages, never on seller claims; a Rinse hand-sourced entry is a claim (`HAND_SOURCED`), not evidence, so it can never rate a critical. If ratings ever read claims, they must carry `HandSourcedBadge` as findings do.
- **New UI pattern:** the Criticals panel awaits Kumar's approval (`docs/ui-patterns.md`).
