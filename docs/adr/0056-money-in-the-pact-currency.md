# ADR 0056: Money lives in the pact's currency; nothing converts silently; one formatter (T-170)

**Status:** accepted (Kumar, 2026-11-26: target markets US, UK, Germany, France, Japan and India). Precedes localization (T-171 onwards).

## Context
- Deals in the target markets are priced in GBP, EUR, JPY and INR, not only USD. The pact contract already carried `baseCurrency` (ISO 4217, default USD, set at creation and never edited), and `Money` already refused to add two currencies.
- But currency was not real end to end:
  - several screens and documents forced two decimals (`JPY 150,000,000.00`) or parsed amounts into floats to show them;
  - the purchase-price bridge rounded each line on its own, so a JPY bridge could be off by ¥1 against its own totals;
  - three copies of the ISO minor-unit table existed, and the report roll-up summed in integer cents;
  - an import had no currency at all: a P&L in EUR imported into a USD pact read as dollars;
  - forms defaulted new amounts (priced risk, financing, asking price) to USD whatever the pact.

## Decision
1. **The pact's currency is canonical.** Every amount on a pact is in its `baseCurrency`. Calculations, findings, the bridge, terms, financing, QoE and reports read amounts in it. Billing lines keep their own currency per row and the metrics engine converts them only with recorded FX rates (unchanged, spec §10).
2. **Nothing is converted silently, and nothing inside the valuation bridge, ever.** An adjustment in another currency is refused by the engine (unchanged), and the bridge has no FX input.
3. **One ISO table of minor units** (`@pactlab/domain` `money/currencies.ts`): JPY 0, KWD 3, CLF 4, otherwise 2. `Money` and the calculations package (`currencyScale`), the import transforms and the formatter all read it. The launch set formatted and tested end to end is USD, GBP, EUR, JPY and INR; the ISO schema stays open to other codes.
4. **The bridge foots as shown.** Each line is rounded once at the currency's minor unit (half-even) and the totals are the sums of the rounded lines. Engine version `valuation-3`; earlier runs keep their stored result and stamp.
5. **One formatter** (`@pactlab/domain` `money/format.ts`): `formatMoney`, `formatAmount`, `formatMoneyRange`, `formatNumber`, `formatDate`, `formatDateTime`, `formatMonth`. Intl-based, locale- and currency-aware:
   - decimal strings go to Intl as strings, so no amount passes through a float;
   - money shows its ISO code (`USD 1,234.50`, `1.234,50 EUR`, `INR 12,34,56,789.50`), so a non-USD pact can never read as dollars; a symbol is an explicit choice (`display: 'symbol'`, used only for Pactlab's own USD prices and AWS costs);
   - never more decimals than the minor unit, rounded half-even like storage;
   - grouping comes from the locale (en-IN lakh and crore), never hand-rolled;
   - until the reader's locale arrives (T-171) the default is en-US, and en-IN for INR amounts.
   The web app, generated documents (reports, IC pack, term sheet, LOI) and comparables use it. `apps/web/lib/money-format.test.ts` fails the build on a direct `Intl` or `toLocaleString` call, a currency formatter of its own, a bare `$` before an amount or forced two decimals in the web app.
6. **Imports declare their currency.** A mapping may carry `currency` (what the person says the amounts are in; absent means the pact's). Pactlab reads what the file says (ISO codes and unambiguous symbols in its header and first rows; line names are not read):
   - a file, or a declared currency, other than the pact's blocks the import with a plain message; when only the file says so, the reviewer is asked which currency the amounts are in (ask-when-unsure), and can settle a wrong label by declaring the pact's;
   - a file that mixes currencies inside one statement set never imports;
   - P&L lines carry their declared currency, and the multi-year trend compares like with like: a year mixing currencies is left out, and growth is not computed across a change of currency (the trend finding says so). Margins and expense ratios are currency-free and still compare.
7. **Cross-pact views group by currency and never sum across currencies.** The executive report rolls up per currency (exactly, at any minor unit); Home's chart plots one currency and names the pacts priced in others.
8. **Display conversion, if a view ever offers it,** is labelled with the rate and its date, from a recorded FX source configured per deployment, and changes nothing on the pact. No view offers one today.

## Consequences
- **Visible changes:** amounts keep their code-first style in en-US; negatives read `-USD 1,000` (Intl's placement); yen show no decimals anywhere; PDFs show minor units through the same formatter.
- **Stored LOIs and term sheets** are frozen by their PDF digest and are not regenerated; a JPY letter generated before this change kept its `.00`.
- **The site** (`apps/site`) shows no pact amounts; when it does, it uses the same formatter (outside this task's paths).
- **No migration.** The mapping's `currency` lives in the existing mapping JSON; an undeclared mapping's idempotency key is unchanged.
- **Rollback:** a code revert. Valuation runs stamped `valuation-3` keep their stored results.
