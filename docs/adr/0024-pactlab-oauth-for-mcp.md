# ADR 0024: Pactlab's own OAuth authorization server for its MCP server (T-084)

**Status:** accepted (Kumar, 2026-11-08)

## Context
T-084 puts Pactlab inside the AI tools deal teams already use (Claude, Copilot and others) through an MCP server. The MCP authorization spec (2026-07-28) requires OAuth 2.1 for remote servers. Live runs only email-code organizations, and Auth0 for live is postponed (T-104). Kumar chose Pactlab's own OAuth: no subscription, and it works today for every email-code organization.

## Decision
- **Roles and addresses:**
  - **Authorization server:** Pactlab, with the issuer at the web origin (for example `https://app.pactlab.ai`).
  - **Discovery:** RFC 8414 metadata at `/.well-known/oauth-authorization-server`.
  - **Consent page:** `/oauth/authorize`, which needs a Pactlab session (email code or passkey).
  - **Token, registration and revocation:** under `/v1/oauth/*` on the API.
- **MCP server (resource server):** `{api origin}/v1/mcp`, using stateless Streamable HTTP and `@modelcontextprotocol/sdk` for the protocol only. RFC 9728 metadata is at `/.well-known/oauth-protected-resource/v1/mcp`, and a 401 points to it.
- **Clients:**
  - **Client ID Metadata Documents** (the spec's SHOULD) are preferred. The document is fetched with SSRF protections:
    - https only, with no redirects;
    - every resolved address is checked, and the connection pinned to the checked one;
    - a 5-second timeout and a 64 KB cap;
    - cached for at most 24 hours.
  - **Dynamic Client Registration** (RFC 7591, deprecated in MCP) is kept as a fallback, rate-limited per address.
  - **Public clients only:** PKCE S256, and redirect URIs must be https, or http on loopback.
- **Tokens:**
  - **Codes:** single-use, 60 seconds, bound to PKCE, the redirect URI and the resource.
  - **Access tokens:** HS256 JWTs (`typ: at+jwt`) whose audience is the MCP URI (RFC 8707). They're signed with a key derived from `AUTH_TOKEN_SECRET` for this purpose alone, so session tokens and MCP tokens never stand in for each other. They last 1 hour.
  - **Refresh tokens:** opaque, 30 days, rotated on every use. Reuse revokes the grant.
  - **The `iss` value** goes in every authorization response (RFC 9207).
  - **Storage:** codes and tokens are stored only as keyed hashes, in tables reached only through `pactlab_auth` SECURITY DEFINER functions.
- **Grants:** each grant is for one person, one organization and one client.
  - **Checked on every MCP request:** the grant must not be revoked, the person must still be a member, and the organization's switch (`organization_flags.mcp_enabled`, off by default and set by operators) must be on.
  - **Disconnecting:** from Settings → Connected apps, or through RFC 7009 revocation.
- **Scopes:** `mcp:read` (the baseline) and `mcp:confidential`.
  - **Confidential content:** the confirmed-value ledger and value-confirmation findings leave every result unless the token has `mcp:confidential`, in addition to whatever the person's role already allows.
- **No business logic in the MCP layer:** every tool calls the services the REST API calls, with the tenant built from the token the same way. Every permission and confidentiality rule therefore applies unchanged.
  - **What-if scenarios:** `run_valuation_scenario` uses `ValuationService.preview`, the same deterministic engine, and saves nothing.
- **Audit:**
  - **OAuth events:** `oauth.grant_created`, `oauth.token_issued`, `oauth.grant_revoked`, `oauth.refresh_reused` (DENIED).
  - **Tool calls:** `mcp.tool_called`, with tool, client and deal.
  - Arguments and results are never logged.

## Consequences
- **Organizations covered:** only email-code organizations can connect apps for now. Auth0 (company SSO) organizations will need T-104 to issue MCP tokens from Auth0, or federate.
- **Signing key:** rotating `AUTH_TOKEN_SECRET` invalidates MCP access tokens along with sessions. Clients recover by refreshing; refresh tokens are hashes keyed by the same secret, so after a rotation clients must reconnect.
- **Rollback:** the migration is expand-only. Turning the switch off for every organization, or removing the `mcp` dependency in `main.ts`, takes MCP offline. The stored rows are harmless.
- **Follow-ups:** T-084b covers proposal tools (Part 2); T-084c covers client mode (Part 3).
