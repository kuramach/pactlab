# ADR 0014 — Pact guests: invite another party into one pact, never into the organization

Status: accepted (T-094 B12, 2026-10-28; design agreed with Kumar)

## Context

A pact has several parties — the buyer team, the seller, advisors — each
from its own company. Kumar's design: one organization per party; the pact
links them with side- and role-scoped grants; nobody joins the other side's
organization; each side signs in its own way (enterprise SSO for buyers,
email codes for sellers); each side sees the other's people on the pact by
name and role only. Until now a deal lived inside one organization and every
user on it had to be a member of that organization.

## Decision

1. **A guest is a deal membership without an organization membership.** An
   invited person from another party holds an active `deal_memberships` row
   in the pact owner's organization (seller → TARGET_CONTRIBUTOR; advisor →
   ADVISER or VIEWER; co-investor → ANALYST, REVIEWER or VIEWER) and no
   `organization_memberships` row there. Their home organization is their
   own.
2. **The session moves, the policies stay.** A guest's email-code session is
   rescoped (security-definer `app_auth_session_rescope`, which now also
   admits organizations where the user holds an active deal membership) to
   the owner's organization; `resolvePrincipal` admits it as
   `organizationRole: 'GUEST'` with `dealIds` = only their pacts. Every
   deal-scoped RLS policy (permitted deal ids + `app_is_buyer_side`) then
   applies unchanged — a seller-side guest never sees buyer-only rows.
3. **Organization-wide policies are tightened to members** with
   `app_is_org_member()`: organization memberships (read others / insert /
   update), users (the organization's people), deal creation, org-level audit
   events, and comparables. A guest sees themselves and the people on their
   pacts — never the organization's member list, library or other deals.
   Members are unaffected (they are all organization members).
4. **Invitations** (`deal_invitations`): one email, one pact, one side and
   role (a CHECK pins the allowed combinations; nobody is invited as deal
   lead). The token is 32 random bytes, stored only as its SHA-256; links
   expire after 14 days and work once. A colleague already in the
   organization is added directly instead. Only the owner's own side can
   create, list or revoke invitations.
5. **Accepting** goes through `app_accept_deal_invitation` (security definer,
   owned by the auth role): the signed-in user's own address must equal the
   invited address. The audit event is written by the API through the normal
   hash-chained path, as the new guest.
6. **Invitees sign up without friction:** a valid invitation for the address
   lets sign-up skip operator approval and the work-email rule (sellers
   often use personal addresses). Their home organization is created ACTIVE.

## Consequences

- Auth0 (enterprise SSO) guests arrive with T-070: their tokens carry their
  home `org_id`; a guest scope for Auth0 sessions is that task's work.
- A platform MFA baseline for email-code organizations and step-up checks on
  exports and counterparty shares are the next B12 increment.
- Any new organization-wide table must gate on `app_is_org_member()`; a new
  deal-scoped table follows the existing deal-scoped pattern and needs
  nothing extra.
