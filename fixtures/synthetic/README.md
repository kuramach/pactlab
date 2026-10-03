# Synthetic companies

Deterministic, cross-system synthetic targets. **Synthetic data only** — never
copy customer or production data here. Every company keeps stable identities
across every provider fixture so joins (billing ↔ CRM ↔ Git ↔ HRIS) resolve.

| Company | Proves |
|---|---|
| [`HealthyCo`](HealthyCo/README.md) | The happy path end to end. |
| [`TroubledCo`](TroubledCo/README.md) | ARR, ghost-commit, key-person and license findings fire. |
| [`SparseCo`](SparseCo/README.md) | Missing fields, pagination, stale data, duplicate names, partial permissions. |

Seeding (`pnpm seed`) creates these idempotently from T-002 onward. Fixture
and live adapters share one normalized interface; downstream logic never
branches on `FIXTURE` vs `LIVE` mode.
