# Case 1: a two-chain grocery merger (the Kroger / Albertsons analog)

> Synthetic. *Meridian Markets*, *Harvest Lane Foods*, *Crossdock Wholesale Supply*, *Tidewell Grocers* and every place, person and figure in this folder are invented. Real names appear only in *The real case*, as history.

## The real case

Kroger / Albertsons, 2022–2024. Public page: <https://pactlab.ai/case-studies/kroger-albertsons/> (same facts, same sources). Status as of 28 October 2026.

- **The deal.** On 14 October 2022 Kroger agreed to acquire Albertsons for about $24.6 billion including net debt ($34.10 per share in cash) [1]. The agreement required "reasonable best efforts" to clear, treated divesting "in excess of 650 Stores" as a material divestment event, and set a $600 million termination fee payable by Kroger in specified circumstances [2].
- **The remedy.** September 2023: 413 stores, banners and eight distribution centers to C&S Wholesale Grocers; expanded to 579 stores on 22 April 2024 [3, 4].
- **The challenge.** 26 February 2024: the FTC and nine states sued, alleging lost head-to-head competition in local supermarket markets and lost competition for union grocery labor [5]. The FTC called the package a "hodgepodge" of assets "cobbled together" for a buyer that operated 23 supermarkets [8].
- **The rulings.** 10 December 2024: the Oregon federal court granted a preliminary injunction, finding "ample evidence that the divestiture is not sufficient in scale" and "structured in a way that will significantly disadvantage C&S" [6, 7], and gave "limited weight" to the non-binding $1 billion price pledge [10]. The same day King County Superior Court permanently enjoined the merger under Washington law [11]. The deal was abandoned and the C&S agreement terminated [3].
- **Precedent.** Haggen bought 146 stores divested in the 2015 Albertsons–Safeway merger and filed for bankruptcy that year [9].
- **Still open (allegations).** Albertsons sued Kroger in the Delaware Court of Chancery alleging breach of the merger agreement, including its efforts obligations, and seeking more than $9.3 billion; Kroger disputes the claims and says no termination fee is owed [3, 12]. The bench trial began on 19 October 2026; no ruling as of this date [13].

Sources:
1. Albertsons Companies, press release, 14 Oct 2022 — https://www.albertsonscompanies.com/newsroom/press-releases/news-details/2022/Kroger-and-Albertsons-Companies-Announce-Definitive-Merger-Agreement/default.aspx
2. Agreement and Plan of Merger, Exhibit 2.1 to Kroger Form 8-K, §6.3, §8.4(d) — https://www.sec.gov/Archives/edgar/data/56873/000110465922108671/tm2227942d1_ex2-1.htm
3. Kroger Form 10-Q, quarter ended 9 Nov 2024 — https://www.sec.gov/Archives/edgar/data/56873/000155837024016233/kr-20241109x10q.htm
4. Kroger Form 8-K Exhibit 99.1, 22 Apr 2024 — https://www.sec.gov/Archives/edgar/data/56873/000110465924049754/tm2412341d1_ex99-1.htm
5. FTC press release, 26 Feb 2024 — https://www.ftc.gov/news-events/news/press-releases/2024/02/ftc-challenges-krogers-acquisition-albertsons
6. FTC statement, 10 Dec 2024 — https://www.ftc.gov/news-events/news/press-releases/2024/12/statement-ftc-victory-securing-halt-kroger-albertsons-grocery-merger
7. Bloomberg Law, 10 Dec 2024 — https://news.bloomberglaw.com/mergers-and-acquisitions/krogers-24-6-billion-albertsons-deal-blocked-by-federal-judge
8. Wilson Sonsini client alert, Mar 2024 — https://www.wsgr.com/en/insights/issues-at-check-out-ftc-challenges-krogers-acquisition-of-albertsons-with-novel-theories-about-labor-market-harm-and-adequate-remedies.html
9. The Daily Herald (Everett), 14 Dec 2015 — https://www.heraldnet.com/2015/12/14/more-than-buyer-must-beware/
10. Associated Press, 10 Dec 2024 — https://www.news4jax.com/business/2024/12/10/a-federal-judge-temporarily-halts-the-proposed-supermarket-merger-of-kroger-and-albertsons/
11. Washington AG, 10 Dec 2024 — https://www.atg.wa.gov/news/news-releases/judge-blocks-kroger-albertsons-merger-following-ag-ferguson-challenge
12. Bloomberg, 12 Oct 2026 — https://www.bloomberg.com/news/articles/2026-10-12/albertsons-seeks-more-than-9-billion-over-busted-kroger-deal
13. U.S. News & World Report (Reuters), 19 Oct 2026 — https://money.usnews.com/investing/news/articles/2026-10-19/albertsons-begins-its-8-billion-trial-against-kroger-over-failed-merger

## The synthetic deal

*Meridian Markets* agrees to acquire *Harvest Lane Foods*. Both are regional-to-national grocery chains.

**Footprint (`sites.csv`, 4,628 sites):**
- 120 local markets in six regions; the chains overlap in 100.
- In 12 of those, the two chains are the only full-service grocers.
- In about a quarter, one chain has only a minor presence.
- Rivals are comparable full-service grocers. Small-format stores sell groceries but are not full-service competitors.

**The remedy:**
- 579 sites to *Crossdock Wholesale Supply*, mainly a wholesaler (`package.json`, revision 3).
- The merger agreement (`merger-agreement.md`) caps divestitures at 650.
- Two of twelve distribution centers go with the stores.

**Regulator feedback** (`feedback.json`): two rounds.
- Round 1 (size) is answered by revisions 2 and 3.
- Round 2 (coherence) is never answered.

**Price pledge** (`commitments.json`): $1 billion, with no measurement, no enforcement and no term.

**The agreement** (`terms.json`): reasonable-best-efforts standard, outside date 14 January 2025, and a $600 million fee payable by the acquirer if clearance fails.

## Findings key (`key.json`, fixed 2026-10-28)

| # | Defect | Check | Phase |
|---|---|---|---|
| 1 | Overlap pockets, including markets where the pair are the only full-service competitors | `overlap-pockets` | Pre |
| 2 | Unused divestiture headroom under the 650-site cap | `unused-headroom` | Diligence |
| 3 | Cherry-picked package: divested sites weaker than those kept | `cherry-pick` | Diligence |
| 4 | Incoherent package: banners without shared distribution or systems | `incoherent-package` | Diligence |
| 5 | Low-viability remedy buyer, with a precedent failure | `buyer-viability` | Diligence |
| 6 | Regulator feedback round 2 never answered by a revision | `unaddressed-feedback` | Diligence |
| 7 | Unverifiable headline price pledge | `unverifiable-pledge` | Diligence |
| 8 | Labor exposure: union density and shared agreements in overlap markets | `labor-exposure` | Pre |

Run the case with `pnpm --filter @pactlab/calculations exec vitest run src/regulatory/case-01.test.ts`. It prints PASS or MISS for each item.

**As a demo pact:** `pnpm seed` (the demo seed) creates **Case 1: Meridian / Harvest Lane (synthetic)**. Its footprint and package are imported, its six documents uploaded, its seven cited entries added, and its regulatory results recorded as draft findings. Open it, then **Diligence → Regulatory**. To load it by hand instead:
1. On **Sources**, import `sites.csv` as **Site footprint** and `remedy-package.csv` as **Divestiture package**.
2. On **Documents**, upload the six `.md` documents.
3. Add the entries on **Regulatory**, each citing its document.

## Calibration log

**2026-10-28 (before the key's first committed run): dataset rebalanced; the key was not changed.** The first draft caught every defect, but too loudly:

| Signal | First draft | After rebalancing |
|---|---|---|
| Overlap markets meeting the presumption | every one (median post-merger HHI 7,883) | 78 of 100 (median HHI ~3,460) |
| Cherry-pick gap | ~30% | 16.4% |
| Package's share of the overlap stores | almost all of them (only 6 sites left to compare) | about 41% |

How it was fixed:
- **Overlap:** rivals made comparable in size, and a quarter of overlap markets given only a minor presence for one chain.
- **Cherry-pick:** package selection made a noisy preference for weaker stores, not a sort.
- **Package share:** the footprint scaled up.

The case was wrong, not the platform.

Unchanged, because they match the record:
- 650 cap against 579 offered: 71 sites (10.9%) unused.
- Coherence 29/100 (a patchwork, as the record describes it).

**Known simplification:** the synthetic chains are smaller than the real ones (1,657 merging sites against roughly 5,000), while the real cap and package counts are kept. So the package is 35% of all the merging sites here, against about 12% in the real deal. The checks read ratios inside the overlap markets the package touches (40.9% of those sites here), so this does not make any key item easier to catch. A later recalibration can scale the footprint up if a check comes to depend on the national share.
