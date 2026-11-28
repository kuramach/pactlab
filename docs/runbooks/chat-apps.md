# Slack and Microsoft Teams (T-181, ADR 0065)

Off by default. Agents never set these values, register apps or touch AWS; these are Kumar's steps.

## What people see
- **Settings → Slack and Microsoft Teams** (owners and admins): **Add to Slack**, **Connect Microsoft Teams**, the installed badge, how many members are connected, **Remove**.
- **Your profile:** a Slack card and a Teams card. With no install: "Ask your admin to connect … for your organization". Installed: **Connect Slack / Connect Teams** → one "Is this you?" message → **Yes, connect me** → Connected. Then **Send a test message** and **Disconnect**.
- **Messages:** direct, from the Pactlab bot, "Pactlab: A pact needs you. Open Pactlab to see what: …" with an **Open Pactlab** button. Never a pact name, amount or document.

## Slack: one-time setup
1. **Create the app from a manifest:** api.slack.com/apps → Create New App → From a manifest → your own workspace. Paste the JSON printed by:
   ```bash
   pnpm --filter @pactlab/api exec tsx -e "import('@pactlab/connectors').then(m => console.log(JSON.stringify(m.slackAppManifest({ apiOrigin: 'https://app.pactlab.ai', webOrigin: 'https://app.pactlab.ai' }), null, 2)))"
   ```
   It sets the name **Pactlab**, the description (the tagline), the background colour (navy `#081127`), the bot user, the bot scopes (`chat:write`, `im:write`, `users:read`, `users:read.email` only), the redirect URL (`/settings/chat-apps/slack/callback`), the events URL (`/v1/webhooks/slack/events`: `app_home_opened`, `app_uninstalled`, `tokens_revoked`) and the interactivity URL (`/v1/webhooks/slack/interactions`).
2. **Icon:** Basic Information → Display Information → App icon: upload `apps/api/assets/brand/pactlab-icon.png` (never a new drawing). Check the name, short description and background colour there.
3. **Distribution:** Manage Distribution → activate public distribution, so other workspaces can install it (Slack Marketplace listing is optional and later).
4. **Store** in the environment's secrets: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (Basic Information → App Credentials). All three or none: a partial set stops the API at startup. (CDK wiring is a follow-up; until then set them as the API task's environment.)
5. **Credential store:** the bot tokens go to Secrets Manager (`CREDENTIAL_STORE=secretsmanager`); without it Add to Slack says the store is unavailable.
6. **Check:** Settings → Add to Slack → approve in Slack → "Installed". Your profile → Connect Slack → the DM → Yes, connect me → Send a test message. In Slack, the app's Home tab shows Disconnect.

## Microsoft Teams: one-time setup
1. **Register the bot:** Azure portal → Create → **Azure Bot**. Bot handle `pactlab`; type of app: **multi-tenant** if Azure still offers it, otherwise **single-tenant** (then set `TEAMS_BOT_TOKEN_TENANT` to the bot's own tenant id). Note the **Microsoft App ID**.
2. **Secret:** the bot's Configuration → Manage password → new client secret. Keep it out of chat and tickets.
3. **Messaging endpoint:** `https://app.pactlab.ai/v1/webhooks/teams/messages`. Channels → add **Microsoft Teams**.
4. **Sign-in redirect:** in the bot's Entra app registration → Authentication → add the Web redirect URI `https://app.pactlab.ai/settings/chat-apps/teams/callback`; supported account types: accounts in any organizational directory.
5. **Bot profile:** Azure Bot → Settings: display name **Pactlab**, icon `apps/api/assets/brand/pactlab-icon.png`, description "Test the pact before you sign it.".
6. **App package:** a zip of `manifest.json`, `color.png` (192×192, from `pactlab-icon.png`) and `outline.png` (32×32, white on transparent, traced from the same icon). The manifest:
   ```bash
   pnpm --filter @pactlab/api exec tsx -e "import('@pactlab/connectors').then(m => console.log(JSON.stringify(m.teamsAppManifest({ botAppId: '<Microsoft App ID>', version: '1.0.0', webOrigin: 'https://app.pactlab.ai' }), null, 2)))"
   ```
   Name **Pactlab**, the tagline, accent navy `#081127`, a personal-scope bot only. Validate it in the Teams Developer Portal.
7. **Publishing:** for each customer, their Teams admin uploads the package (Teams admin centre → Manage apps → Upload a custom app) and deploys it to their users (setup policy, or the Org-wide app catalog). For testing, sideload in your own tenant (Developer Portal → Apps → Preview in Teams). Store submission (Partner Center) is optional and later.
8. **Store:** `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_PASSWORD`, and `TEAMS_BOT_TOKEN_TENANT` if single-tenant. ID and password together or neither.
9. **Check:** Settings → Connect Microsoft Teams → sign in with a Microsoft work account → "Installed". In Teams, open the Pactlab app (this captures the chat). Your profile → Connect Teams → the message → Yes, connect me → Send a test message. Send "stop" in the chat: disconnected.

## Local runs and tests
- `CONTACT_CHANNELS=fixture` (never in production) runs Slack and Teams with fixture adapters: nothing leaves the machine.
- CI never calls Slack or Microsoft: tests use the fixtures and stubbed responses shaped from the official docs.

## When something is wrong
- **"Not set up on this Pactlab yet":** the `SLACK_*` or `TEAMS_*` values are not set here.
- **"Already connected to another Pactlab organization":** that workspace or tenant is installed elsewhere; that organization's admin removes it first.
- **"No one with your email was found":** Slack: the workspace account uses a different email. Teams: the person has not opened the Pactlab app yet, or the tenant gives no email for them.
- **Messages stopped:** the app was uninstalled or its tokens revoked (`contact.slack_uninstalled` / `contact.slack_tokens_revoked` in the audit log), the person disconnected, or removed the Teams app. Reinstall and reconnect.
- **Rotating:** Slack: regenerate the signing secret or client secret, set it, redeploy. Teams: a new client secret, set it, redeploy; the old one expires on its date.
- **Never** copy a workspace id, tenant id, member id or token into a ticket, log or chat.
