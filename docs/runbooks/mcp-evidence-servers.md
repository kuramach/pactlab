# MCP servers as evidence sources (T-084c, ADR 0049)

Pactlab can read evidence from an external MCP server, read-only, when the operator approves it. Today one server is supported: GitHub's MCP server, for a repository's Dependabot alerts.

## Approve a server (operator)

1. Set `MCP_EVIDENCE_SERVERS` on the API task, e.g.
   `MCP_EVIDENCE_SERVERS=github=https://api.githubcopilot.com/mcp/x/dependabot/readonly`
   - comma-separated `<profile>=<https url>`; the profile id must be one Pactlab ships (`github`);
   - https, a host name (no IP, no port, no query); a bad entry stops the API at startup.
2. Redeploy. `GET /v1/mcp-evidence-servers` lists what deal teams can now pick (id, label, host).
3. To withdraw approval, remove the entry and redeploy: existing live connections fail their checks and syncs with "not on this deployment's approved MCP servers".

## Connect (deal team)

- `POST /v1/deals/:dealId/connections/mcp` with `{ "method": "TOKEN", "server": "github", "target": { "repository": "owner/name" }, "token": "<fine-grained PAT>" }`.
- The token needs **Dependabot alerts: read** (`security_events`). It is stored once, never returned or logged.
- The response carries the checks: reachability, credentials, scopes (the tool is offered and read-only), mappings.
- Sync like any connection (`POST /v1/deals/:dealId/sync-runs`). Alerts become `security.dependency_alert` evidence; a refused token shows as source issues on the run.
- Fixture mode (local, dev, qa): `POST …/connections` with `provider: "mcp", mode: "FIXTURE", config: { server: "github", target: { repository: "troubledco/core" } }`. Synthetic repositories are listed at `GET /v1/synthetic-sources` (`mcpServers`).

## Troubleshooting

| Check says                                               | Meaning                                  | Do                                                                               |
| -------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| not on this deployment's approved MCP servers            | the id is not in `MCP_EVIDENCE_SERVERS`  | approve it, or use another source                                                |
| The server did not answer (redirects are never followed) | unreachable, timed out, or it redirected | check the URL is the final endpoint; check the host resolves to a public address |
| The server refused the credential                        | 401/403                                  | a new token with the grant above                                                 |
| Not offered to this credential: list_dependabot_alerts   | the toolset or token does not expose it  | use the `/x/dependabot` path; check the token's permissions                      |
| The server says … can write                              | the server marks the tool writable       | do not use that server; raise it with the provider                               |

## Register a new MCP server (engineering)

A new server is a reviewed code change; nothing is configured by users.

1. **Verify the server's documented tools** (names, parameters, result shape) from its official docs or source. Never guess.
2. **Choose or add evidence types** in `packages/connectors/src/mcp/evidence-types.ts`, and give each a `VALUATION_DIRECTION_MAP` entry (`packages/connectors/src/valuation-direction.ts`) plus an `ADAPTER_EVIDENCE_TYPES` line. Neutral rules need a rationale. `defineMcpEvidenceProfile` refuses a profile without them.
3. **Write the profile** under `packages/connectors/src/mcp/<server>/profile.ts` with `defineMcpEvidenceProfile`: id, label, version, target schema, headers (the server's read-only switch if it has one), the read tools it may call, the grant it needs, and `pull`, which parses each result against a schema (strip people and free text), normalizes to records with a `provider_record` locator and the canonical record as the quote, and reports anything unreadable as a `SourceIssue`.
4. **Write a synthetic fixture server** (`<server>/fixture.ts`) that answers in the documented shape, including fields that must be dropped, and add it to `MCP_FIXTURE_SERVERS`.
5. **Register** the profile in `MCP_EVIDENCE_PROFILES` (`packages/connectors/src/mcp/index.ts`).
6. **Test**: the profile's pull from the fixture (no people or prose in evidence, pagination, refused calls), and a run through `SdkMcpSessionFactory` against an in-process SDK server (`mcp.test.ts` shows how).
7. **Document** the server in ADR 0049's list and this runbook; then the operator can approve it.
