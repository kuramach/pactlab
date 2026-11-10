# UI / E2E Testing Best Practice for AI-Era B2B SaaS (2024–2026)

**Context applied to:** small team, B2B SaaS, Next.js frontend + NestJS API, TypeScript monorepo; strong API/integration suite already; Playwright suite exists but flaky and not trusted as a merge gate; GitHub Actions on tight included-minutes budget; manual dev → staging → production deploys; LLM-backed nondeterministic features (document analysis, AI-generated findings).

**Evidence flags:** `verified live` = page fetched in full in the research browser on 2026-11-10. `index` = search-index excerpt of that page. Most official Playwright/Anthropic/OpenAI claims below are corroborated across both.

## Summary

Consensus in 2024–2026 has not changed the shape, only hardened it: **keep E2E thin, integration/API fat, and never let a flaky suite gate merges.** Google's historic 70% unit / 20% integration / 10% E2E is still quoted everywhere as a *first guess, not a quota*; Kent C. Dodds' Testing Trophy — popularised from Guillermo Rauch's (Vercel CEO) “Write tests. Not too many. Mostly integration” — is the dominant frontend framing, and it agrees with Google on the only point that matters for this team: E2E is a small cap reserved for critical user journeys (CUJs). This team is already trophy-shaped on the API side — the fix is not more E2E, it is a *smaller, deterministic, trusted* E2E tier.

For flakiness, the Playwright team's own playbook (user-facing locators, auto-waiting, web-first assertions, full isolation, API seeding, `trace: 'on-first-retry'`) plus a Google-style quarantine-with-owner-and-expiry policy addresses the empirically dominant causes: async waits, concurrency/shared state, and order dependence.

For LLM features, the published split is sharp: **E2E in CI must never call a live model.** Point the app at a deterministic mock LLM server / recorded fixtures (TanStack AI + CopilotKit's aimock is a worked, public example: 137 tests, 7 providers, ~2 minutes, zero API keys, on every PR), assert structure and *outcomes in the DB/API* rather than prose, and move quality judgement to a separate offline eval suite (Anthropic/OpenAI guidance: 20–50 real-failure tasks to start, multiple trials, code + model + human graders, calibrated LLM-as-judge) run on prompt/model changes and nightly — not per Playwright spec.

On environments and CI money: PR = smoke + `--only-changed` (Playwright's own docs call it a heuristic and require a full run afterwards); merge/nightly = full suite, sharded; staging deploy = full mutating suite; production deploy = a handful of read-path smoke tests, then the *same tagged specs* reused as synthetic monitors (Checkly pattern) once flake rate is low. Sharding cuts wall-clock, **not** total minutes — tiering and Chromium-only-on-PR are what cut minutes.

AI test authoring in 2025–26 is useful as a *drafting and repair assistant under human review* (Playwright 1.56 Planner/Generator/Healer, codegen, MCP), not as an autonomous gate. Independent/critical reviews rank Healer highest, say Generator is often beaten by plain codegen, and warn healed tests can mask real regressions. Commercial self-healing (mabl, Testim) fixes only locator flake — roughly 70–85% of *locator-driven* flake in one 2026 review's field model — at quote-only enterprise prices poorly matched to a small team.

---

## Findings

### 1. Testing strategy — pyramid/trophy, share UI vs API vs unit, which journeys for E2E

| Model / source | Shape | E2E share |
|---|---|---|
| Google Testing Blog, Mike Wacker, “Just Say No to More End-to-End Tests” (2015, still canonical in 2025–26 roundups) | 70% unit / 20% integration / 10% E2E — explicitly “a good first guess”, exact mix varies per team | ~10% |
| Kent C. Dodds, Testing Trophy (2018, described as “still the dominant frontend framing in 2026”) | Static (TS/lint) base → unit (thin) → **integration (largest)** → E2E (thin cap). Principle: “The more your tests resemble the way your software is used, the more confidence they can give you.” Origin: Guillermo Rauch, “Write tests. Not too many. Mostly integration.” | Small cap; no % quota |
| Martin Fowler / Ham Vocke, *The Practical Test Pyramid* (martinfowler.com) | Many more low-level unit tests than high-level broad-stack GUI tests; high-level tests are a *second line of defence* — if one catches a bug, first replicate it with a lower-level test | Few |
| Google test sizes (small/medium/large) | Small = single-process, no network; medium = localhost; large = multi-process/remote, minutes. Smaller run on every commit, larger less often | Large = minority by design |
| web.dev (Google), “What to test” | Warns shapes are one-dimensional; prioritise by use cases and risk, not coverage % — lots of small tests can have high coverage and still not reduce risk | No quota |

Sources: Google 70/20/10 as first guess — http://umatechnology.org/how-to-build-a-scalable-testing-strategy/ (`index`, 2026-11-10, quoting Google Testing Blog https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html); Trophy — https://blog.michaelsam94.com/testing-pyramid-vs-trophy/ and https://landing.complexqa.com/en/wiki/test-automation/automation-levels-and-test-pyramid (`index`); Fowler — http://umatechnology.org/how-to-use-the-testing-pyramid-to-build-a-faster-test-suite/ (`index`); web.dev — https://web.dev/learn/testing/get-started/what-to-test (`index`).

**Which journeys earn E2E** — every source converges: only CUJs that (a) cross the real wiring (browser + API + DB + auth), (b) would cause immediate business impact if broken, and (c) cannot be credibly proven lower down. For this product that translates to roughly 5–15 journeys, e.g.:

- Sign-in / session expiry / tenant isolation (user from tenant A cannot see tenant B data — assert in UI *and* API).
- Core creation flow: upload a document → analysis completes → findings list renders (with mocked LLM, §3).
- The primary CRUD / workflow the product sells, end to sign-out.
- Billing-adjacent entry points *without* completing a real charge (see §4).
- Password reset / invite-accept for a new tenant member.

Explicitly **not** E2E: every form-validation branch, permission matrix permutations, sorting/filtering edge cases, error-message wording — those belong in the existing API/integration suite and in component tests. Vocke/Fowler's rule, restated in multiple 2026 summaries: *if a higher-level test spots an error and no lower-level test fails, write the lower-level test.*

**Next.js-specific exception (Vercel/Next.js team):** Next.js's own testing guide recommends **E2E over unit testing for `async` Server Components**, because unit renderers don't fully support them, and recommends running Playwright against a **production build** (`next build && next start`), not `next dev`, so caching/streaming behaviour matches reality. Sources: https://www.qareef.com/e2e-testing-nextjs.html and https://app.sybqa.com/blog/nextjs-testing-layers (`index`, both citing https://nextjs.org/docs/app/guides/testing). So: extract RSC data logic into plain functions for unit tests; cover the rendered RSC result with the few E2E journeys above.

**No quota to chase:** treat 5–10% E2E by test count (and a hard time budget, e.g. smoke ≤5 min) as a sanity check, not a target. Practitioner roundups in 2026 repeatedly stress the ratios are heuristics; production escape data, not the diagram, is truth.

### 2. Playwright best practices for eliminating flakiness

**Root causes — empirical ranking.** Luo et al. (FSE 2014, 201 commits fixing flaky tests, still the cited taxonomy in 2026 roundups): **async wait 74, concurrency 32, order dependency 19** of 161 classified fixes. Google (John Micco, Google Testing Blog 2016): ~1.5% of all test runs flaky, ~16% of tests showed some flakiness, and **~84% of pass-to-fail transitions involved a flaky test** — i.e. flake destroys trust faster than it destroys minutes. Sources: https://www.busfactor.tech/blog/flaky-tests and https://landing.complexqa.com/en/wiki/test-automation/flaky-tests (`index`).

**The Playwright team's fixes (Playwright — Best Practices, `verified live`):**
https://playwright.dev/docs/best-practices

1. **Locator strategy — user-facing first.** Locators have built-in auto-waiting/retry. Priority: `getByRole` (with accessible name) → `getByLabel` / `getByPlaceholder` / `getByAltText` → `getByText` → `getByTestId` as an *explicit contract* → CSS/XPath last resort. Playwright's bad example is literally `page.locator('button.buttonIcon.episode-actions-later')` — a designer class change breaks it. Use chaining/filtering (`getByRole('listitem').filter({hasText}).getByRole('button',…)`) to disambiguate instead of longer selectors. Generate locators with codegen / VS Code extension, which prioritises role/text/test-id and uniquifies them.
2. **Auto-waiting — never sleep.** Actions wait for actionability (visible, stable, enabled, receives events). **Never `page.waitForTimeout()`** (Playwright API docs: “Tests that wait for time are inherently flaky”); never `waitForLoadState('networkidle')` for readiness. Use **web-first assertions** — `await expect(locator).toBeVisible() / toHaveText()` auto-retry (default 5s) — and never non-retrying manual checks like `expect(await locator.isVisible()).toBe(true)`. For non-UI conditions use `expect.poll` / `expect.toPass`.
3. **Isolation — the default, defended.** Playwright gives each test a fresh BrowserContext (own cookies/local/session storage). Docs: “Each test should be completely isolated… run independently with its own storage, data, cookies.” The leaks are *outside* the browser: shared DB rows, shared seeded user, shared tenant. Fix: per-test unique data (UUID-suffixed names/emails/tenants), create and tear down **via the NestJS API** (`request` fixture) not via UI clicks, and never let tests depend on execution order. Worker-scoped fixtures only for genuinely stateless things (read-only seed user, API client); anything that writes is test-scoped — senior-practitioner write-ups identify wrong fixture scope as a classic “passes alone, fails in CI” cause (https://www.deviqa.com/blog/playwright-best-practices-what-senior-qa-engineers-actually-do-differently/, `index`).
4. **Auth once, not per test.** Setup project logs in once, saves `storageState`, tests reuse it (§ Best Practices, “reuse the signed-in state”). For B2B: one storageState per *role/tenant persona*, created via API login where possible.
5. **Seed via API, assert via UI.** Arrange state through API/DB calls (fast, deterministic); reserve browser steps for the behaviour under test. Don't test third parties you don't control — stub them with `page.route()` / a mock server and “guarantee the response needed” (docs, verbatim advice). Control DB data: test against an environment whose data “doesn't change” except by your seeding.
6. **Parallelism safely.** `fullyParallel: true` + workers locally; on small shared CI runners, docs-oriented guides recommend `workers: 1` in CI for stability and getting speed from *sharding across jobs* instead — oversubscribing workers on a 2-core runner creates the resource-contention timing flakes you're trying to kill (https://www.testmuai.com/learning-hub/playwright-ci-cd/, `index`, summarising Playwright CI docs).
7. **Diagnostics: trace on first retry.** Docs (`verified live`): traces are “set to run on CI on the first retry of a failed test. We don't recommend setting this to `on`… very performance heavy.” Config pattern used everywhere: `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'` (or off on PR tier), `retries: process.env.CI ? 2 : 0`. Trace Viewer gives DOM snapshots per action, network, timeline — use it instead of screenshots/video alone for CI failures.
8. **Retries are a detector, not a fix.** A test that passes on retry *is* flaky by Playwright's definition and is reported as such. Use retries to keep signal while you fix; consider `failOnFlakyTests` (added v1.52) on a dedicated stability job, not as the first move on the main gate.
9. **Quarantine policy (Google/Fowler pattern).** Flaky test → removed from the merge gate *the same day*, still runs in a non-blocking job, gets a named owner + ticket + expiry (Fowler's worked example: cap ~8 quarantined, ~1 week; 2026 policy templates commonly use fix-or-delete within ~10 working days). No owner/expiry = “a delete with extra steps.” New/changed tests should be burn-in run repeatedly (templates suggest e.g. 50×, or Playwright `--repeat-each`) before they may gate. Track flake rate per test weekly; gate on the *rate*, not just red/green. Sources: https://www.busfactor.tech/blog/flaky-tests, https://landing.complexqa.com/en/wiki/test-automation/flaky-tests (`index`).
10. **CI-only flakes checklist** (recurring in guides): slower CI hardware breaking timing assumptions, missing env vars/secrets, web server not ready (use Playwright `webServer` with readiness URL, or test against the deployed staging URL), browser deps missing (`npx playwright install --with-deps chromium` only), and different viewport/timezone/locale — pin timezone/locale in config for determinism (especially for document/date features).

### 3. Testing nondeterministic AI/LLM features end to end

**The line, stated cleanly by multiple 2025–26 sources:** *“If you can write ‘given this input, this assertion must hold’, it's a test; if you can only write ‘given this input, it's probably better’, it's an eval.”* E2E proves **the product is wired correctly** (tools fire, permissions hold, UI states transition, side-effects land); evals prove **the model behaves acceptably** on representative inputs. Sources: https://ai.zenheart.site/tech/08-production/testing.html and https://testchimp.io/guides/verticals/testing-ai-web-apps/ (`index`).

**Make CI E2E deterministic — three seams, cheapest to most realistic:**

1. **Dependency seam in the app (do this first, it's free).** In NestJS, put the LLM provider behind an injectable interface/token with `baseURL`/provider configurable by env (every major SDK supports this). In test env, swap in a fake implementation returning canned structured responses. This is the same pattern as CrewAI/agent testing guides: custom LLM subclass → monkeypatch → scripted OpenAI-compatible HTTP server.
2. **Mock LLM server (best fidelity for E2E).** Point `baseURL` at a local mock server that speaks OpenAI/Anthropic wire format, streams (SSE), and returns fixture responses matched per-test. **Worked public example — TanStack AI (TanStack team, Apr 2026):** Playwright + a TanStack Start harness app + **aimock (CopilotKit, open source)** as drop-in LLM replacement; each test sends a unique `X-Test-Id` header so aimock routes it to its own fixture sequence, enabling full parallelism; **137 tests across 7 providers in ~2 minutes, zero API keys, run on every PR**; aimock also has a record mode that captures live responses as fixtures. Source: https://tanstack.com/blog/how-we-test-tanstack-ai-across-7-providers (`index`). Alternatives in the same class found: generic VCR record/replay (vcrpy/pytest-recording; TS equivalents), `standin` (record once, replay offline, SSE + tool-calls + secret redaction), llmposter (fixture-driven, VCR mode) — all `index` via https://pypi.org/project/standin/ and https://docs.rs/llmposter/latest/llmposter/. Cassette hygiene rules from these sources: match on stable signals (turn index, last-message, test-id) not full request bodies (prompts/beta headers drift and make cassettes brittle); scrub Authorization/secrets before committing; a changed prompt = cassette *miss = loud failure*, forcing deliberate re-record.
   - ⚠️ Server-side caveat for Next.js: `page.route()` only intercepts *browser* calls. LLM calls made server-side (NestJS, or Next.js server actions/RSC) must be intercepted at the API's env/config — hence seam (1)/(2), not Playwright routing.
3. **Live model — almost never in E2E.** A tiny live smoke (1–3 journeys) nightly/pre-release only, with property assertions (below), its own budget and non-gating status until proven stable. Temperature 0 / seed reduces but does **not** eliminate variance — do not rely on it for determinism.

**Assertion strategies for AI outputs (in preference order):**

1. **Structural/schema first.** Assert the response parses, matches the JSON schema / Zod shape, enums are valid, required fields present, finding count/type in an allowed set, confidence in range. “Snapshot the structure, never the content.”
2. **Outcome / probe assertions (Anthropic's strongest advice).** Grade what the system *did*, not what it *said*: after the UI flow, query the DB/API directly — was a Finding record created with the right document ID, tenant, severity category? Anthropic's example: a flight agent can *say* “booked” while no reservation exists in the DB; the outcome is the DB state. They also warn grading an exact tool-call sequence is “too rigid” — grade the produced outcome, not the path. Source: https://www.anthropic.com/research/demystifying-evals-for-ai-agents (`verified live`).
3. **Set-membership / semantic-category assertions.** Category ∈ acceptable set, not == one string; contains-key-facts checks; embedding similarity against a reference above a threshold for summaries. Never `toHaveText(exact LLM prose)` in Playwright — benign rephrasing will flake the suite (TestChimp, `index`).
4. **Streaming UX:** assert on a *completion signal* (streaming-done state, button re-enabled, persisted record appearing via `expect.poll`), never on partial tokens.
5. **LLM-as-judge — only in evals, calibrated.** OpenAI's Evaluation Best Practices: LLMs judge best at discrimination tasks (pairwise comparison, classification, rubric scoring) rather than open-ended scoring; scale a judge only once it “consistently agrees with human annotations”; human judgement is highest quality but slow/expensive. Anthropic: agent evals typically combine **code-based + model-based + human** graders; LLM rubrics must be “frequently calibrated against expert human judgment.” Sources: https://developers.openai.com/api/docs/guides/evaluation-best-practices (`index`); Anthropic above (`verified live`). Note: OpenAI's page states its *hosted* Evals platform is being deprecated (read-only 31 Oct 2026, shutdown 30 Nov 2026) — prefer a code-owned harness (e.g. promptfoo-style, or your own Vitest/NestJS harness) over building on that hosted platform.
   Practical eval design (Anthropic, `verified live` + summaries): start with **20–50 tasks drawn from real failures/support cases**, run **multiple trials** per task (pass@k / pass^k), split **capability evals** (hard, low pass rate, hill-climb) from **regression evals** (near-100%, gate prompt/model changes), review transcripts not just scores. Descript and Bolt are Anthropic's cited customer examples (LLM graders with product-defined criteria + periodic human calibration; separate quality-benchmark and regression suites).

**Schedule:** mocked-LLM E2E on every PR (fast, free); eval suite in a *separate* CI job on prompt/model/provider changes + nightly against the live model; live E2E smoke nightly. Do not run LLM-as-judge inside Playwright specs per-PR — cost, latency, and a second source of nondeterminism in your gate.

### 4. Environment strategy — PR vs staging vs production

Core principle (Currents, *Playwright testing in Staging vs Production*, `verified live`): staging and production have **different risk profiles and must have different configs, scope, and execution settings** — “the same playwright.config.ts, the same test suite, the same execution setup” in both is the root failure mode. Split by risk/reversibility: **staging absorbs anything that mutates state, triggers side-effects, or needs controlled data; production defaults to read-path, non-destructive, high-signal, low-volume.** Writes in prod only with explicit isolation: dedicated test tenant/accounts, scoped data partition, reliable cleanup, exclusion from analytics/billing/emails.
Source: https://currents.dev/posts/playwright-testing-staging-vs-production

| Tier | Environment | Suite | Gates what |
|---|---|---|---|
| PR | CI ephemeral (prod build locally in CI, or preview deploy) | Smoke (@smoke, ≤~5 min) + `--only-changed`; Chromium only | Merge — but only once flake rate is proven low (see below) |
| Merge to main / nightly | CI / dev | Full Playwright suite, all needed browsers, sharded; eval suite (live model) nightly | Nothing directly; creates the trusted baseline |
| On deploy to staging | Staging | Full suite incl. mutating, payment-in-sandbox, email-sending, flag-variant flows; seed data controlled | Promotion to production (manual deploy decision) |
| Immediately post-deploy to prod | Production | Post-deploy smoke: homepage/landing availability, auth with dedicated service account, reach dashboard/primary workflow, add-to-cart-equivalent *without* completing it. Fail-fast, low parallelism; any failure → investigate / roll back | The deploy itself |
| Continuous | Production | Synthetic monitoring: a *tagged subset of the same Playwright specs* on a schedule (e.g. every 5–10 min, multi-region via Checkly or equivalent; or a scheduled GH Actions job as the poor-man's version) | Alerts on-call — only for failures needing response |

Key distinctions and pitfalls, all from Currents (`verified live`) unless noted:

- **Post-deploy smoke ≠ synthetic monitoring.** Different jobs, owners, and alerting: smoke failures block/investigate a release (dev/QE-owned); synthetic failures page on-call (SRE/platform-owned) and catch non-deploy degradation (cert expiry, upstream failure, DB slowdown). One suite can serve both **only** with deliberate tagging and separate Playwright projects/configs.
- **Maturity gate:** “If your smoke tests have a flakiness rate above 2–3%, you're not ready for synthetic monitoring. Fix the stability first.” A flaky synthetic monitor trains on-call to ignore alerts — worse than none.
- **Staging-parity ceiling / why prod tests exist at all:** prod-only failure classes — real third-party behaviour (prod Stripe fraud/rate limits vs sandbox, prod SSO/MFA policy and token TTLs vs sandbox tenant), DNS/CDN/geo routing, and *data-driven* regressions. Currents cites Zalando: 95%-reliable Cypress suite across 120 deploys/day still missed a prod incident because broken CMS *data* broke React hydration — staging tests “were testing a fiction.” Also cited: Grafana Labs' Feb 2025 postmortem — a TLS change tested in dev, pushed to dev/staging/prod simultaneously, destroyed load balancers across 25% of services (150-min partial outage); lesson is staging must be a real sequential gate, not a rubber stamp.
- **Prod-test overheads to budget:** dedicated accounts need provisioning, credential rotation, exclusion from analytics/billing/support; WAF/bot-detection allowlisting without creating a security bypass; traces/screenshots/video in prod can contain real PII — retention/access policy needed; “read-only” tests still create sessions/analytics/audit entries unless test accounts are excluded.
- **Dedicated test tenant in prod (B2B-specific application):** one clearly-labelled synthetic tenant, synthetic users only, no real customer data, identifiable domain/name so support/data teams can filter it, data either self-cleaning (create-and-delete in the test, idempotent) or periodically purged. Never run delete-account / real-payment / bulk-email flows against prod.
- **Checkly pattern (vendor, `index`):** the *same* `@playwright/test` specs run in CI can run as production monitors without a rewrite — tag the prod-safe subset, split into short check suites (long suites delay alerts / worsen MTTD; their guide explicitly warns against reusing a >15-min full regression suite as a monitor), default cadence ~10 min. What Checkly does *not* do for you: “A test that writes to production needs a dedicated account, cleanup, and idempotent steps. That work is on you.” Sources: https://www.checklyhq.com/product/start-monitoring-with-playwright/ and https://www.checklyhq.com/docs/detect/synthetic-monitoring/playwright-checks/test-organization/
- **Preview/ephemeral PR envs:** if the team later adopts per-PR previews, Vercel documents Protection Bypass for Automation (`x-vercel-protection-bypass` header / `VERCEL_AUTOMATION_BYPASS_SECRET`) for running Playwright against protected previews (`index`, via https://www.qareef.com/e2e-testing-nextjs.html). With manual staging deploys today, the cheaper equivalent is: PR tier runs against a CI-spun prod build; staging tier runs the deployed build.

### 5. AI-assisted test authoring and maintenance

**Playwright's own AI stack (Microsoft, official docs `index`):** https://playwright.dev/docs/test-agents

- **Codegen** (pre-AI, deterministic recorder) — records actions, picks best locators (role/text/test-id priority). Still the most reliable *authoring* tool Playwright ships.
- **Playwright MCP** (2025) — MCP server giving a coding agent (Claude Code, Copilot, Cursor, Codex…) browser control via the **accessibility tree**, not screenshots/vision — so agents interact by role/name like good tests do.
- **Test Agents, shipped in Playwright 1.56 (Oct 2025):** three agent *definitions* (instructions + restricted MCP tools) written into your repo by `npx playwright init-agents --loop=vscode|claude|codex|opencode` and executed by *your* coding-agent loop — not a SaaS, not autonomous CI agents. **Planner** explores the running app (from a *seed test* that establishes fixtures/conventions) and writes a Markdown plan to `specs/`; **Generator** replays one scenario live and writes one test file per spec under `tests/`, verifying locators as it goes; **Healer** runs the suite, debugs failures with the page paused, patches, re-runs — and if it gives up, marks the test `test.fixme()`. Regenerate definitions on every Playwright upgrade. VS Code agentic experience needs VS Code ≥1.105.

**Independent / critical assessment (`index`):**

- Michael Brown's Sep 2026 deep review of the shipped agent definitions ranks them: **Healer — production-ready, defensible ROI; Planner — a brainstorming aid that “will confidently describe screens it never opened”; Generator — outperformed by Codegen “for structural reasons no better model will fix”** (Generator is constrained by accessibility snapshots/context, Codegen inspects the full DOM locally with no context window). https://medium.com/@michael-brown-/playwright-test-agents-explained-planner-generator-and-healer-53f0fc0dbc9a
- Augment's guide + Playwright's own caution: **Healer requires human review** — it can make a test pass despite a real application bug, “turning a genuine regression into a green check.” Rule: review every healed diff; classify cause (locator drift vs app regression) before accepting; never let Healer auto-commit to the gating suite. https://www.augmentcode.com/guides/e2e-test-generation-playwright-cypress
- Generated tests are a *first draft*: real locators and sequence, but the agent doesn't know which assertion matters — teams must add outcome assertions, isolation, and data setup in review.

**Commercial self-healing (mabl, Tricentis Testim) (`index`):**

- What they do: ML/smart locators that learn from executions and repair themselves when attributes change (mabl also markets agentic runtime recovery and GenAI assertions; Testim metadata-driven locators + Copilot). Vendor claims: mabl “up to 95%” maintenance reduction, Functionize 99.97% element-identification — **vendor-reported, not independently verified**.
- The sober field model (ForaSoft 2026 review roundup): **“Self-healing is real but partial. It kills roughly 70–85% of locator-driven flake; timing, data and race-condition flake still needs fixes in waits, fixtures and isolation.”** And the key risk: healing accuracy measures matching *an* element, not *the right* element — “a locator that quietly points at the wrong button is worse than a red build.”
- Commercial friction: both mabl and Testim are **quote-only, no published pricing, sales-gated evaluation**; reviewers report Testim enterprise contracts ~$30k–$50k/yr, AI locators that make failures hard to explain, mobile as paid add-on (mabl). Poor fit for a small team on a tight budget unless locator churn — not timing/data — is provably their dominant cost. Sources: https://www.forasoft.com/blog/article/ai-testing-optimization and https://rankite.com/blog/best-ai-powered-test-automation-tools
- Practitioner sentiment (Reddit r/QualityAssurance roundup summarised 2025–26): sharply sceptical — many “AI” tools seen as Selenium/Playwright wrappers; mabl repeatedly criticised on cost-effectiveness/setup; consensus is AI lowers the bar for repetitive tasks but has **not replaced QA judgement**; advice is to POC on maintenance-cost/flake-rate improvement, not vendor demos. https://www.wetest.net/blog/ai-testing-tools-that-truly-save-qa-time-in-2026-1135.html

**Stagehand / browser-use (natural-language browser agents) (`index`):**

- Stagehand (Browserbase): hybrid code + AI primitives `act()` / `extract()` (Zod-schema structured extraction) / `observe()` / `agent()`, with AI-decision caching and re-query on cache miss (its self-healing). Browser-use: fully autonomous agent loop. Independent comparisons put AI browser tools at **~70–85% success on novel tasks vs near-100% for Playwright on known pages**, at **$0.01–0.05+ LLM cost per task** and multiples of the latency (one firsthand test: agent took 30s for a 2s scripted flow, sometimes gave up; “not ready for production CI pipelines where you need predictable timing and costs” — good for exploratory testing/prototyping). A Sep 2026 head-to-head on simple scraping tasks: Browser Use 6/6 correct, Stagehand 3/6. Stagehand v3 also explicitly “optimised for automation, not for testing” per Browserbase. Sources: https://www.nxcode.ai/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026, https://dev.to/sellooh/playwright-ai-stagehand-its-better-than-it-sounds-2gi4, https://www.skyvern.com/blog/browser-use-vs-stagehand-which-is-better/
- **Verdict for this team:** use AI *at authoring/repair time* (codegen, MCP-driven coding agent, Planner for brainstorming a plan, Healer under review) where a human reviews committed, deterministic Playwright code. Do **not** put LLM-in-the-loop execution (Stagehand `act`, browser-use, `ai.act`) in the merge gate — it reintroduces exactly the nondeterminism, cost, and latency §3 removes. Surgical exception: one or two genuinely layout-volatile, non-gating exploratory checks.

### 6. CI economics — fast and cheap on limited GitHub Actions minutes

Key arithmetic first: **sharding cuts wall-clock time, not total billed minutes** (4 shards × ¼ runtime ≈ same minutes, plus 4× job startup/install overhead). Tiering, browser matrix cuts, and not re-running everything are what cut minutes. Sharding is for *feedback speed* on the tiers where you do run the full suite.

1. **Tiered suites (the main saving).** Tag tests (`@smoke`, `@regression`, `@prod-safe`, `@ai-mocked`…) and split:
   - *PR:* `@smoke` + affected tests only, Chromium only, retries 2, trace on-first-retry. Target ≤5 min wall-clock.
   - *Merge to main:* full suite, Chromium only (catches most; keeps minutes down).
   - *Nightly (scheduled workflow — minutes still count, but off the critical path; or on the staging deploy):* full suite × Chromium + Firefox + WebKit, plus live-model evals and live AI smoke.
   - *On staging deploy:* full suite against staging. *On prod deploy:* `@prod-safe` smoke only (§4).
2. **`--only-changed` on PRs (Playwright docs, `index`).** `npx playwright test --only-changed=origin/$GITHUB_BASE_REF` runs test files changed since the ref *plus test files importing changed files*, analysing the dependency graph. Playwright's CI docs are candid: “This is a heuristic and might miss tests, so it's important that you always run the full test suite after the preliminary test run.” Requires non-shallow checkout (`fetch-depth: 0`). Use it as fail-fast preliminary feedback, never as the only run before a staging promotion. Source: https://playwright.dev/docs/ci
3. **Sharding for the full tiers (Playwright docs, `index`).** GitHub Actions matrix with `--shard=${{matrix.shardIndex}}/${{matrix.shardTotal}}`, `fail-fast: false`, `reporter: process.env.CI ? 'blob' : 'html'`, upload each shard's blob report, final `merge-reports` job → one HTML report. `fullyParallel: true` balances shards at test level rather than file level. Vendor/guide reports of 30–40 min → <10 min wall-clock with 4 shards are plausible for wall-clock; expect total minutes to stay flat or rise slightly. Source: https://playwright.dev/docs/next/test-sharding
4. **Workers discipline.** On GitHub-hosted 2–4 vCPU runners, more workers ≠ faster once CPU-saturated; contention *creates* flakes. Start `workers: 1`–`2` in CI (Playwright CI guidance as summarised by TestMu), scale shards (separate runners) for the nightly full run instead.
5. **Install/browser costs.** Install **only Chromium on PR tier** (`npx playwright install --with-deps chromium` — Playwright Best Practices, `verified live`: “Only install the browsers that you actually need”). Playwright's docs advise **against caching browser binaries** (restore ≈ download time); prefer the official Playwright Docker image / `mcr.microsoft.com/playwright` in a container job, or just install per job. *Do* cache `node_modules`/pnpm store keyed on lockfile hash (GitHub cache docs pattern) — that's where the reliable saving is. Note the conflicting folk advice (many blogs cache browsers and report savings) — flagged as a disagreement; measure on your own workflow, the official position is don't.
6. **Cheaper assertions/artifacts.** Trace/video/screenshot only on failure/retry (above); upload artifacts only on failure (`if: failure()`); set short artifact retention (e.g. 7 days) — storage isn't minutes but traces are large. Run tests on Linux runners only (Playwright docs: “Use Linux when running your tests on CI as it is cheaper” — and GitHub bills Windows/macOS at higher multipliers).
7. **Kill retry waste.** Retries multiply minutes: a suite retrying flaky tests at 2× can spend a fifth to a third of compute on reruns (figure reported in CI-optimisation roundups, `index`, treat as directional). Every point of flake-rate reduction from §2 is a direct minutes saving — de-flaking *is* the CI cost optimisation.
8. **Don't pay browsers for API coverage.** The existing API/integration suite is orders of magnitude cheaper per assertion — §1's push-down rule is also the budget rule. Likewise, run component/integration tests (Vitest) on PR instead of promoting those cases to Playwright.
9. **Optional, later:** larger/faster GitHub runners or self-hosted runners for the nightly job only, if nightly wall-clock becomes the bottleneck; test-impact-analysis services exist but add vendor cost/complexity a small team rarely recoups before doing 1–7.

---

## Prioritized checklist (adopt in this order)

**Phase 0 — Stop the bleeding / restore trust (week 1)**
1. ☐ Instrument flake: enable Playwright's flaky reporting in CI; list every test that passed-on-retry in the last 2 weeks. That list, sorted by frequency, is the work queue.
2. ☐ Quarantine the worst offenders *today*: move to a non-blocking `quarantine` job/project, each with named owner + ticket + fix-or-delete date (≤10 working days, cap ~8 at a time). Remaining suite becomes the merge gate.
3. ☐ Set CI config: `retries: 2` (CI only), `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, `workers: 1–2`, Chromium-only, Linux. Upload trace/report artifacts only on failure.

**Phase 1 — De-flake the core (weeks 1–3)**
4. ☐ Ban `waitForTimeout`, `networkidle` waits, non-retrying `isVisible()` assertions, CSS/XPath locators — enforce by lint/review; replace with web-first assertions and role/label/test-id locators (codegen to pick them).
5. ☐ Per-test data isolation: unique tenant/user/document per test (UUID suffixes), seed + teardown via NestJS API `request` fixture, no shared mutable seed user for write tests; worker-scoped fixtures only for read-only personas.
6. ☐ Auth via setup project + `storageState` per role/tenant; API login, not UI login, in setup.
7. ☐ Stub all third parties in E2E (`page.route` for browser calls; env-level fakes for server calls). Pin timezone/locale/viewport in config. Burn-in every new/fixed test (`--repeat-each 20–50`) before it may gate.

**Phase 2 — Shrink and tier the suite (weeks 2–4)**
8. ☐ Audit every E2E test: “could an API/component test prove this?” Push down or delete; keep ~5–15 CUJs (§1 list). Tag survivors: `@smoke`, `@regression`, `@prod-safe`.
9. ☐ Wire tiers: PR = `@smoke` + `--only-changed` (fetch-depth 0); merge-to-main = full Chromium; nightly = full × 3 browsers, sharded (matrix + blob + merge-reports). Publish the tier table in the repo README.
10. ☐ Run Playwright in CI against a production build (`next build && next start` via `webServer`), not `next dev`.

**Phase 3 — Deterministic AI features (weeks 3–5)**
11. ☐ Add the LLM seam in NestJS: provider behind an injectable interface, baseURL/model from env. In test env point it at a mock LLM server (aimock or a small in-repo fixture server) with per-test fixture routing (`X-Test-Id`).
12. ☐ Rewrite AI E2E assertions: schema/shape + allowed-category sets + DB/API probe assertions (finding persisted, correct tenant/document/severity). Delete every exact-prose assertion on LLM output. Assert streaming *completion*, not partial text.
13. ☐ Stand up a separate eval suite (code-owned harness): 20–50 tasks from real documents/failures, code graders first, LLM-as-judge only with a rubric calibrated against human labels; multiple trials; run on prompt/model changes + nightly, never inside Playwright specs.

**Phase 4 — Environments (on the next releases)**
14. ☐ Separate `playwright.config` projects for staging vs production (different baseURL, tags, timeouts, parallelism). Full mutating suite gates staging → prod promotion.
15. ☐ Create the prod synthetic tenant + dedicated accounts (excluded from analytics/billing/email, credentials rotated, self-cleaning tests). Post-prod-deploy job runs `@prod-safe` read-path smoke; failure = investigate/rollback decision.
16. ☐ Only when prod smoke flake rate <2–3% sustained: promote `@prod-safe` specs to scheduled synthetic monitoring (Checkly or scheduled GH Actions), split into short check suites, alerts to on-call with runbooks.

**Phase 5 — AI-assisted authoring (ongoing, low priority)**
17. ☐ Adopt codegen + Playwright MCP in your coding agent for drafting new tests; try `npx playwright init-agents` Planner (plans) and Healer (repairs) — with mandatory human review of every generated/healed diff, and a rule that healed tests are checked for masked regressions.
18. ☐ Do not buy mabl/Testim or put Stagehand/browser-use in CI unless you have data showing locator churn (not timing/data) dominates maintenance *and* a POC proves flake-rate improvement on your own app.

## Could not verify / open questions

- **Linear's own testing practice:** no usable primary source found despite targeted searching (only vendor marketing mentioning Linear as a customer of an AI testing tool). No Linear claim is made above. Similarly, no primary Vercel-team E2E case study beyond the Next.js docs recommendation and Rauch's trophy quote.
- **Browser-binary caching:** Playwright's official docs advise against it (restore ≈ download); multiple practitioner blogs report large savings from caching. Unresolved disagreement — measure on this team's workflow.
- **Self-healing percentages** (mabl 95%, Functionize 99.97%, 70–85% locator-flake field model) are vendor/review claims, not independently benchmarked; no public benchmark comparing Playwright Test Agents, mabl/Testim, and Stagehand on the same app was found.
- **Exact Playwright version features** (agents in 1.56, `failOnFlakyTests` in 1.52, `--only-changed` in 1.46/1.50) come from official docs/release-note excerpts and secondary reviews read via `index`; pin and verify against the team's installed version.
- Mission did not specify current E2E test count, current flake rate, or monthly GitHub minutes actually consumed — the checklist's numeric targets (≤5 min smoke, ~8 quarantine cap) are published-rule-of-thumb starting points to calibrate against those.

## Sources

Verified live (fetched in full, 2026-11-10):
- Playwright — Best Practices — https://playwright.dev/docs/best-practices
- Anthropic — Demystifying evals for AI agents — https://www.anthropic.com/research/demystifying-evals-for-ai-agents
- Currents — Playwright testing in Staging vs Production — https://currents.dev/posts/playwright-testing-staging-vs-production

Index (search excerpts, 2026-11-10):
- Playwright — Test Agents — https://playwright.dev/docs/test-agents
- Playwright — Sharding — https://playwright.dev/docs/next/test-sharding
- Playwright — Continuous Integration (`--only-changed`) — https://playwright.dev/docs/ci
- Playwright — Assertions — https://playwright.dev/docs/test-assertions
- Google Testing Blog — Just Say No to More End-to-End Tests (via summary) — http://umatechnology.org/how-to-build-a-scalable-testing-strategy/
- Testing Trophy / pyramid comparisons — https://blog.michaelsam94.com/testing-pyramid-vs-trophy/ ; https://landing.complexqa.com/en/wiki/test-automation/automation-levels-and-test-pyramid
- Fowler Practical Test Pyramid (via summary) — http://umatechnology.org/how-to-use-the-testing-pyramid-to-build-a-faster-test-suite/
- web.dev — What to test — https://web.dev/learn/testing/get-started/what-to-test
- Flaky tests: Google data + Luo et al. taxonomy + quarantine policy — https://www.busfactor.tech/blog/flaky-tests ; https://landing.complexqa.com/en/wiki/test-automation/flaky-tests
- Senior Playwright practices (fixture scope, auth) — https://www.deviqa.com/blog/playwright-best-practices-what-senior-qa-engineers-actually-do-differently/
- Playwright CI/CD (workers, sharding, browser install) — https://www.testmuai.com/learning-hub/playwright-ci-cd/
- Next.js testing / E2E for async Server Components — https://www.qareef.com/e2e-testing-nextjs.html ; https://app.sybqa.com/blog/nextjs-testing-layers
- TanStack — How We Test TanStack AI Across 7 Providers on Every PR (aimock) — https://tanstack.com/blog/how-we-test-tanstack-ai-across-7-providers
- TestChimp — How to Test AI-Powered Web Applications — https://testchimp.io/guides/verticals/testing-ai-web-apps/
- Deterministic boundary for AI testing — https://ai.zenheart.site/tech/08-production/testing.html
- OpenAI — Evaluation best practices — https://developers.openai.com/api/docs/guides/evaluation-best-practices
- Record/replay for LLMs — https://pypi.org/project/standin/ ; https://docs.rs/llmposter/latest/llmposter/
- Checkly — Playwright tests as monitors; test organization — https://www.checklyhq.com/product/start-monitoring-with-playwright/ ; https://www.checklyhq.com/docs/detect/synthetic-monitoring/playwright-checks/test-organization/
- Playwright Test Agents critical review (Brown, Sep 2026) — https://medium.com/@michael-brown-/playwright-test-agents-explained-planner-generator-and-healer-53f0fc0dbc9a
- E2E test generation / Healer review caution — https://www.augmentcode.com/guides/e2e-test-generation-playwright-cypress
- AI testing tools / self-healing reviews — https://www.forasoft.com/blog/article/ai-testing-optimization ; https://rankite.com/blog/best-ai-powered-test-automation-tools ; https://www.wetest.net/blog/ai-testing-tools-that-truly-save-qa-time-in-2026-1135.html
- Stagehand / browser-use comparisons — https://www.nxcode.ai/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026 ; https://dev.to/sellooh/playwright-ai-stagehand-its-better-than-it-sounds-2gi4 ; https://www.skyvern.com/blog/browser-use-vs-stagehand-which-is-better/
