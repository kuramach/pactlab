# ADR 0012 — Venture Raise: a founder-side pack, competing offers and the investor view

Status: accepted (T-083, 2026-10-25; decisions by Kumar)

## Context

Every pack until now is buyer-side: an acquirer diligences a target. Kumar
asked for a pack for founders raising money from VCs, angels or incubators.
The founder is the one being diligenced, often by several investors at once,
and the round reprices on what they find.

## Decision

1. **Pack selection stays "the seller's company type".** A new type,
   `VENTURE_RAISE`, is the founder's own startup; the startup's sector is an
   optional field on the round. No second selection mechanism.
2. **The seat flips without a new deal model.** The founder's team holds the
   buyer-side roles of the pact (RLS buyer side); investors are not users.
   Founder-confidential analysis is everything in the deal; the investor view
   is the one explicit outward surface.
3. **Competing offers inside one pact** (Kumar, 2026-10-25). Each investor's
   bid is a `venture_offers` row; the round model runs per offer and the
   comparison shows mechanics side by side. No ranking, no recommendation.
4. **Round mathematics is deterministic and stated.** The model's
   conventions (fully diluted pre-money with the pool shuffle and converting
   instruments, conversion at the lower of cap and discount, MFN, no note
   interest, whole shares) are returned with every result. Valuation method
   `ROUND_PRE_MONEY` puts the founder's ask through the existing bridge.
5. **Claims from rules.** A rule proposal may settle a claim; the runner
   records it in the T-071 claims register (origin `PACK_RULE`). Generic: any
   pack may use it.
6. **No legal advice.** Terms are explained as consequences; Pactlab never
   says whether to accept one.

## Consequences

- The investor view's contents are an allow-list, tested to exclude every
  finding, unverified and contradicted claims, other bids, cash and runway.
- Readiness "data room complete" is a view, not a finding: it depends on the
  counterparty, which rules cannot see.
- A founder raising with no cap table import gets readiness and offers but no
  round model (422 `CAP_TABLE_REQUIRED`).
