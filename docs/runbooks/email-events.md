# Email delivery events (T-109, ADR 0032)

SES publishes each environment's bounce, complaint, delivery, reject and rendering-failure events to its SNS topic (`<stack>-MailEvents…`). The API subscribes `https://<app host>/v1/email-events/sns` at startup and records each verified event. A hard bounce or a complaint puts the address on the in-app do-not-send list.

## Check it works (any environment, including the SES sandbox)

The SES mailbox simulator addresses are always deliverable, also in the sandbox.

1. Admin console → **Health**: note the email line.
2. From the environment, send something to each simulator address. For example, sign up three test organizations, or invite these addresses to a test pact:
   - `success@simulator.amazonses.com` → a delivery;
   - `bounce@simulator.amazonses.com` → a permanent bounce, and the address goes on the list;
   - `complaint@simulator.amazonses.com` → a complaint, and the address goes on the list.
3. Within a minute, the Health line shows 1 delivered, 1 bounced and 1 complaint, with 2 addresses on the list.
4. Send to the bounce address again. The API logs `email refused: address on the do-not-send list` with `reason: HARD_BOUNCE`, and SES is not called.

## Logs (CloudWatch Logs Insights, the API's log group)

```
fields @timestamp, event, bounceType, bounceSubtype, domain, sesMessageId, duplicate
| filter msg = "email event"
| stats count() by event, bounceType
```

Refused sends: `filter msg = "email refused: address on the do-not-send list"`. Refused notifications (bad signature, wrong topic): `filter msg = "email event refused"`.

## The subscription is pending

The API resubscribes on every start, which makes SNS resend the confirmation. Restart the API service (or deploy). Check in the SNS console that the subscription shows **Confirmed**.

## Take an address off the list

The person fixed their mailbox and asks to be mailed again. The list holds only a keyed hash of the address, made with the environment's `AUTH_TOKEN_SECRET`:

1. Compute it in an ops task (`scripts/ops-task.sh <env> …`) with `recipientHash(secret, address)` from `apps/api/src/email-events/email-events.service.ts`.
2. As the schema owner, run `DELETE FROM email_suppressions WHERE recipient_hash = '<hash>';`.

SES account-level suppression is separate: also remove the address in SES (console → Suppression list) if SES suppressed it.
