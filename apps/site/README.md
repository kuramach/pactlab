# Pactlab marketing site

Multi-page site for pactlab.ai, built from the brand kit in `brand/`
(logos, navy/indigo palette, Manrope, voice). Fully static.

Pages: home, product (overview + six modules), industries (overview + seven
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
- Accessibility: brand indigo on white is 3.66:1, so indigo buttons carry
  navy text and indigo text on white uses `#4a58e8`.
