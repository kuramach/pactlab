# App translations

How the web app's languages are added, reviewed and switched on (T-172, ADR 0064).

## Where the words are
- `apps/web/messages/en/*.ts`: the English source. Every user-facing string the app has moved out of its screens.
- `apps/web/messages/<locale>/*.ts`: a translation of the same shape, typed `Localized<…>`.
- Offered languages: `OFFERED_LOCALES` in `apps/web/lib/i18n/locales.ts`; the catalog for each in `TRANSLATIONS` (`apps/web/lib/i18n/index.ts`).

## Adding or changing copy
1. Put the words in the English catalog and read them with `const t = await getI18n()` (`t.m…`, `t.fill`, `t.plural`).
2. Write the same key in every offered translation. `pnpm --filter @pactlab/web test` fails on a missing key or a placeholder that differs.
3. Money, numbers and dates go through `t.money`, `t.number`, `t.date`; never `Intl` directly.
4. If you moved copy out of a screen, lower the baseline: `UPDATE_LITERALS_BASELINE=1 pnpm --filter @pactlab/web test`.

## Native review before a language is offered
The translations are machine-made. Before adding a language to `OFFERED_LOCALES` (or widening what it covers), a native speaker checks, in the PR:
- [ ] Deal terms match the glossary (`docs/translation-glossary.md`): escrow, indemnity, holdback, bridge, finding, drag, cushion; the glossary's open differences are settled.
- [ ] Plurals read correctly at 0, 1, 2 and 1,000.
- [ ] Dates and numbers are in the language's format; amounts keep the pact's currency code.
- [ ] Long strings fit: the pact home, the findings table and one finding at desktop and mobile widths.
- [ ] Nothing reads as a promise or legal advice that the English does not make.

German, French and Japanese are machine-made and awaiting this review. The checklist is completed once per language, in the PR that adds it to `OFFERED_LOCALES`. French and Japanese catalogs exist and are tested (`lib/i18n/catalog.test.ts`) but stay out of `OFFERED_LOCALES` until their checklist is done; they cover the same namespaces as German (pact home, findings, settings, profile and chat apps), and the rest of the app's copy arrives with T-172c.

Per-language checklist (copy into the PR):
- [ ] German: glossary terms, plurals at 0/1/2/1,000, formats, fit, no stronger claim than English.
- [ ] French: the same five.
- [ ] Japanese: the same five, plus line breaks (no clipped phrases at 390 px and 1,280 px).

## Switching languages
Settings → Language. The choice is stored on the device (`pactlab_locale` cookie) and applies on the next page; it changes nothing the API does. Following the person across devices and an organization default arrive with T-172b.

## Emails (T-174, ADR 0067)
- **Where:** `apps/api/src/email-login/email-catalog.ts`, one typed catalog per language (`satisfies EmailCopy`, so a missing string fails typecheck). The branded layout (logo, colours, footer tagline and note) is shared; its words are in the catalog's `layout`.
- **Covered:** sign-in and sign-up codes, pact invitations, "act now" notification emails and the digest, in en, de, fr and ja. Other emails (listing interest, passkeys, demo invites, operator emails, contact verification) are English until they move.
- **Which language:** the first offered of the person's choice, the organization's default and the page the request came from (`resolveEmailLocale`); today only the sign-in and sign-up pages' language is sent (`locale` on the start request), since no language is stored on the person or organization yet (T-172b).
- **Review:** the German, French and Japanese emails are machine-made and need the same native review as the app; the tagline uses the site's renderings, which await Kumar's approval (`docs/runbooks/site-translations.md`).
