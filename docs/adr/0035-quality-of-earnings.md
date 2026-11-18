# ADR 0035: Quality of earnings: a cited, deterministic work product that reaches price only through findings and terms (T-135)

**Status:** accepted (2026-11-18)

## Context
- **The gap** (Kumar's PE contact, 2026-11-11/12): what a QoE firm signs — an adjusted-EBITDA normalization schedule, verification of the seller's claimed add-backs, and a working-capital analysis — had no first-class work product in Pactlab. A standalone QoE runs $20k–$50k (docs/pricing-research.md).
- **The constraint:** reuse the Finances uploads, the findings and direction machinery, the term machinery and the T-110 reports. No parallel versions.

## Decision
- **Pactlab is not a QoE firm.** The work product is labelled "platform-prepared analysis for the buyer's own review and their advisors" on the page and in the report (`QOE_DISCLAIMER`).
- **One append-only table, `qoe_entries`** (buyer side, RLS like `regulatory_entries`; SELECT and INSERT only). Four kinds: `REPORTED_EBITDA`, `ADJUSTMENT`, `ADD_BACK`, `WORKING_CAPITAL`. A change is the next version of the same `entry_key`; the latest counts; withdrawal is a version too. Every entry cites an exact quote on a stored document page, verified on entry (people-data and other non-financial classes refused) and re-checked when shown. Figures are in the pact's base currency.
- **Registry pattern** (`packages/domain/src/qoe/registry.ts`): adjustment categories (owner/executive compensation, non-recurring, related party, rent, pro forma acquisitions / locations / contracts, other), verification statuses and working-capital components are `satisfies Record<…>` maps, so an unmapped value fails the build; a test checks the database CHECK lists equal the registry.
- **Said vs observed.** An add-back stores the seller's claimed amount and rationale apart from the verification (status, verified amount, the evidence it rests on). The schedule shows "adjusted EBITDA (as analysed)" and "seller-adjusted EBITDA (as claimed)" side by side, never merged.
- **Unverified add-backs are out by default.** A verified add-back counts at its claim, a partially verified one at the verified amount, an unverified one not at all. Only a reviewer (deal lead or reviewer) can include one — or exclude any — with a reason; the decision is a new version (`inclusion`, `decision_reason`) and an audit event (`qoe.add_back_included` / `_excluded`). Revising an add-back clears the decision.
- **Deterministic arithmetic** (`qoe-1`, `apps/api/src/qoe/qoe-engine.ts`): decimal only (the calculations package's `D`), no model. Net working capital = current assets less current liabilities (cash and debt are never components); the peg is the average of the latest 12 balance-sheet dates (at least 3), with the derivation written out.
- **Into valuation only through findings.** Each adjustment and add-back is drafted as a DRAFT finding (fingerprint `qoe:<entry>:<signal>`, citing its page) whose direction comes from `QOE_DIRECTION_MAP`: an EBITDA-lowering adjustment or an unverified / partially verified add-back is a −1 assumption drag, unpriced ("Needs pricing"); an EBITDA-raising adjustment or a verified add-back is +1 confirmed value, never price paid. A person accepts and prices it like any finding. The schedule itself never writes to a scenario.
- **The peg is a term.** A new lever, `WORKING_CAPITAL_PEG`, joins the term proposals. "Add the peg to draft terms" puts the engine's amount (never a typed one) on the buyer's open draft with the derivation as the note; the seller answers it like any term. It never enters the evaluation, term mix or bridge.
- **Report section.** The pact report (T-110) gains "Quality of earnings (platform-prepared analysis)": the schedule with sources, the register with its status column, and the working-capital table, range, drivers and peg derivation. It reads the QoE view as the generating user, so a seller's report is refused it and leaves it out; `captured.qoeEngineVersion` stamps the version.

## Consequences
- **Not in this slice:**
  - the QoE direction rules live in the domain registry with the `VALUATION_DIRECTION_MAP` rule shape and checks; folding them into the connectors' map needs a change to `packages/connectors`, outside this task's scope;
  - the engine lives in the API (using the calculations package's decimal); moving it into `packages/calculations` is a pure move;
  - models do not yet locate or cite QoE figures: entries are typed with a quote the API verifies. An AI "find the figure" step can propose entries later through the same verification.
- **Migration** `20261220000000_quality_of_earnings` is expand-only. Rollback: drop `qoe_entries` and restore `term_proposals_lever_check` from `20261208000000_buyer_financing` (after removing any `WORKING_CAPITAL_PEG` terms).
