# ADR 0025: Pricing and packaging (T-087)

**Status:** accepted (Kumar, 2026-11-09)

## Context
Live keeps manual organization approval until Pactlab can charge (2026-11-05). T-087 designed the billing engine, with prices as data, and left the numbers to Kumar. A competitor review on 2026-11-09 (sources below) found:
- **AI research tools** sell per seat (Hebbia about $10k per seat per year, Rogo about $3.3k; estimates).
- **Deal-management tools** sell flat or by module (DealRoom $1–3k a month with unlimited users, published; Midaxo median about $52k a year, estimate).
- **Data rooms** sell per page or per project (Firmex about $5–10k per 3-month project; Datasite and Intralinks often above $50k per deal).
- **Per-deal AI diligence** is emerging (Keye about $5–15k per active diligence, estimate).
- **Sellers** pay $75–200 a month to list (BizBuySell), or nothing (Axial).
- **Founders** pay $59–300 a month (Visible, DocSend).
- **Buyers already spend** $25–50k on a QoE report and $150–400k in third-party diligence on a lower-mid-market deal.
- **Pactlab's own AI cost** is about $3.5–10.5 per pact (spec §AI cost planning).

## Decision
Per-deal pricing is the core unit, with subscriptions for repeat buyers. Every plan has unlimited users. Counterparty guests are always free.

| Plan | Price (USD) | Includes | At launch |
|---|---|---|---|
| **Pact** | $2,500 one-time | One buyer pact, every module, live for 12 months, then read-only forever | Yes |
| **Team** | $18,000 a year (shown as $1,500 a month), or $1,800 monthly | 10 pacts a year; extra pacts $1,500 each | Yes |
| **Venture Raise** | $99 a month, $990 a year, or $500 per round; the readiness screen is free | Founder-side pact | Yes |
| **Firm** | $42,000 a year (shown as $3,500 a month) | 30 pacts a year; extra $1,500 each; company SSO; `mcp:confidential`; DocuSign; invoice billing; priority support | In the price book, offered on request |
| **Sell-side** | $1,500 per sale | Seller-led pact with teaser, bidders, Q&A and close; live for 6 months | In the price book, offered on request |
| **Enterprise** | custom | | Sales-led |
| **Pilot** (`pilotMode`) and counterparty guests | free | | Yes |

- **One pact price for every pack** at launch. Complex packs may get their own price-book row later.
- **After the live period** (12 months for Pact, 6 for Sell-side), a pact becomes read-only, never deleted. A customer's diligence record is never held hostage. A further fee may reopen it.
- **Annual billing** gets two months free; Team's monthly option is priced to reflect that.
- **Design partners** move to Team at 50% off for their first year (a Stripe coupon), or stay on pilot while their pilot agreement runs.
- **MCP:** read access (`mcp:read`) comes with every paid plan; `mcp:confidential`, company SSO and DocuSign come with Firm.
- **Prices are data:** price-book rows hold Stripe price ids and display copy, never literals in code. Changing a price is a price-book change, not a release.
- **Currency:** prices are in USD. Stripe presents local currency where enabled (GBP for UK customers). Business customers only: UK and EU customers account for VAT under the reverse charge, and their VAT number is collected at checkout. The US sales-tax setting (Stripe Tax) is decided with a CPA before go-live.

## Consequences
- **Build:** T-087 builds this in Stripe test mode. Going live needs a legal entity, an EIN, a business bank account, an activated Stripe account, Terms, Privacy and DPA pages, and the tax setting. Then live sign-up approval is switched off.
- **Review:** prices get a review after the first 10 paying customers, feeding into T-088's go-to-market work.

## Sources (2026-11-09)
- **Deal management:** DealRoom pricing (Capterra, datarooms.co).
- **Data rooms:** Ansarada pricing guide; Papermark and Peony data-room cost guides.
- **AI research and diligence:** Hebbia and Rogo estimates (insearch.ai, investables.ai); AI due-diligence tools 2026 (CT Acquisitions; Devaland).
- **Enterprise M&A platforms:** Midaxo and DealCloud alternatives (corpdev.ai).
- **Deal data:** PitchBook pricing (investordatarooms).
- **Sellers:** BizBuySell fees (Baton); Axial pricing (raises.com).
- **Founders:** DocSend pricing (Peony); Visible pricing.
- **Diligence spend:** QoE report cost (Bedrock); buy-side diligence cost (Papermark).
