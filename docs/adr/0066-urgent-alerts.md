# ADR 0066: Urgent pact alerts: web push with our own VAPID keys, one content-free alert per pact per 15 minutes, a daily cap across every channel (T-146)

**Status:** accepted for the build (Kumar directed the task, 2026-11-26; WhatsApp deferred, 2026-11-27). Builds on ADR 0046 (notifications), ADR 0064 (contact channels) and ADR 0065 (Slack and Teams).

## Context
- Near signing and closing, a counter-proposal or a waiting signature should reach the person within minutes, even away from their desk. T-145 records "act now" events and emails them; T-180 and T-181 link Telegram, Slack and Teams and sent one message per "act now" item.
- A busy pact can produce several "act now" events in minutes. One message each would bury the person, and every message on a lock screen or in a chat app sits outside Pactlab's control.
- Kumar (2026-11-26): no SMS, because it costs per message. WhatsApp is deferred indefinitely (2026-11-27).

## Decision
1. **Web push, with no provider account.** The standard Push API: a manifest (`display: standalone`, so iPhone and iPad can install it, iOS 16.4+) and a service worker that only shows notifications. Pactlab signs each push with its own VAPID key pair (RFC 8292: ES256, `aud` the push service's origin, `exp` 12 hours) and encrypts the payload to the browser as one aes128gcm record (RFC 8291), all with `node:crypto`, so no dependency is added. Verified against RFC 8030, 8291, 8292, MDN and WebKit on 2026-11-27.
   - **Subscriptions** (`push_subscriptions`): per device, the person's own (RLS by user and organization; the runtime role cannot read the endpoint or keys), at most 10 live a person, removable, and ended at once when the push service answers 404 or 410. Audited: `contact.push_subscribed`, `contact.push_unsubscribed`, `contact.push_expired`.
   - **SSRF:** an endpoint is a URL the browser hands us, so Pactlab posts only to the browsers' own push services (FCM, Mozilla, Apple, Windows), checked at subscribe and at send; redirects are not followed.
2. **Alerts, not messages per event** (`channel_alerts`, `channel_alert_items`). The dispatcher gathers each person's "act now" items per pact into one alert, and sends it once on each channel they chose (Telegram, Slack and Teams claim on the alert's first item, web push on the alert).
   - **The fold:** a pact alerted in the last 15 minutes waits; its later events go out together in the next alert.
   - **The cap:** at most 10 alerts a person in any 24 hours, across every channel together. Beyond it, items are recorded `CAPPED` and never sent later; email and the inbox still carry them.
   - Both are decided in `app_channel_alert_take` under a per-person advisory lock, so two API tasks agree; `decideAlert` in `@pactlab/domain` states the same rule for tests and readers.
3. **Only "act now", and the person's choices.** "For your information" never reaches a channel. Every linked channel is on until the person unticks it (`notification_channel_preferences`; linking is the opt-in). A pact set to "In Pactlab only" sends nothing outside the app. Quiet hours hold alerts unless the person opted act-now items through. Email is unchanged. Items older than 24 hours are never alerted.
4. **Content-free, by construction.** `pushPayload()` takes no pact, event or person: the title "Pactlab", the shared "Pactlab:" words, the brand icon and badge, and `/notifications`, which needs sign-in. Telegram, Slack and Teams keep the shared `channelMessage`. Tests check every payload for the sender, the prefix and the absence of the pact's name and ids.
5. **Configuration.** The channel and VAPID variables move into `messagingEnvSchema` (`@pactlab/config`): off unless set, never half-set. Deployed, Telegram and VAPID each live in one JSON secret (`pactlab/<env>/messaging/{telegram,vapid}`), every field `unset` until set, read only by the API.

## Consequences
- A person on a busy pact gets one alert per 15 minutes per pact and at most 10 a day; nothing important is lost, because email and the inbox carry every item.
- Changing the VAPID pair forces every device to subscribe again: the pair is kept for good.
- **Migration** `20270123000000_urgent_alerts` is expand-only (five tables and functions; nothing existing changes). Rollback: drop the functions, then `push_deliveries`, `channel_alert_items`, `channel_alerts`, `push_subscriptions`, `notification_channel_preferences`; the dispatcher of the previous release sends per item again.
- **Not built here:** LINE (T-182 builds its link; it then joins `ALERT_CHANNELS`), WhatsApp (deferred; its T-180 code stays off), translated push words (the shared template is English until its catalogs exist), and the `scripts/vapid-key.sh` / `scripts/telegram-key.sh` helpers (`scripts/` is outside this task's paths; the runbook gives the commands).
- **New UI:** the urgent-alerts card on Settings → Notifications awaits Kumar's approval (`docs/ui-patterns.md`).
