# Fixture-first integration

On-demand detail for `CLAUDE.md`.

- Give every provider live and fixture adapters behind one normalized interface.
- Persist audited `FIXTURE` or `LIVE` mode per deal; downstream logic never branches by mode.
- `validateConnection()` checks reachability, credentials, scopes, and mappings.
- `dryRun()` performs a bounded read-only pull without a full sync or conclusion change.
- Replay sanitized, versioned cassettes in CI with outbound provider access blocked.
- Make `pnpm seed` idempotently create stable, cross-system HealthyCo, TroubledCo, and SparseCo identities.
- HealthyCo proves the happy path. TroubledCo triggers ARR, ghost-commit, key-person, and license findings. SparseCo covers missing fields, pagination, stale data, duplicate names, and partial permissions.
- Moving fixture to live changes only credentials and mode, never code or schema.
- **One real, recorded fixture: apache/kafka with KAFKA on Apache Jira (T-127).**
  - **What:** `fixtures/recorded/kafka/snapshot.json` is replayed by the fixture adapters for the Kafka demo, as `apache/kafka` and `issues.apache.org`.
  - **People:** pseudonymous.
  - **Not a model for others:** it is public data, recorded once, and the demo never calls out. Every other fixture stays synthetic.
