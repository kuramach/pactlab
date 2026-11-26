# ADR 0045: Market rents from RentCast, cited as evidence; no Zillow scraping (T-158)

**Status:** accepted (Kumar asked for real-estate market data, 2026-11-25).

## Context
- A buyer of a multifamily property wants in-place rents checked against the market, not only against the rent roll's own market-rent column, which the seller fills in.
- Kumar asked whether Pactlab could scrape Zillow. Zillow's terms of use prohibit scraping, and its official data programs (Bridge, the Zillow API) need an approval Pactlab doesn't have.
- RentCast was already integrated for teaser-page property facts (`RentCastPropertyProvider`), but no deployed environment passed a key.

## Decision
1. **No Zillow scraping, now or as a fallback.** Market data comes only from providers Pactlab has terms with. A Zillow programme can be added behind the same seam if an approval ever comes.
2. **RentCast is the market-rent source** (`GET /v1/avm/rent/long-term`, read 2026-11-25), behind `MarketRentProvider` in `@pactlab/connectors`: `RentCastMarketRentProvider` live, `FixtureMarketRentProvider` (deterministic, synthetic) in dev, tests and e2e. A hand-built cassette (`fixtures/cassettes/rentcast/`) covers parsing. CI never calls RentCast.
3. **The key is a platform credential:** `pactlab/<env>/credentials/rentcast-api-key`, created `unset` by CDK, set with `scripts/rentcast-key.sh`. It's passed to the API task only, as `RENTCAST_API_KEY`, and the execution role's grant names that one ARN. Without a key, production turns market rents (and teaser property facts) off, and the screen says so.
4. **One estimate per floor plan.** The rent roll's units are grouped by bedrooms and bathrooms, read from the unit type ("1BR", "2BR/2BA", "2x1", "Studio") or from bedroom and bathroom fields, with the median square footage of each group. Each group gets one call: `propertyType` `Apartment`, `compCount` 15.
   - **Cap: ten calls per retrieval.** RentCast's plans include 50 (Developer) to 25,000 (Scale) requests a month, with overage billed per request, and a hard limit of 20 requests a second.
   - Floor plans over the cap are listed, not checked.
5. **Estimates are evidence.** Each is a `market.rent_estimate` item, written through the sync engine on a per-pact `rentcast` connection (buyer-only). It holds the estimate and its range, the comparables' count and their median distance and similarity, the retrieval date and the source.
   - The fingerprint is address, floor plan and date. A same-day re-run makes no call and adds nothing; a later day's estimate supersedes, with lineage.
   - Comparables keep only their listing (the address as returned, rent, distance, similarity), shown on the citation view.
   - No people data is involved.
6. **Who can run it:** the buyer side with `BUYER_ANALYSIS_READ`, and `DEAL_WRITE` to retrieve or store the address (it writes evidence and spends calls). A counterparty gets 403. Every retrieval is audited as `market_rents.retrieved`, and the address as `deal.property_address_set`.
7. **The address** is the pact's own (`deals.property_address`, new) or its listing's. With neither, the screen asks once and stores it on the pact.
8. **The figures are deterministic** (`multifamily-metrics-2`):
   - **Market rent, annual (from RentCast):** the estimate for each occupied unit's floor plan, summed × 12.
   - **Loss-to-lease vs market (from RentCast):** Σ(estimate − in-place) ÷ Σ estimate, over occupied units.

   Each figure cites the estimates it uses and states its coverage. The rent roll's own loss-to-lease stays, labelled "from the rent roll". Until estimates exist, the figures are missing with `needs: ['MARKET_RENTS']`, and the card offers the retrieval instead of an ask of the seller. Estimates in another currency are never mixed in; market rents are checked for USD pacts only.
9. **The finding rule** `multifamily-below-market-range` (version 1) drafts when at least 25% of the occupied units with an estimate, and at least two of them, rent below the low end of their plan's range. It cites the estimates and the units. It's upside (confirmed value, never a price increase) and stays a draft for review.

## Consequences
- Migration `20270107000000_market_rents` is expand-only: a nullable `deals.property_address`, plus `rentcast` added to the connection credential check (LIVE without a tenant credential). Rollback: delete the rentcast connections' evidence, drop the column and restore the check from `20261024000000_fintech_pack`.
- RentCast estimates are market data, not appraisals. The finding says to confirm them with a local rent survey.
- Operating: `docs/runbooks/rentcast.md`.
