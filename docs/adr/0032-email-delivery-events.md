# ADR 0032: SES delivery events through SNS into the app, and an in-app do-not-send list (T-109)

**Status:** accepted (2026-11-14)

## Context
- Until now, SES account-level suppression and manual console checks were Pactlab's only bounce and complaint handling. The app never learned that an address bounced, so a deal team could not tell "never received the invitation" from "ignoring us".
- The SES production-access request for live describes our bounce and complaint handling to AWS; this makes the standard setup real.

## Decision
- **One configuration set per environment** (`pactlab-<env>-mail`, CDK), with an SNS event destination for BOUNCE, COMPLAINT, DELIVERY, REJECT and RENDERING_FAILURE to that environment's topic.
  - **Every send names it** (`ConfigurationSetName` on `SendEmail`), rather than setting a default on the identity: one domain identity is shared by the environments in an account (`identityOwner: false`), so a default would send every environment's events to one place. The API role may send with that configuration set only.
- **The API consumes the events** at `POST /v1/email-events/sns` (public; the SNS signature is the authentication), rather than a separate Lambda: the API already holds the database role and the hash secret.
  - **Verified before parsed:** the topic must be this environment's (`EMAIL_EVENTS_TOPIC_ARN`); the signing certificate must come from an `sns.<region>.amazonaws.com` host over https, path `/SimpleNotificationService-*.pem`, fetched through the SSRF-safe fetcher and cached; signature versions 1 (SHA1) and 2 (SHA256).
  - **Subscribing:** the API calls `sns:Subscribe` for its own endpoint at startup. That call is idempotent and makes SNS resend the confirmation while a subscription is pending, so a confirmation that reached an older release during a deploy is never lost. The confirmation link is fetched only from an SNS host.
- **What is stored:** `email_events` (type, keyed hash of the address, its domain, SES and SNS message ids, bounce type and subtype, the SMTP diagnostic with any address in it masked, the time). No address and no message content is stored. SNS redeliveries are recorded once.
- **Do-not-send:** a permanent bounce or a complaint puts the address's hash on `email_suppressions`. `SesEmailSender` checks it before every send and refuses with `EmailSuppressedError` (logged with the reason and the domain, never the address). A transient bounce is recorded, not suppressed.
  - **Never breaks sending:** if the check cannot be read, the email is sent; if event processing fails, nothing about sending changes. SES account-level suppression stays the floor.
- **Operators:** structured logs for every event (type, bounce type, domain, SES message id), and an email-health line in the console (counts by type over 7 days, and the list's size). No customer-facing surface in v1.
- **Database access** is through SECURITY DEFINER functions owned by `pactlab_ops` (`app_email_event_record`, `app_email_suppressed`, `app_ops_email_health` with the operator check); the runtime role has no table privileges.

## Consequences
- Idle-paused environments (dev, qa, stage) lose events that arrive while paused (SNS retries briefly, then drops them). SES account suppression still applies; live does not pause.
- Taking an address off the list is a runbook step for now (`docs/runbooks/email-events.md`), not a console action.
- **Rollback:** unset `EMAIL_CONFIGURATION_SET` and `EMAIL_EVENTS_TOPIC_ARN` (sends go back to exactly what they were); the tables and functions can stay or be dropped.
