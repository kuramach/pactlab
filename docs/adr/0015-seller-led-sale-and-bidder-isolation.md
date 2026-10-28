# ADR 0015 — Seller-led sale: the seller runs a bid process; bidders never see each other

Status: accepted (T-097, 2026-10-28; decisions by Kumar, two open points below)

## Context

Until now every pact started on the buy side. Kumar (2026-10-28) asked for
the other direction too: a seller, or its banker, opens the pact and invites
several buyers (PE firms, corp-dev teams, strategic acquirers). Each looks at
what the seller shares, asks questions, then offers or passes. A VC raise
has the same shape (ADR 0012).

## Decision

1. **Who opened the pact is a pact property.** `deals.initiated_by` is
   BUYER (default; today's flow, unchanged) or SELLER. A seller-led pact
   names no buyer and has a `sale_processes` row: round, offer deadline,
   shared summary, data-room link, NDA text, status, awarded bid.
2. **The seller's team holds the pact's own-side roles.** This is the seat
   flip of ADR 0012. Bidders are **guests** (ADR 0014) with a new deal role,
   **BIDDER**. Every membership names its bid (`deal_memberships.bid_id`), so
   one firm can bring several people.
3. **A bidder is a counterparty.** `app_is_buyer_side` and
   `app_is_buyer_analyst` now exclude BIDDER as well as TARGET_CONTRIBUTOR,
   and the API's counterparty checks go through `isCounterpartyRole`. Every
   existing own-side-only table therefore stays closed to bidders with no new
   policy.
4. **Bidders never see each other.** This is the new boundary, enforced in
   row-level security:
   - `bids`, `bid_offers` and `bid_questions`: a bidder reads only rows of
     their own bid (`app_current_bid_id(deal)`).
   - The seller's side reads all of them.
   - A bidder may move their own bid only to ACTIVE, OFFERED or PASSED,
     never SHORTLISTED, DECLINED or WON.
   - A bidder writes offers and questions only for their own bid, as
     themselves.
   - Offers are append-only: a revision is a new version.
   - **Answers to all** are copied into `bid_answers_published` with no bid
     id, so no column can reveal who asked. Private answers stay on the
     question row, which only the asker's bid can read.
   - **People:** `deal_memberships_select` shows a BIDDER membership only to
     the seller's side and to colleagues on the same bid. The users policy
     lists "people on your pacts" through that table, so names follow.
     `app_is_own_side` and `app_current_bid_id` are security-definer
     functions owned by the auth role, so this policy does not recurse.
5. **The NDA gates everything shared.** Until a bidder accepts the NDA,
   their view shows only the NDA. The shared summary, data-room link,
   published answers and shared documents stay closed.
6. **The shared view is an allow-list.** It is the seller's summary, the
   link into their own data room (Pactlab is not the data room; ADR 0016),
   published answers, and documents the seller shared **at upload**.
   Document visibility stays immutable after upload: an earlier decision
   that this ADR keeps rather than weakens.
7. **Rounds, shortlist, award.**
   - **Next round:** shortlisted bids go on to round N+1. Every other live
     bid is declined, and its memberships and pending invitations are
     revoked.
   - **Award:** marks one bid WON, which must have made an offer. Every other
     live bid is declined and revoked. The process closes.
   - **Records stay:** declined firms keep their records; only access ends.
   - **People decide:** Pactlab never ranks or recommends (ADR 0012 decision 6).
8. **Venture Raise keeps its offer model.** A bidder in a seller-led Venture
   Raise pact submits an offer with a pre-money. The founder chooses **Add to
   round comparison**, which creates a `venture_offers` term sheet so the
   existing round model and comparison run unchanged. *Deviation from the
   brief*, which asked to merge the two offer models. Merging would have
   meant migrating a shipped feature for no user-visible gain. Flagged for
   Kumar.

## Open points for Kumar

- **The winner's diligence.** The brief's default was "the same pact". But
  the seller owns this pact, so the winner cannot keep buyer-confidential
  analysis in it: everything they write would be visible to the seller's
  side. Proposal: on award, the winner starts a **linked buyer-led pact in
  their own organization**, prefilled, with the seller invited as a target
  contributor. Not built; the award itself is.
- **Bidder teams** are supported: several people per firm, invited one by one.
- **NDA** is a click-through on the seller's text, recorded with who and
  when. An uploaded signed NDA can follow.

## Consequences

- Migrations: `20261114000000_bidder_role` (enum value, on its own) and
  `20261114000100_seller_led_sale`. Both only add tables, columns and
  functions. Rollback: drop them and restore the functions and policies named
  in the migration header.
- Any new deal-scoped table follows the existing pattern and stays closed to
  bidders. A table bidders should read needs an explicit
  `app_current_bid_id` policy.
