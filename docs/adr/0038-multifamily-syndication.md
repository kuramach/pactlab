# ADR 0038: Multifamily syndication: a sponsor-side pack, offering extraction the sponsor confirms, and a wall between the two sides (T-106)

**Status:** accepted (Kumar, 2026-11-06 and 2026-11-09; scope widened 2026-11-20). PR 1 of 3: the sponsor's side.

## Context
- "Multifamily" covers two deals (Kumar, 2026-11-06):
  - a seller sells a property to a buyer: the Multifamily pack;
  - a **sponsor** buys a large property **and raises the equity from many accredited investors**: a syndication. Three parties, and diligence in two directions: the sponsor diligences the property; the investors diligence the sponsor and the offering.
- Same property core, different seat, different evidence and a different confidentiality shape. As with Venture Raise (ADR 0012), that is a second pack, not a mode inside the first: a mode would make every later Multifamily change ask "which mode?".

## Decision
1. **A new company type, `MULTIFAMILY_SYNDICATION`** (slug `multifamily-syndication`, real-estate cluster). The pack is still the seller's company type (ADR 0009, ADR 0012); there is no second selection mechanism.
2. **Multifamily by reference, never forked.** The registry entry spreads the Multifamily entry: its import targets, calculator (`multifamily-metrics`), finding rules and valuation methods (`NOI_CAP_RATE`, `DCF`) flow through, and a change to Multifamily reaches the syndication pack. The pack adds only:
   - an import target, `SYNDICATION_TRACK_RECORD` (`syndication.prior_deal`): prior deals with projected and actual returns. Blank actuals stay blank;
   - a finding rule, `syndication-track-record-thin` (fewer than three prior deals with actuals);
   - three intake categories offered only by this pack (`PackDefinition.documentCategories`): `OFFERING_PPM`, `OPERATING_AGREEMENT`, `INVESTOR_DECK`, route FILE, read on the Syndication page.
3. **Seats.** The sponsor opens a buyer-led pact (the sponsor is the buyer; buyer personas, valuation and terms apply to the sponsor as buyer). The seller is a target contributor, as today. Investors arrive in PR 2 as guests with their own role (below).
4. **Offering extraction: AI proposes, the sponsor confirms.** Prompt `offering.extract@1` (job type `extraction`) reads one PPM, operating agreement or deck and proposes fees (acquisition, asset management, disposition, other), the preferred return, promote tiers (sponsor share and investor IRR hurdle), a catch-up, and claims (projected IRR, equity multiple, cash-on-cash, occupancy, NOI growth, exit cap, track-record statements).
   - **Grounding in code:** an item is kept only when its quote is on the cited page (`SourceIndex`) **and** every figure it gives is written in that quote (`figuresIn`). Anything else is dropped and counted.
   - **Drafts:** kept items land `PROPOSED` in `syndication_offering_items`. A person confirms (optionally correcting the figure, which must still be in the quote) or rejects each. A term typed by hand goes through the same quote and figure checks.
   - **Only CONFIRMED items feed the math.** The operating agreement governs the waterfall; the PPM and deck are what the checks compare against it.
   - **No AI available:** extraction fails with the existing AI messages and nothing is lost; terms can be entered by hand. Demos and tests use the scripted `demoModelResponse`.
5. **Deterministic waterfall** (`@pactlab/calculations` `syndication/waterfall.ts`, `syndication-waterfall-1`), decimal only: annual periods, interest-only debt, the acquisition fee from the raise, the asset-management fee each year, the disposition fee at sale, then a European waterfall with IRR hurdles (pref compounding annually, then each promote tier to its hurdle). It returns LP and sponsor distributions, LP IRR, equity multiple and average cash-on-cash, **with its conventions**. Not modelled, and said so: a GP catch-up, sponsor co-investment and other fees. Every result is labelled "Scenario computed from stated assumptions — not a projection or promise".
6. **Offering checks** (`offeringChecks`, `syndication-offering-1`): over the confirmed items and the base-case waterfall, they draft findings into the one findings register (fingerprints, citations, a named reviewer) and record each claim in the T-071 claims register (origin `PACK_RULE`) as VERIFIED, CONTRADICTED or UNVERIFIED, linked to its finding:
   - stated IRR, multiple or cash-on-cash against the recompute (1 point, 0.1×, 1 point);
   - track-record claims against the imported actuals; no actuals is UNVERIFIED and a gap finding, never a blank;
   - occupancy against the rent roll;
   - NOI growth and exit cap stay UNVERIFIED: assumptions, tested as scenario inputs, never facts;
   - an operating-agreement fee missing from, or different in, the PPM's fee summary;
   - the PPM's preferred return or promote splits against the agreement's.
   Offering defects are **neutral (direction 0)**: they are corrected in the documents and disclosed; they never change the property's price.
7. **The wall, in the data layer.** `syndication_offerings` and `syndication_offering_items` are the sponsor's own side under RLS (`app_is_buyer_side`), and every route requires `BUYER_ANALYSIS_READ`. The seller (a target contributor) gets 403 and the tab is never listed for them. Tests assert the seller's responses carry no raise content.
8. **Guardrail.** Diligence support only: not legal advice, no accreditation determination, no securities-offering or broker-dealer function. Shown on the page and carried by the API view.

## Still to come (planned, same task)
- **PR 2, investors:** a new deal role `INVESTOR` with `syndication_investors` rows (the BIDDER/`bid_id` pattern of ADR 0015, `app_current_investor_id`), investors invisible to each other; accreditation status per investor (self-certified, third-party verified, pending, not accredited, plus a provider link and an evidence pointer; Pactlab verifies nothing); a published, frozen **investor view** built from an allow-list (the property findings the sponsor publishes, the claims register, the track record, the waterfall check, the return scenarios), which can never carry the price position, persona runs, the confirmed-value ledger, terms or the negotiation brief; wall snapshot tests both ways; planted defect (d).
- **PR 3:** the site's industry page, written as available, and release in `RELEASED_COMPANY_TYPES` and `RELEASED_INDUSTRY_SLUGS`.

## Consequences
- The pack is visible in preview environments (dev, qa, local) and not on stage or live until released.
- Demo data: `pactlab-demo-data/multifamily-syndication/{USD,EUR,GBP}` (Ashgrove Residential, Briarwood Commons, 204 units) with planted defects (a) to (c); the demo organization builds a syndication pact whose offering documents are never shared with the seller.
- **Migration** `20261227000000_multifamily_syndication` is expand-only: two enum values and two tables. Rollback: drop both tables; the enum values stay unused.
