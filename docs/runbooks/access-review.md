# Access review

Monthly during the pilot, and immediately after a partner reports a leaver.

## Inputs

- Organization memberships and roles per pilot organization.
- Deal memberships and roles per deal (`GET /v1/deals/:dealId/members`, which
  is itself audited as `deal.members.list`).
- Audit events since the last review for `deal.member.added`, access denials
  and administrative actions.

## Procedure

1. For each pilot organization, export the current membership list.
2. Send it to the partner's named owner. They confirm each person still needs
   access at the listed role.
3. Remove anyone not confirmed within five business days.
4. Check specifically:
   - `TARGET_CONTRIBUTOR` users only on deals they were invited to;
   - organization admins limited to named people;
   - no Pactlab staff on partner deals without a dated support reason.
5. Review denied-access audit events for patterns (repeated 403s from one
   user, cross-tenant probes) and escalate per
   [suspected-cross-tenant-access.md](suspected-cross-tenant-access.md).
6. Record reviewer, date, changes made and partner sign-off.

A self-serve access-review screen is a follow-up; until then this is a
documented procedure.
