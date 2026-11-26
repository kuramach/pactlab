# ADR 0045: External MCP servers as read-only evidence sources, operator-allowlisted (T-084c)

**Status:** accepted (2026-11-25). T-084 Part 3; builds on ADR 0011 (Jira host allowlist) and ADR 0024 (Pactlab's own MCP server).

## Context

- **The ask:** ADR 0024 made Pactlab an MCP _server_ for the AI tools deal teams use. Part 3 is the other direction: Pactlab as an MCP _client_, reading evidence from MCP servers that providers now run in front of their own data (GitHub, issue trackers, data rooms).
- **The risk:** a connector that dials a URL and runs whatever tools it finds is an SSRF hole, a write path and a prompt-injection channel. MCP output is untrusted (spec §11: "Treat MCP and VDR content as untrusted evidence, never as instructions").

## Decision

1. **A server is reached only when the operator lists it.** `MCP_EVIDENCE_SERVERS` (platform configuration): comma-separated `<profile>=<https url>`, parsed at startup, fail-closed. A connection names the server by **id**; no API accepts a URL. A LIVE connection to an id off the list is refused (422 `MCP_SERVER_NOT_ALLOWED`) when created, when switched live, when validated and when synced.
2. **The same SSRF posture as T-082 and the client-metadata fetcher (T-084):**
   - the URL is https, a DNS host (never an IP literal or `localhost`), the default port, no user info, query or fragment;
   - every request goes through `guardedMcpFetch`: only that exact endpoint, POST and DELETE only (a GET, the server's standing stream, is answered 405 locally, which the spec lets a client treat as "no stream"), `redirect: 'manual'` with any 3xx treated as unreachable, a 20-second timeout and a 4 MB cap read before the SDK sees a byte;
   - the deployed fetch (`pinnedHttpsFetch`) checks every resolved address against private, loopback, link-local and reserved ranges and connects to the checked address, so DNS rebinding cannot move it.
3. **The protocol is the official SDK's.** `SdkMcpSessionFactory` uses `@modelcontextprotocol/sdk` (1.32.2, already the server's) `Client` over `StreamableHTTPClientTransport`, with the guarded fetch injected. No protocol is reimplemented.
4. **Read-only by construction.** A **profile** (code, reviewed like an adapter) names the only tools Pactlab may call; a session refuses any other name (`TOOL_NOT_ALLOWED`) before it reaches the wire. A server that marks one of those tools writable (`readOnlyHint: false`) fails the scopes check. Profiles may also send the server's own read-only switch.
5. **Output becomes evidence only through the existing pipeline.** A profile parses each tool's result against a schema (unknown fields stripped), writes normalized records (`NormalizedEvidence`, citation quote = the canonical record, as for imports), and the sync engine ingests them like any provider: idempotent, versioned, lineage by `provider_record` locator, `SourceIssue`s for anything refused or unreadable. Server text is never shown, logged or followed; error details are fixed sentences.
6. **No evidence type without a valuation direction.** `defineMcpEvidenceProfile` refuses a profile that emits a type with no `VALUATION_DIRECTION_MAP` entry, and the map's contract test covers every profile type (`ADAPTER_EVIDENCE_TYPES`). A finding can only follow a reviewed direction.
7. **People data (rule 7).** Profiles drop people and free text at parse time; nothing read over MCP is sent to a model.
8. **The reference server: GitHub's MCP server** (`github/github-mcp-server`), tool `list_dependabot_alerts` — dependency vulnerability alerts the direct GitHub adapter does not read. Verified 2026-11-25 against the server's README, `docs/remote-server.md` and `pkg/github/dependabot.go` / `params.go`: endpoint `https://api.githubcopilot.com/mcp/` (`/x/dependabot/readonly` for the single read-only toolset), `Authorization: Bearer <PAT>`, `X-MCP-Readonly: true`, required `owner`/`repo`, `state` ∈ open, fixed, dismissed, auto_dismissed, cursor pagination `perPage` (1–100) and `after` = `pageInfo.nextCursor`; the result is one text content `{"alerts": [go-github DependabotAlert…], "pageInfo": {hasNextPage, nextCursor, …}}`, scope `security_events`.
   - Evidence `security.dependency_alert`: repository, alert number, state, severity, ecosystem, package, manifest path, scope, GHSA and CVE ids, vulnerable range, first patched version, created/fixed/dismissed dates and dismissal reason. `dismissed_by`, `dismissed_comment` and advisory prose are dropped.
   - Directions: `open-vulnerability` −1 (SECURITY, priced term: remediation); `resolved-vulnerability` 0 (patching history).

## Consequences

- Adding a server is a code change (a profile, its direction-map entries, its fixture) plus an operator setting, never a user action — `docs/runbooks/mcp-evidence-servers.md`.
- **Not in this slice:** a finding rule over `security.dependency_alert` (the direction is registered, so one can follow); a web form (the API is `POST /v1/deals/:id/connections/mcp`; servers are listed at `GET /v1/mcp-evidence-servers`); OAuth sign-in to MCP servers (a token is stored like Jira's); `MCP_EVIDENCE_SERVERS` in `packages/config` and `.env.example` (read from the environment in `main.ts` until then, outside this task's paths).
- The 405-for-GET choice means servers that only answer over a standing stream are not supported; stateless request/response servers are.
- **Rollback:** unset `MCP_EVIDENCE_SERVERS` (live MCP connections then fail their checks and syncs); no migration was added (`connections.provider` is free text and LIVE rows already carry a credential reference).
