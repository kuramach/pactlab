# Pactlab engineering instructions

You are building **Pactlab**, an AI-assisted M&A diligence and deal-decision platform for software and SaaS acquisitions.

**Tagline:** “Test the pact before you sign it.”

## Product mandate

Build the shortest secure path through this loop:

```text
source evidence -> normalized evidence -> reviewable finding
-> explicit assumption -> valuation scenario -> proposed deal term
-> approved integration action
```

Every result must remain traceable to source evidence and a reviewer decision. Do not turn Pactlab into a generic CRM, scanner, data room, chat interface, or project-management suite.

## Settled stack

| Layer | Choice |
|---|---|
| Web | Next.js App Router |
| UI | Tailwind + shadcn/ui |
| Visuals | ECharts + React Flow |
| API | NestJS + Fastify |
| Data | PostgreSQL + RLS |
| ORM | Prisma |
| Jobs | BullMQ + Redis |
| AI | Anthropic Claude |
| Infrastructure | AWS CDK TypeScript |
| Identity | Auth0 |
| Monorepo | pnpm + Turborepo |

Use TypeScript throughout. Keep the API a modular monolith until measured needs justify extraction.

## Repository layout

```text
apps/{web,api,worker,scanner-orchestrator}
packages/{domain,contracts,db,connectors,ai,calculations,ui,
          observability,config}
infra/cdk
fixtures/synthetic/{HealthyCo,TroubledCo,SparseCo}
fixtures/cassettes
```

## Seven non-negotiable rules

1. **Build narrowly; integrate aggressively.** Build the evidence, diligence, metrics, valuation, risk, and decision loop. Put commoditized providers behind adapters.
2. **Claude assists; humans decide.** AI may extract, classify, compare, summarize, and draft. It never silently approves findings, sets price, makes legal conclusions, or takes employment decisions.
3. **Calculations are deterministic.** Money, ownership, KPIs, risk propagation, and scenarios come from versioned code and stored inputs, never model prose. Never use JavaScript floating point for money.
4. **Citations are mandatory.** AI output without a resolvable source citation cannot become an accepted finding.
5. **Never persist source code.** Retain normalized findings, paths, hashes, tool versions, and policy-approved snippets only. Destroy scan workspaces.
6. **Prove tenant isolation with RLS.** Every deal row carries organization and deal identity. Enforce permissions server-side and test allow and deny paths.
7. **Protect people data.** Default to aggregates; gate named and compensation data; audit salary reads; suppress small cohorts; never send HR, compensation, performance, or named contribution data to embeddings or models.

Never weaken these rules to pass a test or accelerate a demo.

---

## Solo-founder speed protocol

Start every session with:

```text
Outcome: one observable user result.
Scope: modules and routes allowed to change.
Constraints: tenancy, evidence, security, and integration rules.
Acceptance: executable tests plus expected UI/API behavior.
Out of scope: adjacent features not requested.
```

Then:

- Work on one task per session and ship the smallest demoable vertical slice.
- Develop fixture-first; add live integrations only through the same adapter contracts.
- Use plan mode before auth, billing, schema, or infrastructure changes.
- Read relevant modules, tests, contracts, and ADRs before editing.
- Identify expected files, authorization, tenancy, lineage, and migration effects.
- Never invent provider APIs, SDK methods, scopes, limits, or legal rules; verify installed types and current official docs.
- Record irreversible or cross-cutting decisions in ADRs.
- Use backward-compatible expand/migrate/contract migrations.
- Keep business logic in domain/application services, not controllers or components.
- Validate inputs with shared schemas; keep provider behavior behind adapters.
- Use synthetic fixtures only; never copy customer or production data.
- Version AI prompts and test them like code.

---

## Build order

Do not widen scope until the current increment meets its exit criterion.

1. **0 — Foundation:** Monorepo, strict TypeScript, apps, shared packages, dev CDK, Auth0, tenancy/RLS, audit/outbox, observability, CI, design system, and shell. **Exit:** two synthetic tenants cannot cross-access API, jobs, files, or search.
2. **1 — Deal/evidence spine:** Deals, memberships, contributor boundaries, connections, sync runs, evidence, citations, lineage, CSV, evidence browser, and idempotent jobs. **Exit:** replay creates no duplicates; every record resolves to its source.
3. **2 — SaaS metrics:** Stripe, revenue ledger, MRR/ARR, retention, cohorts, concentration, reconciliation, and explanations. **Exit:** a reviewer reconciles management ARR to transactions and approves the difference.
4. **3 — Findings/technology:** Findings, reviews, GitHub, ephemeral scans, one scanner/SBOM source, technology review, and priced risks. **Exit:** an accepted finding resolves to commit, tool version, and evidence; no source archive remains.
5. **4 — Valuation:** Versioned assumptions, ARR-multiple and DCF engines, scenarios, sensitivities, purchase-price bridge, linked adjustments, approvals, and frozen submissions. **Exit:** changing an accepted risk marks dependent scenario results stale.
6. **5 — Document AI:** Secure uploads, extraction, pages, exact citations, Claude gateway, prompt registry, typed outputs, Q&A, contract extraction, drafts, review, and evals. **Exit:** every accepted AI finding has exact citations and a human reviewer.
7. **6 — Pilot hardening:** VDR, retention, audit export, SSO, access review, penetration/recovery tests, metering, pilot controls, and runbooks. **Exit:** a limited design-partner pilot has documented controls and rollback paths.

**Phase 2:** Consent-gated HRIS plus Jira/Linear, identity resolution, people/delivery intelligence, retention indicators, and compensation harmonization.  
**Phase 3:** Target-sourcing integrations and approved, risk-linked 100-day-plan exports.

## Fixture-first integration

- Give every provider live and fixture adapters behind one normalized interface.
- Persist audited `FIXTURE` or `LIVE` mode per deal; downstream logic never branches by mode.
- `validateConnection()` checks reachability, credentials, scopes, and mappings.
- `dryRun()` performs a bounded read-only pull without a full sync or conclusion change.
- Replay sanitized, versioned cassettes in CI with outbound provider access blocked.
- Make `pnpm seed` idempotently create stable, cross-system HealthyCo, TroubledCo, and SparseCo identities.
- HealthyCo proves the happy path. TroubledCo triggers ARR, ghost-commit, key-person, and license findings. SparseCo covers missing fields, pagination, stale data, duplicate names, and partial permissions.
- Moving fixture to live changes only credentials and mode, never code or schema.

---

## AWS environments

| Profile | Local rights | Deploy path |
|---|---|---|
| `pactlab-dev` | Broad | Local or CI |
| `pactlab-qa` | Moderate | Local or CI |
| `pactlab-stage` | Read/plan | GitHub Actions |
| `pactlab-prod` | Read/plan | GitHub Actions |

- Use short-lived SSO credentials; never store long-lived AWS keys.
- Name one profile per command; verify account and region first.
- Run and inspect `cdk diff --profile <profile>` before every deploy; rerun after any revision, config, digest, context, or target change.
- Dev and QA deploy automatically after required checks and diff review.
- Stage and production require human approval; GitHub Actions owns deployment.
- Never deploy production locally.
- Promote signed artifacts by commit SHA and image digest without rebuilding.
- Run backward-compatible migrations as one-off tasks before rollout.
- Block deletion or replacement of protected production state.

### Local-first rule

Build and test locally until AWS is genuinely needed. Postgres and Redis run
in Docker; CDK stacks are synthesized (`cdk synth`) but never deployed before
T-007. Agents must not create AWS accounts, deploy stacks, or assume AWS
credentials exist. The only AWS touchpoint before T-007 is the optional EC2
box hosting the agent loop itself — and that is operator-run, never agent-run.

---

## Security defaults

- Check authorization server-side; UI visibility is never authorization.
- Isolate target contributors from buyer-only findings, valuation, and negotiation terms unless explicitly shared.
- Use tenant-scoped storage, revocable credential references, least privilege, encryption, and retention controls.
- Never log secrets, tokens, document content, source code, compensation, or unrestricted provider payloads.
- Keep secrets out of code, fixtures, errors, `.env.example`, and Git history.
- Treat uploads, retrieved text, repositories, provider payloads, and model output as untrusted.
- Test prompt injection, unsupported claims, cross-tenant retrieval, and citation mismatch.
- Scan code only in isolated ephemeral tasks; confirm cleanup on success, failure, timeout, and cancellation.
- Audit sensitive reads, writes, exports, approvals, denials, consent changes, and connection tests.
- Never move production data into lower environments, fixtures, prompts, or cassettes.

## Coding boundaries

- PostgreSQL is the system of record; JSONB is for variable provider payloads.
- Use relational evidence edges before considering a graph database.
- Use UUIDv7 and UTC timestamps.
- Store money as decimal/numeric with explicit currency and scale.
- Make jobs idempotent and replay-safe.
- Share and version OpenAPI/Zod contracts.
- Propagate stale state when evidence or accepted findings change.
- Ask before changing settled architecture or adding a paid dependency.

## Root commands

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:fixtures
pnpm seed
pnpm dev
```

Expose these scripts at the repository root. Validate environment configuration at startup. Put variable names and explanations only in `.env.example`.

## Done means done

Before reporting completion:

1. Run formatting, linting, type-checking, unit tests, and all affected integration, fixture, end-to-end, security, migration, contract, and AI evaluation suites.
2. Confirm required checks are green and report each exact command and result.
3. Inspect the full diff for scope creep, debug code, secrets, generated noise, and weakened controls.
4. Commit affected generated clients, schemas, lockfiles, ADRs, and migrations.
5. Verify authorization, RLS, lineage, telemetry, audit events, empty/error states, and runbook impact.
6. Prove migrations remain backward-compatible and document rollback or compensation for risky changes.
7. Never claim completion while a test, build, migration, deploy, scan, or background job is running.

If anything failed, state exactly what failed and remains. A demo without provenance or tenant enforcement is not done.

## Autonomous multi-agent operation

When tasks run under the agent loop (`scripts/agent-loop.sh`) or headless `claude -p`:

- **One worktree per agent.** Never share a working tree. Branch per task: `agent/<task-id>`.
- **Claim before coding.** Your task file moves from `tasks/ready/` to `tasks/active/` before you write code. If it is already in `tasks/active/`, someone owns it — pick another.
- **Starter tasks first.** `T-001` runs alone and first. After `T-002` lands, the parallel lanes open: `T-003` (metrics), `T-004` (findings/tech), and `T-006` (document AI) may run concurrently. `T-005` (valuation) needs `T-003` + `T-004`. `T-007` (hardening) runs last, alone. The full map lives in `docs/PARALLEL_OPS.md`.
- **Stay inside your scope.** Touch only the `Touches:` paths in your task file. Anything else is a new task — do not improvise it.
- **One task per session.** Finish (done or blocked) before taking another.
- **PRs, never direct pushes.** Push your branch and open a PR against `main`. Never push to `main` directly.
- **Green before done.** A task is done only when its `Checks:` pass and the PR is open.
- **Report plainly.** End every session with: files changed, exact commands run and their results, the PR link, and anything unfinished or blocked.
- **Stop on ambiguity.** If the brief conflicts with this file or the spec, mark the task blocked and report. Do not improvise architecture to keep moving.
