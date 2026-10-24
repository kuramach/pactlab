# Browser tests (`@pactlab/e2e`)

Playwright drives the real web app against the real API and PostgreSQL —
synthetic data only, AI off. Each run:

1. drops and recreates a separate `pactlab_e2e` database, migrates it and runs
   `pnpm seed` (your `pnpm dev` database is never touched);
2. generates the public demo data set (`scripts/demo-data/generate.py`) to upload;
3. starts the API on :4400 and a production build of the web app on :3400;
4. signs in once as `lead@charlie.example` by reading the emailed code from
   `apps/e2e/.data/mail`, and runs every spec from that session.

```bash
pnpm local:up                                   # Docker Postgres + Redis
pnpm --filter @pactlab/e2e exec playwright install chromium   # once
pnpm test:e2e                                   # the whole suite
pnpm --filter @pactlab/e2e test:e2e specs/pack-import.spec.ts  # one file
pnpm --filter @pactlab/e2e test:e2e --ui        # watch and debug
```

Needs Python 3 (for the demo data). Ports and database credentials can be
overridden with the `E2E_*` variables in `.env.example`. CI runs the suite in
the `e2e` job and uploads traces and screenshots when it fails.

Every spec starts its own Pact through the wizard, so specs never share state.
Add a spec for every bug a manual test finds before fixing it.
