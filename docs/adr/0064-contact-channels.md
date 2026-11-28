# ADR 0064: Contact details in the profile: a verified email for everyone, Telegram by default, WhatsApp opt-in (T-180)

**Status:** accepted for Telegram and email (Kumar directed the task, 2026-11-26). **WhatsApp is built off by default and stays off until Kumar's approval is recorded in `tasks/…/T-180.md` (it is a paid dependency).**

## Context
- Kumar (2026-11-26): *"If we need to notify users via email and sms/whatsapp, we need their email and phone no in profile."* and *"SMS cost money but WhatsApp, telegram does not and so we support that."*
- `users.email` existed only for email-code sign-in. Auth0 and SSO people had no address, so T-145's notification emails skipped them as `NO_ADDRESS`.
- No phone or messaging handle was stored, and there was no per-person profile screen.

## Decision
1. **A verified email for everyone, kept apart from the sign-in address.**
   - `user_contact_emails` (one row per person) holds the address Pactlab writes to. It is not `users.email`, which stays the email-code sign-in key (unique, used by `app_email_login_*`). Writing a colleague's SSO address into it could collide with an email-code account and would change who can sign in.
   - Notification emails use the contact address first, then the sign-in address (`app_notification_pending_page`, unchanged signature). The sign-in address of an email-code person is already verified by its code.
   - Colleagues cannot read it: the table has its own RLS (own row only), unlike `users`, which members of an organization can read.
2. **Auth0 / SSO: the verified claim, from `/userinfo`.**
   - Auth0 access tokens for a custom API carry no email by default. The web requests `audience` with `@auth0/nextjs-auth0` v4's default scope `openid profile email offline_access` (checked in the installed package), which makes the access token valid for `https://{AUTH0_DOMAIN}/userinfo` too (auth0.com/docs, "Multiple audiences", read 2026-11-27).
   - The API calls `/userinfo` with the caller's own token, and stores `email` only when `email_verified` is `true`, only when the person has no address yet, and at most once per 10 minutes per person while they have none (Auth0 rate-limits `/userinfo` per user).
   - Without a verified claim, the profile asks for an address and confirms it with a one-time code: 6 digits, 10 minutes, single use, 5 attempts, at most 5 requests per 15 minutes, only an HMAC stored (the email-code login rules, ADR 0001).
   - Changing the address is the same code to the new address; the old address is told (without naming the new one). Audited (`contact.email_changed`).
   - Until a person has an address, every page shows one banner: "Add your email so Pactlab can tell you when a pact needs you".
3. **Telegram is the default phone channel (free).**
   - Telegram Bot API (core.telegram.org/bots/api, Bot API 10.5, read 2026-11-27), behind `TelegramBot` in `@pactlab/connectors` with a fixture adapter.
   - **Linking:** **Connect Telegram** opens `https://t.me/<bot>?start=<token>`. The token is 32 base64url characters (the deep-link parameter allows 64 of `A-Za-z0-9_-`), stored only as its SHA-256, single use, 10 minutes. The bot receives `/start <token>` in a private chat and Pactlab stores the `chat_id` against the person. No phone number.
   - **Webhook:** verified by `X-Telegram-Bot-Api-Secret-Token` (1–256 of `A-Za-z0-9_-`), compared in constant time; set with `allowed_updates: ["message", "my_chat_member"]`.
   - **Disconnecting:** from the profile, by `/stop` in the chat, or by blocking the bot. Telegram documents that in a private chat `my_chat_member` arrives only on block or unblock, and a banned member's status is always `"kicked"`; Pactlab stops the channel on `kicked`.
   - Messages are sent with `link_preview_options.is_disabled` (no preview card on a lock screen) and `protect_content`.
   - Off unless `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` are all set; partly set fails at startup.
4. **WhatsApp: Meta's Cloud API directly, opt-in, off by default.**
   - **Choice:** the WhatsApp Business Platform Cloud API (`POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages`, bearer token; webhooks signed `X-Hub-Signature-256` with the app secret; a `hub.verify_token` GET handshake). Verified against Meta's developer docs, 2026-11-27.
   - **Rejected for now: AWS End User Messaging Social.** It fits the AWS-first stack (IAM instead of a Meta token, inbound via SNS, `SendWhatsAppMessage` in us-east-2), but it would add `@aws-sdk/client-socialmessaging`, and whether AWS adds a per-message fee on top of Meta's is not stated on the pages read (its pricing page was not read). It stays behind the same `WhatsAppSender` seam: switching is a second adapter, not a schema change. Revisit once its pricing is checked.
   - **Number:** typed with a country picker (launch markets first; any E.164 number accepted), read into E.164, and verified with a 6-digit code sent over WhatsApp itself in an **authentication** template (copy-code button; the code in body and button, as Meta documents). The consent text shown and its time are stored on the channel.
   - **STOP:** an inbound text that is a stop word (STOP, unsubscribe, …) ends every message to that number at once, audited (`contact.whatsapp_stopped`). No reply is sent (it would be a billable message).
   - **Gate:** `WHATSAPP_ENABLED=true` plus its four credentials. Nothing enables it in any environment in this change.
5. **The same rule for every channel.**
   - **Verified before use:** a channel row exists only once verified (`verified_at NOT NULL`); the dispatcher reads only live, verified rows from the database.
   - **Content-free:** one shared template (`channelMessage`, `@pactlab/domain`), always prefixed "Pactlab:", the same words on every channel; never a pact name, party, amount, document or person; only a link to the inbox. Translated where the app's catalogs exist (T-172; English only today).
   - **Only "act now":** the dispatcher sends a channel message only for an act-now item whose email plan is "send now", so quiet hours and per-pact settings apply. "For your information" never goes to a phone channel.
   - **At most once:** each message is claimed in `contact_channel_deliveries` (unique per notification and channel) before it is sent.
   - **Test message:** the person's own channel, at most 3 an hour.
   - Caps, folding, preferences per channel and metering are T-146.
6. **Contact details are personal data.**
   - **Who reads:** the person their own (RLS: emails by user; channels by user and organization). An organization owner or admin sees members **masked** (`+91 •••• ••12`, `k•••@example.com`, `Telegram ••42`) through `app_contact_admin_list`, which masks in the database and audits every call (`contact.admin_viewed`, allowed and denied). No other unmasked read exists outside the person's own profile; the dispatcher's read is for sending and returns nothing to anyone.
   - **Never** logged (adapters report a status class only, never the provider's description, which may quote the chat), never in fixtures (tests use the fictional `+1 555 555 01xx` range), never sent to a model. A test proves no value reaches a log line or the AI gateway.
   - **Writes** go only through SECURITY DEFINER functions owned by `pactlab_auth`, acting on `app_current_user_id()`; webhooks act only through the single-use token (Telegram) or the number's own STOP (WhatsApp).
7. **Branding (Kumar, 2026-11-27).** The sender is "Pactlab" everywhere; the about line is the tagline "Test the pact before you sign it." (`EMAIL_BLURB`). The Telegram bot's name, description and short description are set with `setMyName`, `setMyDescription` and `setMyShortDescription`; its picture with `@BotFather /setuserpic` from `apps/api/assets/brand/pactlab-icon.png` (the API's `setMyProfilePhoto` takes an `InputProfilePhoto` not verified here). The WhatsApp Business profile's display name, logo and about are set in Meta's WhatsApp Manager. Both are in the runbook's checklist.

## Costs (read 2026-11-27)
- **Telegram:** the Bot API has no per-message charge.
- **WhatsApp:**
  - Meta charges **per delivered message** since 2025-07-01, only for messages from businesses to people, in five categories: marketing, utility, authentication (templates), service and Meta Business Agent (non-template, inside the 24-hour window).
  - **Since 2026-10-01** Meta charges again for utility templates sent inside an open customer-service window, and for service messages beyond 1,000 free a month per business number (developer docs; the marketing page still says these are free: the developer docs are the current statement).
  - **Per-country rates** are published only as downloadable rate cards (CSV and PDF, 16 currencies, effective 2026-10-01) and an interactive tool; the page text carries no figures for Pactlab's markets. Markets: United States (rate card region "North America"), United Kingdom, Germany, France and India (each its own market), Japan ("Rest of Asia Pacific"). The one figure in the text is an example: 0.68 US cents per utility or authentication message to Brazil.
  - Pactlab sends one authentication template per verification and one utility template per act-now event.
  - Kumar records the rates from the rate card in the runbook when approving.
- **SMS:** not built (Kumar: it costs money). T-146 already excludes it.

## Consequences
- Auth0 people get notification emails once their identity provider has verified the address, or once they confirm one.
- **Migration** `20270121000000_contact_channels` is expand-only: four tables, functions, and `app_notification_pending_page` replaced with the same signature. Rollback is in its header.
- **Follow-ups:**
  - the `TELEGRAM_*`, `WHATSAPP_*` and `CONTACT_CHANNELS` variables are read in `apps/api/src/contacts/channels-config.ts`; moving them into `@pactlab/config` and `.env.example`, and the Secrets Manager wiring in `infra/cdk`, are outside this task's paths (T-146 touches both);
  - an email-code person's sign-in address does not change when their contact email does;
  - per-channel preferences, daily caps, the 15-minute fold and WhatsApp metering in Hosting cost are T-146.
- **New UI:** the profile page is built from `Card`, `Button`, `PageHeader` and `Pager`; the add-your-email banner reuses the shared-demo notice's look. Both await Kumar's approval (`docs/ui-patterns.md`).
