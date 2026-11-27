# ADR 0057: Languages on the site — typed catalogs, prefixed routes, country routing at the edge (T-171)

**Status:** proposed (T-171, 2026-11-26). Kumar approves the tagline renderings and each locale's native review.

## Context
- Target markets (Kumar, 2026-11-26): US, UK, Germany, France, Japan and India. English serves the US, the UK and India; the site adds German, French and Japanese.
- The site is a static export (`output: 'export'`) on S3 + CloudFront (ADR 0003). There is no server and no Next middleware at runtime.
- The copy is structured TypeScript data (`lib/content.ts`, `lib/industry-stories.ts`, `lib/answers.ts`, `lib/cases.ts`) plus interface words inline in pages. T-172 internationalizes the app next and must use the same library and conventions.
- Translations are machine-made in the build and need a native speaker's review before a market sees them.

## Decision
1. **No i18n library: Next's documented dictionary pattern, typed.** A catalog is a TypeScript module per language, checked by the compiler:
   - interface words: `messages/en/ui.ts` is the source; `Messages = typeof en`;
   - page copy that is data stays where it is in `lib/` (the English source); a translation is an **overlay** of the same shape with only the words (`Localized<T>`, `lib/i18n/localize.ts`). Slugs, icons, links, images and enum values are *structural* keys and always come from English, so a translation cannot point elsewhere, drop a page or change a status;
   - `localize(source, overlay)` merges them at build time and **throws** on a missing key, an empty string, a length mismatch or an unexpected key. English fallback is a build failure, never silent;
   - placeholders are `{name}`; `{name|lower}` lower-cases a value for English running text only. Grammar that needs a different shape drops the placeholder (German "Branchenbegriff", not "In {name}").
   T-172 uses the same convention in the app: a source catalog in English, one typed module per language, `Localized<…>` overlays for data, build-time completeness, no runtime fallback. Plurals, when the app needs them, go through `Intl.PluralRules` inside the same `fill` helper rather than ICU strings.
2. **Routes.** English is unprefixed (`app/(en)/…`, its own root layout, `<html lang="en">`); German, French and Japanese are `/de`, `/fr`, `/ja` (`app/[locale]/…`, root layout with `<html lang>`). Pages are shared views in `views/` taking a locale. Two root layouts mean the 404 is `app/global-not-found.tsx` (`experimental.globalNotFound`).
3. **What is translated.** Home, how it works, guides, questions and answers, the comparison, about (story, vision), the case-studies index, the industries index and all 17 industry pages (walkthroughs, example findings, FAQs). English only, linked as English from translated pages: product module pages, pricing, trust, try, pilot, the case-study bodies (every fact cites an English source) and the legal pages (a translated contract needs counsel, not a model). Links to English-only pages are labelled "(Englisch)", "(en anglais)", "（英語）".
4. **Native review gates publication.** `NATIVE_REVIEW` in `lib/i18n/locales.ts` holds one flag per language, set only in the PR that completes that language's checklist (`docs/runbooks/site-translations.md`). Until then the language's pages are built, reachable by URL and `noindex`; the switcher does not offer it, hreflang and the sitemap leave it out, and the edge never routes to it. `NEXT_PUBLIC_LOCALE_PREVIEW=true` previews every language (environment copies, e2e).
5. **SEO.** Every translated page carries `<html lang>`, a self canonical, hreflang for every *published* language plus `x-default` (English), per-language OpenGraph locale, and sitemap entries with alternates. hreflang is the indexing source of truth.
6. **Country detection at the edge.** One CloudFront Function on viewer request (`infra/cdk/functions/site-viewer-request.js`) reads `CloudFront-Viewer-Country` (made available by an origin request policy, not the cache key) and the `pactlab_locale` cookie:
   - DE/AT/CH → de, FR/BE → fr, JP → ja, everything else (US, UK, India, the rest) → English;
   - only entry and section-root paths with no language prefix, and only for GET/HEAD; a 302 (never 301), path and query kept, `Cache-Control: private, no-store`;
   - the cookie is set only by the language switcher and always wins (including a choice of English); detection never fires under a prefix, so there are no loops or double redirects;
   - its configuration (languages, published set, country map, entry paths, cookie names) is built from `lib/i18n/locales.ts` into `/locales.json` and read by the stack at synth, so the edge and the build cannot disagree. The site's e2e server runs the same function source.
   A viewer-response function sets `pactlab_country` (two letters, a day) so the pilot request email pre-fills the country. No geo-IP service, no client-side lookup.

## Consequences
- Adding a language: add it to `LOCALES`, write its catalog (the compiler lists what is missing), add its country map entries, review, flip its flag.
- Changing English copy: the completeness test and the build fail until every translation is updated; "translate the change" is part of changing copy on a translated page.
- The privacy policy names the two functional cookies.
- Illustrations with English text inside the SVGs (home slides) stay English until the art is localized.
