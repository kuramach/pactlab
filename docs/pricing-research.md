# Pactlab pricing research — extracted

Compiled 2026-11-09 from the record: the original pricing work (2026-09-30), a competitor assessment (2026-10-07), and how the model was operationalised in task T-087 (2026-10-26) and T-093 (resellers).

**Status:** the numbers below are working hypotheses to validate in pilots, not final prices. Final price points were never set — that decision is the open gate on T-087 (Pricing + Stripe), which builds with test-mode placeholders until then.

---

## 1. The original pricing model (2026-09-30, Kumar approved)

Per-deal pricing, tiered by target size — not per-seat.

**Why per-deal:** M&A is episodic, not daily-use software. A PE firm might run ~5 tech deals a year — per-seat pricing would under-monetise badly. Platform costs are per-deal too (~$3.5–10.50 in AI tokens per deal), so margins stay clean at any price point.

**The anchor:** traditional tech diligence runs **$50k–$300k+ per deal** and takes weeks. Price at a fraction of the displaced cost:

| Target ARR | Price per deal |
|---|---|
| Under $10M | ~$5k |
| $10–50M | ~$12k |
| $50M+ | ~$25k or custom |

**Plus an annual platform fee** for repeat acquirers — ~$30k/yr for the firm (unlimited seats, pipeline/CRM always on), with deals billed on top or a block of deals included. This smooths revenue between their deal cycles.

**The "prices itself" pitch:** one finding — inflated ARR, a copyleft landmine, a key-person flight risk — can move the purchase price by millions. The platform pays for itself 100× over on a single catch.

**Guardrail:** avoid %-of-deal-value pricing — it creates procurement friction and weird incentives.

**Pilot pricing:** flat $5k for the first deal, no platform fee. Get logos and case studies first, optimise price later.

## 2. Competitor anchor (2026-10-07)

**MoneySoft DealSense** — the closest priced comparable found. Middle-market M&A financial modelling and reporting (normalisation, projections, valuation, deal structuring), Windows-desktop. Priced at **$1,595 for a single-seat subscription, $795 renewal**. It overlaps only the valuation-workbench slice: it has no evidence→finding diligence loop, no SaaS-system ingestion, no document AI, no priced risk register. Noted in T-087 as the "valuation-only competitors ~$1,595/seat" reference point — i.e., the per-seat world Pactlab's per-deal model deliberately prices against.

## 3. How it was operationalised — T-087 (2026-10-26)

The Sep 30 model became the billing structure (prices as configuration — a price book of Stripe price IDs — never hardcoded):

- **Per-pact purchase** as the core unit (one payment = one pact, full modules). This is the $5k/$12k/$25k tier idea in product form.
- **Firm subscription** row (annual, pact allowance + overage) for PE firms and advisors — the $30k/yr platform-fee idea in product form.
- **Venture Raise founder-priced row** — cheaper entry pricing for founders raising.
- **pilotMode orgs stay free**, never paywalled (the $5k pilot offer generalises to free design-partner pilots).
- Access states: active → full; past_due → grace (existing pacts completable, no new pacts); cancelled → read-only archive (the diligence record is never held hostage).
- Go-live gated on Kumar setting the real price points + explicit go; everything builds and accepts in Stripe test mode.

## 4. Reseller economics layered on top — T-093 (Kumar's terms)

- Commission on revenue actually collected: **15% year 1 / 10% year 2 / 5% year 3**.
- Customers who come through a reseller get **10% off year one**.
- These figures are confidential — they appear on no public surface (the task includes a test proving it).

## 5. What is still undecided

- The actual per-pact price points (do the $5k/$12k/$25k tiers stand, and what exactly does a tier key on — target ARR vs deal value?).
- The subscription's allowance size and overage rate.
- The Venture Raise founder price.
- Whether the first pilot cohort is $5k flat or free under pilotMode.
