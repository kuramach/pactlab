# Contact channels: email, Telegram, LINE and WhatsApp (T-180, T-182; ADR 0064, ADR 0069)

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
3. **Store the three values** in the environment's Secrets Manager secret `pactlab/<env>/messaging/telegram` (T-146; one JSON secret, every field `unset` until set), then restart the API (`aws ecs update-service … --force-new-deployment`, or the next deploy). The fields map to:
   - `TELEGRAM_BOT_TOKEN`: from BotFather;
   - `TELEGRAM_BOT_USERNAME`: without `@`;
   - `TELEGRAM_WEBHOOK_SECRET`: generate with `openssl rand -base64 48 | tr -d '=+/' | cut -c1-64` (letters and digits only).
   All three or none: a partial set stops the API at startup. To write them without the values reaching a command line (signed in with `scripts/aws.sh login`):
   ```bash
   read -rs TOKEN; read -r USERNAME; read -rs SECRET
   jq -n --arg t "$TOKEN" --arg u "$USERNAME" --arg s "$SECRET" '{token:$t, username:$u, webhookSecret:$s}' \
     | aws secretsmanager put-secret-value --secret-id pactlab/<env>/messaging/telegram --secret-string file:///dev/stdin --query VersionId --output text
   unset TOKEN SECRET
   ```
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
- **Turning off:** set the three fields back to `unset` and restart the API; `deleteWebhook` on the bot. Linked channels stay recorded but nothing is sent.

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

## LINE for Japan (T-182, ADR 0069; free up to the monthly allowance)

### Cost (checked 2026-11-28)
LINE Official Account plans for Japan, from `https://www.lycbiz.com/jp/service/line-official-account/plan/` (fees a month, excluding tax):

| Plan | Fee | Messages included | More messages |
|---|---|---|---|
| コミュニケーションプラン (Communication) | ¥0 | 200 | not allowed |
| ライトプラン (Light) | ¥5,000 | 5,000 | not allowed |
| スタンダードプラン (Standard) | ¥15,000 | 30,000 | about ¥3 each up to 200,000, then ¥2.5 (revised 2026-10-01) |

- **What counts:** push, multicast, broadcast and narrowcast, one per recipient. **Not counted:** replies (the Reply API), LINE chat, auto-responses and greeting messages (developers.line.biz "Messaging API pricing"; lycbiz.com).
- **Pactlab runs on the free plan.** Every alert and test message is a push; the "You are connected" message is a reply, so it is free.
- **A paid plan is a paid dependency:** record Kumar's approval in `tasks/…/T-182.md` first. Then the plan is changed in LINE Official Account Manager, and the code's limit (`LINE_FREE_MONTHLY_MESSAGES`, `@pactlab/domain`) is raised in a reviewed change. `LINE_MONTHLY_ALLOWANCE` may only go down from 200 today.
- **At the allowance:** Pactlab counts its own LINE messages for the calendar month in Japan time and stops at the allowance; if LINE answers 429 "You have reached your monthly limit." first, it stops too. People still get the email (it never depended on LINE). Operators see **"LINE monthly allowance reached"** in the operator console (Health, the LINE line) and get one email a month at `OPERATOR_EMAIL`. LINE resumes on the 1st (Japan time). LINE does not state when its own count resets; check `GET /v2/bot/message/quota/consumption` (shown beside Pactlab's count in the console) on the 1st.

### One-time setup (Kumar)
Everything below is done once, signed in as the Pactlab administrator. Never paste a secret or token into chat or a ticket.

1. **Create the official account** in LINE Official Account Manager (`https://manager.line.biz`), country **Japan**:
   - **Account name:** `Pactlab`.
   - **Profile image:** `apps/api/assets/brand/pactlab-icon.png` (the icon the emails use; never a new drawing).
   - **Status message:** `Test the pact before you sign it.` (`EMAIL_BLURB`'s tagline). Check the length limit the Manager shows; LINE's limits for the name and status message were not readable from the docs on 2026-11-28.
   - **Response settings:** turn **off** auto-response and greeting messages, so every message is Pactlab's shared template; turn **on** webhooks.
2. **Enable the Messaging API** (Manager → Settings → Messaging API). Create the provider **Pactlab** when asked. This makes the Messaging API channel in the LINE Developers console (`https://developers.line.biz/console/`).
3. **Messaging API channel** (Developers console → the channel):
   - **Basic settings:** copy the **channel secret**.
   - **Messaging API:** issue a **long-lived channel access token**. Set **Webhook URL** `https://<host>/v1/webhooks/line`, turn **Use webhook** on, and press **Verify** (it sends an empty event list, signed; Pactlab answers 200).
4. **LINE Login channel**, under the **same provider** (user ids differ between providers, so this is required):
   - **LINE Login → Callback URL:** `https://<host>/settings/profile/line/callback`.
   - **Basic settings → Linked LINE Official Account:** Edit → choose Pactlab → Update.
   - Scopes: `openid` and `profile` only (Pactlab never asks for email).
   - Copy the **channel ID** (digits) and **channel secret**, and **publish** the channel.
5. **Add-friend link:** in the Manager, copy the official account's add-friend URL (its add-friend tools). It is shown to people who skipped the add-friend screen during sign-in.
6. **Set the values** for the API (all five or none; a partial set stops the API at startup):
   - `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` (Messaging API channel);
   - `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` (LINE Login channel);
   - `LINE_ADD_FRIEND_URL` (https);
   - optional `LINE_MONTHLY_ALLOWANCE` (1–200; default 200).
   Deployed environments need these wired as a Secrets Manager secret into the API task (`infra/cdk`), which is a follow-up outside T-182; until then LINE stays off there. Locally, set them in `.env`, or use `CONTACT_CHANNELS=fixture`.
7. **Check:** Your profile → **Connect LINE** → sign in → add Pactlab as a friend → "Pactlab: You are connected." in LINE → **Send a test message**. Block Pactlab in LINE: the profile shows LINE as not connected (`contact.line_stopped` in the audit log).

- **Japanese wording:** the messages' Japanese (`CHANNEL_WORDS.ja` in `@pactlab/domain`) is machine-made. Have a native speaker review it before Japanese customers use LINE.
- **Rotating:** issue a new channel access token or channel secret in the console, set it, restart the API. A new channel secret also changes webhook signatures, so set it before the next webhook.
- **Turning off:** clear the five values and restart the API; turn off **Use webhook**. Linked channels stay recorded but nothing is sent.

### When something is wrong
- **"LINE could not confirm your sign-in":** the callback URL in the LINE Login channel must be exactly `https://<host>/settings/profile/line/callback`, and the channel must be published.
- **Signed in, but never connected:** the person has not added Pactlab as a friend (the profile says so), or the Login channel is under another provider or not linked to the official account (step 4).
- **Webhook "Verify" fails with 403:** `LINE_CHANNEL_SECRET` is not the Messaging API channel's secret.
- **Never** copy a LINE user id into a ticket, log or chat. Use the person's Pactlab user id.

## Slack and Microsoft Teams
See `docs/runbooks/chat-apps.md` (T-181, ADR 0065).

## Local runs and tests
- `CONTACT_CHANNELS=fixture` (never in production) runs every channel, LINE included, with the fixture adapters: nothing leaves the machine.
- CI never calls Telegram, Meta or LINE: tests use the fixtures and stubbed responses shaped from the official docs.

## When something is wrong
- **"Telegram is not set up":** the three `TELEGRAM_*` values are not set in this environment.
- **Links say "expired or already used":** the link lasts 10 minutes and works once; connect again.
- **Messages stopped arriving:** the person blocked the bot or sent `/stop` (Telegram), or replied STOP (WhatsApp). They reconnect from their profile.
- **Never** copy a chat id, number or address into a ticket, log or chat. Use the person's user id.
