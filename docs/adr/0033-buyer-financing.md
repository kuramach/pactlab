# ADR 0033: Buyer financing: buyer-attested, shown to the seller as structure, status and coverage (T-117)

**Status:** accepted (2026-11-14)

## Context
- The flow had no buyer-financing step. The only funds element was the closing payment (ADR 0022). A seller choosing a buyer, or comparing bidders, could not see how the deal would be funded: cash, an SBA 7(a) loan, conventional debt, a seller note, rollover equity, or earnest money in escrow. That is the seller's core certainty-of-close question.

## Decision
- **One plan per buyer on a pact** (`financing_plans`): the own side of a buyer-led pact (no bid), or each bidder on a seller-led pact (ADR 0015), keyed by the bid. The plan holds:
  - **tranches:** kind, amount (decimal, with currency), status on a ladder NOT_STARTED → EXPLORING → PRE_QUALIFIED → APPLICATION_SUBMITTED → COMMITMENT_ISSUED → CLEARED_TO_CLOSE, a label the seller sees, and a buyer-only note;
  - an optional commitment-expected-by date;
  - **earnest money** (`financing_escrows`): amount, the third-party holder (title company, attorney, broker; never Pactlab), deposit-due and hard dates, and refund conditions. Its status runs NOT_COMMITTED → COMMITTED → DEPOSITED → APPLIED_AT_CLOSE / RELEASED_TO_SELLER / REFUNDED_TO_BUYER;
  - **documents** (`financing_documents`): PDF only, through the existing upload checks and malware scanner, stored under the plan.
- **Visibility.** Row-level security enforces it; the service shapes it.

  | | Buyer (the plan's own side or bidder) | Seller (the seller's contributors; on a seller-led pact, the seller's side) | Another bidder | Another organization |
  |---|---|---|---|---|
  | Tranches: kind, amount, status, label, dates | ✓ | ✓ | — | — |
  | Coverage, posture, blockers | ✓ | ✓ | — | — |
  | Buyer notes | ✓ | — | — | — |
  | Documents | all | **shared ones only** (per document, revocable; every share, unshare and read audited) | — | — |
  | Earnest money | ✓ | ✓ (confirms or disputes the deposit) | — | — |

  - `app_is_financing_buyer(deal, bid)` and `app_is_financing_seller(deal, bid)` decide every policy. A bidder matches only their own bid (`app_current_bid_id`).
  - A document that is the proof of a recorded deposit cannot be unshared.
- **Attestations, labelled as such.** Amounts and statuses are the buyer's. The seller's views say "Buyer-provided", and a tranche shows "document-backed" only when a document the reader can see is attached to it. From PRE_QUALIFIED up, the buyer is asked to attach one. There are no lender integrations, credit checks or loan origination.
- **Deterministic posture** (`@pactlab/calculations` `financing`):
  - **Coverage** is the decimal sum of the tranches against the price. That price is the agreed headline price, else the latest proposed one; on a seller-led pact, the bid's latest offer.
  - **Firm money** is a lender commitment or better, or proven cash, equity or a seller note (pre-qualified or better).
  - **Levels:** NONE, EARLY, IN_PROGRESS, COMMITTED (firm money covers the price) and CLEARED.
  - **Blockers:** coverage below the price; a commitment-expected date passed without a commitment; an earnest deposit past due.
- **Where it shows:**
  - the pact's Financing tab, with a per-bidder comparison for a seller-led seller;
  - the pact overview;
  - the close checklist (`missing`). Order: the financing contingency, then the financing blockers, then the earnest deposit (the seller confirms; a disposition is recorded), then the funds transfer, which stays the end of the chain;
  - the IC pack's blockers;
  - the pact report, as the reader's view (a seller's report has the seller layer only).
- **Financing contingency term:**
  - `FINANCING_CONTINGENCY` joins the proposed-term levers, with `term_proposals.due_on` (required for it, and only for it);
  - the buyer adds one to a draft, and the seller may draft one;
  - it is answered, countered and agreed like any term, and is shown with its date on the term sheet and the LOI;
  - once agreed, the close checklist holds it open until the plan reaches COMMITTED.
- **Never price.** Financing does not enter valuation, the persona term mix, findings or directions, and no financing-derived finding type exists. The earnest deposit is distinct from the ESCROW holdback term (a remediation holdback from findings); both can coexist.

## Consequences
- Seller-led pacts close on a linked buyer-led pact (T-097) or on the winning bid; `closingFinancing` uses the buyer-led plan, or the plan of the WON bid.
- **Rollback:** drop the `financing_*` tables and `term_proposals.due_on`, and restore the lever check from `20261126000000_two_sided_close`. Nothing else reads them.
