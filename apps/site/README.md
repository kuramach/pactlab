# Pactlab marketing site

Single-page site for pactlab.ai, built from the brand kit in `brand/`
(logos, navy/indigo palette, Manrope, voice). Fully static.

```bash
pnpm --filter @pactlab/site dev     # http://localhost:3100
pnpm --filter @pactlab/site build   # writes apps/site/out/ — upload to any static host / CDN
```

- Copy lives in `lib/content.ts`; tests enforce the brand tagline, banned
  words and "no unbacked claims".
- `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_CONTACT_EMAIL` (build time) turn on
  the Sign in link and the Request a pilot button. Unset, they are hidden —
  the site never ships a placeholder address.
- Accessibility: brand indigo on white is 3.66:1, so indigo buttons carry
  navy text and indigo text on white uses `#4a58e8`.
