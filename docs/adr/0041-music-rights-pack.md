# ADR 0041: Music rights: a two-party catalog pack, a confirmed register, and termination exposure priced as its own line (T-140)

**Status:** accepted (Kumar, 2026-11-19 and 2026-11-20).

## Context
- Music catalogs (publishing and master recording rights) are bought for their royalty streams by funds, catalog acquirers and labels. The diligence fails in specific, checkable ways: chain of title, writer splits, royalty accounting, unrecouped advances, liens, and US copyright termination rights.
- That is the shape the evidence → findings → valuation loop is built for. No pack covered it.

## Decision
1. **A new company type, `MUSIC_RIGHTS`** (label "Music rights", slug `music-rights`, cluster `media-rights`). One pact, two parties: the buyer acquires rights from the seller (artist, estate, publisher, label or prior fund), who is a target contributor as in every acquisition pack. Released on merge (`RELEASED_COMPANY_TYPES`, `RELEASED_INDUSTRY_SLUGS`).
2. **The evidence model: four CSV targets (ADR 0010)**, after billing (direct licence invoices):
   - `MUSIC_WORKS` → `music.work`: work id, title, type (composition or recording), ISWC, ISRC, PRO, publisher, release year, whether US law governs the grant.
   - `MUSIC_SPLITS` → `music.split`: each writer's share of a work, from the split sheet or as a statement pays it.
   - `MUSIC_TITLE_CHAIN` → `music.grant`: registrations, assignments, licences, administration and work-for-hire agreements, with the execution, publication and copyright-secured dates the termination windows run from.
   - `MUSIC_ROYALTY_STATEMENTS` → `music.royalty_line`: net income by work, period and source (performance, mechanical, sync, neighbouring, streaming), in the deal's base currency.
   - **People (rule 7):** writers appear only as pseudonymous references (`WR-014`); names and IPI numbers are refused by the people-column guard and never reach a model.
3. **Register entries from documents: AI proposes, a person confirms.**
   - Prompt `music.extract@1` (job type `extraction`) reads a royalty statement, split sheet, publishing or administration agreement, Copyright Office record or lien search and proposes splits, grants, statement income, unrecouped balances and liens.
   - **Grounding in code:** an entry is kept only when its quote is on the cited page, its figure is written in the quote and the year of its date appears there too. A figure corrected at confirmation must still be in the quote.
   - Entries land `PROPOSED` in `music_register_items` (buyer side, RLS `app_is_buyer_side`). Only `CONFIRMED` entries join the register, the income model, the termination analysis and the catalog checks. An entry that matches an imported row (same work and writer, grant, or period and source) corroborates it and is not counted twice.
   - Five intake categories offered only by this pack: royalty statement, split sheet, publishing agreement, Copyright Office record, lien search.
4. **The royalty income model** (`@pactlab/calculations` `packs/music`, `music-catalog-1` and the pack calculator `music-royalties-1`), decimal only:
   - Trailing income: lines whose period ends in the twelve months to the latest period end; the prior year is the twelve months before.
   - By work, by source, and by catalog-age band (0–2, 3–5, 6–10, 11–20, 21+ years).
   - **Decay adjustment:** each band's trailing income is reduced by its year-on-year decline; growth is never added (the standing asymmetry).
   - **No invented income:** a work with no statement line earns nothing; a payer that skipped a period between its own statements is a gap finding, never an estimate.
5. **The termination-exposure treatment.**
   - Windows from the grant dates under 17 U.S.C. §203 (grants on or after 1 January 1978: five years from 35 years after execution, or for a grant covering publication from the earlier of 35 years after publication and 40 years after execution) and §304(c) (copyrights secured before 1978: five years from 56 years after copyright was secured, or 1 January 1978 if later).
   - Only assignments and licences are analysed; registrations, administration agreements and works made for hire are not; works not governed by US law are not analysed.
   - **Inside the hold:** a window open at any time between the analysis date (the latest statement period end) and the end of the hold. The hold is the one a document states ("hold period of N years"), else a pack default of 10 years, stated in every result; the Catalog tab can recompute at any hold.
   - **Exposed income:** the work's trailing income, at the grantor's split-sheet share when the grantor is a writer on the sheet, capped at the whole work.
   - At 10% of trailing income or more it is a −1 finding, quantified as the exposed share, **priced as its own line on the bridge**: a price reduction on that share at the scenario's royalty multiple, set by the reviewer.
   - The conventions are returned with every result. Whether a notice has been or could validly be served is for counsel.
6. **Finding rules** (deterministic, versioned, drafts only, cited): chain-of-title gap (−1, a title holdback the reviewer sizes), split mismatch (−1), termination exposure (−1), income concentration by work (> 15%) or writer (> 25%) (0), recoupment mismatch (−1, priced off the price at the undisclosed ledger balance), royalty leakage (0, registered compositions earning mechanicals but no performance income while works of the same age do), undisclosed encumbrance (−1, an indemnity at the amount secured), missing statement period (0), and verified growth (+1, confirmed value only).
   - The Catalog tab's **Run catalog checks** runs the same rules over the imported rows plus the confirmed entries (each cited by its quote, never as evidence it is not), with the same fingerprints the pack-rule run uses, so neither path duplicates a finding.
7. **Valuation: a royalty multiple, through the core ARR-multiple engine.** Enterprise value = trailing decay-adjusted net income (net publisher's share or net label share) × multiple — the same formula as the revenue multiple, so the engine, its validation and its version (`valuation-2`) are unchanged. The pack names it through a new registry field, `PackDefinition.methodLabels` ("Royalty multiple"; labels only). Cushions — verified growth, clean title — go to the confirmed-value ledger only.
8. **Guardrail.** Diligence support only: not legal advice; no determination that title is good or that a termination notice is valid. Shown on the Catalog tab, carried by its API view and stated on the site page.

## Consequences
- The Catalog tab (`/deals/:id/catalog`) is the buyer's own side; the works register and the entries are keyset-paged (T-126).
- Demo data: `pactlab-demo-data/music-rights/{USD,EUR,GBP}` (Fairlight Songs, 120 works, four semi-annual statements) with planted defects: (a) the hit with no assignment, (b) termination windows inside the hold on about 30% of trailing income, (c) splits on one work totalling 105%, (d) an unrecouped advance the summary omits — plus a concentration, a leakage and an undisclosed lien. `apps/api/src/packs/music-rights.acceptance.api.test.ts` runs it end to end with scripted model responses.
- A dedicated `ROYALTY_MULTIPLE` method id (rather than a label on the revenue multiple) would need the shared API contract (`packages/contracts`) widened; it is a follow-up if a royalty-specific input (e.g. a separate NPS and NLS) is wanted.
- **Migration** `20270101000000_music_rights_pack` is expand-only: five enum values and one table. Rollback: drop the table; the enum values stay unused.
