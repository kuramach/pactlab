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
- **Follow-ups:** T-084b covers proposal tools (Part 2); T-084c covers client mode (Part 3, ADR 0049).

## Addendum (2026-11-14): suggestions from connected apps (T-084b)

- **Scope `mcp:propose`:** with it, a connected app sees four more tools: `propose_term`, `draft_document_requests`, `list_my_proposals` and `export_counterparty_view`. Without it they are not registered at all.
- **Suggest, never decide:** each write-shaped tool files a row in `agent_proposals` (PENDING). A buyer-side member with deal write access approves or rejects it on the pact's **Suggestions** page. Approval runs the app's own service as that member:
  - TERM runs `PricingService.addFindingTerm`;
  - DOCUMENT_REQUEST runs `DocumentsService.createRequest`.

  The decision route accepts only a session token, so an MCP token gets 401 there, and no MCP tool approves anything.
- **Money stays deterministic:** a term suggestion names only the finding and the lever. The amount is the finding's priced risk at its midpoint, from `adjustmentAmount`, and the app cannot send one.
  - **Eligible findings:** only an accepted −1 finding with a priced risk.
  - **No draft yet:** with no open buyer draft, approval fails as "Draft terms first".
  - **Already drafted:** a finding already on the draft is refused, because a drafted line is never rewritten.
- **Failures are visible:** when the target service refuses, the suggestion becomes FAILED with a plain reason, and it can be approved again or rejected.
- **The counterparty view:** `export_counterparty_view` returns only what the other side may already see:
  - on a Venture Raise, `VentureService.investorView`;
  - otherwise the proposed terms and open document requests.
- **Isolation:** RLS on `agent_proposals` is buyer side only, on the organization and the deal. Tests cover another organization and a target contributor.
- **Audit:** `agent_proposal.created`, `.approved`, `.rejected` and `.failed`, plus `mcp.tool_called`.
- **Still to come:** `submit_evidence` follows as T-084b PR 2, through an external-agent evidence source and the direction-map checks.

## Addendum (T-128, 2026-11-16): the REST API as a second protected resource

Kumar asked for API access "secure and per login since we can track it by user". Rather than static personal tokens, the REST API joins the MCP server as a second resource of the same authorization server, so it inherits per-person grants, revocation, rotating refresh tokens and audit.

- **Resource and tokens:** the API is `<origin>/v1`. `ApiAccessTokens` are HS256 JWTs with that audience and a key derived for this purpose alone (`pactlab:api-access-token:v1`). An API token is refused at `/v1/mcp`, an MCP token is refused on the API, and a session token is neither.
- **Scopes:** `api:read` (the default; GET and HEAD) and `api:write` (anything else). Read always comes with write.
- **Allowlist:** a route is open to API tokens only when marked `@ApiAccess()`; every other route answers 403 `NOT_AVAILABLE_TO_API`. Admin, billing, sign-in, OAuth, Connected apps, approvals and sign-offs stay app-only, and routes needing a recent sign-in refuse API tokens because there is no session.
- **Same tenant as a session:** the guard resolves the tenant from the grant's person and organization with `resolvePrincipal`, so every role check, RLS policy and confidentiality rule applies unchanged.
- **Scripts:** the device authorization grant (RFC 8628). `POST /v1/oauth/device_authorization` gives a device code (stored only as a hash) and an eight-letter consonant user code. The person approves it at `/device` while signed in (a recent sign-in, no demo sessions). The script polls the token endpoint (`authorization_pending`, `slow_down` within 5 seconds, `access_denied`, `expired_token`). Codes last 10 minutes and are limited to 30 an hour per address. A script that isn't a registered client names itself (`[a-z0-9._-]{3,64}`) and is shown as unverified.
- **Apps:** the existing authorization code with PKCE, with `resource=<origin>/v1`.
- **Organization switch:** `organization_flags.api_enabled` is on by default (MCP stays off by default). Organization owners and admins turn it off in Settings → API access, which takes effect at once (403 `API_DISABLED`), and they can list and remove any member's API grant. Changes are audited as `oauth.api_enabled`, `oauth.api_disabled` and `oauth.grant_revoked`.
- **Usage:** `last_used_at` is updated at most once a minute (`app_oauth_grant_access`, a new function, so the running release keeps `app_oauth_grant_state`).
- **Rollback:** the migration is expand-only. Dropping `oauth_device_codes` and the new functions, and restoring the scope check, undoes it.
- **Reference (T-128 PR 2):**
  - **Source:** `GET /v1/openapi.json` (public, OpenAPI 3.1) is generated at runtime from Nest's route metadata: each `@ApiAccess({ tag, summary, description })` route, with the very `ZodValidationPipe` schemas that validate it (`z.toJSONSchema`, no extra dependency).
  - **Pagination:** a query shaped like `pageQuerySchema` is documented as returning a `Page`.
  - **No drift:** being open to API tokens and being documented are the same fact.
