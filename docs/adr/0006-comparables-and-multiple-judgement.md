# ADR 0006 — Comparables ground the multiple; the deal lead judges the ask

Status: accepted (2026-10-11)

## Context

Sextant valued a business as ARR × a multiple with no context for the
multiple. A buy-side deal lead needs to see where a multiple, and the
seller's asking price, sit among past deals and peers — and to record a
judgement of whether the ask is in range, high or low.

## Decision

- **Comparables are organization-wide** (`comparables`), reusable across
  deals and visible only to the buying firm's buy-side people (RLS via
  `app_is_buyer_analyst()`); target contributors never see them.
- **Every comparable says where it came from**, enforced by a CHECK:
  `ENTERED` needs a cited source; `PROVIDER` needs a provider name and data
  version; `OWN_DEAL` points at the firm's deal; `SYNTHETIC` rows must be
  named "Synthetic …" and exist only through the demo seed (the API never
  accepts them). Rows are never edited or deleted, only retired.
- **Own deals** become precedents by an explicit act of the deal lead, only
  after an approved valuation, at the risk-adjusted enterprise value (price
  reductions applied, escrows not). Numbers only — no documents.
- **The benchmark is deterministic** (`benchmark-1` in
  `@pactlab/calculations`): EV ÷ ARR quartiles by linear interpolation,
  mid-rank percentiles for the scenario's and the ask's multiples, and the
  target's measured growth/NRR/GRR against the comparables' medians. It
  describes; it never sets a price. A deal never benchmarks against itself.
- **The judgement is human** (`multiple_judgements`, append-only, buyer side,
  deal lead only). It stores the ask version and a hash of the comparable set
  it was made against, so a later change to either shows it as out of date.
- **Market data providers** sit behind the `ComparablesProvider` port; only
  a not-configured stub exists. Adding a paid provider needs approval.

## Consequences

EV ÷ ARR only for now; EV ÷ revenue and EV ÷ EBITDA, FX conversion of
comparables and a live provider are later work.
