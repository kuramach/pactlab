# Pactlab marketing site

Multi-page site for pactlab.ai, built from the locked B2 brand kit in `brand/`
(SVG logo assets, navy/indigo palette, Manrope, voice). Fully static.

Pages: home, product (overview + nine modules), pricing, industries (overview + seven
sectors), how it works, trust, pilot. Module and industry pages are generated
from `lib/content.ts`; icons come from the registry in `lib/icons.ts`.

```bash
pnpm --filter @pactlab/site dev     # http://localhost:3100
pnpm --filter @pactlab/site build   # writes apps/site/out/ — upload to any static host / CDN
```

- Copy lives in `lib/content.ts`; tests enforce the tagline, banned words,
  "no unbacked claims", that only Software and SaaS is marked available
  (industry packs are planned, spec §19), and that every link has a page.
- `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_CONTACT_EMAIL` (build time) turn on
  the Sign in link and the Request a pilot button. Unset, they are hidden —
  the site never ships a placeholder address.
- `NEXT_PUBLIC_CF_BEACON_TOKEN` (build time) turns on Cloudflare Web Analytics
  (cookieless, marketing site only). Unset, there is no analytics script at
  all. Setup: `docs/runbooks/site-analytics.md`.
- `/api` is the public description of the REST API and MCP server
  (`lib/api-docs.ts`); `lib/api-docs.test.ts` fails when a route opened to
  API tokens or an MCP tool is missing from the page.
- Languages (T-171, ADR 0057): English unprefixed (`app/(en)`), German, French
  and Japanese under `/de`, `/fr`, `/ja` (`app/[locale]`); pages are shared
  views in `views/`. Interface words live in `messages/en/ui.ts`, translations
  in `messages/{de,fr,ja}/` as typed overlays on the English source; a missing
  translation fails the build. A language is linked, indexed and geo-routed only
  once its native review is complete (`lib/i18n/locales.ts`,
  `docs/runbooks/site-translations.md`); `NEXT_PUBLIC_LOCALE_PREVIEW=true`
  previews all of them.
- `pnpm --filter @pactlab/site test:e2e` builds the site and serves it through
  the CloudFront Function code (`e2e/edge-server.ts`) to prove each language,
  the switcher and country routing (header stubbed), and that no page overflows.
- Accessibility: brand indigo on white is 3.66:1, so indigo buttons carry
  navy text and indigo text on white uses `#4a58e8`.
