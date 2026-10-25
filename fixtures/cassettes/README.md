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

`packages/connectors/src/http/cassettes.test.ts` checks every cassette holds
only allow-listed keys, pseudonymous logins and no credentials.

