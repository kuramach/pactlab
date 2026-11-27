# Pactlab pricing research — extracted

Compiled 2026-11-09 from the record: the original pricing work (2026-09-30), a competitor assessment (2026-10-07), and how the model was operationalised in task T-087 (2026-10-26) and T-093 (resellers).

**Status:** sections 1–5 are the research record. **Section 6 is the adopted per-deal model** (Kumar, 2026-11-26, T-177): it supersedes the per-pact price points those sections left open, and the 2026-09-30 guardrail against pricing as a percentage of deal value.

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

**Guardrail:** avoid %-of-deal-value pricing — it creates procurement friction and weird incentives. *Superseded 2026-11-26 (section 6): a small, capped, declining size component on top of a fixed fee.*

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

*Answered by section 6 for per-deal pricing: the per-pact price is $5,000 fixed plus a size variable on enterprise value, and the pilot cohort is $5,000 flat. The subscription allowance, overage and Venture Raise subscription prices stay as ADR 0025 sets them.*

## 6. The adopted model: a fixed fee plus a small size variable (Kumar, 2026-11-26, T-177)

**The model.** Every pact pays a **fixed fee** plus a **variable** that scales with the deal's enterprise value. A $100M deal carries far more documents and complexity than a $10M deal; one price for both ignores that. The variable is a small percentage on a declining scale, capped, so it stays a modest addition and never the headline.

| | USD book |
|---|---|
| Fixed fee per pact | $5,000 (the workspace, packs, evidence and findings machinery, with a base document and AI allowance) |
| Variable, first $25M of enterprise value | 5 bps (0.05%) |
| Variable, $25M–$100M | 2 bps |
| Variable, above $100M | 1 bp |
| Variable cap per deal | $50,000 |
| Pilot | $5,000 flat, no variable |

**Worked totals:**

| Enterprise value | Fixed | Variable | Total |
|---|---|---|---|
| $10M | $5,000 | $5,000 | **$10,000** |
| $25M | $5,000 | $12,500 | **$17,500** |
| $50M | $5,000 | $17,500 | **$22,500** |
| $100M | $5,000 | $27,500 | **$32,500** |
| $250M | $5,000 | $42,500 | **$47,500** |
| $500M | $5,000 | $50,000 (capped; uncapped $67,500) | **$55,000** |

These are reproduced exactly by the quote tests (`packages/domain/src/pricing/pricing.test.ts`).

**Why the change from "never a percentage of deal value".** The 2026-09-30 guardrail feared procurement friction and incentives tied to the price. The adopted variable avoids both: it is a few basis points, declining, capped at $50,000, and computed on the enterprise value the pact itself declares at purchase (the same figure its IC and LOI surfaces use), never on the price finally paid. It prices the real cost driver (documents and AI scale with the deal), and the scale it pays for is shown to the buyer at checkout as the document count and AI budget included.

**Rules that come with it:**
- **Config, never code:** the fixed fee, bands, cap, pilot rate and each band's inclusions live in a versioned price book Kumar edits in the admin console; a quote binds to the version live when it is made.
- **No true-up:** the variable is on the enterprise value declared at purchase. Truing it to the valuation's base case is a later decision, not taken.
- **Every market its own book:** USD, EUR, GBP, JPY and INR books with locally sensible numbers, each rounded in its own currency (whole yen, round rupees); the deal's currency picks the book, and nothing converts silently.
- **Discounts:** T-093's reseller first-year 10% applies to the total; a promo and the reseller discount do not stack unless the promo says so (the better single discount wins); commissions accrue on what is collected, variable included.
- **Public copy:** the site may say "a fixed per-deal fee plus a small size-based component — a $10M deal and a $100M deal don't cost the same", with the $5,000 fixed fee and the pilot rate. The full band table is shown at checkout and in the sales conversation. Reseller commission figures stay non-public (T-093).
- **Venture Raise** uses the same shape on the raise size.

