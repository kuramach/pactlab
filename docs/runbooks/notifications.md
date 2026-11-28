# Pact activity notifications (T-145, ADR 0046)

People get an in-app item (the bell) for each event on their pacts, and email by their settings: "act now" at once, "for your information" in a digest. The API's dispatcher sends every minute.

## Someone says they were not emailed

1. Ask them to open **Notifications** (the bell). Each item says what happened to its email: *Emailed*, *Not emailed: your address bounced or reported spam*, *The email could not be delivered*, or *Not emailed: no email address on your sign-in*. No note: it is still waiting (quiet hours, or the next digest slot), or their settings keep it in the app.
2. Check their settings: **Settings → Notifications**, and the pact's own override at the bottom of that page.
3. Bounced or spam: the address is on the do-not-send list; see `email-events.md` ("Take an address off the list").

## Deliveries that failed or never finished (schema owner)

```sql
-- Failures in the last day, by error class (no addresses or bodies are stored).
SELECT status, error_class, count(*) FROM notification_deliveries
 WHERE claimed_at > now() - interval '1 day' AND status <> 'SENT' GROUP BY 1, 2;
-- Claimed but never finished: the API stopped between claiming and sending. These are never resent.
SELECT id, user_id, kind, items, claimed_at FROM notification_deliveries
 WHERE status = 'CLAIMED' AND claimed_at < now() - interval '10 minutes';
```

A `CLAIMED` delivery older than a few minutes is not retried, so nobody is emailed twice; the items stay in the person's inbox. To give up on it explicitly: `SELECT app_notification_finish('<id>', 'FAILED', 'Abandoned');`.

## Logs (the API's log group)

`filter msg = "notification email failed"` (kind, item count and error class only) and `filter msg = "notification dispatch failed"` (a pass that could not start, e.g. the database was unreachable; the next minute tries again).

## Nothing is being sent at all

- The API sends only when email is configured (`EMAIL_PROVIDER=ses` and `EMAIL_FROM` deployed; `LOCAL_MAIL_DIR` locally). Without it, items stay in the inbox, waiting.
- Pending items piling up: `SELECT count(*) FROM notifications WHERE email_status = 'PENDING' AND created_at < now() - interval '1 day' AND urgency = 'ACT_NOW';` Act-now items older than a day should only be waiting on quiet hours.

## Settings

Email uses the existing SES sender (`EMAIL_*`), configuration set and do-not-send list. Urgent alerts (below) add `VAPID_*` for web push; the chat channels' settings are in `contact-channels.md` and `chat-apps.md`.

## Urgent alerts: web push, Telegram, Slack and Teams (T-146)

"Act now" items (a signature, terms to answer, a deadline within two days, an IC decision, a question) also reach each channel a person chose, as well as email. "For your information" never does.

- **Content-free, everywhere:** one shared template (`channelMessage` / `pushPayload` in `@pactlab/domain`): "Pactlab: A pact needs you. Open Pactlab to see what." and a link to `/notifications`, which needs sign-in. Never a pact name, party, amount or document. A web push's title is "Pactlab", with the Pactlab icon and badge (`/brand/apple-touch-icon.png`, `/brand/favicon-32.png`).
- **Limits:** at most 10 alerts a person in any 24 hours across every channel together; one alert per pact per 15 minutes, later events folded into the next one. Capped items still go by email and stay in the inbox; they are never sent later. An "act now" item older than 24 hours is never alerted.
- **Choices:** Settings → Notifications → **Urgent alerts**: every connected channel is on until the person unticks it. A pact set to "In Pactlab only" for act-now items gets no alerts at all. Quiet hours hold alerts unless "Email act-now items during quiet hours too" is ticked.
- **Channels:** web push (below), Telegram (`contact-channels.md`), Slack and Teams (`chat-apps.md`). WhatsApp is deferred indefinitely (Kumar, 2026-11-27): it stays off. LINE joins once T-182 builds its link.

### Web push: the VAPID keys (once per environment)

Web push needs no provider account and costs nothing: the server signs each push with a VAPID key pair (RFC 8292) and encrypts it to the browser (RFC 8291). Browsers only accept pushes from the key they subscribed with, so **keep the pair for good**: a new pair means every device subscribes again.

1. **Generate the pair** on your machine (nothing is sent anywhere; this is what `generateVapidKeys()` in `@pactlab/connectors` does):
   ```bash
   node -e "const c=require('crypto').createECDH('prime256v1');c.generateKeys();console.log(JSON.stringify({publicKey:c.getPublicKey().toString('base64url'),privateKey:c.getPrivateKey().toString('base64url')}))"
   ```
2. **Store it** in `pactlab/<env>/messaging/vapid` with the contact push services see, without the private key reaching a command line:
   ```bash
   read -rs PAIR   # paste the JSON from step 1
   echo "$PAIR" | jq '. + {subject:"mailto:alerts@pactlab.ai"}' \
     | aws secretsmanager put-secret-value --secret-id pactlab/<env>/messaging/vapid --secret-string file:///dev/stdin --query VersionId --output text
   unset PAIR
   ```
   Then restart the API (`aws ecs update-service --cluster <cluster> --service <api service> --force-new-deployment`). All three fields or none: a partial set stops the API at startup, naming what is missing.
3. **Check:** Settings → Notifications → **Alerts on this device** → **Turn on alerts on this device** → allow → **Send a test alert**: a notification titled "Pactlab" arrives.
- **Local runs:** `CONTACT_CHANNELS=fixture` gives a fixture push service (nothing leaves the machine), or put a pair in `.env`.
- **Turning off:** set the fields back to `unset` and restart. Subscriptions stay recorded; nothing is sent. Removing the pair forever means people subscribe again later.
- **The `scripts/vapid-key.sh` helper** the brief asks for is not written yet (`scripts/` is outside T-146's paths); until it is, use the steps above.

### iPhone and iPad (checked against WebKit, 2026-11-27)

- iOS and iPadOS **16.4 or later**, and only for a web app **added to the Home Screen** (Share → Add to Home Screen) whose manifest says `display: standalone` (Pactlab's does: `apps/web/app/manifest.ts`). The settings screen says so.
- Permission is asked only when the person taps **Turn on alerts on this device**; iOS refuses a request that isn't a tap.
- Apple's push service is `*.push.apple.com`; Pactlab already allows it. No Apple Developer account is needed for web push.

### Which push services Pactlab sends to

Only the browsers' own: FCM (`fcm.googleapis.com`, Chrome and Android), Mozilla (`updates.push.services.mozilla.com`), Apple (`*.push.apple.com`) and Windows (`*.notify.windows.com`, Edge). A subscription to any other host is refused at subscribe and never called (it would let anyone make the API post to an address of their choosing).

### A device stopped getting alerts

- The push service answered 404 or 410: the subscription expired (the person cleared site data, uninstalled the Home Screen app, or the browser rotated it). Pactlab ended it at once (`push_subscriptions.revoked_reason = 'EXPIRED'`, audited `contact.push_expired`); the person turns alerts on again on that device.
- Notifications blocked in the browser: the settings screen says so; they allow it in the site settings.
- Capped or folded: see the limits above.

```sql
-- Push outcomes in the last day, by error class (no endpoints or keys are logged or stored outside push_subscriptions).
SELECT purpose, outcome, error_class, count(*) FROM push_deliveries WHERE created_at > now() - interval '1 day' GROUP BY 1, 2, 3;
-- Alerts per person per day, and what the cap held back.
SELECT outcome, count(*) FROM channel_alert_items WHERE created_at > now() - interval '1 day' GROUP BY 1;
```

Logs: `filter msg = "notification push failed"` and `filter msg = "notification message failed"` (channel and error class only).

### Costs

- **Web push:** none. FCM, Mozilla, Apple and Windows push services carry it free; no carrier registration.
- **Telegram:** the Bot API has no per-message charge.
- **Slack and Teams:** no per-message charge for a bot's direct messages (`chat-apps.md`).
- **WhatsApp:** Meta charges per message; deferred, so nothing is sent and nothing is metered. If it is ever approved, metering in Hosting cost comes with it.
- **SMS:** not built (it costs per message).

### Branding checklist for Kumar (every channel says "Pactlab")

| Where | Name | Picture | About |
|---|---|---|---|
| Web push (app manifest) | `Pactlab` (set in code) | `/brand/apple-touch-icon.png` and `/brand/favicon.svg` (set in code) | "Test the pact before you sign it." (set in code) |
| Telegram bot | `setMyName` (`contact-channels.md` step 4) | `@BotFather` → `/setuserpic` → `apps/api/assets/brand/pactlab-icon.png` | `setMyDescription`, `setMyShortDescription` |
| Slack app, Teams app | the manifests in `@pactlab/connectors` (`chat-apps.md`) | the same icon | the tagline |

