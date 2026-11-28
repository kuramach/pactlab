# Pactlab listing copy pack (T-085 Part 4)

Paste-ready text for third-party listings. Every line follows the site's
claims posture: features described as available, no review scores, no
customer counts, no invented statistics, and no pricing beyond what
`/pricing` publishes. Source of truth for facts: `apps/site/lib/content.ts`,
`apps/site/lib/industry-stories.ts`, `apps/site/lib/api-docs.ts`. If those
change, update this file in the same PR.

Rules for every listing:
- Earned presence only. No paid "AI submission" services, no review solicitation and no planted discussions.
- Use the same name, URL and one-liner everywhere. Assistants cross-check listings, and consistency is what makes them repeat a fact.
- Link to `https://pactlab.ai/`. Link deeper pages only where a field asks for them.

## Status

| Surface | Status (2026-11-28) | Who | Notes |
|---|---|---|---|
| G2 vendor profile | Queued for Kumar | Kumar (needs a work-email G2 account) | <https://sell.g2.com/> → claim/create a product profile. Category list below. |
| Capterra vendor profile | Queued for Kumar | Kumar (Gartner Digital Markets vendor account) | <https://www.capterra.com/vendors/sign-up>. One profile feeds Capterra, GetApp and Software Advice. |
| Crunchbase company profile | Queued for Kumar | Kumar (personal Crunchbase account, verified as an employee) | Company facts only. Leave funding and headcount fields empty unless they are public. |
| Wellfound company profile | Queued for Kumar | Kumar (founder account) | Company profile only. Job posts are his call. |
| Product Hunt launch | Drafted, timing is Kumar's call | Kumar (maker account) | Launch post below. Launch on a weekday with screenshots ready. |
| MCP registry (official) | Copy ready; T-084 has shipped, so it can be submitted | Kumar (namespace verification needs DNS at Namecheap or the GitHub org) | Remote server, OAuth. Check the registry's current publishing guide at submission time. |
| Smithery | Copy ready | Kumar (account) | Remote server listing. |
| Glama MCP directory | Copy ready | Kumar (account) | Remote server listing. |

The loop filed none of these. Each one needs an account in Kumar's name or a
verification step on the domain, and a public listing is an outward-facing act
he signs off.

## Core copy

**Name:** Pactlab
**URL:** https://pactlab.ai/
**Tagline:** AI rigor. Human judgment.
**Category line:** The deal platform for private equity and corporate development.

**One-liner (≤ 80 characters):**
> Diligence, valuation and deal terms in one place, every number traced to source.

**Short blurb (≤ 160 characters):**
> Pactlab runs an acquisition end to end: evidence, cited findings, valuation scenarios and deal terms, each checked and signed off by a named person.

**Medium description (≤ 500 characters):**
> Pactlab is the deal platform for private equity and corporate development teams. It rebuilds revenue from billing records, reads code history and contracts with page-level citations, and turns every accepted finding into a priced adjustment in the valuation and a proposed deal term. Calculations are deterministic; AI drafts and a person decides. Industry packs cover software and SaaS, fintech, healthcare, property and more. Venture Raise lets founders run an investor's checks first.

**Long description (≤ 2,000 characters):**
> Pactlab is the deal platform for private equity firms, corporate development teams and their advisors. It manages and executes an acquisition from first look to close (diligence, valuation, terms and closing) with every number traced to its source and every conclusion signed off by a person.
>
> The loop is the product. Source evidence comes in from billing systems, repositories, issue trackers and documents. Pactlab normalizes it and drafts findings with exact citations. A reviewer accepts or rejects each one. Accepted risks become explicit assumptions in valuation scenarios and a purchase-price bridge (Sextant). From there they become proposed deal terms that both sides counter and agree in one place, signed through the buyer's own DocuSign.
>
> What it checks: recurring revenue rebuilt from billing records and reconciled to what management reports; commit history, ownership and licence exposure read from the repository; sprint and issue history that shows whether the roadmap is delivered; and contract terms extracted with page-level citations.
>
> Industry packs apply the same loop to the evidence each sector trades on: Software and SaaS, Fintech, Healthcare services and healthtech, Hospitals, Small clinics, Pharma and biotech, Telecom and media, IT and professional services, E-commerce and DTC, Multifamily, Commercial property, Music rights, Energy generation and rights, and Startup equity SPVs.
>
> Founders preparing a round use Venture Raise to run the checks an investor will run (deck against billing, cap table against the corporate record, IP against the agreements) and to model competing offers, keeping what they find private until they share it.
>
> AI assists and people decide. Money, KPIs and scenarios come from versioned, deterministic code, and AI output without a resolvable citation cannot become an accepted finding. Pactlab has a REST API and an MCP server, so Claude and other assistants can read pacts with the reader's own permissions.
>
> Pricing: $2,500 per pact (one-time), Team at $1,500 a month billed yearly, Venture Raise at $99 a month, and Firm and Enterprise on request. Unlimited users; counterparty guests are free.

## Category tags

Use the closest match each directory offers, in this order:

1. M&A software / Mergers and acquisitions software
2. Due diligence software
3. Deal management software
4. Business valuation software
5. Private equity software
6. Virtual data room (adjacent only; Pactlab is not a data room, so don't pick it as primary)

Free-text tags: `M&A due diligence`, `technical due diligence`, `SaaS metrics`, `ARR reconciliation`, `quality of earnings`, `valuation`, `purchase price bridge`, `deal terms`, `corporate development`, `private equity`, `VC due diligence`, `MCP server`.

## Feature list

Exactly the nine product modules on `/product`:

- **Revenue and SaaS metrics:** recurring revenue rebuilt from billing records and reconciled to what management reports.
- **Technology and code:** commit history, ownership and licence exposure, read from the repository rather than the interview.
- **Delivery health:** sprint and issue history that shows whether the roadmap is being delivered.
- **Documents and contracts:** contract terms extracted with exact, page-level citations.
- **Findings and review:** one place where every issue is drafted, evidenced, priced and decided.
- **Sextant (valuation and deal terms):** accepted risks become scenarios and a purchase-price bridge, frozen when submitted and approved by a second person.
- **Two-sided close:** terms proposed, countered and agreed by both sides in one place, signed through your own DocuSign, with funds confirmed.
- **Reports:** an executive view across every deal, and the complete record of one pact as a PDF you can forward.
- **Pactlab in your AI assistant:** ask Claude or another MCP-ready assistant about your pacts, with answers drawn from Pactlab and cited to the evidence.

## Pricing fields

Copy `/pricing` exactly. Never add a free trial, discount or plan that the page does not list.

| Plan | Price | Cadence | For |
|---|---|---|---|
| Pact | $2,500 | per pact, one-time | One acquisition, start to close |
| Team | $1,500 | a month, billed yearly ($18,000) | Buyers running deals every quarter |
| Venture Raise | $99 | a month | Founders preparing a round |
| Firm and Enterprise | Talk to us | — | Funds, corporate development and advisors |

Unlimited users. Counterparty guests are free.

## Screenshots and illustrations

All synthetic data. Upload in this order:

1. `apps/site/public/demos/finding-to-valuation.png`: a finding becoming a valuation adjustment. Use it as the hero image.
2. `apps/site/public/demos/metrics-flow.png`: revenue rebuilt from billing.
3. `apps/site/public/demos/document-qa.png`: contract answers with page citations.
4. `apps/site/public/demos/git-stars.png`: repository evidence.
5. Logo: `apps/site/public/brand/pactlab-logo.svg`. Square icon: `apps/site/public/brand/icon-512.png`.
6. Where a directory takes animated media (Product Hunt gallery), use the matching `.gif` files in the same folder.

## Product Hunt launch post (draft)

**Name:** Pactlab
**Tagline (≤ 60):** Deal diligence where every number traces to its source
**Topics:** pick the closest from Product Hunt's list at launch time, for example SaaS, Artificial Intelligence and Venture Capital.

**Description (≤ 260):**
> The deal platform for acquisitions: evidence in, cited findings, valuation scenarios and deal terms out. AI drafts; a named person decides every finding. Founders use Venture Raise to run an investor's checks before the round.

**Maker's first comment** (a draft in Kumar's voice; rewrite it in your own words before posting):
> Hi Product Hunt. I'm Kumar, and I built Pactlab because acquisition diligence ends up as a stack of spreadsheets and memos that never quite connects to the price.
>
> Pactlab connects them. Evidence comes from the source: billing records, repositories, issue trackers, contracts. Each finding cites where it came from, and a reviewer accepts or rejects it. Accepted risks flow into valuation scenarios and a purchase-price bridge, then into proposed terms both sides agree in one place.
>
> Two things we hold to: calculations are deterministic code, never model prose, and AI never approves anything. It drafts, and a person decides.
>
> You can try it without talking to us: https://pactlab.ai/try has synthetic data rooms for several industries. I'd value hard questions about where this breaks.

## MCP registry listing (official registry, Smithery, Glama)

**Server name:** Pactlab
**Remote URL:** `https://app.pactlab.ai/v1/mcp` (Streamable HTTP)
**Auth:** OAuth 2.1 with PKCE. The person approves the connection in Pactlab, and an organization admin switches MCP on first.
**Docs:** https://pactlab.ai/api/#mcp

**Short description (≤ 100):**
> Read your M&A pacts in Claude: findings, claims register, valuation bridge and Foresight, cited to evidence.

**Description:**
> Pactlab's MCP server gives AI assistants read access to the deals (pacts) a person can already see in Pactlab, with that person's permissions, and every call is audited. Tools: `list_deals`, `get_deal_summary`, `get_findings`, `get_claims_register`, `get_valuation_bridge`, `run_valuation_scenario` (what-if, nothing saved), `search_evidence`, `get_post_close_register` and `get_foresight`. With the `mcp:propose` scope, an assistant can also suggest a deal term (`propose_term`) or a document request (`draft_document_requests`). A person approves each suggestion in Pactlab before anything changes. Prompts: "Screen this deal", "Prep me for IC" and "What will the investor find?".

**Tags:** `finance`, `m&a`, `due-diligence`, `valuation`, `private-equity`, `remote`, `oauth`

**Namespace (official registry):** prefer DNS verification on `pactlab.ai`, which gives a reverse-DNS name such as `ai.pactlab/pactlab`. Confirm the exact naming rule in the registry's publishing docs when submitting.
