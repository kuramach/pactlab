# ADR 0066: LINE for Japan: LINE Login plus a friend add, push within the free monthly allowance, content-free bilingual words (T-182)

**Status:** accepted for the build (Kumar, 2026-11-26: *"Line for Japan."*). Off by default: nothing is sent until Kumar sets up the LINE Official Account and its two channels (runbook `docs/runbooks/line.md`). Extends ADR 0064 (contact channels) and ADR 0065.

## Context
- Japan is a target market (T-170 to T-173) and LINE is the main messaging app there. T-180 gave every person a verified email and `user_contact_channels`; LINE joins the same table, the same profile and the same "act now" dispatch.
- Push messages from a LINE Official Account reach only people who have added it as a friend, and every push counts toward the account's monthly message allowance; a paid plan is a paid dependency.

## Decision
1. **One Pactlab LINE Official Account**, with a Messaging API channel and a LINE Login channel **under the same provider** (LINE documents that only then is the user ID the same in both).
2. **Linking, from Your profile.** **Connect LINE** opens LINE Login v2.1 (`scope=openid profile`, `nonce`, `bot_prompt=aggressive`, a signed 10-minute state bound to the person and organization). The API exchanges the code, verifies the ID token with `POST /oauth2/v2.1/verify` (audience and nonce checked again), and asks `GET /friendship/v1/status` with the person's access token; no token is kept.
   - **A friend already:** the user ID becomes the person's channel at once.
   - **Not yet:** a pending row (15 minutes, `contact_verifications` kind LINE); the account's signed `follow` webhook completes it. **The user ID is stored as a channel only after both steps.**
   - **Disconnect:** the profile, STOP in the chat (and 停止, ストップ, 配信停止), or blocking the account: `unfollow` disconnects at once.
3. **Webhooks** (`POST /v1/webhooks/line`, read raw): `x-line-signature` = Base64 HMAC-SHA256 of the raw body with the channel secret, compared in constant time; a bad or missing signature is 403. Only one-to-one (`source.type: user`) events with a documented user ID (`U[0-9a-f]{32}`) are read; standby events carry no reply token. Redelivered events are harmless (each change is idempotent).
4. **Sending.** Alerts and test messages are `POST /v2/bot/message/push` with one text message and `X-Line-Retry-Key` set to the delivery's id (LINE accepts it at most once; a duplicate's 409 counts as sent). Replies in the chat (connected, not connected, stopped) use `POST /v2/bot/message/reply`, which LINE does not count.
   - **Content-free, the T-146 rule:** the shared `channelMessage` words, "Pactlab:" first, a link to `/notifications`, never a pact name, party, amount or document text.
   - **Language:** Japanese for a Japanese reader; until the server knows a person's language (T-172b), English then Japanese in one message, one prefix, the link last (`lineMessage`). The Japanese words are in `@pactlab/domain` beside the English ones and need a native review.
   - **"Act now" only, due now**, through the same plan as every channel; claimed in `contact_channel_deliveries` before sending.
5. **The monthly allowance.** `line_monthly_usage` counts pushes by calendar month in Japan time; `app_line_quota_take` takes one atomically before each push and refuses at the allowance (the first refusal records `reached_at`); a push LINE did not accept is given back; LINE's own 429 "You have reached your monthly limit." stops the month too. At the allowance nothing goes to LINE, the email for the same alert goes as planned, and operators see **LINE monthly allowance reached** (`GET /v1/admin/line/usage`, Health in the console). The allowance is the free Communication plan's 200 (lycbiz.com, read 2026-11-27); configuration can only lower it, and raising it is a code change after Kumar's approval is recorded.
6. **Data rules.** A LINE user ID is personal data: on the person's own channel row only (the T-180 RLS by user and organization), masked for admins (`LINE ••3f`, `app_contact_admin_line`), never logged, never in a fixture (tests use made-up IDs), never sent to a model. Every write is a SECURITY DEFINER function owned by `pactlab_auth`; connections, stops and disconnections are audited.
7. **Connector seam.** `LineBot` in `@pactlab/connectors`: `LineApi` (live) and `FixtureLineBot` (the same signature check and parsing, logins by code, friends, an outbox with the exact payloads). `CONTACT_CHANNELS=fixture` runs it outside production.
8. **Branding** (Kumar, 2026-11-27): the account name "Pactlab", the profile image `apps/api/assets/brand/pactlab-icon.png`, the status message "Test the pact before you sign it." (`EMAIL_BLURB`), set in LINE Official Account Manager (runbook). Every payload's sender is Pactlab and its text starts "Pactlab:" (tested).

## Verified, and what was not used
- Read on developers.line.biz on 2026-11-27: push and reply endpoints and headers, five messages per request, `X-Line-Retry-Key` (UUID, 409 on a duplicate, push only), the 429 monthly-limit message, webhook signature and body, `follow` / `unfollow` / text `message` events and the user ID format, LINE Login's authorize, token, verify and friendship endpoints and parameters, `bot_prompt`, the same-provider rule, and which messages count.
- **Not used, because not read word for word:** the quota endpoints (`/v2/bot/message/quota…`), `notificationDisabled`, and the maximum text length (Pactlab's messages are short). Pactlab counts its own pushes instead of asking LINE.

## Consequences
- **Migration** `20270123000000_line_channel` is expand-only (one table, wider CHECKs, new functions, `app_contact_mask` replaced with the same signature). Rollback is in its header.
- **Configuration** (`LINE_*`) is read in `apps/api/src/contacts/channels-config.ts`, like T-180's and T-181's; moving it into `@pactlab/config`, `.env.example` and the CDK secrets is a follow-up outside this task's paths (with T-146's).
- **Not built:** per-person caps and the 15-minute fold (T-146, applied to LINE with the other channels when it lands); per-channel preferences.
