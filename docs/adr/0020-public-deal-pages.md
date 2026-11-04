# ADR 0020 — Public deal pages: a seller's teaser, signed-out requests, approval into the bid process

Status: accepted (2026-11-04)

## Context

A seller running a pact wants to market it. Interested buyers should be able to leave their details; the seller approves them; the buyer then signs in and sees the deal.

Until now, everything in Pactlab sat behind sign-in and row-level security (RLS). The seller-led sale (ADR 0015) already has a seller-run bid process. In it, the seller invites a bidding firm, the bidder accepts the NDA, and the bidder sees only their own bid.

Decided with Kumar:
- **The seller chooses visibility:** anonymous under a codename by default, or named.

## Decision

1. **A listing per pact (`deal_listings`), written by the seller's side.**
   - **Public content:** only seller-authored teaser text (codename, headline, sector, region, size band, optional asking range, summary, highlights). Nothing is read from evidence, findings, valuation or the pact itself.
   - **Names:** the company name is shown only when the seller chooses Named.
   - **Link:** an unguessable slug (`pl-` plus 10 characters).
   - **Lifecycle:** Draft, Published or Closed. Pages are `noindex` unless the seller allows indexing.
2. **Signed-out access goes only through SECURITY DEFINER functions owned by a new no-login role, `pactlab_public`**: the same pattern as `pactlab_auth` and `pactlab_ops`.
   - **Grants:** column-limited.
   - **What the role may do:**
     - read published teasers;
     - insert, confirm and housekeep requests;
     - append one audit action, `listing.interest.received`.
   - **What the API holds:** no table rights for signed-out callers.
3. **Requests (`listing_interests`) reach the seller only after the requester confirms their email.**
   - **Link:** a one-time link valid for 7 days, with a confirm button rather than auto-confirm, so mail scanners cannot confirm.
   - **Rate limits:** per address and per listing, and one open request per email per listing. Addresses are stored only as keyed hashes.
   - **The public answer is always "check your email"**, so it never reveals whether a request was recorded, refused, or a duplicate.
   - **A honeypot field** catches simple bots.
4. **Approval feeds the existing bid process, without a parallel access path.**
   - The requester's firm becomes a bid (an existing one with the same name is reused), and the requester is invited as a bidder.
   - The invitation email names the pact by its codename when the page is anonymous.
   - Nothing beyond the teaser is visible until the bidder accepts the NDA (`SaleService.openBid` and `mine`).
   - A declined requester is emailed, with the seller's note if any.
5. **Retention:** unconfirmed requests are deleted after 7 days, declined ones 90 days after the decision. Approved requests live on as the bid and invitation.

## Consequences

- **The first unauthenticated surface that reads tenant tables.** Its exposure is limited by the function bodies and the column grants. Tests cover:
  - teaser-only output, and nothing for draft or closed pages;
  - no direct reads by the runtime role;
  - rate limits;
  - cross-tenant 404s;
  - the full end-to-end flow.
- **Before the NDA, the invitation page still shows the pact's name and the seller organisation's name**, as it already does for seller-invited bidders (ADR 0015). Sellers should give an anonymous pact a codename-like name. Hiding these on the invitation page needs a label stored on the invitation; that's a follow-up.
- **The audit chain trigger runs as the inserting role**, so `pactlab_public` can read the chain columns (organization, deal, sequence, hash) of `audit_events`, and nothing else.
