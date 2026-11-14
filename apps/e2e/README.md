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
pnpm test:e2e                                   # fast suite (every PR)
pnpm test:e2e:full                              # + @slow tests (promotion gate)
pnpm --filter @pactlab/e2e test:e2e specs/pack-import.spec.ts  # one file
pnpm --filter @pactlab/e2e test:e2e --ui        # watch and debug
```

Needs Python 3 (for the demo data). Ports and database credentials can be
overridden with the `E2E_*` variables in `.env.example`. CI runs the suite in
the `e2e` job and uploads traces and screenshots when it fails.

Tests that take more than a few seconds are tagged `@slow` (`{ tag: '@slow' }`). They
run only in the promotion suite (`.github/workflows/e2e-full.yml`): before
promoting dev → qa → stage → production, nightly, or on demand — not on every PR.

## Tiers and what they gate

Every test carries a tier tag: `@smoke`, the critical journeys (sign-in by email code, tenant isolation, create and screen a pact, upload and read documents, a cited finding from an import, invite a counterparty, the committee decides), or `@regression` (everything else). `quarantine:check` fails a test without one. Long tests also carry `@slow`; flaky ones `@quarantine`.

| Suite | Runs | What | Gates |
|---|---|---|---|
| PR | every pull request and branch push (`ci.yml`, job `e2e`) | `@smoke`, plus every test in a spec the change touches (the diff against main; a heuristic, never the only run) | merge |
| Main | every push to main (`ci.yml`, job `e2e`) | the whole gating suite: all but `@slow` and `@quarantine` | the next deploy |
| Full | nightly, on demand and before promotion (`e2e-full.yml`), in 2 shards with merged reports | all but `@quarantine` | promotion |
| Quarantine | every PR, non-blocking (`ci.yml`, job `e2e-quarantine`); skipped while empty | `@quarantine` | nothing |

Locally: `pnpm test:e2e` is the main suite; `pnpm --filter @pactlab/e2e exec playwright test --grep @smoke` is the PR smoke tier.

- **In CI:** Chromium on Linux, one worker, two retries (only to tell flaky from broken), a trace on the first retry, screenshots and video on failure, and timezone and locale pinned to UTC and en-US. Reports and traces are uploaded only on failure.
- **Flaky tests:** every pass on retry is listed in the job summary and must be quarantined or fixed that day. See [QUARANTINE.md](QUARANTINE.md).

## Writing a spec (enforced by lint)

- **Locators a person would use:** `getByRole`, then `getByLabel` / `getByText`, then `getByTestId` as a last resort. No CSS classes, no XPath.
- **Never wait for time:** use web-first assertions (`expect(locator).toBeVisible()`, `toHaveText`, `toHaveURL`). No `waitForTimeout`, no `networkidle`, and no non-retrying `isVisible()` / `isEnabled()` checks. When a page can be in one of two states, wait on `a.or(b)` first.
- **Burn-in:** a new or fixed spec runs `pnpm --filter @pactlab/e2e test:e2e:burn-in specs/<file>` (20 repeats, no retries) and passes every time before it joins the gate.

Every spec starts its own Pact through the wizard, so specs never share state.
Add a spec for every bug a manual test finds before fixing it.
