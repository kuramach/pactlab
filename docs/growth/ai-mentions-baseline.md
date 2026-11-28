# AI mentions baseline (T-085 Part 5)

Does an AI assistant name Pactlab when someone asks a question Pactlab answers?
This file holds the fixed prompt panel, the recording format, the first
baseline and the monthly re-run ritual. **The zeros are the baseline, not a
failure.** Success is movement in mentions and citation quality over months.
Nobody can promise a ranking, including us.

## The prompt panel (fixed; never reword, or the trend breaks)

| # | Audience | Prompt |
|---|---|---|
| P1 | Buyer | What's the best tool for AI due diligence on a SaaS acquisition? |
| P2 | Buyer | What software should I use for technical due diligence in M&A? |
| P3 | Buyer | How does AI due diligence work on a software acquisition? |
| P4 | Buyer | Tools to compare what a seller claims vs their actual financials? |
| P5 | Buyer | How do I verify ARR in a SaaS acquisition? |
| P6 | Buyer | Is there an M&A platform that links diligence findings to valuation and deal terms? |
| P7 | Buyer | What's the best M&A due diligence software for private equity? |
| P8 | Founder | How should a founder prepare for VC due diligence? |
| P9 | Founder | What do investors check in a seed round due diligence? |
| P10 | Founder | Is there a tool for founders to run investor due diligence on their own startup before raising? |
| P11 | Advisor | What software lets M&A advisors run due diligence and valuation in one place? |
| P12 | Advisor | What software builds a purchase price bridge for an acquisition? |
| P13 | Advisor | What AI tools help with quality of earnings analysis in acquisitions? |
| P14 | Brand | What is Pactlab? |
| P15 | Brand | Does Pactlab have an API for findings and valuation? |

## Recording format

For each prompt × assistant, record one row:

```text
date | assistant (mode) | prompt | mentioned? (Y/N) | position (1st named / listed / cited only / —) | cited pactlab.ai URL(s) | verbatim sentence naming Pactlab, or "—" | first three products named
```

- **Modes:** Claude (web search on), ChatGPT (search on), Perplexity (default), Gemini (default). Use a signed-out or fresh session where the product allows it, so personal history doesn't steer the answer.
- **Quote verbatim.** Paraphrasing hides the change we are looking for, for example "listed" becoming "recommended".
- **Record every wrong claim about Pactlab** (wrong price, wrong feature, confused with another company) in the Notes column. These are the corrections the site, llms.txt and listings must fix.

## Baseline 1 — 2026-11-28

### a) Retrieval layer (run by the T-085 agent)

Assistants answer these prompts by searching the web first, so whether
pactlab.ai appears in web results is the precondition for being named. The
agent ran all 15 prompts through Claude Code's web search tool (US results)
(P2, P10, P11 and P15 as close search phrasings of the panel wording) and recorded whether any pactlab.ai page came back and which products the
results named. This is **not** the consumer Claude, ChatGPT, Perplexity or
Gemini apps; see (b).

| # | pactlab.ai in results? | Products and sources the results named first |
|---|---|---|
| P1 | N | Hebbia, Datasite, AlphaSense, DealRoom (G2 discussion and vendor "top 10" lists) |
| P2 | N | DealRoom, Emma Legal, Sigrid (Software Improvement Group), CodeDD; also Datasite, Midaxo, iDeals |
| P3 | N | Black Duck, Bain, Thomson Reuters, Intralinks articles; no product recommendation |
| P4 | N | QoE as a method; EcomBalance, Clara AI (Clearly Acquired), DueDilio, WebAcquisition |
| P5 | N | Peony, Papermark, Software Equity Group, FE International checklists |
| P6 | N | DealRoom, Midaxo, Hebbia, **DealSense** (the valuation-only adjacent on `/compare/valuation-software`) |
| P7 | N | Datasite, DealRoom, Midaxo, Grata |
| P8 | N | Bain Capital Ventures, Orrick, Carta, Visible, DocSend guides |
| P9 | N | SaaStr, Octopus Ventures, HubSpot, CMS guides |
| P10 | N | Roast My Startup, Startup Due Dil, General Counsel Audit, En Vérité AI, DocSend |
| P11 | N | DealRoom, Midaxo, Datasite, MergerWare, Devensoft |
| P12 | N | No tool named; Deloitte, Ankura and law-firm articles on purchase-price mechanics |
| P13 | N | QoEAgent, Crunchafi, Forvis Mazars, Grant Thornton; "no AI tool runs a full QoE for you" |
| P14 | N | **Name collision:** PaCT Lab (UNC Charlotte philosophy lab), PACTALAB Inc. (lab furniture), Packlab on Crunchbase |
| P15 | N (run as "Pactlab deal diligence platform pactlab.ai") | "Pactlab specifically does not appear in these results"; DealRoom, Deeligence, Parsl, Harvey named instead |

**Readout:**
- **Zero of fifteen.** pactlab.ai is not yet in the web results assistants ground on. The likely reason is that the domain is not yet verified or crawled (Part 2 search consoles are still Kumar's step) and nothing links to it from third-party sites.
- **Brand collision (P14):** "Pactlab" already means two other organizations in search results. The listings in `copy-pack.md` should always pair the name with the category ("Pactlab, the deal platform for private equity and corporate development") until pactlab.ai owns the query.
- **Where answers come from:** vendor "best of" lists (DealRoom, Hebbia, softwaretestinghelp), G2 category pages and G2 discussions dominate the buyer prompts. A G2 profile (copy pack) is the highest-leverage listing.
- **Open lane (P6, P12):** no result named a tool that carries findings into valuation and a purchase-price bridge. That is exactly the question `/compare/valuation-software` and `/api` answer.

### b) The four assistants (queued for Kumar)

Not run by the loop. Each needs a signed-in consumer account, and the loop
holds none. The baseline is complete when Kumar (or a tester) fills this
table once, using the recording format above. Expect zeros, given (a).

| Assistant (mode) | Run on | Mentions (of 15) | Cited pactlab.ai (of 15) | Wrong claims |
|---|---|---|---|---|
| Claude (web search on) | — | — | — | — |
| ChatGPT (search on) | — | — | — | — |
| Perplexity | — | — | — | — |
| Gemini | — | — | — | — |

Put the per-prompt rows in `docs/growth/ai-mentions/2026-11.md` (one file per run).

## Monthly re-run ritual

On the first working day of each month (manual for now; a cron is a future task, not built here):

1. Run P1–P15 through (a), the web search retrieval check, and (b), the four assistants, in the modes above.
2. Save the rows as `docs/growth/ai-mentions/YYYY-MM.md` in the recording format.
3. Add one line to the trend table below.
4. File every wrong claim about Pactlab as a fix to the site, `llms.txt` or a listing. Never argue with the assistant. Fix the source it read.

## Trend

| Month | Retrieval (of 15) | Claude | ChatGPT | Perplexity | Gemini | Notes |
|---|---|---|---|---|---|---|
| 2026-11 | 0 | not run | not run | not run | not run | Baseline. Search consoles not yet verified; no listings live. |
