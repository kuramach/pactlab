# ADR 0065: Slack and Microsoft Teams: an admin installs once, each person links by verified email and confirms, the bot sends content-free direct messages (T-181)

**Status:** accepted for the build (Kumar, 2026-11-26: *"Yes slack and teams for sure."*). Off by default: nothing is sent until Kumar registers the Slack app and the Azure bot (runbook `docs/runbooks/chat-apps.md`). Extends ADR 0064 (contact channels).

## Context
- PE and corp-dev teams work in Slack or Teams all day; both carry bot messages at no per-message cost.
- T-180 gave every person a verified email and a `user_contact_channels` table for Telegram and WhatsApp. Slack and Teams join the same table and the same "act now" dispatch.
- Workspaces are shared, logged and searchable by the customer's admins, so the message must say nothing about a pact.

## Decision
1. **Organization install, once, by an owner or admin** (`chat_installs`; Settings → Slack and Microsoft Teams).
   - **Slack:** OAuth v2 (`/oauth/v2/authorize` → `oauth.v2.access`), bot scopes `chat:write`, `im:write`, `users:read`, `users:read.email` and nothing else; an install that granted fewer is refused. The bot token goes to the credential store (`SecretStore`, ADR 0038); the row keeps only its `secretref:`. The install state is HMAC-signed, bound to the admin, organization and platform, 10 minutes.
   - **Teams:** a personal-scope bot registered in Azure Bot Service (Bot Framework). Pactlab learns the customer's tenant by the admin signing in with Microsoft (`openid`, the id token's `tid`, read directly from the token endpoint over TLS, OIDC Core 3.1.3.7); the admin then deploys the Pactlab app to the tenant in the Teams admin centre. Pactlab's own bot credentials send; there is no per-organization token.
   - **One organization per workspace or tenant:** a live install is unique per platform and tenant; a second organization claiming it is refused (`INSTALL_TAKEN`, audited DENIED, never says whose).
2. **Per-person link** (`user_contact_channels`, kinds `SLACK` and `TEAMS`, naming their install).
   - **Match by the verified Pactlab email** (T-180), never a typed handle. Slack: `users.lookupByEmail`. Teams: when the app is installed for a person, the verified `installationUpdate` activity gives the conversation reference proactive messages need; Pactlab reads the member's email with the Bot Connector's `GET /v3/conversations/{id}/members/{memberId}` and stores the reference (`teams_conversation_refs`) with a keyed hash of the email, never the address.
   - **Confirm before linking:** one message from the bot, "Is this you?" with **Yes, connect me**; the token is 24 random bytes, stored only as its SHA-256, single use, 10 minutes, and valid only for the member it was sent to, while the install is live, in the requester's own organization.
   - **Disconnect:** from Your profile, from the Slack app's Home tab (Disconnect button), or by sending "stop" to the Teams app. Removing the Teams app for oneself ends the link.
   - **No install:** the profile card says "Ask your admin to connect Slack (or Teams) for your organization", with nothing to click.
3. **Sending.**
   - **Direct messages only:** Slack opens the DM (`conversations.open`) and the adapter refuses any conversation that is not a DM (`D…`); Teams sends only into the personal conversation. Never a channel post.
   - **Content-free, the T-146 rule:** the shared `channelMessage('ACT_NOW')` words prefixed "Pactlab:", with one **Open Pactlab** button to `/notifications`, which needs sign-in. No pact name, party, amount or document text; tests assert it on every payload, with the sender "Pactlab".
   - **Only "act now", due now:** the same plan as the other channels (quiet hours honoured); each message claimed in `contact_channel_deliveries` before it is sent (at most once).
   - **Platform limits:** on `429`, wait once for `Retry-After` (at most 30 s), then fail the send as rate-limited; a member Slack or Teams says is gone (`user_not_found`, Bot Connector 403/404) ends the link.
   - **Uninstall and revocation stop sends at once:** Slack's `app_uninstalled` and `tokens_revoked` events (signed), and an admin's Remove (which also calls `auth.revoke`), end the install and every link on it in one transaction; the token is destroyed. Targets are read only through live installs.
4. **Inbound verification.** Slack: `X-Slack-Signature` (`v0=` HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the signing secret), timestamps within 5 minutes. Teams: the Bot Framework JWT (RS256, keys from `https://login.botframework.com/v1/.well-known/openidconfiguration`, issuer `https://api.botframework.com`, audience the bot's Microsoft App ID, 5-minute clock tolerance) and its `serviceurl` claim equal to the activity's `serviceUrl`; a `serviceUrl` outside the Bot Connector hosts (`smba.trafficmanager.net`, `*.botframework.com`) is never stored or called (SSRF).
5. **Data rules.**
   - Workspace and tenant ids, platform user ids, tokens and conversation references are personal or credential data: the runtime role reads none of `chat_installs` and `teams_conversation_refs`; SECURITY DEFINER functions owned by `pactlab_auth` act on the signed-in person; no response, log line, fixture or model prompt carries them (a test checks the logs and the AI gateway).
   - **RLS:** a person sees only their own links (the T-180 policy); an admin sees which members are linked, by name (`app_chat_admin_members`, audited `contact.admin_viewed`), never their Slack or Teams ids.
   - **Audit:** install, uninstall, tokens revoked, link, unlink, and every Slack or Teams send's outcome (`contact.slack_delivered` / `_delivery_failed`, no content).
6. **Branding** (Kumar, 2026-11-27). The Slack app manifest (`slackAppManifest`) and Teams manifest (`teamsAppManifest`, schema 1.19) in `@pactlab/connectors` carry the name "Pactlab", the tagline as description, Pactlab navy `#081127` as background or accent, and the icon from `apps/api/assets/brand/pactlab-icon.png` (Slack app settings; Teams `color.png` and `outline.png`). Messages use the shared template.

## Verified, and what is left to check at setup
- Read from the providers' docs on 2026-11-27: Slack request signing; Bot Framework OpenID metadata, issuer and `serviceurl` claim; the Teams member read. From each provider's API reference as recalled and covered by fixtures shaped from them (to confirm against a live workspace and bot in the runbook's checks): `oauth.v2.access`'s response, `users.lookupByEmail`'s `users_not_found`, `views.publish`, the `tokens_revoked` event shape, Teams `installationUpdate` on a personal install, and Adaptive Card `Action.Submit` arriving as a message `value`.
- **Microsoft's bot tenancy:** the token tenant is configurable (`TEAMS_BOT_TOKEN_TENANT`, default `botframework.com` for a multi-tenant bot). Whether a new Azure bot can still be created multi-tenant, or must be single-tenant or managed identity, is checked by Kumar when registering it; the runbook says what to set either way.

## Consequences
- **Migration** `20270122000000_chat_channels` is expand-only (two tables, one nullable column, wider CHECKs, new functions; `app_contact_delivery_finish` keeps its signature). Rollback is in its header.
- **Configuration** is read in `apps/api/src/contacts/channels-config.ts` (`SLACK_*`, `TEAMS_*`), like T-180's; moving it into `@pactlab/config`, `.env.example` and the CDK secrets is a follow-up outside this task's paths (with T-146's).
- **Not built:** per-platform preferences, daily caps and folding (T-146); translations beyond English (T-172).
