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
