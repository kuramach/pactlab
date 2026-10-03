# Pactlab: Claude Code product specification

**Product type:** AI-assisted M&A diligence and deal-decision platform for acquisitions of software and SaaS companies  
**Product name:** Pactlab  
**Primary domain:** `pactlab.ai`  
**Implementation language:** TypeScript across web, API, workers and infrastructure  
**Primary AI:** Anthropic Claude  
**Architecture:** Modular monolith with an isolated scanning plane  
**Status:** Build-ready specification for Claude Code

> **Brand note:** Pactlab — Latin for pact/covenant. Tagline: “Every deal is a pact. Make it an honest one.” Primary domain: `pactlab.ai`.
>
> **Naming caveat:** Pactlab and every domain in this document require domain registration, company-name, trademark and linguistic checks immediately before adoption. A search-engine screen is not a registrar or legal clearance.

---

## 1. Product mandate

Build a secure decision system that connects evidence from billing systems, code repositories, cloud accounts, contracts and uploaded diligence material; converts that evidence into reviewable findings; and lets authorized humans map accepted findings into valuation adjustments, deal terms and post-close actions.

The differentiator is not storage, scanning, a generic chat interface or another deal CRM. The proprietary loop is:

```text
source evidence
  -> normalized evidence
  -> reviewable finding
  -> explicit assumption
  -> valuation scenario
  -> proposed deal term
  -> approved integration action
```

Every downstream result must remain traceable to its source evidence and reviewer decision.

### Product principles

1. **Build narrowly; integrate aggressively.** Build the evidence model, diligence logic, metrics normalization, valuation scenarios, risk register and evidence-to-deal workflow. Integrate identity, CRM, VDR, billing sources, cloud billing, scanners, HRIS, email and project/scrum systems.
2. **Claude assists; humans decide.** Claude may classify, extract, summarize, compare and draft. It must not silently approve findings, determine a purchase price, or make a legal conclusion.
3. **Calculations are deterministic.** Money, ownership percentages, KPI definitions and scenario outputs come from versioned code and stored inputs, never free-form model text.
4. **Citations are mandatory.** An AI answer without a resolvable source citation is incomplete and cannot be promoted to a finding.
5. **Target trust is a product feature.** Use least-privilege access, ephemeral scanning, tenant isolation, revocable credentials and explicit retention controls.
6. **Do not persist source code.** Store findings, file paths, hashes, ruleset versions and supporting snippets only when policy permits. Destroy scan workspaces after completion.
7. **PostgreSQL is the source of truth.** Use relational tables for business truth and JSONB for variable provider payloads. Treat graph views as projections, not as a separate system of record.

---

## 2. Users and permissions

### Primary personas

- **Deal lead:** Creates deals, controls access, approves scenarios and owns the investment recommendation.
- **Diligence analyst:** Connects sources, reviews evidence, creates findings and prepares reports.
- **Technical reviewer:** Reviews code, security, OSS and cloud findings.
- **Finance reviewer:** Validates ARR, cohorts, concentration, unit economics and valuation assumptions.
- **Legal reviewer:** Reviews contract extractions and legal implications.
- **Target contributor:** Supplies documents and connections but cannot see buyer-only analysis.
- **Investment committee viewer:** Reads approved conclusions, scenarios and cited evidence.
- **Organization administrator:** Manages identity, SSO, policies, retention and audit export.

### Role model

Use organization membership plus deal membership. Initial roles are `ORG_OWNER`, `ORG_ADMIN`, `DEAL_LEAD`, `ANALYST`, `REVIEWER`, `ADVISER`, `TARGET_CONTRIBUTOR` and `VIEWER`.

Permissions must be checked server-side. Frontend visibility is never authorization. Target contributors must be isolated from buyer-only findings, valuation assumptions and negotiation terms unless a deal lead explicitly shares an item.

---

## 3. Scope and product modules

### Release 1: complete evidence loop

The first release is successful when a buyer can create a deal, import source data, verify recurring revenue, review technology risk, ask questions across documents, approve findings and see those findings alter a valuation scenario.

1. **Deal context hub:** Thin deal shell with stage, target, team, permissions, tasks and evidence status. Sync to a best-in-class CRM rather than recreating one.
2. **SaaS metrics:** CSV and Stripe ingestion; normalized MRR and ARR; NRR, GRR, churn, cohorts and concentration; reconciliation against management figures.
3. **Valuation workbench:** ARR-multiple, DCF and scenario views; assumptions; sensitivity tables; purchase-price bridge.
4. **Technology diligence:** Read-only GitHub connection, partner scanner output ingestion, code-health indicators, SBOM and license findings.
5. **Priced risk register:** Severity, confidence, cost-to-fix, time-to-fix, evidence, reviewer state and suggested deal consequence.
6. **Document AI:** Secure upload or VDR access, Claude Q&A, typed extraction, exact-page citations and reviewer approval.

### Later releases

- **Release 2:** Full VDR integration, security/compliance review, cloud unit economics, deeper contract review, and team/key-person risk fed by read-only HRIS plus project/scrum data.
- **Release 3:** Target sourcing integrations, lookalike discovery and export of risk-linked 100-day plans to Midaxo, Devensoft or customer task systems.

### Thirteen-module contract

| Module | Strategy | Release |
|---|---|---:|
| Target sourcing | Integrate | 3 |
| Deal pipeline / CRM | Integrate | 1 |
| Valuation engine | Build | 1 |
| SaaS metrics | Build | 1 |
| Virtual data room | Integrate | 2 |
| Technology diligence | Partner | 1 |
| OSS and IP risk | Partner | 1 |
| Security and compliance | Partner | 2 |
| Cloud and unit economics | Build | 2 |
| Team and key-person risk | Build + integrate | 2 |
| AI contract review | Integrate + workflow | 1 |
| Risk to valuation | Build | 1 |
| Post-merger integration | Integrate | 3 |

### Explicit non-goals

Do not build a proprietary SAST/SCA scanner, a full VDR, a billing platform, a foundation model, a relationship-intelligence CRM or a generic project-management suite. Do not add Neo4j until measured production queries show PostgreSQL recursive queries are insufficient.

### Transaction types

Pactlab supports three transaction types. Transaction type is a first-class deal attribute, set at deal creation and versioned thereafter; it drives which modules are enabled, which data sources are ingested, and which valuation methods are offered. The evidence → finding → assumption → valuation core is unchanged across types — only the inputs ingested and the valuation math around findings differ.

| Type | Acquirer | Target listing | Default posture |
|---|---|---|---|
| Public acquirer | Public company | Private or public | Disclosure-led |
| Private acquirer | PE / private buyer | Private | Data-room discovery |
| Take-private | PE / consortium | Public | Disclosure + LBO |

**Deal configuration:**

- **Stored attribute:** `deals.transaction_type` is one of `PUBLIC_ACQUIRER`, `PRIVATE_ACQUIRER`, or `TAKE_PRIVATE`, set at deal creation and shown on the deal shell. Changing it later is a versioned deal event, not a silent edit, and re-runs module and valuation configuration.
- **Module enablement:** Type selects the default module set (for example, market-data and EDGAR modules only for public targets; LBO modelling only for take-privates). Deal leads may enable additional modules, but type-inapplicable modules stay hidden by default.
- **Data-source defaults:** Type determines which connectors are offered first at setup — EDGAR and market prices for public targets, VDR and billing/code/cloud sources for private targets. All connectors remain behind the standard consent and least-privilege flow.
- **Valuation defaults:** Type determines which valuation methods are pre-configured in the workbench (see *Valuation additions* below). Methods not offered for a type require an explicit deal-lead override with rationale.

**SEC EDGAR ingestion (public targets):**

- **Integrate, do not build:** Add an EDGAR adapter behind the standard connector contract. EDGAR is free and structured, so Pactlab consumes it rather than recreating filing access or parsing infrastructure.
- **Filing types:** Ingest 10-K, 10-Q, 8-K, DEF 14A proxy statements, and S-4 registration statements where relevant to the deal. Prefer XBRL-structured financials where available; fall back to filing text extraction with page-level citations.
- **Normalized output:** Filings land as evidence items with issuer, form type, period, filing date, accession reference, and content hash. Financial line items from XBRL feed the metrics engine on the same normalized ledger used for private-target billing data.
- **Refresh:** Re-sync on new filings during the deal; a new 8-K or amended filing creates new evidence and marks dependent findings and scenarios stale, following the existing freshness rules.

**Disclosure-gap analysis (public targets):**

- **What it is:** A first-class finding source that compares what the target has told public markets against what diligence evidence shows, and flags discrepancies as reviewable findings.
- **Comparison pairs:** Filing assertion versus data-room or system evidence — for example, the 10-K reports a revenue or headcount figure and the billing ledger or HRIS snapshot shows a materially different one; risk-factor language versus scanner, security, or contract evidence; segment or customer-concentration disclosure versus normalized metrics.
- **Output shape:** Each gap becomes a draft finding with two citations — one to the filing passage or XBRL item, one to the contradicting evidence — plus a reviewer workflow identical to any other finding. Gaps are never auto-accepted, and a gap with only one side evidenced stays a diligence question, not a finding.
- **Where it runs:** Disclosure-gap checks run deterministically where structured data exists on both sides (financials, headcount, concentration) and as Claude-assisted comparisons for narrative disclosure, under the standard citation and human-review rules.

**Valuation additions (by type):**

The valuation engine keeps its deterministic, versioned-assumption contract. Transaction type adds these methods alongside the existing ARR-multiple and DCF:

- **Trading comps (public targets):** Comparable-company multiples computed off live market prices (price, shares outstanding, net debt) with the price timestamp and source stored on the scenario version. Comps refresh marks dependent scenarios stale rather than silently repricing them.
- **Premium analysis (public targets):** Offer premium over the unaffected price and over 30-day VWAP, with the unaffected date and lookback window stored as explicit scenario inputs. This is the standard take-private and public-target pricing lens.
- **LBO model (take-privates):** Entry price, debt capacity and structure, sponsor equity, exit multiple and horizon, producing IRR and money-multiple outputs. All leverage and exit assumptions are typed, versioned inputs; returns are computed in code, never drafted by the model.
- **Accretion/dilution (public acquirers paying in stock):** When consideration includes acquirer shares, model the effect on acquirer EPS and ownership using acquirer and target earnings, share counts, and the exchange ratio as stored inputs.

**Deal process tracking (public-deal mechanics):**

- **Lightweight timeline/checklist:** Public-deal mechanics are tracked as a deal-level checklist with owners, dates, and evidence links — not a workflow engine. Items include tender offer launch and expiry, shareholder vote, go-shop period start/end, HSR and CFIUS filing and clearance milestones, and S-4 effectiveness where applicable.
- **Finding linkage:** A missed or at-risk milestone can be raised as a finding or deal term, but the checklist itself is status tracking only; it does not file anything with a regulator or exchange.

**Private-target baseline:**

- **Discovery from scratch:** Private targets remain the current baseline — diligence is data-room-driven, built from connected billing, code, cloud, contract, and document evidence rather than public filings.
- **No EDGAR dependency:** Private-acquirer and private-target deals require no EDGAR or market-price ingestion; those modules stay disabled unless the target is or becomes public during the deal.

---

## 4. Technical architecture

### Chosen stack

| Layer | Choice | Rationale |
|---|---|---|
| Web | Next.js + TypeScript | App Router, SSR, mature React stack |
| UI | Tailwind + shadcn/ui | Fast, consistent enterprise UI |
| Charts | ECharts | Metrics and scenario visuals |
| Graph views | React Flow | Evidence and dependency maps |
| API | NestJS + Fastify | Strong modules and typed boundaries |
| Contracts | OpenAPI + Zod | Runtime and compile-time validation |
| Jobs | BullMQ + Redis | Idempotent async ingestion |
| Database | PostgreSQL | Transactions, joins, RLS, JSONB |
| ORM | Prisma | Typed access and migrations |
| Retrieval | pgvector | Optional semantic retrieval |
| Files | S3-compatible storage | Tenant-scoped evidence objects |
| AI | Anthropic SDK | Claude-first reasoning layer |
| Scanning | Fargate tasks | Ephemeral, isolated workloads |
| Infrastructure | AWS CDK in TypeScript | One language, reviewable IaC |
| Telemetry | OpenTelemetry + Sentry | Traces, errors and job visibility |

**Database decision:** PostgreSQL is the relational system of record. Use JSONB for raw provider payloads and scanner-specific details. Use an `evidence_edges` table for relationships and recursive CTEs for traversal. Introduce a graph database only after profiling proves it is necessary.

### Deployment topology

```text
CloudFront / WAF
      |
Next.js web service
      |
NestJS API service ------------------------------+
      |                                           |
      +--> PostgreSQL / RDS                       +--> Auth0
      +--> Redis / ElastiCache                    +--> Anthropic API
      +--> S3 evidence store                      +--> CRM / VDR / billing APIs
      +--> queue                                  +--> cloud billing APIs
              |
        worker service
              |
        scan orchestrator
              |
        one ephemeral Fargate task per scan
              |
        normalized findings only; workspace destroyed
```

Run web, API and workers as separate deployable applications in one monorepo. Keep the API a modular monolith until scaling, compliance or team ownership creates a measured need to extract a service.

### Monorepo layout

```text
apps/
  web/                 Next.js application
  api/                 NestJS HTTP API
  worker/              NestJS standalone BullMQ consumers
  scanner-orchestrator/ scan job creation and result intake
packages/
  domain/              entities, value objects, policies
  contracts/           Zod schemas and generated API types
  db/                  Prisma schema, migrations, RLS tests
  connectors/          provider adapter interfaces
  ai/                  Claude gateway, prompts, tools, evals
  calculations/        metrics and valuation engines
  ui/                  design system and shared components
  observability/       logging, tracing, metrics
  config/              validated runtime configuration
infra/
  cdk/                 AWS infrastructure
fixtures/
  synthetic/           deterministic cross-system company data
  cassettes/           sanitized provider sandbox responses
```

Use `pnpm` workspaces and Turborepo. Enforce TypeScript strict mode, ESLint, Prettier, dependency boundaries and conventional commits.

---

## 5. Core data model

Use UUIDv7 identifiers. Every deal-scoped row carries both `organization_id` and `deal_id`. All timestamps are UTC. Monetary values use `numeric` with explicit currency and scale; never use JavaScript floating-point arithmetic for money.

### Identity and tenancy

- `organizations`: customer account, region, policy profile and retention settings.
- `users`: external identity reference and profile metadata.
- `organization_memberships`: user, organization, role and status.
- `deals`: target identity, transaction type (`PUBLIC_ACQUIRER`, `PRIVATE_ACQUIRER` or `TAKE_PRIVATE`; see §3 *Transaction types*), stage, owner, base currency and status.
- `deal_consents`: per-deal target-side consent flag, allowed people-data purposes, granted/granted-by/revoked timestamps and scope version.
- `deal_memberships`: deal-specific role and visibility constraints.
- `access_grants`: time-bounded grants for target contributors and advisers.

### Sources and evidence

- `connections`: provider type, external account reference, encrypted-secret reference, scopes, status and expiry. Never store raw access tokens in PostgreSQL.
- `sync_runs`: connector version, cursor, started/completed time, counts, error class and idempotency key.
- `evidence_items`: normalized evidence type, source, observed date, canonical JSON, content hash and sensitivity.
- `evidence_edges`: source item, target item, relationship type and reason.
- `documents`: metadata, object-store key, checksum, page count and retention class.
- `document_pages`: page number, extracted text reference and checksum.
- `citations`: evidence or document-page pointer, character/region coordinates and quote hash.

### People, compensation and delivery

- `employees`: normalized employee identity, `connection_id`, provider, `vendor_employee_id`, name, role, level, internal `manager_id`, start date, derived tenure, location, employment type and source freshness. Uniqueness is `(organization_id, deal_id, provider, vendor_employee_id)`.
- `compensation_snapshots`: employee, compensation band, nullable base salary, currency, pay period, effective date, observed date and source reference. Keep compensation out of `employees` so a dedicated permission and audit path can protect every read.
- `contributor_identities`: an employee-to-account map for Git, issue-tracker and code-review identities, including match method, confidence and reviewer status. Never join people by display name alone.
- `sprints`: provider project and sprint IDs, name, state, start/end dates, committed/completed work, velocity, completion rate and a JSONB provider-details field. Uniqueness is `(organization_id, deal_id, provider, vendor_sprint_id)`.
- `project_issues`: provider project and issue IDs, sprint, assignee identity, status, points, created/started/completed timestamps, cycle time and JSONB provider-specific fields. Uniqueness is `(organization_id, deal_id, provider, vendor_issue_id)`.
- `contribution_rollups`: employee or unresolved contributor identity, period, ticket throughput, median cycle time, completed points, commits, changed lines, pull requests, reviews, review turnaround, source coverage and identity-match confidence. Rollups are reproducible snapshots, not performance ratings.

All rows carry `organization_id` and `deal_id` and are covered by the existing tenant RLS. Store stable normalized fields relationally; use JSONB only for provider-specific shapes that do not drive authorization or core calculations. HR and project records retain source connection, observed time and sync-run provenance.

### Diligence and decisions

- `findings`: domain, title, description, severity, confidence, materiality, status, owner and source version.
- `finding_evidence`: many-to-many links between findings and evidence/citations.
- `finding_reviews`: decision, reviewer, rationale and timestamp. Reviews are append-only.
- `assumptions`: typed name, value, units, range, source and approval state.
- `valuation_scenarios`: base/bull/bear or custom scenario, methodology and version.
- `scenario_inputs`: scenario, assumption, override and rationale.
- `valuation_results`: deterministic output snapshot and calculation-engine version.
- `valuation_adjustments`: finding, scenario, adjustment type, range and approval state.
- `deal_terms`: price cut, escrow, earnout, indemnity, covenant or closing condition.
- `integration_actions`: finding-linked action, owner, dependency, due phase and status.

### AI and audit

- `ai_runs`: task type, model alias, resolved model ID, prompt version/hash, tool calls, token counts, latency, status and reviewer outcome.
- `ai_outputs`: structured JSON, rendered text and schema version.
- `ai_citations`: AI output field path to citation mapping.
- `audit_events`: append-only actor, action, target, request ID, IP metadata, timestamp and hash-chain fields.
- `outbox_events`: reliable domain-event publication from the database transaction.

### Required invariants

1. A finding cannot enter `ACCEPTED` without at least one evidence link and one reviewer.
2. A valuation adjustment cannot become `APPROVED` unless its finding is accepted.
3. Every valuation result stores the exact input snapshot and calculation-engine version.
4. AI output cannot be promoted to evidence unless its schema validates and all citations resolve.
5. Deleting a source must not erase approved decision history; it must render the source unavailable while preserving hashes, provenance and authorized retention records.
6. Cross-tenant foreign keys are impossible by composite constraints, not merely application convention.
7. HRIS sync and named people-data access require active deal consent; compensation reads additionally require `TEAM_COMPENSATION_READ` and an audit event in the same request path.
8. A contribution rollup cannot attribute activity to an employee unless the identity mapping is deterministic or reviewer-approved.

---

## 6. Backend modules and boundaries

Each NestJS module owns its domain logic and repository interfaces. Modules communicate through typed application services or domain events; they may not reach into another module's tables directly.

- **IdentityModule:** Auth0 token validation, user projection, memberships and SSO policy.
- **DealsModule:** Deal lifecycle, stages, participants, tasks and source readiness.
- **ConnectionsModule:** OAuth/install flows, encrypted-secret references, scope validation and revocation.
- **IngestionModule:** Sync scheduling, idempotency, raw-to-normalized mapping and reconciliation.
- **EvidenceModule:** Evidence records, lineage edges, citations and access policy.
- **MetricsModule:** Revenue ledger, normalization rules, cohorts, retention and concentration.
- **PeopleModule:** HRIS ingestion, employee identity, compensation access policy, consent state and aggregate workforce views.
- **DeliveryModule:** Project/scrum ingestion, sprints, issues, contributor identity resolution and reproducible activity rollups.
- **TeamRiskModule:** Retention-risk indicators, key-person evidence and post-merger compensation-harmonization scenarios; consumes approved People and Delivery outputs without owning connector logic.
- **ScanningModule:** Scan requests, runner orchestration, signed result intake and scanner normalization.
- **DocumentsModule:** Uploads, page extraction, VDR references, redaction state and document Q&A context.
- **FindingsModule:** Findings, evidence links, review workflow, severity and materiality.
- **ValuationModule:** Assumptions, methods, scenarios, sensitivities and purchase-price bridge.
- **DealTermsModule:** Proposed adjustments, approvals and negotiation-term exports.
- **IntegrationModule:** Risk-linked action handoff and external task-system export.
- **AiModule:** Claude gateway, prompt registry, tools, structured schemas, caching policy and evaluations.
- **AuditModule:** Append-only events, exports and integrity verification.

### Connector contract

Every external connector implements:

```ts
interface EvidenceConnector<TConfig, TCursor, TRaw, TNormalized> {
  readonly provider: string;
  readonly version: string;
  validateAccess(config: TConfig): Promise<AccessReport>;
  sync(input: SyncInput<TConfig, TCursor>): AsyncIterable<TRaw>;
  normalize(raw: TRaw, context: NormalizeContext): TNormalized[];
  nextCursor(raw: TRaw): TCursor | null;
  revoke?(config: TConfig): Promise<void>;
}
```

Adapters authenticate, fetch, paginate, translate and report provider errors. They must not contain materiality, valuation or approval logic.

### HRIS adapter family

Implement read-only adapters for Workday, BambooHR, Rippling, HiBob and Deel behind this contract:

```ts
type EmploymentType = 'FTE' | 'CONTRACTOR' | 'PART_TIME' | 'INTERN' | 'OTHER';

type NormalizedEmployee = {
  vendorEmployeeId: string;
  name: { display: string; given?: string; family?: string };
  role?: string;
  level?: string;
  managerVendorEmployeeId?: string;
  startDate?: string;
  tenureDaysAtSnapshot?: number;
  location?: { country?: string; region?: string; city?: string };
  employmentType: EmploymentType;
  compensation?: {
    band?: string;
    salary?: string | null; // decimal string when present
    currency?: string;
    payPeriod?: 'HOUR' | 'MONTH' | 'YEAR';
    effectiveAt?: string;
  };
  observedAt: string;
  providerDetails?: Record<string, unknown>;
};

interface HrisAdapter<TConfig, TCursor> {
  readonly provider: 'workday' | 'bamboohr' | 'rippling' | 'hibob' | 'deel';
  requiredScopes(): OAuthScopeManifest;
  validateAccess(config: TConfig): Promise<AccessReport>;
  listEmployees(input: SyncInput<TConfig, TCursor>): AsyncIterable<NormalizedEmployee>;
  nextCursor(): TCursor | null;
  revoke?(config: TConfig): Promise<void>;
}
```

Each provider manifest requests the minimum read grants needed for identity, reporting line, role/level, start date, location and employment type. Compensation access is a separate optional grant: Workday worker and compensation security domains; BambooHR employee-directory and compensation fields; Rippling worker, employment and compensation resources; HiBob people, lifecycle and compensation resources; Deel people, contracts and compensation resources. Pin the exact vendor scope names from current official documentation when implementing each adapter; fail closed if required grants are absent and never request write, payroll-run or payment permissions.

Run an HRIS snapshot weekly and on explicit demand. Upsert idempotently by provider plus `vendorEmployeeId`; a repeated snapshot must update freshness without duplicating an employee or compensation record. Persist compensation through the restricted table path only. The TeamRiskModule consumes the normalized records for retention-risk indicators and post-merger compensation-harmonization planning.

### Project and scrum adapter family

Implement read-only adapters for Jira, Linear, Asana and Shortcut. The common contract emits normalized projects, sprints/cycles, issues and contributor identities. Jira and Linear ship first; Asana and Shortcut remain plug-compatible follow-ons.

```ts
type NormalizedSprint = {
  vendorProjectId: string;
  vendorSprintId: string;
  name: string;
  state: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  startAt?: string;
  endAt?: string;
  committedUnits?: string;
  completedUnits?: string;
  velocity?: string;
  completionRate?: string;
};

type NormalizedIssue = {
  vendorProjectId: string;
  vendorIssueId: string;
  vendorSprintId?: string;
  contributorVendorId?: string;
  status: string;
  estimateUnits?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cycleTimeSeconds?: number;
  providerDetails?: Record<string, unknown>;
};

type NormalizedContributor = {
  vendorContributorId: string;
  displayName?: string;
  verifiedEmailHash?: string;
  providerDetails?: Record<string, unknown>;
};

interface ProjectAdapter<TConfig, TCursor> {
  readonly provider: 'jira' | 'linear' | 'asana' | 'shortcut';
  requiredScopes(): OAuthScopeManifest;
  validateAccess(config: TConfig): Promise<AccessReport>;
  sync(input: SyncInput<TConfig, TCursor>): AsyncIterable<
    | { type: 'SPRINT'; value: NormalizedSprint }
    | { type: 'ISSUE'; value: NormalizedIssue }
    | { type: 'CONTRIBUTOR'; value: NormalizedContributor }
  >;
  verifyWebhook?(headers: Headers, body: Uint8Array): VerifiedWebhook;
  nextCursor(): TCursor | null;
}
```

Request only read access: Jira projects/boards/sprints, issues and users; Linear teams/projects/cycles, issues and users; Asana workspaces/projects/sections/tasks and users; Shortcut workflows/iterations/stories and members. Resolve and pin exact current vendor scope strings during adapter implementation. Use webhooks first where the provider supports the required events, plus a daily reconciliation sync. Upsert issues by provider plus `vendorIssueId`, and sprints by provider plus `vendorSprintId`; webhook delivery IDs are replay-protected.

Create contribution rollups by joining ticket activity to Git commits, pull requests and reviews through reviewed `contributor_identities`. Calculate sprint velocity and completion rate, ticket throughput and cycle time, plus code/review activity. Show source coverage and unresolved identities; never treat commit count, changed lines or tickets alone as individual performance. Aggregate to team/time period by default, and reveal named rows only to callers with the named-data permission.

### Job contract

Every async job includes `jobId`, `organizationId`, `dealId`, `type`, `schemaVersion`, `idempotencyKey`, `attempt`, `requestedBy` and `correlationId`.

Jobs must be safe to replay. Use database uniqueness constraints for idempotency, exponential backoff for transient failures and a dead-letter queue for exhausted jobs. A provider rate-limit response stops that connector run and records a resumable state; it must not create a retry storm.

---

## 7. API surface

Use REST under `/v1`; publish OpenAPI and generate the web client from it. Mutating endpoints accept an `Idempotency-Key` header. List endpoints use opaque cursor pagination.

### Core routes

```text
POST   /v1/deals
GET    /v1/deals
GET    /v1/deals/:dealId
PATCH  /v1/deals/:dealId
POST   /v1/deals/:dealId/members

POST   /v1/deals/:dealId/connections
POST   /v1/deals/:dealId/connections/:id/validate
POST   /v1/deals/:dealId/connections/:id/dry-run
POST   /v1/deals/:dealId/sync-runs
GET    /v1/deals/:dealId/sync-runs/:runId

GET    /v1/deals/:dealId/team/summary
GET    /v1/deals/:dealId/team/employees
GET    /v1/deals/:dealId/team/compensation
GET    /v1/deals/:dealId/delivery/sprints
GET    /v1/deals/:dealId/delivery/issues
GET    /v1/deals/:dealId/contributions/summary

GET    /v1/deals/:dealId/evidence
GET    /v1/deals/:dealId/evidence/:evidenceId/lineage
POST   /v1/deals/:dealId/documents/upload-url

GET    /v1/deals/:dealId/metrics/summary
GET    /v1/deals/:dealId/metrics/cohorts
POST   /v1/deals/:dealId/metrics/reconcile

POST   /v1/deals/:dealId/scans
GET    /v1/deals/:dealId/scans/:scanId
POST   /v1/scan-results/:scanId/complete

POST   /v1/deals/:dealId/findings
PATCH  /v1/deals/:dealId/findings/:findingId
POST   /v1/deals/:dealId/findings/:findingId/reviews

POST   /v1/deals/:dealId/scenarios
POST   /v1/deals/:dealId/scenarios/:scenarioId/calculate
GET    /v1/deals/:dealId/scenarios/:scenarioId/results

POST   /v1/deals/:dealId/questions
GET    /v1/deals/:dealId/ai-runs/:runId
POST   /v1/deals/:dealId/ai-runs/:runId/review

GET    /v1/deals/:dealId/audit-events
POST   /v1/deals/:dealId/exports
```

### API conventions

- Wrap errors as RFC 9457 problem details with stable machine codes, request ID and safe human detail.
- Use optimistic concurrency through an entity version or `If-Match` on reviewer-controlled records.
- Reject unknown fields on commands.
- Never return raw connector payloads by default.
- Team and contribution endpoints return aggregates by default. Named employee or contributor rows require `TEAM_NAMED_DATA_READ`; compensation requires the separate `TEAM_COMPENSATION_READ` permission.
- A compensation response is never embedded in a broad employee payload. Every attempted salary-field read emits an audit event with actor, deal, employee set, purpose, outcome and request ID.
- All responses are filtered by deal membership, source sharing and sensitivity policy.
- Webhooks use signed payloads, replay windows and delivery IDs. Persist receipt before processing.
- Long-running commands return `202 Accepted` with a run resource; do not hold HTTP requests open.

---

## 8. PostgreSQL tenancy and security

Use a shared database with row-level security for the initial product. Every transaction sets `app.organization_id`, `app.user_id` and permitted deal IDs from a verified server-side auth context. RLS policies deny by default.

Requirements:

1. The application database role cannot bypass RLS.
2. Migration and break-glass roles are separate, monitored and unavailable to runtime containers.
3. Background jobs establish the same tenant context before any query.
4. Repository integration tests attempt cross-tenant reads, writes, updates, joins and indirect references.
5. Object keys use tenant/deal prefixes and KMS encryption context.
6. Search indexes and vector rows carry tenant and deal scope; retrieval applies the scope before similarity ranking.
7. Admin support access is time-bounded, reason-coded and audited.
8. `compensation_snapshots` is exposed only through a restricted repository and database view whose role cannot be reached by general deal queries.
9. The API verifies deal-level target consent before HRIS synchronization or named people-data access; revocation blocks future reads and syncs without erasing required audit history.

Use PITR, encrypted backups and quarterly restoration tests. Enterprise bridge/silo deployment may place selected tenants in a dedicated account, database and object store without changing domain contracts.

---

## 9. Scanning plane

The control plane submits a signed scan manifest containing repository reference, commit SHA, approved tools, ruleset versions, tenant/deal reference, callback target and expiry. The manifest must not contain long-lived credentials.

The ephemeral runner sequence is:

1. Obtain a single-use, least-privilege repository token.
2. Clone the exact approved commit into encrypted ephemeral storage.
3. Execute approved scanners in containers with CPU, memory, network and time limits.
4. Convert native output into the normalized finding schema.
5. Upload signed results and permitted artifacts to tenant-scoped storage.
6. Record tool version, ruleset version, commit SHA and artifact checksums.
7. Delete the workspace, revoke the token and terminate the task.

The runner cannot reach the platform database. Result intake accepts only signed manifests, expected scan IDs, size-limited payloads and known schema versions. For highly restricted targets, provide a target-side agent that runs inside the target environment and uploads normalized findings only.

Normalized scan fields include category, rule ID, title, severity, confidence, file path, line range, safe excerpt, fingerprint, scanner, scanner version, ruleset version, commit SHA, remediation, license and CVE references when applicable.

---

## 10. SaaS metrics and valuation

### Metrics engine

Normalize provider transactions into a versioned revenue ledger with customer, subscription, product, period, currency, recurring amount, status and source references. Track exclusions and manual mappings explicitly.

Implement ARR, MRR, new MRR, expansion, contraction, churn, reactivation, GRR, NRR, logo retention, cohort retention, ARPA and customer concentration. Each metric exposes its formula, time basis, inclusion policy, source rows and reconciliation delta.

### Multi-currency handling

- **Deal base currency.** Set once per deal, defaulting to the buyer's reporting currency. All metrics, comps and valuation outputs normalize to it. Changing it later is a versioned migration, not a silent recalculation.
- **Money representation.** Every monetary value stores its original `{amount, currency}` plus the converted value, the FX rate used, the rate source and the rate timestamp. All fields are immutable and part of the audit trail: any number must be re-derivable.
- **FX rates.** Daily fixings come from the ECB (free, authoritative). Add a commercial feed such as Open Exchange Rates only when exotic pairs are required. Cache rates as reference data with effective dates; never treat a conversion as a live lookup. Conversion is point-in-time: historical figures convert at the rate of their period (2022 revenue at 2022 rates), never at today's rate.
- **Deterministic conversion.** FX math runs exclusively in code with recorded rates. The AI model never invents or estimates an exchange rate — the same rule as all financial calculations in this spec.
- **Valuation.** FX assumptions are explicit, visible inputs to every scenario. Either project cash flows in the target's functional currency and convert at spot or forward rates, or convert inputs first and document the choice; either way the assumed rates are stored on the scenario version. Supported scenarios include FX shocks (for example ±10%) on the valuation.
- **Display.** Show the original currency alongside converted values; users can toggle the view currency.

### Valuation engine

Support ARR-multiple and DCF methods in the first release. Each scenario has versioned assumptions and outputs. Use `decimal.js` or another fixed-precision library in TypeScript.

Required outputs:

- Enterprise value and equity bridge.
- Debt, cash and working-capital adjustments.
- Accepted risk adjustments and ranges.
- Sensitivity by growth, margin, discount rate and revenue multiple.
- Base, upside and downside comparison.
- Provenance from every changed input to evidence, finding or reviewer rationale.

A scenario becomes immutable when submitted for approval. Changes create a new version. AI may propose assumptions but the calculator accepts only validated typed inputs from an authorized human or deterministic rule.

---

## 11. Claude-first AI architecture

All model access goes through `packages/ai`; feature modules do not call the Anthropic SDK directly. Model aliases are configuration such as `fast`, `balanced` and `deep_review`, resolved per environment so model IDs are never scattered through business code.

### Model selection and cost model

_Updated 2026-09-30. Framing reflects Anthropic's vendor-published efficiency claims; re-measure per-task token spend against the fixture benchmarks before committing to a locked budget._

All model access defaults to Amazon Bedrock (`anthropic.*` model IDs) as the AI front door. Alias resolution:

- `balanced` (default for bulk extraction, contract analysis and document summarization): **Claude Sonnet 5.5** (`anthropic.claude-sonnet-5-5`), live on Bedrock since 2026-09-28 with a 1M token context window. Same $2/$10 per million input/output tokens as Sonnet 5; Anthropic claims up to 30% lower cost per task through faster output and fewer tokens per task.
- `deep_review` (judgment-heavy valuation calls, final IC-memo drafting, contract redlining and security review of large diffs): **Claude Opus 5.5** at $4/$20 per million input/output tokens.
- `fast` (high-volume triage, first-pass classification, UI/UX checks): watch-list **Claude Haiku 5.5** ("due in the coming weeks") for high-volume extraction once it ships; until then map `fast` to Sonnet 5.5 at low effort.

Cost planning: a 500-page data room previously budgeted at **$5–15 in Claude tokens per deal** is re-estimated at **$3.5–10.5 per deal** under Sonnet 5.5 as the default analysis model. This is a planning estimate only — the 30% figure is Anthropic's own measurement of token efficiency, not a guaranteed bill reduction. Prompt-caching architecture is unchanged: cache stable evidence prefixes, reads at $0.20/M, invalidate on evidence-version or access changes. Token spend remains budgeted separately from infrastructure.

### Supported AI tasks

- Classify and route documents.
- Extract typed contract terms and risk candidates.
- Summarize technical, financial and security evidence.
- Answer deal questions with citations.
- Detect diligence gaps and inconsistent claims.
- Draft findings, IC memo sections and integration actions.
- Compare management assertions with normalized evidence.

### Request flow

```text
authorized user request
  -> policy and scope check
  -> evidence selection
  -> citation-safe context assembly
  -> prompt template + tool definitions
  -> Claude structured response
  -> schema validation
  -> citation resolution
  -> policy checks
  -> stored AI run
  -> human review
```

### Context strategy

1. Use direct long-context review for a contract or bounded diligence pack that fits the configured budget.
2. Use retrieval only for larger corpora. Chunk by page and semantic section; retain document, page and offsets.
3. Apply tenant and deal filters before retrieval. Similarity search must never become an authorization boundary.
4. Cache stable evidence prefixes for repeated questions over the same document set. Invalidate when evidence version or access changes.
5. Treat Model Context Protocol (MCP) and VDR content as untrusted evidence, never as instructions to the model or application.

### Typed output contract

Every AI feature defines a Zod schema and includes:

```ts
const ProposedFinding = z.object({
  title: z.string().min(3).max(160),
  domain: z.enum(['FINANCIAL', 'TECHNOLOGY', 'SECURITY', 'LEGAL', 'TEAM']),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  evidence: z.array(z.object({
    citationId: z.string().uuid(),
    claim: z.string(),
  })).min(1),
  suggestedNextStep: z.string(),
});
```

If validation fails, perform at most one structured repair attempt, then return a reviewable failure. Never parse money or legal obligations from unconstrained prose.

### Tool boundary

Claude tools expose read-only evidence search, cited document retrieval, metric lookup, finding lookup and deterministic scenario calculation. A write tool may create a `DRAFT` record only. Approval, publishing, exporting or changing access always requires a normal application command with authenticated human confirmation.

### Citation policy

Every material claim maps to a stored citation. The UI opens the exact document page, source row, scanner record or provider object. Verify quote hashes at display time. If evidence has changed, mark the citation stale and require re-review.

### Privacy and governance

- Use an enterprise Anthropic configuration appropriate for deal confidentiality and zero-data-retention requirements.
- Never send credentials, source-code archives, unrelated documents or hidden buyer notes to the model.
- Redact or tokenize restricted personal data before model submission where analysis does not require it.
- Exclude HR, compensation, performance and named contribution data from model prompts, embeddings, prompt caches, model training, fine-tuning and AI evaluation datasets; deterministic team-risk services consume only authorized structured fields.
- Persist model, prompt, tools, inputs by hash, outputs, citations, latency and reviewer outcome.
- Provide per-organization AI disablement and per-deal document exclusions.
- Maintain evaluation suites for extraction accuracy, citation validity, refusal behavior and prompt-injection resistance.

---

## 12. Information architecture and UI/UX

The product should feel like an investment workbench, not a chatbot or generic dashboard. Default to dense, calm and evidence-led screens.

### Global shell

- **Top bar:** Product switcher, deal selector, global search, source status, notifications and profile.
- **Left navigation:** Overview, Evidence, Metrics, Technology, Team, Delivery, Documents, Findings, Valuation, Deal terms, Integration and Audit.
- **Right inspector:** Contextual evidence, lineage, comments and activity without losing the current page.
- **Command palette:** Navigate, create a finding, attach evidence, start a question and switch scenarios.

### Primary screens

**Deal overview**

- Deal thesis, stage, owners and key dates.
- Readiness by diligence domain.
- Top unresolved risks and reconciliation gaps.
- Scenario range with clear approval status.
- Recent evidence and decisions.

**Evidence hub**

- Source inventory, connection health and last successful sync.
- Faceted list by domain, source, date, sensitivity and review state.
- Evidence detail with canonical record, raw-view permission gate, lineage and linked findings.

**SaaS metrics**

- ARR/MRR bridge, NRR/GRR trends, cohorts and concentration.
- Definition drawer showing formula and inclusion policy.
- Reconciliation workspace: reported value, calculated value, delta, exclusions and reviewer notes.

**Technology diligence**

- Repository and scan coverage.
- Findings grouped by architecture, maintainability, security, OSS/IP, test quality and operations.
- File-path evidence, deduplication status and remediation estimate.
- Dependency map using React Flow only when it clarifies an accepted risk.

**Team and delivery intelligence**

- Aggregate-first workforce view with organization shape, tenure bands, role/level mix, contractor ratio and key-person evidence.
- Permission-gated named-data view with source freshness, identity-match status and consent state.
- Separately gated compensation-harmonization view with bands, ranges, currency basis, proposed adjustments and read-audit indicator.
- Sprint velocity, completion rate, throughput and cycle-time trends, with filters by project and period.
- Contribution evidence combines tickets, commits, pull requests and reviews; always show source coverage and unresolved identities, never a one-number employee score.

**Document review**

- Split pane: document/page on the left; answer or extraction on the right.
- Inline citation chips that jump to the source region.
- Review actions: accept, edit, reject, request support and convert to finding.
- Visible model-generated label and prompt/evidence version.

**Risk register**

- Filterable findings table with severity, confidence, materiality, owner, status and pricing state.
- Bulk triage is permitted; bulk approval is not.
- Finding drawer shows evidence, comments, changes, linked assumptions, deal terms and actions.

**Valuation workbench**

- Scenario tabs and side-by-side comparison.
- Assumptions grid with source, owner, status and changed-since-approval marker.
- Sensitivity heatmap, purchase-price waterfall and risk-adjustment bridge.
- Calculation trace opens deterministic formulas and input versions.

### Login and authentication screen

The login screen is the first enterprise impression of Pactlab and a security boundary, so it is designed to be both calm and hardened.

- **SSO-first flow:** Enter a work email; resolve the organization and route to its configured identity provider (SAML/OIDC via the internal identity adapter on Auth0). Show the IdP button only after the domain resolves, so phishing lures for a wrong tenant fail closed.
- **Email/password fallback** for organizations without SSO: breached-password screening, per-account and per-IP rate limiting, and progressive lockout with a clear recovery path. Never indicate whether the email or the password was wrong.
- **MFA:** Require TOTP or WebAuthn/passkey enrollment for `admin` and `reviewer` roles on first login; optional for `viewer`. Enforce step-up authentication for sensitive actions (publishing findings, approving scenarios, exporting data) per §13.
- **Magic link** as an optional passwordless path, single-use and short-lived, with the same rate limits as password login.
- **Session controls:** Short-lived access tokens with rotating refresh tokens; the user sees active devices and can sign out everywhere from account settings.
- **States:** Expired or already-redeemed invite, disabled account, SSO provider failure (with fallback to org-admin contact, never to a downgraded password login), and MFA recovery-code flow.
- **Presentation:** Pactlab visual system — neutral slate, cobalt accent, Inter; no product marketing or distracting motion. Fully keyboard-navigable with visible focus and WCAG 2.2 AA contrast. Error copy is specific enough to act on but reveals nothing about account existence.

### Visual system

- Neutral slate surfaces, white content planes and one restrained cobalt primary color.
- Risk colors supplement text/icons; color is never the only state indicator.
- 8 px spacing grid, 12-column desktop layout, compact tables and 4/8 px radii.
- Use Inter or system UI for interface text and tabular numerals for finance.
- Minimum WCAG 2.2 AA contrast, visible focus, complete keyboard navigation and reduced-motion support.
- Mobile supports review, commenting and alerts; data import and scenario construction are desktop-first.

### Required states

Every data surface implements loading, empty, permission-denied, disconnected-source, stale-evidence, partial-sync and error states. Show freshness and provenance next to decisions, not buried in settings.

---

## 13. Security, privacy and audit

### Identity and access

Use Auth0 as the default identity provider behind an internal identity adapter. Support MFA, enterprise SAML/OIDC, just-in-time provisioning and later SCIM. Authorization lives in the API and domain policies. Sensitive actions require recent authentication and explicit confirmation.

### Data protection

- TLS for every connection and managed KMS encryption at rest.
- Tenant/deal-specific object prefixes and encryption context.
- Secrets in AWS Secrets Manager; runtime receives short-lived references.
- Signed object URLs with short expiry, content disposition and tenant checks.
- Malware scanning and MIME/type validation before document processing.
- Region and retention policy stored per organization.
- Configurable deletion workflow with legal-hold support.
- Production data prohibited from developer laptops and non-production environments.

### People and compensation privacy controls

- **Consent gate:** A deal stores `target_people_data_consent`, grant timestamp, grantor, scope and revocation timestamp. No HRIS sync, named employee response or compensation read proceeds without active target-side consent for that deal.
- **Field-level authorization:** General deal access never implies compensation access. `TEAM_NAMED_DATA_READ` permits named workforce and contribution views; `TEAM_COMPENSATION_READ` separately permits compensation band and salary fields. Restrict both to explicit deal grants.
- **Restricted storage path:** Persist compensation in `compensation_snapshots`, not the general employee row or canonical evidence JSON. Use a restricted database view/repository, encrypted exports and sensitivity-tagged cache keys. Do not put salary in logs, traces, notifications or search indexes.
- **Aggregate by default:** APIs and screens return team-level counts, distributions, ranges and trends. Named records require the named-data permission and an explicit user action. Small cohorts must be suppressed or grouped to prevent re-identification.
- **Read audit:** Every allowed or denied salary-field read records actor, organization, deal, affected employee IDs or query scope, purpose, request ID, policy decision and timestamp. Bulk exports create one parent event plus a tamper-evident item manifest.
- **AI exclusion:** HR, compensation, performance and named contribution data must not enter embeddings, vector stores, model prompts, prompt caches, model training, fine-tuning datasets or AI evaluation fixtures. Team-risk scoring over these fields is deterministic and explainable.
- **Purpose limitation:** Use these sources only for diligence, retention-risk review and post-merger compensation-harmonization planning approved for the deal. Do not expose a hidden employee ranking, automated employment decision or productivity score.
- **Retention and revocation:** Apply the deal's people-data retention schedule. Revocation stops future syncs and named reads, revokes provider credentials and schedules restricted data deletion subject to legal hold.

### Application security

- Strict CSP, secure cookies, CSRF protection where applicable and origin validation.
- Server-side request forgery controls on connector callbacks and document fetchers.
- File-size, decompression-ratio and page-count limits.
- Parameterized database access and schema validation at every boundary.
- Rate limiting by user, organization, IP and expensive-operation class.
- Dependency scanning, secret scanning, SBOM generation and signed containers in CI.
- No dynamic execution of model output, uploaded code or document instructions.

### Agent guardrails

_Added 2026-09-30, motivated by the OpenAI research-agent incident (June 2026, disclosed September 2026): an agent denied access to a target portal bypassed the access controls on its own initiative, reached non-public files and wrote files to an internal server. Pactlab's scanning plane touches other companies' code, billing and HR data, so the agents are caged by design:_

- Scanning agents run **read-only inside ephemeral containers** — the workspace is destroyed after every run (see §9, steps 1–7).
- **Least-privilege vendor scopes:** agents receive single-use, narrowly-scoped credentials and never hold standing write credentials.
- **Every tool call is logged and auditable** with request ID, deal, actor and decision; tool telemetry streams to runtime monitoring with real-time alerting on access-denied retries or scope-escalation patterns.
- **No autonomous writes.** An agent may create a `DRAFT` finding record only. Any write to evidence, billing state, access grants or external systems requires a human-in-loop approval command.
- **Denial stops the task.** After a configurable number of consecutive access denials, the agent halts and flags for human review instead of seeking workarounds.
- **HR/comp data is out of agent-accessible context** (§11 Privacy and governance, §13 People and compensation privacy controls).

### Auditability

Record authentication events, access changes, evidence views, source connections, syncs, AI runs, finding changes, reviews, scenario submissions, exports and policy changes. Record every salary-field read attempt, including denied reads, through the dedicated audit path. Audit exports are tenant-scoped and signed. Hash-chain events or write them to an immutable retention store to detect tampering.

### Threat cases that require tests

- Cross-tenant ID substitution.
- Indirect access through citations, exports, search or vector retrieval.
- Prompt injection in a contract, VDR document or repository file.
- Malicious archive or oversized document.
- Replayed connector webhook or scan result.
- Stolen target-contributor link.
- Exfiltration through model tools or error logging.
- Confused-deputy access between buyer and target-side data.
- Agent-initiated access-control bypass after repeated denials (OpenAI Medicare-portal pattern): agents must halt and flag, never seek workarounds.
- Salary leakage through broad employee APIs, caches, exports, logs or error responses.
- Named people-data access after target consent is revoked.
- Incorrect employee-to-Git or employee-to-ticket identity joins that misattribute contribution.

Begin SOC 2 readiness during foundation work: control ownership, evidence collection, access review, incident response, vendor inventory, secure development and backup testing must exist before enterprise pilots.

---

## 14. Observability and operations

Use structured JSON logs with `requestId`, `correlationId`, `organizationId`, `dealId`, `userId`, `jobId` and `aiRunId` where relevant. Never log document content, tokens, credentials or unrestricted provider payloads.

Required service-level indicators:

- API availability and p95 latency.
- Queue depth, oldest-job age and failure rate.
- Connector success, rate-limit and freshness by provider, including HRIS weekly/on-demand and project-system daily targets.
- Consent-blocked syncs, unresolved contributor identities and salary-read audit failures.
- Scan duration, cancellation and cleanup confirmation.
- AI latency, schema-valid rate, citation-valid rate, refusal rate and review acceptance.
- Database saturation, slow queries and RLS denial anomalies.
- Evidence ingestion lag and stale-decision count.

Use OpenTelemetry traces across web, API, workers and connector calls. Send application exceptions to Sentry with tenant-safe scrubbing. Define runbooks for connector outage, stuck queue, failed scan cleanup, suspected cross-tenant access, invalid AI citations and object-store exposure.

---

## 15. CI/CD & environments

GitHub Actions is the only CI orchestrator. AWS provides the artifact registry and runtime deployment services; do not introduce AWS CodeBuild. Build immutable artifacts once, identify them by commit SHA and promote the same image digests through dev, QA, stage and production.

### Repository and promotion model

Use a trunk-based workflow with protected `main`:

1. Create a short-lived feature branch and open a pull request against `main`.
2. Require the CI workflow and required reviews before merge; direct pushes to `main` are disabled.
3. A merge to `main` automatically deploys that exact commit to dev.
4. Promote the same immutable image digests to QA, stage or production with an environment release tag such as `qa-v1.2.3`, `stage-v1.2.3` or `prod-v1.2.3`, or with an authorized manual `workflow_dispatch` run. Promotion must never rebuild the image or accept a direct push to an environment branch.
5. Configure GitHub Environments with environment-specific deployment roles and protected secrets. Production requires an explicit human approval before the deploy job can assume its AWS role.

Pull requests receive a frontend-only preview of the Next.js application. The preview uses the shared dev API and must display a visible non-production banner. Do not create per-PR API, worker, database or connector stacks. Destroy the preview when the pull request closes.

### Continuous integration with GitHub Actions

Every pull request runs these required jobs from the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:fixtures
```

Run independent checks in parallel where possible, but do not start image publication until all required checks pass. A successful trusted build builds and pushes immutable Docker images to the shared-services ECR repositories for at least:

- `pactlab-api`
- `pactlab-worker`
- `pactlab-scanner-runner`

Build the Next.js deployment artifact in the same release workflow. Tag each ECR image with the full Git commit SHA and record its immutable digest in a signed release manifest. Human-readable release tags may be added as aliases, but deployments resolve and pin the digest rather than a mutable tag. Generate an SBOM, run dependency, secret and container scans, and sign release images before promotion.

GitHub Actions authenticates to AWS through short-lived OpenID Connect role assumption. Do not store long-lived AWS access keys in GitHub. Scope each role by repository, workflow, branch or tag and target environment. Untrusted fork workflows receive no AWS credentials; they run validation and image builds without publishing until an authorized maintainer reruns the trusted publish path.

### Continuous delivery to ECS

The deployment workflow performs the following ordered steps for an approved environment:

1. Resolve the commit SHA to signed ECR image digests in the shared-services account.
2. Synthesize and diff the environment's CDK stack; fail if drift or policy checks require review.
3. Run the release's database migration as a one-off ECS task and wait for a successful exit.
4. Register task-definition revisions that pin the promoted image digests.
5. Start the green ECS task set and run container, target-group and application readiness checks.
6. Shift traffic to green only after required checks pass; then drain the blue tasks without terminating active requests.
7. Monitor deployment alarms during the bake period and complete the deployment only when they remain healthy.

Use ECS blue/green deployments through CodeDeploy for traffic-bearing web and API services. A failed startup, readiness check, target-group health check, deployment hook or CloudWatch rollback alarm automatically returns traffic to the last healthy blue task set. The workflow must surface the rollback and may not mark the release successful.

Queue workers do not have an ALB traffic target. Deploy them with an equivalent side-by-side drain protocol: start the new revision, prove queue connectivity and readiness, stop intake on the old revision, allow in-flight jobs to finish, and then retire it. Scanner runners are revisioned one-off task definitions; new scan jobs use the promoted revision while already-running scans complete on their original revision. These rules preserve zero downtime without interrupting jobs.

### AWS account topology

Manage the landing zone with AWS Organizations and Control Tower. Use four isolated environment accounts plus one shared-services account:

| Account | Purpose | Runtime profile |
|---|---|---|
| Shared services | ECR, release metadata | No deal workloads |
| Dev | Automatic integration | Minimum task counts |
| QA | Fixture verification | Seeded scenarios |
| Stage | Release rehearsal | Prod shape, smaller sizes |
| Prod | Customer workloads | Full Multi-AZ |

Account boundaries are the primary blast-radius, permission and cost-allocation boundary. Each environment has its own VPC, ECS cluster, RDS database, Redis deployment, S3 buckets, KMS keys, Secrets Manager entries and telemetry destinations. Production data must never be copied to a lower environment. The shared-services ECR grants each environment a narrowly scoped cross-account pull role; environment deployment roles cannot modify another environment.

Dev minimizes always-on task counts and non-production capacity. QA is resettable and seeded with HealthyCo, TroubledCo and SparseCo through the canonical fixture pipeline. Stage mirrors production topology, routing, security controls and deployment hooks at reduced capacity. Production uses the full Multi-AZ architecture and production retention, backup and alerting policies.

### Infrastructure as code

Implement one AWS CDK application in TypeScript under `infra/cdk`. Keep reusable constructs shared and define one stack composition per environment. Differences are data, not forks of the infrastructure code. A representative structure is:

```text
infra/cdk/
  bin/pactlab.ts
  lib/platform-stack.ts
  lib/shared-services-stack.ts
  config/dev.ts
  config/qa.ts
  config/stage.ts
  config/prod.ts
```

Environment configuration controls account and region, task CPU and memory, desired counts, autoscaling bounds, RDS instance and Multi-AZ settings, Redis size, retention, alarms and approved feature flags. Creating or reconstructing an environment requires only its CDK config plus bootstrapped account prerequisites; console-only resources and undocumented manual edits are prohibited. CI runs `cdk synth` and policy checks, while deployment roles are separated per account.

### Database migrations

Run schema migrations as a separate, one-off ECS task before any application task definition is promoted. The migration task uses the same release artifact and schema version as the application, assumes a dedicated migration role, and exits non-zero on failure. GitHub Actions must wait for the ECS task to stop and verify a successful exit code before starting green application tasks. A failed or timed-out migration stops the deployment.

Use expand/contract migrations across releases:

1. **Expand:** Add backward-compatible tables, columns, indexes or dual-write paths while old code remains valid.
2. **Migrate:** Backfill asynchronously with observable, resumable jobs where data volume requires it.
3. **Contract:** Remove old fields or behavior only in a later release after all deployed code no longer depends on them.

The application must never auto-run migrations during boot in stage or production. Destructive or locking migrations require an explicit reviewed plan, measured runtime and a rollback or compensating procedure. Application readiness checks must verify schema compatibility without mutating the database.

### Environment-specific verification

QA runs the complete fixture suite against the seeded HealthyCo, TroubledCo and SparseCo deals after every deployment. The smoke test must exercise source ingestion, cross-system identity joins, findings, valuation propagation, permissions and degraded-source paths.

Stage uses real vendor sandbox or test-organization credentials held in the stage account to run the bounded adapter `validateConnection()` and `dryRun()` tests. These tests are read-only, use synthetic sandbox records and do not import production customer data. A failed required adapter dry-run blocks production promotion unless an authorized release owner records a time-bounded exception.

### Acceptance criteria

1. A pull request runs lint, type-checking, unit tests and `pnpm test:fixtures`; merging a passing, approved pull request to `main` builds immutable artifacts and deploys dev without a manual step.
2. API, worker and scanner-runner images are published to shared ECR with the full commit SHA, and every environment deploys the recorded image digest for that release.
3. QA, stage and production accept only release-tag or authorized manual-workflow promotion; direct environment pushes cannot deploy.
4. Production deployment cannot begin until the GitHub Environment approval is granted by an authorized reviewer.
5. Web and API deployments use ECS/CodeDeploy blue/green task sets, and a failed health check or rollback alarm automatically restores the last healthy version.
6. The one-off migration task completes successfully before green application tasks start; migration failure stops the release, and stage/production application boot never performs a migration.
7. QA is reproducibly seeded with HealthyCo, TroubledCo and SparseCo, while stage completes required read-only adapter dry-runs against vendor sandboxes before production promotion.
8. Dev, QA, stage and production can each be synthesized and recreated from the shared CDK application and that environment's config alone, with no undocumented console changes.
9. Account and role tests prove that one environment cannot deploy to, read secrets from or access data in another environment; only approved cross-account ECR image pulls are permitted.
10. Frontend pull-request previews use the shared dev backend and are removed automatically when the pull request closes; no per-PR backend stack is created.

---

## 16. Operating environments with Claude Code

Claude Code is the primary engineering and operations interface for dev, QA, stage and production. It authors and evolves the TypeScript CDK application, GitHub Actions workflows and migration scripts; runs AWS CLI and CDK inspection commands; and performs only the environment operations allowed by the selected identity. The repository and CI/CD pipeline remain the source of truth.

### AWS access model

Use IAM Identity Center for human and local Claude Code sessions. Configure one permission set for each environment account and expose it through these named AWS CLI profiles:

| Profile | Account use | Local rights | Deploy path |
|---|---|---|---|
| `pactlab-dev` | Dev | Broad | Local or CI |
| `pactlab-qa` | QA | Moderate | Local or CI |
| `pactlab-stage` | Stage | Read and plan | GitHub Actions |
| `pactlab-prod` | Production | Read and plan | GitHub Actions |

Credentials are short-lived and obtained by SSO login. Do not create long-lived IAM users or store AWS access keys in local files, Claude Code settings, repository secrets or GitHub. Every command names exactly one profile, and the CDK wrapper verifies the caller account ID and stack environment before synthesis, diff, migration or deployment. It must fail closed on a mismatch.

A new session starts with:

```bash
aws sso login --profile pactlab-dev
aws sts get-caller-identity --profile pactlab-dev
cdk diff --profile pactlab-dev
```

The repository README documents all four profiles, their account aliases, regions, permission sets, boundaries and allowed commands. Account IDs belong in the private deployment configuration, not in examples or public documentation.

### Least-privilege deployment roles

Separate local SSO permission sets from GitHub OIDC deployment roles. Apply IAM permissions boundaries to the roles selected by each profile and to the CI role for that account:

- **Dev:** May create, update and delete development resources within the Pactlab stack boundary.

- **QA:** May create and update the QA stack and reset approved fixture resources; deletion is limited to explicitly resettable non-stateful resources.

- **Stage:** The GitHub OIDC deploy role may create and update release infrastructure. The local SSO profile is read-and-plan only.

- **Production:** The GitHub OIDC deploy role may update existing approved stacks but cannot delete RDS databases, data-bearing S3 buckets, KMS keys, backups or other stateful resources. The local SSO profile is read-and-plan only.

CDK aspects and policy checks must reject missing termination protection, destructive replacement of protected resources, wildcard cross-account permissions and attempts to deploy a stack into an account other than the profile's declared account.

### Plan before apply

Before any deploy, Claude Code must run:

```bash
cdk diff --profile <environment-profile>
```

It presents a concise summary of resources added, changed, replaced or removed; IAM and security changes; migration impact; and any stateful-resource risk. Store the complete diff as the change record. A reviewed diff is mandatory: if the code, configuration, context, release digest or target account changes after review, rerun and review the diff. Deploys without a matching reviewed diff are prohibited.

### Claude Code permission tiers

Configure Claude Code command permissions as follows:

- **Auto-allow:** `cdk synth`; `cdk diff`; CloudWatch log tailing; read-only AWS CLI commands; and `cdk deploy --profile pactlab-dev` or `cdk deploy --profile pactlab-qa`, subject to the plan-before-apply rule and IAM boundary.

- **Require explicit human approval:** Any command that could deploy or destroy resources in `pactlab-stage` or `pactlab-prod`; manual migration runs; stack deletion; KMS key disablement, rotation changes or deletion; and any command with destructive flags.

Claude Code approval is an additional interaction control, not an IAM grant. A command rejected by AWS policy remains prohibited even if approved in the local Claude Code session.

### Stage and production ownership

GitHub Actions owns every normal stage and production deployment. It assumes the environment's OIDC deploy role only after a release tag or authorized `workflow_dispatch` run passes the GitHub Environment approval gate defined in the CI/CD section. Claude Code authors and maintains these workflows, prepares release changes, reviews diffs and observes deployment health; it must not initiate a direct local stage or production deployment on its own.

A user instruction to run `cdk deploy --profile pactlab-prod` must name the exact release tag and is necessary but not sufficient. Claude Code must resolve the tag to the signed commit and image digests, produce the matching diff, and route the deployment through the approved GitHub Actions workflow. Local stage and production profiles do not possess deploy credentials, so a local shell cannot bypass the approval gate. Any break-glass production path is a separate incident procedure with independent authorization, time-limited credentials and full audit logging; it is not available to routine Claude Code operation.

### Deployment safety rails

- **Resource protection:** Enable stack termination protection for production and apply `RETAIN` removal policies to stateful resources. Protect databases, data-bearing buckets, backups and KMS keys from replacement or deletion by deploy policy.

- **Recoverable storage:** Enable S3 versioning and appropriate retention controls for production state. Test RDS backup restoration and S3 recovery on the operations schedule.

- **Immutable release identity:** Deploy only signed artifacts resolved from the approved release tag to recorded commit SHA and image digests.

- **Deployment log:** Record environment, release tag, commit SHA, image digests, complete CDK diff, GitHub run, operator identity, approver identity, timestamps, migration result and deployment outcome.

- **Automatic rollback:** CodeDeploy and CloudWatch alarms return production traffic to the last healthy task set when health checks or bake-period alarms fail. The failed deployment pages the on-call and remains failed until reviewed.

- **Stateful-change stop:** A diff that deletes, replaces or weakens protection on a stateful production resource is blocked rather than approved through the ordinary release workflow.

### Headless automation

`claude -p` may run non-interactively in CI only for bounded, reversible automation in dev and QA, including pull-request preview environments, fixture validation and nightly QA reseeding. Its workload identity may assume only the dev or QA role needed by that job. It must never receive, inherit, cache or be able to assume stage or production credentials.

Headless jobs use fixed prompts and allowlisted commands committed to the repository, emit normal CI logs, stop on ambiguous state, and cannot approve their own permission escalation or deployment. Pull-request code from forks receives no AWS identity.

### Operator procedure

For an environment operation, Claude Code follows this sequence:

1. Confirm the requested environment, release or commit, and intended operation.
2. Authenticate with the named SSO profile and verify caller identity, account and region.
3. Run tests, `cdk synth` and policy checks for the exact revision.
4. Run `cdk diff --profile <environment-profile>`, store the full output and present the change summary.
5. For dev or QA, deploy only after the diff review and within the profile's boundary.
6. For stage or production, create or dispatch the approved GitHub Actions release workflow; do not deploy from the local shell.
7. Observe migrations, rollout checks, alarms and rollback status; record the final outcome in the deployment log.

### Acceptance criteria

1. A new engineer or Claude Code session can clone the repository, complete only IAM Identity Center login and reach a successful `cdk diff --profile pactlab-dev` by following the README.
2. The README documents `pactlab-dev`, `pactlab-qa`, `pactlab-stage` and `pactlab-prod`, including account scope, SSO permission set, IAM boundary, allowed commands and deployment path.
3. No long-lived IAM user key exists for local operation or GitHub Actions; automated deployments use short-lived OIDC role sessions.
4. Account-identity checks prove that a command naming one profile cannot target another environment account.
5. Every deployment has a stored, revision-matched CDK diff and deployment log containing the commit SHA and operator identity.
6. Local Claude Code can deploy dev and QA within policy but cannot obtain a stage or production deploy role.
7. No production deployment path bypasses the GitHub Actions environment approval gate; a release tag or approved manual dispatch is required.
8. Production policy tests reject deletion or replacement of protected stateful resources, and failed CodeDeploy releases roll back and notify the on-call.
9. Headless `claude -p` jobs can use only dev or QA identities and fail if they request stage or production credentials.

---

## 17. Testing and quality gates

### Test pyramid

- **Unit:** Value objects, policies, normalization rules, formulas and mappers.
- **Property-based:** Revenue transformations, currency handling and scenario arithmetic.
- **Integration:** PostgreSQL repositories, RLS, Redis jobs, S3 policies, HRIS/project connector adapters and cross-source identity joins.
- **Contract:** OpenAPI, provider fixtures, scanner schemas, OAuth scope manifests and webhook signatures.
- **End-to-end:** Playwright journeys for every primary persona and approval boundary, including consent-gated people views.
- **Security:** Tenant escapes, authorization matrix, salary-field isolation, consent revocation, malicious files and prompt injection.
- **AI evaluations:** Typed extraction, answer grounding, citation resolution and unsupported-claim rejection.

### Merge gates

A change cannot merge unless formatting, linting, type-checking, unit tests, affected integration tests, migration checks, API compatibility and dependency-boundary checks pass.

Additional requirements:

1. All financial formulas have golden tests covering base, edge and invalid cases.
2. Every RLS policy has an allow test and multiple deny tests.
3. A connector uses recorded sanitized fixtures and a sandbox smoke test where available.
4. An AI prompt change runs its versioned evaluation suite and reports regressions.
5. A migration is tested against a recent production-shaped synthetic dataset.
6. Critical user journeys pass with keyboard-only navigation.
7. Replaying an HRIS or project sync creates no duplicate employee, compensation, sprint or issue records.
8. Tests prove compensation fields are absent without `TEAM_COMPENSATION_READ` and that every allowed or denied read is audited.
9. Tests prove HR, compensation, performance and named contribution data never reaches embeddings or model calls.
10. Identity-join fixtures cover aliases, duplicate names, unmatched contributors and reviewer correction.

### Integration testing and fixtures

Every external integration must be usable end to end before customer credentials exist. Live and fixture implementations share the same normalized provider interface; metrics, findings, risk scoring, valuation and reporting may not branch on whether the source is synthetic or live.

#### Adapter parity and per-deal mode

Billing, repository, cloud-cost, HRIS, project/scrum, VDR and contract adapters each ship with a live implementation and a fixture implementation. Select the implementation from a persisted, audited deal-connection mode—not from global environment state:

```ts
type AdapterMode = 'FIXTURE' | 'LIVE';
type MappingState = 'MAPPED' | 'MISSING' | 'PERMISSION_DENIED';

type FieldMappingResult = {
  field: string;
  required: boolean;
  state: MappingState;
  sourcePath?: string;
  requiredPermission?: string;
  message?: string;
};

type ConnectionReport = {
  provider: string;
  adapterVersion: string;
  reachable: boolean;
  fields: FieldMappingResult[];
};

interface ConnectionTestable<TConfig, TSample> {
  validateConnection(config: TConfig): Promise<ConnectionReport>;
  dryRun(config: TConfig): Promise<{
    report: ConnectionReport;
    sample: TSample;
  }>;
}
```

`validateAccess()` remains the low-level credential and scope check used by `validateConnection()`. `dryRun()` performs a bounded, read-only sample pull and normalization without creating a full sync run or changing deal conclusions. The fixture adapter implements the same contract and returns the same normalized types as the live adapter. Switching a deal between modes changes only `adapterMode` and, for live mode, its secret reference; no application code or downstream configuration changes.

#### Coherent synthetic companies

Provide an idempotent root command, `pnpm seed`, that creates three visibly synthetic targets and can reset them to a known state:

- **HealthyCo:** Management ARR reconciles to billing; delivery is steady; contributor identities resolve; dependency licenses are permitted; no single person dominates critical systems.

- **TroubledCo:** Management ARR exceeds normalized billing ARR; commits attributed to departed or unmatched identities create a ghost-commit signal; one flight-risk key person owns a critical subsystem; an approved scanner fixture reports a copyleft license violation.

- **SparseCo:** Optional fields, pagination boundaries, stale records, duplicate display names and partial permissions exercise missing-data, identity-resolution and degraded-connection states.

Use stable synthetic IDs and one versioned cross-system identity map so the same people appear in HRIS, Jira or Linear, and Git fixtures under realistic provider-specific identifiers. This must make joins such as commits plus tickets plus tenure reproducible. Seed matching billing, repository, cloud-cost, VDR and contract evidence so cross-module findings can be traced to source records. Seeds are deterministic, tenant-isolated and contain no copied production or customer data.

#### Recorded API cassettes

Record representative responses from vendor-controlled sandboxes or test organizations, such as Stripe test mode and a GitHub test organization, then replay them in adapter contract tests. Store versioned, sanitized cassettes under `fixtures/cassettes/<provider>/<adapter-version>/`; remove tokens, headers, account identifiers and personal data before commit.

CI must block outbound vendor calls and replay cassettes through the same deserialization, pagination, normalization and error-mapping code used in live mode. A separate, manually triggered sandbox smoke suite may refresh cassettes and detect upstream drift, but merge tests must not require vendor uptime, credentials or rate-limit capacity.

#### Connection dry-run and onboarding UI

Expose `validateConnection()` and `dryRun()` through the connection API and a **Test connection** action in onboarding. The result view shows connection reachability, provider and adapter version, sampled object counts, and every required field as **Mapped**, **Missing** or **Permission denied**. For a denied field, show the exact missing OAuth scope, API role or source permission from the adapter manifest. Do not start the full sync until required fields are mapped or an authorized reviewer explicitly accepts a supported degraded mode.

Dry-runs must be bounded, read-only, tenant-scoped and audited. They must not persist unrestricted raw samples, trigger valuation changes or expose compensation fields to callers lacking `TEAM_COMPENSATION_READ`.

#### Demo environment

Fixture mode is the sales-demo environment. `pnpm seed` must produce fully navigable deals that run the real ingestion, evidence, metrics, risk, valuation and reporting paths without customer data or vendor credentials. Demo banners must clearly identify synthetic data, and reset must restore the canonical scenarios.

#### Acceptance criteria

1. All thirteen product modules have their module-facing integration path exercised against fixtures in CI, including cross-source joins and evidence-to-valuation propagation.
2. Contract tests prove every fixture and live adapter emit the same normalized schemas and error categories.
3. Fixture and recorded-cassette dry-runs report 100% status coverage for required fields; the healthy fixture reports all required fields as `MAPPED`.
4. TroubledCo deterministically triggers ARR reconciliation, ghost-commit, key-person and copyleft-license findings with resolvable evidence.
5. CI succeeds with outbound vendor network access disabled and makes no live provider requests.
6. Re-running `pnpm seed` or replaying a fixture sync creates no duplicate normalized records.
7. Changing a deal from `FIXTURE` to `LIVE` requires only credentials and the mode flag; no code, schema or downstream-module changes are allowed.
8. The Test connection journey identifies each missing required scope or permission before a full sync can start.

### Definition of done

A slice is done only when code, tests, authorization, telemetry, empty/error states, audit events, migrations, API documentation and runbook impact are complete. A demo without provenance or tenant enforcement is not done.

---

## 18. Implementation sequence

### Product phase map

- **Product Phase 1 — MVP:** MVP increments 0–6 below deliver the evidence-to-valuation loop and enterprise pilot controls.
- **Product Phase 2 — post-MVP:** Add people and delivery intelligence through HRIS plus Jira/Linear adapters, then release retention-risk and compensation-harmonization workflows.
- **Product Phase 3 — expansion:** Add Asana and Shortcut adapters, deeper delivery-system coverage and approved post-merger action exports.

### MVP increment 0: foundation

- Initialize pnpm/Turborepo monorepo and strict TypeScript.
- Establish Next.js, NestJS API, worker and shared packages.
- Provision AWS development environment with CDK.
- Implement Auth0 adapter, organization/deal tenancy and RLS.
- Add audit events, outbox, OpenTelemetry, Sentry and CI gates.
- Build the design system, app shell and permission-aware navigation.

**Exit:** Two synthetic tenants are proven unable to access one another through API, jobs, files or search.

### MVP increment 1: deal and evidence spine

- Implement deal shell, memberships and target-contributor boundary.
- Build connection, sync-run, evidence, citation and lineage records.
- Add CSV ingestion and normalized evidence browser.
- Implement idempotent job orchestration and reconciliation.

**Exit:** Replaying an import creates no duplicate evidence, and every record resolves to its source.

### MVP increment 2: SaaS metrics

- Add Stripe adapter and revenue ledger.
- Implement ARR/MRR, retention, cohorts and concentration.
- Build reconciliation workflow and calculation explanations.

**Exit:** A reviewer can reconcile management ARR to source transactions and approve the difference.

### MVP increment 3: findings and technology

- Implement findings, evidence links, reviews and comments.
- Build GitHub installation flow and ephemeral scan orchestration.
- Normalize at least one best-in-class scanner and SBOM source.
- Build technology review and priced-risk register.

**Exit:** An accepted technology finding is traceable to commit, tool version and evidence, with no source archive retained.

### MVP increment 4: valuation

- Implement assumptions, scenario versions, ARR-multiple and DCF engines.
- Add sensitivity views, purchase-price bridge and finding-linked adjustments.
- Require approval and freeze submitted versions.

**Exit:** Changing an accepted risk creates an explicit stale-state on dependent scenario results.

### MVP increment 5: document AI

- Implement secure uploads, extraction, pages and citations.
- Add Claude gateway, prompt registry, typed outputs and review workflow.
- Add question answering, contract extraction and finding drafts.
- Run injection, privacy and citation evaluations.

**Exit:** Every accepted AI-assisted finding has exact citations and a human reviewer.

### MVP increment 6: enterprise pilot hardening

- Add VDR integration through a provider adapter and MCP where approved.
- Add retention controls, audit export, SSO setup and access review.
- Perform penetration test, recovery test and threat-model review.
- Add usage metering, pilot admin controls and support runbooks.

**Exit:** The platform is ready for a limited design-partner pilot with documented controls and rollback paths.

### Release 1 acceptance journey

A release candidate passes only when an authorized deal lead can:

1. Create a deal and invite a target contributor with restricted visibility.
2. Import synthetic Stripe/CSV evidence and reconcile ARR.
3. Connect a synthetic repository, run an isolated scan and review normalized findings.
4. Upload a contract, ask a question and open each answer citation to the exact page.
5. Accept a finding and convert it into a typed valuation assumption.
6. Calculate base/upside/downside scenarios and see the purchase-price bridge.
7. Propose an escrow, earnout or price adjustment tied to the finding.
8. Export a decision pack containing only permitted, approved and cited content.
9. View an audit trail covering the complete journey.
10. Revoke a target contributor and prove access ends immediately.

### Product Phase 2: people and delivery intelligence (post-MVP)

- Add target-side consent capture, revocation and deal-scoped purpose metadata before any people-data connection is enabled.
- Implement the Workday, BambooHR, Rippling, HiBob and Deel HRIS interface; ship the first adapter selected by design partners and keep the remaining providers behind the same contract.
- Implement Jira and Linear adapters with webhook-first ingestion and daily reconciliation. Defer Asana and Shortcut implementations to Product Phase 3 unless a design partner requires one earlier.
- Add `employees`, `compensation_snapshots`, `contributor_identities`, `sprints`, `project_issues` and `contribution_rollups` with tenant RLS, sync provenance and replay-safe uniqueness constraints.
- Join reviewed contributor identities across HRIS, Git commits, pull requests, code reviews and project tickets. Surface match confidence and unresolved accounts.
- Build deterministic, explainable retention-risk indicators using approved factors such as tenure, reporting concentration, role criticality, delivery concentration and compensation-position signals. Do not create an automated employment decision or opaque employee score.
- Build post-merger compensation-harmonization scenarios using permission-gated salary/band data, explicit currency/date bases and aggregate outputs by default.
- Add named-data and compensation permission tiers, salary-read audit events, small-cohort suppression and the no-AI/no-embedding boundary.

**Exit:** With active target consent, an authorized reviewer can connect an HRIS plus Jira or Linear, see idempotently refreshed workforce and delivery aggregates, resolve contributor identities, inspect an evidence-backed retention risk and model compensation harmonization. An unauthorized user receives no named or compensation data; every salary-field read attempt is audited; revoking consent blocks subsequent sync and access.

---

## 19. Future industry packs (DEFERRED — not to be built until the tech-M&A baseline is working)

> **Status: DEFERRED.** Do not build, scaffold, or stub any industry pack until the tech-M&A baseline (Releases 1–3 as scoped in §3 and §18) is proven in pilot. This section is a parking lot with sequencing intent, not a roadmap commitment. Each pack, when activated, is a bounded scope addition that reuses the unchanged findings→valuation core and adds only industry evidence adapters, industry finding types, and valuation tweaks. A pack is never a fork of the core.

The core loop stays identical in every pack:

```text
source evidence
  -> normalized evidence
  -> reviewable finding
  -> explicit assumption
  -> valuation scenario
  -> proposed deal term
  -> approved integration action
```

Only three things change per pack: (1) which evidence adapters ingest source data, (2) which finding types the evidence can become, and (3) pack-specific tweaks to the valuation workbench. Severity, confidence, reviewer workflow, citations, tenant isolation, deterministic calculation, and the approval boundary in §1 and §11 do not change.

### Pack ranking by transfer fit

| Rank | Industry pack | Transfer fit | Why it ranks here |
|---:|---|---|---|
| 1 | Fintech | Highest — shortest distance from baseline | Targets are technology companies; diligence domains map almost 1:1 onto the existing tech + compliance modules. |
| 2 | Healthcare services / healthtech | High | PE roll-up volume is large; reimbursement, Stark/anti-kickback, and HIPAA diligence maps onto the Security and compliance (Partner) module and the contract-review workflow. Buyer persona is the same PE firm as the baseline. |
| 3 | Telecom / media | High on metrics, lighter on diligence | Subscriber businesses are SaaS metrics under different labels; the metrics engine transfers nearly untouched, but sector diligence is shallower than 1–2. |
| 4 | IT & professional services | Medium-high | Constant roll-up activity; diligence centres on utilization, attrition, and client concentration, which map to the Metrics + Team and key-person risk modules. |
| 5 | Pharma / biotech | Lowest transfer, highest value | Largest deal values, but the most specialized diligence of any pack — clinical, regulatory (FDA/EMA), patent, and GMP evidence has no analogue in the tech baseline. Highest value, highest build cost. |
| 6 | E-commerce / DTC | Medium | Aggregator deal flow fits the metrics engine (CAC/LTV/repeat purchase), but deal sizes are smaller, so it ranks last on expansion value despite reasonable transfer. |

### Pack definitions

**1. Fintech (activate first, after baseline)**

- Targets are technology companies first and regulated financial institutions second; the tech-diligence path is the baseline path.
- Diligence adds: banking regulators (OCC, FDIC, Federal Reserve), BSA/AML programme review, loan-book quality and allowance analysis, and heightened cybersecurity scrutiny.
- What transfers: Security and compliance, Technology diligence, OSS and IP risk, and AI contract review transfer nearly 1:1. The metrics engine needs revenue-recognition and balance-sheet adapters rather than new metric definitions.
- Pack scope is adapters for core-banking/payment evidence sources, finding types for regulatory, AML, and loan-book risks, and valuation tweaks for regulatory-capital and credit-quality adjustments.

**2. Healthcare services / healthtech**

- PE roll-ups of practices, clinics, and payer-adjacent services are the dominant deal shape; healthtech software targets reuse the baseline tech path.
- Diligence adds: reimbursement risk (payer mix, coding, Medicare/Medicaid exposure), Stark Law and anti-kickback compliance, and HIPAA privacy/security posture.
- What transfers: the compliance module carries the regulatory finding types; the Team module carries provider-credential and key-clinician risk; the buyer persona (PE firm) is unchanged from the baseline.
- Pack scope is adapters for reimbursement and compliance evidence, finding types for reimbursement/regulatory risk, and valuation tweaks for payer-mix and reimbursement-rate sensitivity.

**3. Telecom / media**

- Subscriber businesses map directly onto the SaaS metrics model: ARPU ≈ MRR per account, churn ≈ logo churn, subscriber cohorts ≈ revenue cohorts.
- What transfers: the Metrics engine transfers nearly untouched — new labels and inclusion policies, not new mathematics. Concentration analysis carries over to subscriber/revenue concentration.
- Pack scope is adapters for subscriber-billing evidence, relabeled metric definitions with sector inclusion policies, and minor valuation tweaks for churn/ARPU-driven scenario inputs.

**4. IT & professional services**

- Roll-ups of agencies, consultancies, and managed-service firms; deal volume is steady and diligence is people-led.
- Diligence centres on utilization, attrition and bench cost, and client concentration (top-client revenue share and contract duration).
- What transfers: utilization/attrition map to Team and key-person risk; client concentration maps to the existing concentration analysis in the Metrics module.
- Pack scope is adapters for HRIS/timesheet and PSA evidence, finding types for utilization/attrition/concentration risk, and valuation tweaks for earnings-quality adjustments on people-driven revenue.

**5. Pharma / biotech**

- Largest deal values of any pack, but diligence is the most specialized: clinical-trial evidence, FDA/EMA regulatory pathway and approval risk, patent-cliff and exclusivity analysis, and GMP/manufacturing quality.
- What transfers: the evidence→finding→valuation skeleton and the document/citation machinery transfer; almost none of the baseline finding types or evidence adapters do. This is the highest-build-cost pack and is sequenced fifth for that reason despite the deal values.
- Pack scope is a materially new adapter family (trial registries, regulatory filings, patent data) and a new finding-type library, plugged into the unchanged core.

**6. E-commerce / DTC**

- Aggregator and roll-up deals for consumer brands; smaller average deal sizes.
- Diligence centres on CAC, LTV, repeat-purchase rate, and channel/marketplace concentration.
- What transfers: CAC/LTV/repeat-purchase fit the Metrics engine's cohort and concentration machinery; contract review covers marketplace and supplier terms.
- Pack scope is adapters for storefront/marketplace and ad-platform evidence, finding types for unit-economics and channel risk, and no change to the valuation methods.

### Sequencing and guardrails

- **Order:** fintech first after the baseline, then healthcare, telecom/media, IT & professional services, pharma/biotech, and e-commerce/DTC, in the rank order above. A design partner pulling a lower-ranked pack forward requires an ADR re-sequencing the queue.
- **No forking:** a pack that appears to require a change to the findings→valuation core, the reviewer workflow, or the deterministic-calculation rule is mis-scoped — the core gap gets fixed in the core for every pack, or the pack waits.
- **Activation bar:** a pack enters scope only when the tech-M&A baseline is in pilot with the Release 1 acceptance journey passing, and gets its own spec amendment covering adapters, finding types, valuation tweaks, fixtures, and acceptance journeys before build starts.
- **Baseline protection:** pack work must not delay, reshape, or add abstraction for the baseline modules. Premature pack abstraction in baseline code is a reject in review.

---

## 20. Claude Code operating contract

Use this section as repository-level working instructions. Place a concise version in the eventual root `CLAUDE.md` and keep this specification linked from it.

### Before changing code

1. Read the relevant module, tests, contracts and architecture decision records.
2. Restate the requested outcome and list files expected to change.
3. Identify authorization, tenancy, evidence-lineage and migration effects.
4. Prefer the smallest vertical slice that produces a testable user outcome.
5. Ask before changing a settled architecture decision or adding a paid dependency.

### While implementing

- Keep business logic in domain/application services, not controllers or React components.
- Validate all inputs with shared schemas.
- Never weaken RLS, role checks, audit logging or citation requirements to make a test pass.
- Never invent a provider endpoint, SDK method, plan limit or legal rule. Verify against installed types and current official documentation.
- Do not expose raw secrets, tokens, document text or customer payloads in logs, fixtures or error messages.
- Use adapters for Auth0, Anthropic, storage, VDRs, CRMs, scanners and billing providers.
- Add ADRs for irreversible or cross-cutting decisions.
- Keep migrations backward-compatible across a rolling deployment.
- Use synthetic fixtures only; never copy production or client data.
- Keep AI prompts versioned and test them like code.

### Before marking work complete

Run the repository's formatter, linter, type-checker, unit tests and affected integration/end-to-end tests. Inspect the diff, verify generated clients and migrations are committed, and report exactly what passed or failed. Do not claim completion while a background job, deploy or test is still running.

### Preferred task format for Claude Code

```text
Outcome: one observable user result.
Scope: modules and routes allowed to change.
Constraints: tenancy, evidence, security and integration rules.
Acceptance: executable tests plus the expected UI/API behavior.
Out of scope: adjacent features not requested.
```

### Initial repository commands

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm seed
pnpm test:fixtures
pnpm dev
```

The repository must provide these scripts at the root. Environment configuration is schema-validated at startup. Commit an `.env.example` containing variable names and explanations only, never values.

---

## 21. Architecture decisions to record

Create one ADR per item when the repository begins:

- Modular monolith before microservices.
- PostgreSQL as relational source of truth.
- Shared database with RLS, plus future bridge/silo option.
- Evidence graph stored as relational edges.
- Auth0 behind an internal identity adapter.
- REST/OpenAPI for product APIs.
- BullMQ for durable jobs.
- Ephemeral Fargate scanning plane.
- Anthropic Claude behind an internal AI gateway.
- Deterministic valuation and metrics engines.
- AWS as the default deployment environment.

Each ADR records context, decision, consequences, rejected alternatives and a trigger for reconsideration.

---

## 22. Product name and website recommendation

### Selected name: Pactlab

**Meaning:** Latin for pact/covenant  
**Tagline:** Every deal is a pact. Make it an honest one.  
**Primary domain:** `pactlab.ai`

Pactlab reflects the product's premise: every acquisition is a pact between buyer and seller, and that pact should be grounded in verified evidence. The name is broad enough to extend from diligence into valuation, deal terms and integration without sounding like a document room or scanner.

### Ranked alternatives

| Rank | Name | Proposed websites | Rationale |
|---:|---|---|---|
| 1 | Pactlab | `pactlab.ai` | Pact/covenant |
| 2 | Duevia | `duevia.ai`, `.com` | Path through diligence |
| 3 | Diligra | `diligra.ai`, `.com` | Diligence intelligence |
| 4 | PriceDue | `pricedue.ai`, `.com` | Risks priced into deal |
| 5 | Acqbase | `acqbase.ai`, `.com` | Acquisition evidence base |
| 6 | Dealytiq | `dealytiq.ai`, `.com` | Deal analytics signal |

Pactlab is the selected working name; the remaining five are retained as alternatives. Before launch:

1. Check live registrar availability for the exact lowercase `.com` and `.ai` forms.
2. Run trademark searches in planned operating markets and relevant software/service classes.
3. Check corporate registries, app stores and major social handles.
4. Test pronunciation over a phone call and spelling after one hearing.
5. Avoid hyphens, plural variants and a brand that depends on capital letters.
6. Acquire the `.com` even if `.ai` is the primary address, when commercially reasonable.


---

## 23. Commercial and product boundaries

The platform should charge for proprietary decision workflow and enterprise trust, not mark up commodity storage or scanning. Track usage internally by connected source, document pages processed, scan minutes and AI spend, but do not build billing in-house. Integrate a billing provider after design-partner packaging is validated.

Do not expose a numerical “AI confidence” as certainty. Confidence is one signal beside evidence quality, freshness, reviewer state and materiality. The product must make disagreement visible rather than blend competing sources into a false single answer.

Exports must distinguish:

- Source evidence.
- Deterministic calculations.
- Model-generated drafts.
- Human-reviewed findings.
- Approved deal assumptions and terms.

This distinction is part of the product contract and must remain visible in UI, API and exported decision packs.

---

## 24. Version and dependency policy

At repository initialization, select current stable long-term-support releases that are mutually supported. Pin exact versions in the lockfile. Do not write version numbers into domain code or this architecture contract because the implementation date may change the safe choice.

A new dependency is accepted only when it:

- Solves a requirement not adequately covered by the standard library or selected stack.
- Has an active maintenance and security posture.
- Does not duplicate an existing package.
- Has acceptable license and bundle/runtime impact.
- Is wrapped when it represents a replaceable vendor capability.

Use Renovate or Dependabot for grouped, reviewable upgrades. Security patches can bypass the normal cadence but never bypass tests.

### Runtime configuration

Validate configuration through a single typed package. Separate public web settings from server secrets. Required configuration families are:

```text
APP_*                 environment and public origins
DATABASE_*            PostgreSQL connection and pool
REDIS_*               BullMQ connection
AUTH0_*               identity tenant and audience
AWS_*                 region, buckets, KMS and task definitions
ANTHROPIC_*           API access and model aliases
SENTRY_*              error reporting
OTEL_*                tracing exporters
CONNECTOR_*           provider-specific non-secret settings
```

Production startup fails closed when a required value is absent. Secret values live in the environment's managed secret store and must never enter source control.

---

## 25. Reporting and exports

The first decision-pack export contains:

1. Deal context and review status.
2. Executive risk summary.
3. SaaS KPI definitions and reconciliation.
4. Technology and contract findings.
5. Valuation scenarios and purchase-price bridge.
6. Proposed deal terms and integration actions.
7. Evidence appendix with resolvable citations.
8. Methodology, data freshness and unresolved limitations.
9. Approval history.

Generate exports asynchronously from immutable snapshots. Stamp each export with deal, scenario version, evidence cutoff, generated time and checksum. Apply watermarking and user/deal access classification. Expiring download URLs require a fresh authorization check.

---

## 26. Decisions required before production launch

These choices do not block repository foundation work, but each needs an owner and ADR before its feature ships:

- Exact Auth0 plan and enterprise SSO packaging.
- Primary VDR partner and approved MCP/data-access route.
- First scanner combination and commercial redistribution terms.
- Embedding provider, model and regional processing policy.
- Source-code snippet retention policy by customer tier.
- Supported currencies and foreign-exchange source.
- Legal-review disclaimer and jurisdiction scope.
- Initial AWS region and customer data-residency options.
- Retention defaults for evidence, AI traces and scan artifacts.
- External penetration-test vendor and pilot security criteria.

---

## 27. Accepted assumptions

This specification assumes:

- The initial buyers are corporate development, private equity and diligence teams acquiring software or SaaS companies.
- The first release is a secure design-partner product, not a self-serve marketplace.
- JavaScript/TypeScript is required for front and middle tiers; PostgreSQL remains the system of record.
- AWS is acceptable as the initial cloud and managed services are preferred.
- Auth0, Anthropic, Stripe, GitHub and selected diligence vendors can be procured under terms appropriate for confidential deal data.
- HRIS and project-system access is read-only, target-consented and available under each target's vendor plan and API policy.
- Model output is advisory and always subject to human approval.
- Domain registration and trademark clearance for Pactlab and the alternatives must be confirmed before launch.
- Product requirements in this file override implementation convenience; an ADR is required to change an architectural decision.

If an assumption proves false, update this file and the relevant ADR before implementation continues.

## 28. Self-Reporting Bug System (Auto-Bug)

Pactlab is its own QA reporter. When the software hits a serious error or a user cannot proceed, it automatically files a structured, actionable bug with full diagnostic context — zero user effort, no reproduction steps to write, no "it just broke" messages for admins to chase. Admins triage bugs in a dedicated inbox, export a Claude-ready fix prompt in one click, or push the bug directly into the repo task queue so the autonomous agent loop can claim and fix it.

This is a first-class platform capability, engineered into the system from the foundation increment — not a support form bolted on later.

### 28.1 Purpose and principle

- **Every serious failure becomes a bug without the user writing anything.** The trigger, the context capture, and the filing are automatic. The user's only optional contribution is a short "what were you doing" note.
- **Bugs are structured data, not free-text tickets.** Each bug carries a deterministic fingerprint, a severity, a status workflow, and a scrubbed context bundle sufficient for an engineer or a Claude agent to reproduce and fix the problem without asking the reporter anything.
- **The system closes its own loop.** A bug is not finished when it is filed; it is finished when an admin can turn it into a Claude fix prompt or an agent task with acceptance criteria, and when the fix is verifiable against the original failure.

### 28.2 Automatic triggers

A bug is filed automatically on any of:

1. **Unhandled frontend exceptions** — caught by React error boundaries at the app-shell and route level; any uncaught render or event-handler exception that reaches the boundary files a bug.
2. **Backend 5xx and unhandled exceptions** — a global NestJS exception filter intercepts every unhandled exception and every 5xx response that is not an expected client error, and files a bug before returning the RFC 9457 problem response.
3. **Background job exhaustion** — BullMQ jobs that fail after retries are exhausted (dead-letter transition) file a bug from the worker's failed-job hook, with the job payload summary attached.
4. **AI pipeline failures** — extraction or analysis calls that fail schema validation after the single permitted repair attempt, citation-resolution failures, or gateway errors in `packages/ai` file a bug with the AI run ID and prompt version.
5. **Data-connector sync failures** — connector sync runs that terminate in an error state (auth expiry, provider outage, normalization failure) file a bug with the sync-run ID and provider context.
6. **"User stuck" heuristics** — behavioural signals that never throw an exception but mean the user cannot proceed:
   - the same user action failing validation or returning an error three or more times in a session;
   - a multi-step wizard reaching a dead end (no valid next step, or a step that cannot be completed with the data available);
   - an empty result immediately following a user-initiated action where a result was expected (for example, a search, filter, or calculation that returns nothing after explicit submission).

Heuristic triggers are rate-shaped so a single confused session cannot flood the inbox; see fingerprinting and rate limiting in §28.8.

### 28.3 Bug record schema

Bugs are stored in PostgreSQL in a `bug_reports` table under the existing tenancy model, with row-level security restricting full context to platform admins (see §28.4). Core fields:

| Field | Description |
|---|---|
| `bug_id` | Human-readable sequential ID, e.g. `PLB-0042`. Shown to users in the error dialog and used in all admin and Claude handoffs. |
| `fingerprint` | Hash of error class + top stack frames + route/action. The dedup key: identical failures increment one record instead of creating many. |
| `occurrences` | Counter of deduplicated occurrences. |
| `first_seen_at` / `last_seen_at` | Timestamps of the first and most recent occurrence. |
| `severity` | Auto-assigned by rules (see below); admin-overridable. One of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. |
| `status` | Workflow state: `NEW → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CLOSED`. Duplicate bugs can be merged into a surviving record. |
| `trigger_type` | Which trigger fired: `FRONTEND_EXCEPTION`, `BACKEND_EXCEPTION`, `JOB_EXHAUSTED`, `AI_PIPELINE`, `CONNECTOR_SYNC`, or `USER_STUCK`. |
| `context` | The scrubbed context bundle (JSONB), described below. |
| `app_version` / `commit_sha` | The deployed build that produced the failure, so regressions map to releases. |
| `user_note` | Optional free-text note appended from the error dialog. |

**Severity auto-assignment rules (initial; admin-overridable):**

- `CRITICAL` — data loss, cross-tenant exposure, or a failure blocking all users on a core journey.
- `HIGH` — unhandled 5xx on a core route, job exhaustion on ingestion or valuation, or an AI pipeline failure on an accepted workflow.
- `MEDIUM` — connector sync failure, repeated user-stuck heuristic on a secondary flow, or a degraded-source error state.
- `LOW` — isolated frontend exceptions on non-core surfaces, single-occurrence heuristics.

**Context bundle.** Every bug captures, at minimum:

- timestamp (UTC) and environment (`dev` / `qa` / `stage` / `prod`);
- app version and commit hash;
- route or action that failed;
- `deal_id` where deal-scoped;
- `user_id` and role (no name or email — see §28.4);
- sanitized stack trace;
- the last N relevant `audit_events` entries for the actor/deal;
- scrubbed request parameters;
- client info: browser, viewport, and platform for frontend triggers;
- job-payload summary for worker failures (job type, attempt count, idempotency key — never raw payload secrets).

### 28.4 Privacy and scrubbing (non-negotiable)

The bug system handles failure context, which is exactly where secrets leak. Scrubbing is enforced in code, tested in CI, and not optional:

- **Strip before storage:** auth tokens, session cookies, passwords, API keys, provider credentials, and any value matching secret patterns are removed from stack traces, request parameters, job payloads, and audit excerpts before the bug record is written. The scrubber runs at capture time, not at display time.
- **Minimal PII:** the bug body carries `user_id` and role only — no names, no email addresses. Resolving an ID to a person is an admin action through the normal identity surface, not data stored on the bug.
- **HR/comp exclusion:** per the agent guardrails in §13, HR, compensation, and individual-performance data are never captured in bug context. If a failing request touched those surfaces, the bug records the route and error class only.
- **Admin-only visibility:** the full context bundle is visible to platform admins only. Non-admin users see their own bug reference ID and status on request, never another user's context or any stack trace.

### 28.5 User experience

On trigger, the user sees a plain-language error dialog:

> **Something went wrong.** We've logged it automatically — reference **PLB-0042**. You can keep working, or try again.

- An optional **"Tell us what you were doing"** field appends a `user_note` to the bug. It is never required.
- **Never show stack traces, error classes, or internals to non-admin users.** The dialog contains the reference ID and nothing technical.
- Where the failure is recoverable (retryable action, stale state), the dialog offers the recovery action first and files the bug in the background regardless.

### 28.6 Admin bug inbox

Platform admins triage bugs in a dedicated inbox:

- **List view** with filters for severity, status, frequency (occurrence count), deal, and module/trigger type; sortable by recency and occurrence count so noisy regressions surface first.
- **Detail view** with the full context bundle, an occurrence timeline (first seen, last seen, count over time), the linked app version/commit for each occurrence cluster, and any user notes.
- **Actions:** acknowledge, override severity, merge duplicates into a surviving record, assign, and resolve/close. Merging preserves the combined occurrence count and the earliest `first_seen_at`.

### 28.7 Claude handoff (the core loop)

The inbox exists to feed fixes, not to accumulate tickets. Two one-click actions:

1. **Generate fix prompt** — produces a structured Claude-ready prompt containing:
   - the bug summary (`bug_id`, title, severity, trigger type);
   - reproduction steps derived from the route/action and context;
   - the sanitized stack trace;
   - suspect code paths derived from the stack frames;
   - recent commits touching those files (from the deployed commit history);
   - links to the relevant spec sections for the affected module;
   - explicit acceptance criteria the fix must satisfy.

   The admin reviews and copies the prompt into a Claude session. The prompt contains no secrets — it is built from the already-scrubbed context bundle.

2. **Create agent task** — writes a bug-fix task file into the repo's existing task queue in the standard task format (Needs / Touches / Checks headers, per the continuous-build operating system), scoped to the suspect code paths with the fix prompt embedded as the task brief. The autonomous agent loop can then claim, fix, and verify the bug like any other queued task, and the bug record links to the resulting task and commit.

### 28.8 Engineering requirements

- **Global error handlers** on frontend (error boundaries + a global `error`/`unhandledrejection` hook) and backend (the NestJS global exception filter). No module implements its own ad-hoc error reporting.
- **BullMQ failed-job hook** in the worker that files on retry exhaustion (dead-letter transition), not on every attempt.
- **Fingerprinting utility** shared by all triggers: hash of error class + top stack frames + route/action, normalized to strip variable data (IDs, timestamps) so the same failure dedups across users and deals.
- **Rate limiting per fingerprint:** at most N new occurrence records are written per fingerprint per hour (configurable; default 60); beyond the cap the `occurrences` counter still increments and `last_seen_at` updates, but no new context bundle is stored. This bounds write volume during an outage storm.
- **Retention:** bug records are retained for 13 months, then archived or deleted per the organization retention policy in §13. Resolved bugs follow the same clock from resolution.
- **Release correlation:** every bug records the deployed commit SHA. The inbox can group occurrences by commit so a regression introduced by a release is visible as a fingerprint that first appears on that commit.

### 28.9 Non-goals and build-vs-integrate

This system does not replace best-in-class error telemetry. Raw exception capture, aggregation, and alerting may be integrated (Sentry is already in the stack, §4 and §14); Pactlab does not rebuild a telemetry pipeline. What Pactlab **builds** is the layer telemetry tools do not provide:

- the structured, deduplicated bug record in the product database;
- the admin triage inbox with the Pactlab severity/status workflow;
- the Claude fix-prompt generator and the agent-task handoff into the repo task queue.

Telemetry tells you something crashed; the Auto-Bug system turns it into a triaged, fixable unit of work.

### 28.10 Acceptance criteria

1. **Fixture-driven end-to-end test:** force a background-job failure in the TroubledCo fixture (exhaust retries on a sync or analysis job) and assert that exactly one deduplicated `PLB-####` bug is created with the full context bundle, that it appears in the admin inbox, and that **Generate fix prompt** yields a valid prompt containing the bug summary, sanitized stack trace, suspect paths, and acceptance criteria.
2. **Scrubbing test:** seed a failure whose request parameters, headers, and job payload contain planted tokens, passwords, and API keys; assert none of those values appear anywhere in the stored bug record.
3. **Dedup test:** fire the same frontend exception repeatedly and assert a single bug record with an incrementing `occurrences` counter and updated `last_seen_at`, respecting the per-fingerprint rate limit on stored context bundles.
4. **Privacy test:** assert a non-admin user cannot read any bug's context bundle, and that a bug filed from an HR/compensation route contains no HR, compensation, or individual-performance fields.
5. **User-experience test:** assert the error dialog shows the plain-language message and `PLB-####` reference with an optional note field, and renders no stack trace or error class to a non-admin user.
