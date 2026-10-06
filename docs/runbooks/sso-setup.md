# SSO setup

## Choosing a sign-in method

Each organization uses exactly one method (`organizations.auth_method`,
ADR 0001):

- **AUTH0** (default) — Auth0 Organizations, including enterprise SAML/OIDC
  through Auth0. Follow "Onboarding a pilot organization" below.
- **EMAIL_CODE** — Pactlab emails a 6-digit one-time code; no Auth0. For
  organizations that do not want Auth0. No SSO and no MFA beyond the inbox.

### Onboarding an email-code organization (operator)

1. Create the `organizations` row with `auth_method = 'EMAIL_CODE'` and
   `auth0_organization_id` NULL (the database rejects any other combination),
   through the reviewed admin procedure.
2. For each user: a `users` row with `auth0_subject = 'pactlab|<user id>'`
   and a lowercased `email`; then the organization and deal memberships.
3. Confirm the user receives a code at /login and lands only in that
   organization. Confirm an Auth0 user of another organization gets 404 on
   its deals.

### Revoking email-code sessions

Logout revokes immediately. To cut off a user, set their membership to
`SUSPENDED`/`REVOKED` (principal resolution then fails on the next request)
or set `revoked_at` on their `auth_sessions` rows. Rotating
`AUTH_TOKEN_SECRET` invalidates every email-code session at once.

**Status: gap.** The API validates Auth0-issued tokens and maps the
organization claim (`org_id`, Auth0 Organizations) to a Pactlab organization.
Web sign-in is not wired yet (`apps/web/lib/session.ts` returns no session),
and per-organization connection setup is operator-run in the Auth0 dashboard.
The follow-up is a web sign-in task plus an admin-facing SSO settings flow.

## Onboarding a pilot organization (operator)

1. In the Auth0 tenant for the target environment, create an Organization for
   the partner. Record its `org_…` id.
2. Add the partner's enterprise connection (SAML or OIDC) to that
   Organization. Use the partner's metadata; never paste their signing
   secrets into tickets.
3. Restrict the Organization to that connection — no database (password)
   connection for SSO organizations, so an IdP failure never falls back to a
   weaker login.
4. Create the Pactlab `organizations` row with `auth0_organization_id` set to
   the recorded id (one-off, through the reviewed admin procedure; no direct
   production SQL from laptops).
5. Have the partner admin call the API with their token; confirm it resolves
   to their organization only.
6. Confirm a user from another Auth0 Organization receives 403 on the
   partner's deals.

## Offboarding

Disable the Auth0 Organization's connection, then remove memberships. Tokens
expire at their TTL; record the time both steps completed.
