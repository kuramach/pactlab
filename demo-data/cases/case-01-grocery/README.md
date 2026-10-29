# Case 1: a two-chain grocery merger (the Kroger / Albertsons analog)

> Synthetic. *Meridian Markets*, *Harvest Lane Foods*, *Crossdock Wholesale Supply*, *Tidewell Grocers* and every place, person and figure in this folder are invented. Real names appear only in *The real case*, as history.

## The real case

The narrative brief with citations to the court rulings, regulator filings and reporting is written together with the public case-study page (T-092, slice 3). Every fact there is checked against its source before it is published. Until then this section is intentionally empty: nothing unverified goes in.

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
