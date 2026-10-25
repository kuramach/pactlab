# Provider cassettes

Sanitized, versioned recordings of provider sandbox responses, replayed in CI
with outbound provider access blocked. Never record production data, secrets,
tokens or personal data. Cassettes arrive with the first live adapter.

## Index (T-082)

- `github/octocat__Hello-World.json` — recorded anonymously from the public
  repository; pull-request titles replaced, logins pseudonymised.
- `github/apache__kafka-pulls.json` — two merged apache/kafka pull requests
  with their reviews and check runs, recorded 2026-10-25 with `gh api`;
  logins pseudonymised, titles kept (they carry the public Jira keys).
- `jira/apache-kafka-datacenter.json` — hand-built from Jira Data Center
  REST v2 shapes and an anonymous read of issues.apache.org; synthetic people.
- `jira/cloud-synthetic.json` — hand-built from Jira Cloud REST v3 enhanced
  search shapes on a fictional site; synthetic data only.

- `github/apache__kafka.json`, `jira/apache-kafka.json` — the Kafka pair
  (T-074), recorded by `packages/connectors/scripts/record-cassettes.ts`:
  the live adapters run against the public targets through a recording
  fetch; bodies are pruned to `src/http/cassette-allowlist.ts`, logins,
  emails and Jira people pseudonymised, messages sanitized. Re-record with
  `pnpm --filter @pactlab/api exec tsx ../../packages/connectors/scripts/record-cassettes.ts`
  (anonymous; `GITHUB_TOKEN` optional) and review the diff before committing.

Live smoke tests against the same targets run only with `pnpm test:live`
(`INTEGRATION_LIVE=1`), nightly in `.github/workflows/integration-live.yml`.

`packages/connectors/src/http/cassettes.test.ts` checks every cassette holds
only allow-listed keys, pseudonymous logins and no credentials.

