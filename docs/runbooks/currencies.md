# Currencies: adding one, and what each pact's currency means

A pact's amounts live in its own currency (`deals.base_currency`, set when the pact is created and never edited). Nothing converts silently (ADR 0056).

## What already works for any ISO 4217 code
- The contract accepts any three-letter code (`isoCurrencySchema`).
- Rounding, storage scale and display read the one minor-unit table, `packages/domain/src/money/currencies.ts`: anything not listed there has two decimals.
- Formatting comes from Intl, which knows every ISO code.

## Adding a currency to the launch set
1. **Minor units.** Check the code's ISO 4217 exponent. If it is not 2, add it to `MINOR_UNITS` in `packages/domain/src/money/currencies.ts`. That one change reaches `Money`, the valuation bridge, import parsing (`MINOR` amounts) and display.
2. **Launch list.** Add it to `LAUNCH_CURRENCIES`; if its market brings a locale, add the locale to `LAUNCH_LOCALES`.
3. **Tests.** Extend `packages/domain/src/money/money.test.ts` (rendering in every launch locale; the table drives the loop) and add a bridge to `packages/calculations/src/valuation/currencies.test.ts` that recomputes exactly.
4. **Default locale.** If amounts in it should group differently before the reader's locale exists (as INR does with en-IN), extend `defaultMoneyLocale`.
5. **Pact creation.** Add it to the currency list in `apps/web/app/(app)/pacts/new/wizard.tsx`.
6. **Import clues.** If it has an unambiguous symbol, add it to `SYMBOLS` in `packages/domain/src/imports/currency.ts`, and the code to `KNOWN_CODES`.
7. **FX.** Billing lines in it need recorded rates for the metrics engine (spec §10); nothing else converts.

## Support questions
- **"My import says the currency doesn't match."** The file (or what was declared) is in another currency than the pact's. Pactlab never converts: import the figures in the pact's currency. If the file's label is wrong, choose the pact's currency on the mapping screen.
- **"This file mixes amounts in X and Y."** One statement set must be in one currency. Split it into one file per currency, each in the pact's.
- **"The trend says the currency changes."** Two years were declared in different currencies; growth across that year is not computed. Margins still compare.
- **"Home doesn't show some pacts."** The chart plots one currency; pacts priced in others are named under it, never converted onto the same axis.
