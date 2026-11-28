# Writing an industry pack

A pack adds a sector's evidence, checks, metrics and valuation method to the core loop. It never forks the loop. Two packs follow this recipe: fintech (T-058) and multifamily (T-059). Copy whichever is closer.

**Read first:**
- ADR 0008 (pack framework);
- ADR 0009 (packs before pilot);
- ADR 0010 (CSV imports for pack evidence);
- spec §19 (activation bar).

**Rules that do not bend:**
- Rules are deterministic, cite their evidence and propose DRAFTs only. A person decides.
- People data appears only as aggregates or pseudonymous keys. The people-column guard refuses names, contact details, identity, health and pay columns.
- Upside is confirmed value (a +1 cushion), never a price increase.
- Money is decimal (`D` from `@pactlab/calculations`). Never use a JS float.

## 1. Spec amendment

Add the pack's §19 activation section before any code:
- its targets;
- its findings (with direction and pricing);
- its valuation method;
- its demo data and acceptance journey.

## 2. Import targets (evidence)

- **`packages/domain/src/imports/targets.ts`:** one `TargetDefinition` per extract:
  - fields: name, kind, required flag, hint;
  - `recordIdField`, `fileName` (it must match the demo data), `people`, `refusesPeopleColumns`.
- **Migration (expand only):** add the target to the `import_target` enum (`packages/db/prisma/schema.prisma` plus a migration).
- Extracts without a currency column are read in the deal's base currency. Say so on the target hint.
- Uploads accept CSV, TSV and Excel, and large files import in the background. The target gets all of this for free (T-075).

## 3. Registry

In `packages/domain/src/packs/registry.ts`, give the pack its `importTargets` (billing first), `findingRules`, `metricCalculator`, `valuationMethods` and `built: true`.

The source plan then adds **Industry data** (`pack_upload` connections) automatically.

## 4. Finding rules

- **Where the code goes:** `packages/calculations/src/packs/<pack>/rules.ts`, implementing `PackFindingRule` from `packs/rule-types.ts`.
  - The types mirror the domain registry types; this is a decision recorded in the ADR 0008 addendum.
- **What a rule reads:**
  - `RuleContext.evidence`: the newest version per record, loaded by `apps/api/src/packs/pack-evidence.ts`;
  - `RuleContext.pages`: readable document pages only, never HR, pay or performance.
- **What a rule proposes:** a `RuleProposal` that cites evidence ids and/or exact page quotes.
  - Quotes are verified by `SourceIndex`; an unverifiable quote is not drafted.
- **Fingerprints:** stable, so re-runs create nothing.
- **Registration:** add the rules to `apps/api/src/findings/pack-rules.ts`.
- **When rules run:** after every inline pack import, and from "Run … checks" on Findings.
- **Unpriced drags:** a drag with no defensible amount is proposed −1 without a price. Findings shows it as **Needs pricing**, and acceptance waits for a person to price it.

## 4b. Multi-year P&L trend (every pack, Kumar 2026-11-26)

- **Reuse, never fork:** `pnlTrendRules('<pack>', KEY_EXPENSES)` (`packages/calculations/src/packs/pnl-trend.ts`) gives three rules over the imported P&L (`finance.pnl_line`): the trend record (0), margin drift (−1) and a key expense outpacing revenue (−1). Name the vertical's key expenses (label and line-name pattern); list the three rule ids in the registry (fintech: `fintech-pnl-trend`, `-margin-drift`, `-expense-outpacing`; healthcare: `healthcare-pnl-…`; small clinics: `clinics-pnl-…`).
- **Years:** a year the file states, or all twelve of its months; partial years are left out, never scaled up. One year still reads as one year.
- **Demo data:** at least three years of P&L with one planted trend defect a single year misses; the acceptance test imports it through `FINANCIAL_PNL` with the line kinds a person confirms.

## 4c. Five years of history (every pack, ADR 0057)

- **Expect five fiscal years** of income and expenses (the P&L import) and of the pack's operating drivers, plus the current year or the T-12. Accept less: every history figure carries `coverage` ("FY2025–FY2026 (2 of 5 years): ask the seller for FY2022–FY2024 …") and the report's `history` table lists one ask per kind of history with missing years. Never extrapolate a missing year.
- **Years** are labelled by the year they end in; monthly data is read in twelve-month years ending with the latest imported month; part years are left out.
- **Reuse:** the multifamily calculator (`packages/calculations/src/packs/multifamily/history.ts`) and the generic `PackHistory` table; the Home **History** strip and the Finances years table read them unchanged.
- **Multifamily thresholds** (`history-rules.ts`):

  | Constant | Value | Drafts when |
  |---|---|---|
  | `OCCUPANCY_EROSION_POINTS` | 0.03 | average occupancy is down 3 points or more, first year to last |
  | `OCCUPANCY_FLOOR` | 0.90 | …or a year's average is below 90% in any of the last three years |
  | `RENT_EXPENSE_GAP_POINTS` | 0.02 | operating expenses or a key expense grow 2 points a year or more faster than average rent |
  | `NOI_SPIKE_POINTS` | 0.05 | the latest year's NOI growth is 5 points or more above the earlier years' average |
  | `MARGIN_DRIFT_POINTS`, `EXPENSE_OUTPACING_FACTOR` | 0.03, 1.25 | the shared P&L trend rules (4b) |

- **Demo data:** five years with seasonality, a rent step each lease year, expense inflation and the planted defects; the 12-month files stay equal to the last twelve months of the history. Draw the history from its own random generator so the pack's other files are unchanged.

## 4d. History for any pack (T-184)

- **Name drivers, don't write a reader.** Declare the pack's operating drivers as `DriverSpec`s over a monthly import it already has (`packs/history.ts`), with its key expenses, in a `PackHistorySpec`. `packHistory(spec, evidence)` gives the years side by side (`report.history`), coverage and asks; `withHistory(metric, result, driverKey)` puts a History strip under a figure on Home.
- **Trend rules:** `driverTrendRule({ id, driver, adverse, threshold, domain, advice }, spec)`, one per driver that matters; thresholds are named constants in the pack's rules.

  | Pack | Constant | Value | Drafts when |
  |---|---|---|---|
  | Fintech | `TAKE_RATE_COMPRESSION_POINTS` | 0.001 | take rate falls every year, 0.10 points or more first to last |
  | Fintech | `LOSS_RATE_CLIMB_POINTS` | 0.0005 | (chargebacks + fraud) ÷ volume rises every year, 0.05 points or more |
  | Telecom & media | `CHURN_CLIMB_POINTS` | 0.001 | disconnects ÷ opening subscribers rises every year, 0.10 points a month or more |
  | Professional services | `UTILIZATION_DECLINE_POINTS` | 0.03 | billable ÷ available hours falls every year, 3 points or more |
  | Healthcare, small clinics | `VISITS_DECLINE_SHARE` | 0.05 | visits fall every year, 5% or more first to last |
  | E-commerce | `DISCOUNT_CLIMB_POINTS` | 0.01 | discounts ÷ gross sales rises every year, 1 point or more |
  | Pharma | `PRODUCT_DECLINE_SHARE` | 0.1 | a product's billed revenue falls every year, 10% or more |
  | Software & SaaS | `NRR_DECLINE_POINTS` | 0.05 | net revenue retention falls every year, 5 points or more |
  | Music rights | `INCOME_DECLINE_SHARE` | 0.1 | statement income falls every year, 10% or more |
  | Energy | `GENERATION_DECLINE_SHARE` | 0.1 | a plant's net generation falls every year, 10% or more |
  | Hospitals | `ADMISSIONS_DECLINE_SHARE` | 0.05 | admissions in the census fall every year, 5% or more (T-162) |
  | Commercial property | `RECOVERY_SHORTFALL_SHARE`, `RECOVERY_TREND_MIN_YEARS` | 0.02, 3 | recoveries billed short of the leases' triple-net shares by 2% or more in every one of three consecutive years (T-165) |

- **Driver options (T-184b):** `numeratorWhere` / `denominatorWhere` (a field's value, or `contains`: a payer class's share, consumer channels, a product's billing lines), `numeratorLess` (net = gross − discounts − returns), `multiplier` (subscriber-months from opening + closing), `complement` (repeat orders = 1 − new ÷ orders), and `compute` for a driver no sum expresses (ARR and retention from recurring revenue; income from half-year statements). A pack may build its spec from its evidence (pharma: one driver per product the patent schedule names).
- **Software:** the SaaS engine keeps 36 months, so ARR at each December, NRR, GRR and logo churn by year come from the month-by-month recurring revenue the pack's rules read (`software/history.ts`); `GET …/metrics/pack` returns them as the history beside the P&L, and Finances shows the years card.
- **Direction map:** every evidence type a driver trend reads carries the `driver-trend` signal (−1, ASSUMPTION) in `VALUATION_DIRECTION_MAP`; the pack's `*-directions.test.ts` points its trend rules at it.
- **Where history does not apply:** *Venture Raise* is a founder's pre-seed to Series A round: there are rarely five years of anything, the round is priced on traction since launch, and the cap table and runway are point-in-time; its billing and P&L still import and read as they do. A *startup SPV* is a vehicle with no operating business: it is checked on the round's math and the vehicle's terms, so it has no history to expect. Neither pack asks for five years.
- **Demo data:** extend the existing monthly export back five years from its own random generator (so the last 24 months, and every planted finding read from them, are unchanged), keep the P&L's revenue lines equal to the export where a rule reconciles them, and plant one driver defect. Billing that runs back sets `ds.billing_months = HIST_MONTHS + MONTHS`.

## 4e. History of any length (T-185)

- **Every complete year is read**, up to `MAX_HISTORY_YEARS` (30); the trend rules and five-year figures keep reading the latest `RECENT_YEARS` (5). Pass the calculator input to `packHistory(spec, evidence, input)` / `multifamilyHistory(evidence, currency, input)` so the pact's history start applies.
- **Expected years:** max(latest − 4, `historyStartYear`) … latest. A missing year before the first read, with no start set, is asked "…or tell us the business started later"; a gap inside the history is asked for alone; years before the start never are.
- **Long-run figures** (`longRunMetrics`, on `PackHistory.longRun`): ten-year and full-history growth, the worst year and its recovery, through-cycle averages. Name the pack's key ratio driver with `keyDriver` when the first ratio driver is not it.
- **The recent run against the long run:** add `recentRunRule('<prefix>', SPEC)` to the pack's rules and `'<prefix>-recent-run'` to its registry entry.

  | Constant | Value | Drafts when |
  |---|---|---|
  | `RECENT_RUN_MIN_YEARS` | 10 | only over ten years or more |
  | `RECENT_RUN_WINDOW`, `RECENT_RUN_MIN_RECENT` | 5, 3 | the last five years (three at least) |
  | `RECENT_RUN_POINTS` | 0.03 | their average margin or key ratio driver is 3 points or more above the full history's |
  | `LONG_RUN_YEARS` | 10 | the ten-year growth rate (FY2017 ÷ FY2026 ^ 1/9) needs ten years read |


## 5. Metrics

- **Calculator:** in `packages/calculations/src/packs/calculators.ts`. It returns the generic `PackMetricsReport` (`packs/metrics-types.ts`): label, value as a decimal string, unit, formula and source count.
- **API and screen:** `GET /v1/deals/:id/metrics/pack` serves it, and Finances renders it. No new screen is needed.

## 6. Valuation method

- **Reuse first:** a method in `packages/calculations/src/valuation/engine.ts` (`METHOD_ENGINES` / `METHOD_RULES`). Real-estate packs reuse `NOI_CAP_RATE`.
- **Adding a method:** add it there with validation and its sensitivity variables. Outputs of existing methods must not change.

## 7. Demo data and acceptance

- **Demo data:** `scripts/demo-data/generate.py` writes `<slug>/{USD,EUR,GBP}`:
  - one file per target;
  - documents;
  - a README listing the planted findings.
- **Contract test:** `apps/api/src/ops/demo-data.test.ts` checks every file against the code. It covers new targets automatically through the registry.
- **API acceptance:** `apps/api/src/packs/<pack>.acceptance.api.test.ts`, using `acceptance-kit.ts`:
  - import everything in each currency;
  - the planted findings appear as cited drafts, and a re-run adds none;
  - accepted findings reach valuation with their direction;
  - contributors and other tenants are refused.
- **Browser test:** one fast spec in `apps/e2e/specs/` covering the pack's main import. Anything slow is tagged `@slow`, so it runs only at promotion.

## 8. Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:fixtures`, `pnpm test:e2e`, and `prisma migrate diff` (empty).

## 8b. Checks that read documents (T-163)

- **Wait for the documents.** Rules run after every import, often before the data room. A rule whose answer a document can change (a record that governs a date, a retention agreement that clears a finding, correspondence that settles a claim) returns nothing while `pages` is empty, so no stale draft is left behind.
- **Order imports by dependency.** When one extract checks another (pharma's registry records against the pipeline), list the evidence first in `importTargets`.
- **Read the right documents.** Recognise a document by its heading (a patent record, regulator correspondence) before reading its sentences: the paged extracts PDF repeats every CSV row and must never verify itself.

- **One draft per independent signal (T-164).** A trend that reads two imports (the orders export and the P&L) drafts each part on its own key: rules run after every import, and a combined draft keyed on what was present at the time is left stale when the second import arrives.

- **Extending a shared register in place (T-162).** A child pack that needs one more column on a reused target (a hospital privilege's department, a payer agreement's rate basis) adds it as an optional field in code; the parent's files keep importing as they are, and no migration is needed.

- **Documents that govern an import (T-165).** When a document is the primary source for an imported summary (a lease behind a rent roll), read it by its heading, match it to the import's rows by name, and let it govern: the rent roll is checked against the lease, never the other way round. A row with no document is a 0 gap, never a guess.

- **Pseudonymous people, reused helpers (T-167).** A target that carries people by reference declares `people: 'PSEUDONYMOUS'`; whole-token matching of a reference in a document reuses `refPattern` (healthcare). A sentence that names the person with "no" covenant is shown as stated, never read as cover.

## 9. Extending a parent pack (small clinics on healthcare, T-161)

- **By reference:** list the parent's import targets and rule ids in the child's registry entry; never copy a rule. The parent's tab may open for the child too (`DEAL_SECTION_RULES`), with only what differs (e.g. the P&L key expenses) chosen per pack.
- **Required inputs:** a common document the child's rules need (a clinic's lease) goes in `requiredInputs`, so the intake checklist asks for it.
