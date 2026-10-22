# Build order

On-demand detail for `CLAUDE.md`.

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
