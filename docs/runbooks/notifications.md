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

No new environment settings: notifications use the existing SES sender (`EMAIL_*`), configuration set and do-not-send list.
