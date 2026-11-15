# MCP server (T-084, ADR 0024)

AI apps such as Claude can read a person's pacts over MCP, after the person approves the connection. Every call is audited. With the extra `mcp:propose` scope an app may also *suggest* things (T-084b), but a person decides each suggestion in Pactlab.

## Turn it on for an organization
Go to the admin console, then **Organizations**, then **MCP**, and click **Turn on**. The switch is audited (`org.mcp_enabled` / `org.mcp_disabled`). Turning it off makes connected apps get 403 on their next request.

## Connect Claude (for the customer)
1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Enter `https://app.pactlab.ai/v1/mcp`.
3. Claude opens Pactlab's sign-in. Sign in with your email code or passkey, check the organization and what it may read, then click **Approve**.
4. Ask, for example, "What's still open on Project X before IC?"

Other MCP clients work the same way: they discover everything from the address above.

## Suggestions (`mcp:propose`, T-084b)
- **What an app can suggest:**
  - **A term:** `propose_term`, for an accepted −1 finding that has a priced risk. The app names the lever; the amount is Pactlab's (the priced risk at its midpoint).
  - **A document request:** `draft_document_requests`. By default it asks for the checklist categories still missing and not yet requested.
- **Where it lands:** the pact's **Overview → Suggestions** page, which shows only when MCP is on for the organization. Deal leads and analysts approve or reject there. Approval runs the same action as the app's own buttons; nothing reaches the counterparty before that.
- **Reading back:** `list_my_proposals` gives the app each suggestion's status and the approver's note.
- **"Not carried out":** approval could not be done; the card says why (for example "Draft terms on the Terms page"). Fix the cause, then **Try again**, or reject it.
- **What the other side sees:** `export_counterparty_view` returns only that (the investor view on a Venture Raise; otherwise proposed terms and open requests).
- **Audit:** `agent_proposal.created`, `agent_proposal.approved`, `agent_proposal.rejected` and `agent_proposal.failed`.

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
