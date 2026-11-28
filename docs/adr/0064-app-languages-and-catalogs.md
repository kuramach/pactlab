# ADR 0064: Languages in the app — typed catalogs, the site's conventions, user over organization over English (T-172)

**Status:** accepted for the first slice (Kumar directed it, 2026-11-26: the product speaks Japanese, German and French alongside English). Builds on ADR 0056 (one formatter) and ADR 0057 (site languages).

## Context
- The web app had no i18n and every user-facing string was inline: about 4,300 JSX literals in 212 files.
- The site (T-171) already chose its framework: Next's documented dictionary pattern, typed TypeScript catalogs, English as the source, translations as overlays checked at build time.
- T-170 put money, numbers and dates through one formatter that takes a locale.

## Decision
1. **The site's convention, shared through `@pactlab/ui`.** No i18n library. `packages/ui/src/i18n.ts` holds `Localized<T>`, `localize` (throws on a missing, empty or unexpected string), `fill` (`{name}` placeholders), `plural` (`Intl.PluralRules`, a forms object with `one` and `other` always present) and `stringPaths` / `placeholders` for tests. The site keeps its own copy for now (it has structural keys the app does not need); moving it onto the shared one is a small follow-up.
2. **Catalogs:** `apps/web/messages/en/*.ts` is the source, by surface (`common`, `pact`, `home`, `findings`, `settings`); `Messages = typeof en`. A translation is `messages/<locale>/*.ts`, typed `Localized<…>`, so a renamed or missing key fails typecheck, and built once with `localize`, so a gap fails at first use, never by falling back to English key by key. Enumerations (domains, stages, company types, priced-risk types) are `satisfies Record<Enum, string>`, so a new enum value fails until it has words.
3. **Reading them:** `getI18n()` (server, cached per request) returns the reader's `I18n`: `m` (the messages), `fill`, `plural`, `inText` (a name inside a sentence: lower-cased in English, kept in German), and the T-170 formatter bound to the reader's locale (`money`, `amount`, `moneyRange`, `number`, `date`, `dateTime`). Shared pieces (`ApiState`, `Pager`, `OutcomeBanner`, the claim, withdrawn-source and evidence badges, the pipeline, the deal tabs) take `t`; callers not yet moved get English. Client components get their words as props.
4. **Locale and currency are independent axes.** The language changes the words and how a number is written; money stays in the pact's own currency (ADR 0056). A German reader of a yen pact sees `150.000.000 JPY`. English keeps the formatter's own defaults (en-US, en-IN for rupees), so English screens read as before; English dates stay day-month-year.
5. **The locale model: the person over the organization over English.** `resolveLocale` takes the first *offered* choice. A language is offered only when its catalog covers every string in the catalog (tested). The person's choice is stored on the device (`pactlab_locale`, set from Settings → Language, http-only); switching takes effect on the next request. Storing it on the person (so it follows them across devices) and an organization default need columns on `users` and `organizations` and API support: T-172b. Until then the organization default is empty.
6. **Launch set:** en, de, fr, ja (the site's). German is offered now and covers the pilot surface; French and Japanese are not offered until T-173.
7. **No literal outside the catalog.** `apps/web/lib/i18n/no-literals.test.ts` (in `pnpm test`) parses every TSX file in `apps/web` and `packages/ui` with the TypeScript compiler and counts JSX text, string literals in JSX and read attributes (`title`, `label`, `placeholder`, `aria-label`, `alt`, `description`, `hint`…). The pilot files must have none; a file not in `literals-baseline.json` must have none; a file in it may only go down, and the baseline is lowered with it. Copy held in plain data (arrays of labels) is not detected; reviewers catch it.
8. **API errors carry codes, not prose.** The problem-details filter already sends only a stable `code` (never `detail`), so the API needed no change; the UI maps codes to catalog messages (`findings.rules` for acceptance refusals, `common.outcomes`, `common.states`). Email and document text is T-174.
9. **`<html lang>`** is the reader's language.

## The pilot (German)
The pact home's own content, the findings register and one finding, the pact header and tabs, and the shared states, pager and badges they render, all in German with plurals, German dates and number grouping. Not in the pilot, and still English when they appear on the home: the valuation panels (Sextant explanation, multiple context, negotiation anchors), the property metrics card, the financing posture, the guided tour and the app shell (sidebar, top bar). They move with their surfaces (T-172c).

## Consequences
- **Not done in this slice:** the English catalog covers the pilot surface only; about 4,100 literals in 163 files remain, recorded in the baseline (T-172c). A German e2e journey lives in `apps/e2e`, outside this task's paths (T-172b).
- Adding a language: write `messages/<locale>`, add it to `TRANSLATIONS` and `OFFERED_LOCALES` after its native review (`docs/runbooks/app-translations.md`).
- Changing English copy in the catalog fails the completeness test until every offered translation is updated.
- **Rollback:** a code revert; the cookie is ignored by earlier releases. No migration.
