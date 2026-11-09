# MCP server (T-084, ADR 0024)

AI apps such as Claude can read a person's pacts over MCP, after the person approves the connection. It's read-only and every call is audited.

## Turn it on for an organization
Go to the admin console, then **Organizations**, then **MCP**, and click **Turn on**. The switch is audited (`org.mcp_enabled` / `org.mcp_disabled`). Turning it off makes connected apps get 403 on their next request.

## Connect Claude (for the customer)
1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Enter `https://app.pactlab.ai/v1/mcp`.
3. Claude opens Pactlab's sign-in. Sign in with your email code or passkey, check the organization and what it may read, then click **Approve**.
4. Ask, for example, "What's still open on Project X before IC?"

Other MCP clients work the same way: they discover everything from the address above.

## Revoke access
- **The person:** Settings → **Connected apps** → **Disconnect**.
- **Everyone in an organization:** switch MCP off for that organization.
- Reusing a refresh token (a sign of a stolen token) revokes that grant automatically, audited as `oauth.refresh_reused`.

## Audit
- **Events:** `oauth.grant_created`, `oauth.token_issued`, `oauth.grant_revoked`, `oauth.refresh_reused`, and `mcp.tool_called`. The last has the target "tool · client" and the deal.
- **Never logged:** arguments and results.

## Support
- **"Connecting AI apps isn't switched on for your organization"**: switch MCP on as above.
- **"This app asked to return to an address it did not register"**: the client is misconfigured. Pactlab never redirects in that case.
- **Company-SSO (Auth0) organizations** can't connect yet; that needs T-104.
