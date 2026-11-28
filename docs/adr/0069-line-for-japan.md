# ADR 0069: LINE for Japan: LINE Login proves the user id, the friend added completes the link, sends stop at the free allowance (T-182)

**Status:** accepted for the build (Kumar directed the task, 2026-11-26: *"Line for Japan."*). Off by default: nothing is sent until Kumar creates the official account and both channels (`docs/runbooks/contact-channels.md`). Extends ADR 0064 (contact channels) and ADR 0066 (urgent alerts).

## Context
- Japan is a target market (T-170 to T-173) and LINE is the main messaging app there. T-180 built the profile's channels on `user_contact_channels`; T-146 routes "act now" alerts to them with a daily cap and a 15-minute fold.
- A LINE official account can push only to people who added it as a friend, and only knows them by a user id that is issued per provider.
- LINE's Japanese plans (lycbiz.com, read 2026-11-28): the free Communication plan includes 200 messages a month and allows no more; paid plans are ¥5,000 (5,000) and ¥15,000 (30,000, then about ¥3 each). Pushes count; replies do not.

## Decision
1. **Every endpoint, header and limit from developers.line.biz** (read 2026-11-28), behind `LineChannel` in `@pactlab/connectors` with a fixture adapter: push and reply (`/v2/bot/message/push|reply`, bearer channel access token, `X-Line-Retry-Key`), the monthly quota and consumption, `x-line-signature` (Base64 HMAC-SHA256 of the raw body with the channel secret), `follow` and `unfollow` events, LINE Login v2.1 (authorize, token, `verify`, `friendship/v1/status`).
2. **Linking is two steps, and the id is stored only after both.**
   - **Connect LINE** opens LINE Login (code flow, scopes `openid profile`, a single-use 10-minute `state` stored only as its hash, a `nonce` and a PKCE S256 verifier both derived from the state with the server's key, `bot_prompt=aggressive` so LINE offers the friend right after consent).
   - The callback, as the same signed-in person, exchanges the code, verifies the ID token with LINE (`aud`, `iss`, `nonce`) and reads the friendship status. Already a friend: linked now. Not yet: the verification keeps a **keyed hash** of the user id for 30 minutes, never the id; the `follow` webhook for that id completes the link and is answered with a reply ("You are connected", free).
   - The Login channel must be linked to the official account under the same provider (runbook).
3. **Unfollow disconnects at once:** a signed `unfollow` (the person blocked Pactlab) ends the channel (`contact.line_stopped`). Every webhook is verified before it is read; a bad signature is 403.
4. **Sending:** only through the T-146 alert path (one alert per pact per 15 minutes, 10 a day across channels) and the person's own test. The words are the shared, content-free template prefixed "Pactlab:"; Japanese for a `ja` reader, otherwise English and Japanese together, because no person's language is stored yet (T-172b). The delivery id is LINE's retry key.
5. **The free allowance is a hard platform-wide cap.** `app_line_delivery_claim` counts the month's LINE deliveries (Japan time) under one advisory lock and refuses past `LINE_MONTHLY_ALLOWANCE` (default and maximum 200, the free plan); LINE's own "monthly limit" 429 also marks the month reached (`line_allowance_months`). Once reached, nothing more is tried that month; the person still gets the email; operators see "LINE monthly allowance reached" in the console and get one email. Raising the cap needs Kumar's approval of a paid plan recorded in T-182, then a reviewed code change.
6. **Personal data:** a LINE user id is never logged, sent to a model or put in a fixture (tests use synthetic ids). RLS by user and organization as T-180; writes through `pactlab_auth` SECURITY DEFINER functions; link, disconnect and stop are audited.
7. **Branding:** the official account is named "Pactlab", with the emails' icon and the tagline as its status message, set in LINE Official Account Manager (runbook checklist).

## Consequences
- **Migration** `20270126000000_line_channel` is expand-only (one table, wider CHECKs, new functions). Rollback is in its header.
- **Not built here:** the masked admin list does not show LINE yet (changing `app_contact_admin_list`'s return type needs a drop and recreate); `LINE_*` variables are read in `apps/api/src/contacts/channels-config.ts`, and moving them into `@pactlab/config`, `.env.example` and a CDK secret is a follow-up outside T-182's paths, so deployed environments stay off until then; a native review of the Japanese words.
- **New UI:** the LINE card on Your profile and the LINE line in the operator console follow the Telegram card and the email-health line; they await Kumar's approval (`docs/ui-patterns.md`).
