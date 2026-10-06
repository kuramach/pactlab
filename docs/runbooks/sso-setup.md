# SSO setup

## Choosing a sign-in method

Each organization uses exactly one method (`organizations.auth_method`,
ADR 0001):

- **AUTH0** (default) — Auth0 Organizations, including enterprise SAML/OIDC
  through Auth0. Follow "Onboarding a pilot organization" below.
- **EMAIL_CODE** — Pactlab emails a 6-digit one-time code; no Auth0. For
  organizations that do not want Auth0. No SSO and no MFA beyond the inbox.

### Self-serve sign-ups (ADR 0002)

New organizations from `/signup` wait for approval:

```bash
pnpm org:pending                 # who is waiting (owner, SSO requested?)
pnpm org:approve <slug>          # activates and emails the owner
pnpm org:reject <slug>           # suspends; nobody can enter it
```

With `OPERATOR_EMAIL` set you also get an email per sign-up containing the
approve command. Set `SIGNUP_REQUIRES_APPROVAL=false` to skip approval.

### Moving an organization to company SSO (Auth0)

When a signed-up organization asked for SSO (`sso_requested`):

1. In Auth0, create an Organization for them and add their enterprise
   connection (SAML/OIDC) from their metadata. Record its `org_…` id.
2. In one statement (the database rejects a half-switch):
   `UPDATE organizations SET auth_method = 'AUTH0', auth0_organization_id = '<org_…>' WHERE slug = '<slug>';`
3. Make sure each member's Pactlab user `auth0_subject` is their Auth0 user
   id (`auth0|…` or the connection's id) — email-code subjects
   (`pactlab|…`) do not carry over.
4. Members now use "Continue with Auth0 or company SSO"; email codes stop
   working for that organization.

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
