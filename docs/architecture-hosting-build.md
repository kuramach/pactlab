# Pactlab — Architecture, Hosting and Build Process

Living reference for how Pactlab is built, where it runs, and how changes get
from an idea to live. Last updated 2026-11-19. Detail lives in the ADRs
(`docs/adr/`) and runbooks (`docs/runbooks/`); this document is the map.

## 1. What the system is

Pactlab is a deal platform for private equity and corporate development:
diligence, valuation, terms and closing in one place. Its core loop is

```
evidence → normalized evidence → reviewable finding → explicit assumption
→ valuation scenario → proposed deal term → approved integration action
```

Every step is a versioned record a human can inspect. AI produces cited
evidence and findings; deterministic code does all arithmetic; humans approve
anything that leaves the platform (terms, letters, signatures).

Industry coverage ships as **packs** (evidence adapters + findings logic per
deal type — software, healthcare, industrials, multifamily, venture raise,
multifamily syndication, and others). The valuation engine's internal name is
**Sextant**.

### The valuation influence rule

Every adapter input maps to a finding with a direction of −1, 0 or +1,
enforced by the `VALUATION_DIRECTION_MAP` registry and a contract test that
fails the build on any unmapped evidence type:

- **−1 (drag)** → term proposals in the seller-facing position
  (price reduction, remediation cost, escrow, indemnity).
- **+1 (cushion)** → "value confirmed, not price paid" in a
  counterparty-confidential confirmed-value ledger. It never touches the
  bridge and never raises the price.
- **0** → informational, with an explicit rationale.

Buyer personas (Quality Compounder / Value Investor / Grave Dancer, ADR 0021)
parameterise how findings translate into price and terms. A persona never
changes evidence, findings or directions, and is never visible to the seller.

## 2. Repository layout

pnpm monorepo with Turborepo. TypeScript throughout.

**Apps**

| App | Role |
|---|---|
| `apps/web` | The product web app (Next.js) |
| `apps/api` | The API service (auth, pacts, documents, valuation, admin) |
| `apps/worker` | Background job worker (BullMQ consumers) |
| `apps/scanner-orchestrator` | Orchestrates scans of connected codebases |
| `apps/site` | Marketing site (pactlab.ai) |
| `apps/e2e` | Playwright end-to-end suites |

**Packages**

| Package | Role |
|---|---|
| `packages/domain` | Core domain model: pacts, evidence, findings, terms |
| `packages/db` | Prisma schema and migrations (Postgres) |
| `packages/ai` | AI provider gateway, model routing, evaluation |
| `packages/connectors` | Evidence adapters (GitHub, Jira, uploads, CSV, …) |
| `packages/calculations` | Deterministic financial calculations (no AI arithmetic) |
| `packages/contracts` | Shared contracts (evidence/citation, signing, …) |
| `packages/config` | Shared configuration |
| `packages/observability` | Logging and metrics |
| `packages/ui` | Shared UI components |

## 3. Application architecture

Three runtime services, all stateless containers:

- **Web** serves the UI. **API** serves the product API and admin console.
  **Worker** runs asynchronous jobs (document intake and extraction, imports,
  connector pulls, demo maintenance) from a Redis-backed BullMQ queue.
- **Sessions, tokens and rate limits live in Postgres**, not Redis. Redis is
  the job-queue backbone, not a cache.
- **Tenancy**: every record belongs to an organization; Postgres row-level
  security enforces isolation. Confidentiality walls are structural, not
  cosmetic — buyer-confidential material (personas, the confirmed-value
  ledger, IC packs) is excluded in the read model, so it cannot leak through
  reports or the seller view.
- **Document flow**: upload → storage in S3 → intake job (classification,
  extraction, vision pass where needed) → normalized evidence with citations
  → findings → valuation bridge → terms. Source files are kept byte-for-byte;
  every AI-derived statement carries a citation back to its source.
- **Reports** are generated from the same versioned read model (executive and
  detailed pact reports, PDF, org-branded per ADR 0031).

### Identity

Auth0 handles sign-in. Posture (ADR 0001, reaffirmed 2026-10-31):
**SSO-capable, never SSO-required.** Default for sellers, guests and
counterparties is passwordless + MFA; per-organization enterprise SSO is
enabled only when a signed enterprise customer requires it. A production
Auth0 tenant is provisioned at that point, not before.

## 4. The AI subsystem

AI is reached only through the provider gateway in `packages/ai`. No feature
calls a model directly.

**Routing (T-132).** A `JOB_MODEL_MAP` registry assigns each job type a
model, a provider lane and a declared fallback chain; a contract test keeps
the registry complete. Defaults:

| Job | Default model class |
|---|---|
| Deep review | Claude Opus |
| Contract scrub (dedicated pass) | GPT-5.5 with reasoning |
| Extraction, classification, first-pass Q&A | Gemini 3.1 Pro |
| Vision / document understanding | Gemini 3.1 Pro |
| Fast triage | Haiku / Flash class |

Lanes: AWS Bedrock, Anthropic direct (interim lane), Google Gemini API,
OpenAI. One evidence + citation contract applies across all providers, and
per-job cost is metered against a target of roughly **$3.50–$10.50 of AI
spend per deal**.

**Data-terms gate (ADR 0034).** A non-AWS provider's models may serve traffic
only when both are true, recorded in Admin → AI models: (1) the provider's
data terms are on file with **DPA in place and zero retention**, and (2) the
model has passed the built-in evaluation (status EVALUATED). US data
residency only.

**Current operating note (Nov 2026).** Bedrock access is suspended at the
account level by AWS Fraud Prevention and under review (cases escalated
2026-11-16); the direct Anthropic lane is the interim path for Claude models.
This is an account matter, not an architecture constraint — the gateway makes
it a configuration change.

## 5. External integrations

| Integration | Posture |
|---|---|
| GitHub / Jira | Live evidence adapters, **permanently read-only** (ADR 0005/0011) |
| Stripe | Billing; test mode until live pricing is set (ADR 0025) |
| Signing | Provider-neutral seam (ADR 0022); **BoldSign is the launch adapter**, selectable per organization; DocuSign adapter deferred until an enterprise customer justifies its ISV licensing |
| Email | Amazon SES (production access approved 2026-11-18: 50,000/day, out of the sandbox); bounce/complaint events handled per ADR 0032 |
| MCP | Pactlab OAuth for MCP access (ADR 0024) |

## 6. Hosting

### AWS organization

One AWS Organization (**PactLab-Team**), four accounts:

| Account | ID | Holds |
|---|---|---|
| Management | 042954450979 | Org root, billing |
| Dev | 379959319207 | dev + qa environments |
| Stage | 438535681690 | stage environment |
| Prod (live) | 339764561153 | live environment only |

All infrastructure is CDK (TypeScript) under `infra/cdk/`. An organization
guardrail (SCP, ADR 0003 amendment) allows CloudFormation **only in
us-east-2**; Bedrock is used from us-east-1. All account navigation, support
and cost work goes through `scripts/aws.sh` (see `docs/agent/aws.md`).

### Per-environment shape

Each environment is the same stack at a different size: VPC → ALB → ECS
Fargate services (web, API, worker) → RDS Postgres + ElastiCache Redis, with
evidence in S3 and secrets in Secrets Manager (injected into ECS at runtime;
secrets are never committed — the repo is public).

| | dev / qa | stage | live |
|---|---|---|---|
| Database | small, shared account | own instance | t4g.medium, single-AZ, 20 GiB (grows to 200), 35-day backups |
| Redis | one cache.t4g.micro, shared (logical DBs) | cache.t4g.small ×2 | cache.t4g.micro ×1 |
| Idle pause | yes — services and RDS pause when idle | yes | **never — always on** |
| Protections | standard | standard | protected state, deletion protection, COMPLIANCE audit archive (2,555 days) |

Live runs deliberately skinny (~$150–180/month) for the design-partner
pilot. The scaled target is already written in `infra/cdk/config/prod.ts`
(`PROD_SCALED_TARGET`: 3 AZs, Multi-AZ m7g.large database at 100 GiB growing
to 1 TB, replicated m7g Redis pair). Spreading it over the live config is one
change, no re-architecture.

The marketing site is a private S3 bucket served through CloudFront
(global). The product app is served from the region.

### Scaling and geography — the honest position

- **More traffic, same region: configuration, not code.** The services are
  stateless, so capacity is container counts plus the scaled target above.
  The ceilings, in the order they would be hit: AI provider quotas
  (tokens/min) → the database → the single Redis node.
- **Users in other countries work today.** They pay ~100 ms of extra latency
  to Ohio, which document review and signing do not notice. CloudFront in
  front of the app is the cheap latency upgrade if that ever matters.
- **Hosting in other regions is a data project, not a container project.**
  There is one Postgres writer in us-east-2. Multi-region means per-customer
  data-residency decisions and replication, and amending the org guardrail.
  The org/RLS tenant model would support a "home region per customer" design
  without redesigning the app. It gets built when a customer's residency
  requirement pays for it, not speculatively.
- **Customer-hosted installs** (their cloud account or data center): the
  application travels well (containers, env-driven config, standard
  Postgres/Redis, provider seams for AI and signing); the AWS-native delivery
  platform around it does not. Feasible as a paid enterprise engagement, not
  a current offering.

### Email

SES in us-east-2, production tier (50,000 messages/day, 14/second) since
2026-11-18. Sign-in and notification mail send from the live account only.

## 7. Build process

### Local development

pnpm + Turborepo; Docker Desktop provides local Postgres and Redis
(docker-compose). Environment is configured through `.env` files locally and
Secrets Manager when deployed; the application reads plain environment
variables either way.

### Work is specified as tasks

Development is driven by task files in `tasks/` (`ready/`, `active/`,
`review/`, `done/`, `blocked/`). Every task carries literal header lines the
tooling greps for:

```
Engine:  Claude | Codex
Model:   haiku | sonnet | opus (by Context tier)
Lane:    …
Context: light | standard | deep
Touches: the paths the change may touch (clean path tokens)
Needs:   none, or task IDs that must be in tasks/done/ first
Checks:  the commands that must pass
```

**Build-time model routing** mirrors the product's: light → haiku,
standard → sonnet, deep → opus, and a tier-escalating retry escalates the
model too. **Engine split**: easy work (light/standard, well-specified, one
surface, verifiable, no money, no schema or security-critical design) builds
on Codex; hard work (deep, judgment, money, security, cross-cutting) builds
on Claude. Whoever builds, the other engine reviews.

### The agent loop

`scripts/agent-loop.sh` polls `tasks/ready/` and claims claimable tasks
(Needs met, no Touches overlap with anything active). `scripts/run-task.sh`
runs one task end to end; `scripts/run-tasks.sh` runs a named list:

1. Claim: move the file to `tasks/active/`, commit, push.
2. Build in an isolated git worktree on branch `agent/<task-id>`.
3. Run the task's `Checks:`.
4. Open a PR. With `--auto-merge`, it merges only if the diff stays inside
   the task's `Touches:` scope **and** all PR checks pass; out-of-scope
   diffs go to `tasks/review/`, failures to `tasks/blocked/`.

Two GitHub watchdogs report new failures and state changes (CI, deploys,
nightly suites); known, unchanged failure signatures are suppressed.

### Testing and CI

Principles live in `CLAUDE.md` (research: `docs/testing-best-practices.md`):
prove behaviour at the lowest level that can; Playwright only for ~5–15
critical journeys, tagged `@smoke` / `@regression` / `@prod-safe`;
user-facing locators only; per-test isolated, API-seeded data; auth once via
storageState; **CI never calls a live model**; a flaky test is quarantined
the same day and fixed or deleted within 10 working days.

| Workflow | Runs |
|---|---|
| `ci.yml` | PR smoke suite; full Chromium suite on main |
| `e2e-full.yml` | Full end-to-end suite |
| `integration-live.yml` | Nightly, against real GitHub/Jira (recorded demo data keeps demos offline) |
| `deploy.yml` | Per-environment deploys (below) |
| `site.yml` | Marketing site build and publish |
| `wake.yml` | Wakes idle-paused environments |
| `release.yml` | Release tags (below) |

## 8. Release and deployment

Deploy model (ADR 0019): **manual dispatch per environment**. Each deploy
waits on that environment's GitHub Environment approval; AWS access is via
OIDC (no stored keys); the image tag is the commit SHA; database migrations
gate the rollout. qa and live accept `main` only; dev and stage accept any
branch.

**Interim release path** (while there are no customers): branch → dev →
merge to main → dev → live, skipping qa/stage. qa/stage are parked, not
deleted, and remain manually dispatchable. When live-only changes accumulate,
a sync-back pass redeploys dev/qa/stage on the current build and reconciles
config parity — the environments share one codebase, so this is mechanical.

**Releases** are CalVer tags (`vYYYY.MM.N`) cut by deliberate `release.yml`
dispatch on main (see `docs/release.md`). Post-deploy `@prod-safe` browser
checks are specified and their config is in the repo; wiring the step into
`deploy.yml` is pending (the automation token lacks workflow scope, so it is
a one-time manual paste).

Operational scripts: `scripts/aws.sh` (accounts, support, cost),
`scripts/ai-key.sh` (per-environment AI provider keys into Secrets Manager),
`scripts/demo-org.sh` (demo tenants; a pool of five synthetic orgs is swept
every 15 minutes in live), `scripts/wake-environment.sh`, plus the runbooks
in `docs/runbooks/` (deploy, rollback, environments, hosting cost, recovery
drill, and more).

## 9. Security and data posture

- Tenant isolation enforced by Postgres row-level security; cross-tenant
  access is a sev-1 runbook (`docs/runbooks/suspected-cross-tenant-access.md`).
- Audit archive in S3 Object Lock **COMPLIANCE** mode — no identity,
  including root, can shorten retention.
- AI providers are gated on recorded data terms (DPA + zero retention) and
  evaluation before they can serve (ADR 0034); connector payloads are never
  logged; GitHub/Jira access is read-only.
- Secrets live in Secrets Manager per environment or in local `.env` files.
  Neither is ever committed; the repository is public.
