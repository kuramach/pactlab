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
| AI | Claude via AWS Bedrock |
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

## Every session

- One task per session; ship the smallest demoable vertical slice. Read the relevant modules, tests, contracts and ADRs before editing, and identify the expected files, authorization, tenancy, lineage and migration effects.
- Plan mode before auth, billing, schema or infrastructure changes. Record irreversible or cross-cutting decisions in ADRs (`docs/adr/`).
- Never invent provider APIs, SDK methods, scopes, limits or legal rules; verify installed types and current official docs.
- Migrations are backward-compatible expand/migrate/contract. Business logic lives in domain/application services; inputs validate against shared schemas; provider behavior stays behind adapters.
- Fixture-first: every provider has live and fixture adapters behind one interface; downstream code never branches on mode. Synthetic fixtures only — never customer or production data.
- Version AI prompts and test them like code.
- Local-first: Postgres and Redis run in Docker; CDK is synthesized, never deployed. Agents never create AWS accounts, deploy stacks or assume AWS credentials exist.

## On-demand docs (read when the task needs them — not every run)

| Need | Read |
|---|---|
| Session framing (Outcome/Scope/…) and full working protocol | `docs/agent/session-protocol.md` |
| Build increments, exit criteria, phases 2–3 | `docs/agent/build-order.md` |
| Fixture/live adapters, `pnpm seed`, synthetic companies | `docs/agent/fixtures.md` |
| AWS profiles, deploy and promotion rules | `docs/agent/aws.md` |
| Full product spec (large — read only the sections you need) | `docs/spec/Claude Code Specification.md` |
| Architecture decisions | `docs/adr/` |
| Agent loop, parallel lanes, context tiers | `docs/PARALLEL_OPS.md` |
| Operational procedures | `docs/runbooks/` |

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
- **Order and lanes.** The scheduler honours each task's `Needs:` and `Touches:`; the map lives in `docs/PARALLEL_OPS.md`.
- **Context tiers.** A task's `Context:` (`light | standard | deep`, default `standard`) decides what the runner puts in your prompt. Work from that; open on-demand docs only when the task needs them. If missing context blocks you, print `CONTEXT-STARVED: <what you needed>` and stop rather than guess.
- **Stay inside your scope.** Touch only the `Touches:` paths in your task file. Anything else is a new task — do not improvise it.
- **One task per session.** Finish (done or blocked) before taking another.
- **PRs, never direct pushes.** Push your branch and open a PR against `main`. Never push to `main` directly.
- **Green before done.** A task is done only when its `Checks:` pass and the PR is open.
- **Report plainly.** End every session with: files changed, exact commands run and their results, the PR link, and anything unfinished or blocked.
- **Stop on ambiguity.** If the brief conflicts with this file or the spec, mark the task blocked and report. Do not improvise architecture to keep moving.
