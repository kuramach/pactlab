# ADR 0045: Pact activity notifications: an event catalogue, recipients that follow access, an inbox, and at-most-once email with a digest (T-145)

**Status:** accepted (2026-11-25). Planned in the task brief (Kumar, 2026-11-20: "When deals are in full flight keeping the parties in tight dance is key"). T-146 (push and SMS) adds channels on the same events.

## Context
- Pactlab emailed only sign-in codes, invitations, listing interest, demo invites and operator alerts. A seller's upload, a counter-proposal, a signature waiting or an exclusivity clock running out reached the other side only if they happened to open the pact.
- Who may see what on a pact is already settled: deal membership and role, buyer-only versus shared, target-contributor isolation, bidders walled from each other (ADR 0015), investors seeing only the published view (ADR 0044). Notifications must not open a side door around any of it.

## Decision
1. **A small, explicit catalogue** (`@pactlab/domain` `notifications/catalog.ts`, a `satisfies Record<…>` registry; the database CHECK lists the same types):

   | Urgency | Event | Recorded where | Who | Visibility |
   |---|---|---|---|---|
   | Act now | `SIGNATURE_REQUESTED` | terms agreed (in-app sign-off), terms or a letter of intent sent for e-signature | the named signatories | shared |
   | Act now | `TERMS_PROPOSED` | either side proposes a version | the buyer's deal lead / the seller | shared |
   | Act now | `TERMS_COUNTERED` | the other side answers a version | the proposing side (deal lead / seller) | shared |
   | Act now | `DEADLINE_NEAR` | the dispatcher's sweep: a countersigned letter's exclusivity, or a sent letter's answer-by date, within 48 hours | everyone on the pact (bidders and investors excepted) | shared |
   | Act now | `IC_DECIDED` | the committee decides | the own side | buyer-only |
   | Act now | `QUESTION_ASKED` | a bidder asks the seller | the seller's team | shared |
   | For your information | `DOCUMENT_ADDED` | a shared upload | the other side | shared |
   | For your information | `FINDING_DRAFTED`, `FINDING_DECIDED` | a finding drafted (by a person or a rule), or reviewed | the own side | buyer-only |
   | For your information | `MEMBER_ADDED` | a member added, or an invitation accepted | everyone who may see that membership | shared (a bidder's: the own side only; an investor's: none) |
   | For your information | `VALUATION_SUBMITTED` | a scenario submitted | the own side | buyer-only |
   | For your information | `SYNC_FINISHED`, `SYNC_FAILED` | a sync run completes | the person who started it | shared |

   The person who made a change is never told of it (a sync is theirs, so they are).
2. **Recorded in the change's own transaction.** An event is a `notification_events` row, deduplicated by a stable key per change (`terms:<batch>:proposed`, `finding:<id>:v<n>:decided`, …), so a retried request or a replayed job records it once. Most are written through the change's own audit write (`AuditEventInput.notify`), so the change, its audit event and its notification commit or roll back together.
3. **Recipients follow access, computed server-side.** The runtime role cannot insert events or notifications. `app_notify` (SECURITY DEFINER) checks the caller is an active member of the pact, then derives recipients from active memberships in one rule: never an investor; a buyer-only event never reaches a target contributor or bidder; a bidder hears only of their own bid; then the audience narrows it. No recipient list ever comes from client input; a named-people audience (signatories) is still filtered by the same rule.
4. **Defence in depth on read.** A person reads their own items only, in the organization their session is in, on pacts still in their tenant context, and a buyer-only item only while they are on the pact's own side (RLS on `notifications`). Revoking a membership hides its items at once.
5. **Content rules.** An item's words are fixed per type in the catalogue: plain words and the pact's name, never an amount, a valuation, compensation, document text or named-person HR data (rule 7). Emails carry the same words and a link back (an exact place in the pact, checked by a database CHECK to stay inside its own pact). Digest lines are "<pact>: <event>".
6. **Preferences** (`notification_preferences`): per person (act now, for your information, digest cadence, time zone, quiet hours, act now through quiet hours) and a per-pact override of the two modes. Defaults: act now by email at once; for your information in a daily digest at 08:00 local time; no quiet hours.
7. **Email, at most once.** The dispatcher (`apps/api` `NotificationDispatcher`) plans each pending item with the domain's `planEmail`: in-app only, wait (quiet hours, or not yet the digest slot), send now, or into the digest. Before sending it **claims** the items (`app_notification_claim` marks them and records a `notification_deliveries` row in one transaction); a claimed item is never claimed again, so a retry, a crash or a second API task never sends twice. A crash between claim and send leaves the delivery `CLAIMED` (visible, never resent). Outcomes (`SENT`, `SUPPRESSED`, `FAILED` with an error class) are stored on the delivery and shown on each item.
8. **Suppression.** An address on the in-app do-not-send list (T-109) is never emailed: the dispatcher checks it before sending (and the SES sender checks again). Pactlab's branded SES sender sends everything.
9. **Audit of sends.** `notification_deliveries` is the send record: who, which items (and so which events), which channel (immediate or digest), when, and the outcome. No message body is stored; the event reference is enough to rebuild the words.

## Deviation from the brief: where the dispatcher runs
- The brief puts the digest and delayed sends in the worker (BullMQ). The worker has no email: its configuration schema (`packages/config`) has no `EMAIL_*`, it does not depend on the SES SDK, and its task role may not send as the SES identity (`infra/cdk`). All three are outside this task's scope.
- So the dispatcher runs in the API process, on a one-minute timer, as source checks already do. Correctness does not depend on where it runs: every send is claimed in the database first, so several API tasks may run it at once, and a missed tick only delays.
- **Follow-up:** move it to a repeatable BullMQ job in the worker once the worker has `EMAIL_*`, the SES SDK and the SES send permission (a config, CDK and worker change).

## Consequences
- An inbox and bell in the top bar (`/notifications`, keyset-paginated, mark read and mark all read); Settings → Notifications.
- A session is in one organization at a time, so the inbox shows that organization's pacts; the digest email covers every organization a person is on.
- An Auth0 user with no stored address gets in-app items only (`NO_ADDRESS`).
- Not yet notified: LOI countersigned or declined, bid answers to bidders, sale-process rounds. Each is one more `notify` on its audit write.
- **Migration** `20270107000000_pact_notifications` is expand-only: four tables and the functions above. Rollback: drop the functions, then `notifications`, `notification_deliveries`, `notification_events` and `notification_preferences`; nothing else reads them.
