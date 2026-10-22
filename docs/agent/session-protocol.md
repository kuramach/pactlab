# Session protocol (solo-founder speed)

On-demand detail for `CLAUDE.md`. The rules every run needs are in its core.

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
