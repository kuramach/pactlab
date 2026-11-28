# Contact channels: email, Telegram and WhatsApp (T-180, ADR 0064)

Everything here is off by default. Agents never set these values or touch AWS; these are Kumar's steps.

## What people see
- **Settings → Your profile** (`/settings/profile`): name, email (verified), Telegram, WhatsApp, each with its verified state; a test message and disconnect per channel.
- **Banner** on every page until the person has a verified email.
- **Admins** see members' contact details masked on the same page; every view is audited (`contact.admin_viewed`).

## Email
- Nothing to set up: codes and notices go through the branded SES sender.
- **Auth0 / SSO:** the email is read from `https://<AUTH0_DOMAIN>/userinfo` with the person's own access token, and stored only when `email_verified` is true. If Auth0 people still have no email after signing in:
  1. Check the web app requests scope `openid profile email` (the SDK default; `AUTH0_*` in the web's environment).
  2. Check the connection marks addresses verified (Auth0 dashboard → the user → `email_verified`). Enterprise connections often send `email_verified: false` unless configured; the person can still add one by code.
  3. Auth0's `/userinfo` is rate-limited per user; Pactlab asks at most once per 10 minutes while a person has no address.

## Telegram (free)
1. **Create the bot:** in Telegram, open `@BotFather` → `/newbot`. Name: `Pactlab`. Username: e.g. `PactlabBot` (must end in `bot`). Keep the token BotFather gives you; never paste it in chat or a ticket.
2. **Picture:** `@BotFather` → `/setuserpic` → choose the bot → send `apps/api/assets/brand/pactlab-icon.png` (the icon the emails use; never a new drawing).
3. **Store the three values** in the environment's secrets (Secrets Manager wiring is a follow-up in `infra/cdk`, T-146; until then set them as the API task's environment):
   - `TELEGRAM_BOT_TOKEN`: from BotFather;
   - `TELEGRAM_BOT_USERNAME`: without `@`;
   - `TELEGRAM_WEBHOOK_SECRET`: generate with `openssl rand -base64 48 | tr -d '=+/' | cut -c1-64` (letters and digits only).
   All three or none: a partial set stops the API at startup.
4. **Profile and webhook** (once, after deploy), from a machine with the token, in a shell that does not log history:
   ```bash
   TOKEN=...; SECRET=...; HOST=app.pactlab.ai
   curl -s "https://api.telegram.org/bot$TOKEN/setMyName" -d name=Pactlab
   curl -s "https://api.telegram.org/bot$TOKEN/setMyDescription" --data-urlencode "description=Test the pact before you sign it. Pactlab tells you here when a pact needs you, with no deal details."
   curl -s "https://api.telegram.org/bot$TOKEN/setMyShortDescription" --data-urlencode "short_description=Test the pact before you sign it."
   curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" -H 'content-type: application/json' \
     -d "{\"url\":\"https://$HOST/v1/webhooks/telegram\",\"secret_token\":\"$SECRET\",\"allowed_updates\":[\"message\",\"my_chat_member\"]}"
   curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
   ```
   Each answers `{"ok":true,...}`. The same calls are `TelegramBotApi.setProfile` and `setWebhook` in `@pactlab/connectors`.
5. **Check:** Your profile → **Connect Telegram** → Start in the chat → "Pactlab: You are connected." → **Send a test message**.
- **Rotating:** BotFather `/revoke` gives a new token; set it, redeploy. A new webhook secret needs `setWebhook` again.
- **Turning off:** unset the three values and redeploy; `deleteWebhook` on the bot. Linked channels stay recorded but nothing is sent.

## WhatsApp (paid per message: needs Kumar's approval first)
**Do not enable until the approval line below is filled in and committed.**

> Approval: _not given_ — date, rates accepted (per market, from Meta's rate card), and who.

1. **Rates:** download the current rate card (Meta developer docs → WhatsApp → Pricing → "Rate cards and volume tiers", CSV or PDF, in USD/GBP/EUR/INR). Record here the utility and authentication rates for: North America (US), United Kingdom, Germany, France, India, Rest of Asia Pacific (Japan). Pactlab sends one authentication message per number verification and one utility message per "act now" event. Since 2026-10-01 utility messages inside an open service window are charged too.
2. **Business verification (Kumar):** Meta Business Suite → Security Centre → verify the business (legal name, address, documents). Then WhatsApp Manager → add a phone number that is not on a personal WhatsApp account.
3. **Business profile:** WhatsApp Manager → the number → Profile: display name `Pactlab` (Meta reviews it), profile photo `apps/api/assets/brand/pactlab-icon.png`, about `Test the pact before you sign it.`, website `https://pactlab.ai`.
4. **Templates** (WhatsApp Manager → Message templates), language English:
   - `pactlab_verify`, category **Authentication**, copy-code button (Meta's fixed text "<code> is your verification code."), code expiry 10 minutes;
   - `pactlab_act_now`, category **Utility**, body `Pactlab: A pact needs you. Open Pactlab to see what: {{1}}`;
   - `pactlab_test`, category **Utility**, body `Pactlab: This is a test message. Notifications will arrive here, with no deal details. {{1}}`.
   The bodies must stay word for word the shared template (`channelMessage` in `@pactlab/domain`).
5. **App and webhook:** in the Meta app (Developers → your app → WhatsApp): note the phone number id and the app secret; create a system-user access token with `whatsapp_business_messaging`. Webhook URL `https://<host>/v1/webhooks/whatsapp`, a verify token you generate (`openssl rand -hex 32`), subscribe to `messages`.
6. **Set:** `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_API_VERSION` (default `v27.0`). Missing any with `WHATSAPP_ENABLED=true` stops the API at startup.
7. **Check:** Your profile → WhatsApp → number, consent, code → **Send a test message**. Reply `STOP` from the phone: the channel ends at once (`contact.whatsapp_stopped` in the audit log).
- **Turning off:** `WHATSAPP_ENABLED=false` and redeploy.

## Local runs and tests
- `CONTACT_CHANNELS=fixture` (never in production) runs both channels with the fixture adapters: nothing leaves the machine.
- CI never calls Telegram or Meta: tests use the fixtures and stubbed responses shaped from the official docs.

## When something is wrong
- **"Telegram is not set up":** the three `TELEGRAM_*` values are not set in this environment.
- **Links say "expired or already used":** the link lasts 10 minutes and works once; connect again.
- **Messages stopped arriving:** the person blocked the bot or sent `/stop` (Telegram), or replied STOP (WhatsApp). They reconnect from their profile.
- **Never** copy a chat id, number or address into a ticket, log or chat. Use the person's user id.
