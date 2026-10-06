# ADR 0001 — Per-organization sign-in: Auth0 or emailed one-time code

- **Status:** Accepted (2026-10-06)
- **Supersedes:** "Identity: Auth0" for every organization (settled stack, CLAUDE.md)

## Context

Some customer organizations do not want Auth0 in their sign-in path. Pactlab
must still serve them without weakening tenant isolation, and without
building a password system.

## Decision

1. Each organization has exactly one sign-in method,
   `organizations.auth_method`: `AUTH0` (default; includes Auth0-brokered
   enterprise SSO) or `EMAIL_CODE` (Pactlab-native emailed 6-digit code).
2. Every verified token carries its issuer. Principal resolution only
   matches organizations whose method equals the issuer: an email-code
   session can never enter an Auth0 organization, and vice versa. A
   database CHECK ties `auth0_organization_id` to `auth_method = 'AUTH0'`.
3. Email-code sign-in: random 6-digit code, 10-minute expiry, single use,
   5 attempts, newest code only; ≤5 codes per address and ≤20 per client
   address per 15 minutes. Only an HMAC of the code (keyed by
   `AUTH_TOKEN_SECRET`, bound to the address) is stored. Responses never
   reveal whether an address exists or can sign in this way.
4. Sessions are server-side (`auth_sessions`, 8 hours). The API issues HS256
   tokens naming the session; every request re-checks it, so logout and
   revocation are immediate.
5. Login state is reachable only through `SECURITY DEFINER` functions owned
   by the no-login role `pactlab_auth` (column-limited grants, explicit
   policies). The runtime role has no table privileges on it.
6. Auth0 is optional per deployment, all-or-nothing in configuration;
   without it, Auth0 sign-in is disabled (never open).

## Consequences

- Pactlab now operates an authentication factor: email delivery, rate
  limits, session revocation and the token secret are ours to run.
  Rotating `AUTH_TOKEN_SECRET` signs out every email-code session.
- Email-code organizations get no MFA beyond inbox possession, and no SSO;
  organizations that need either stay on Auth0.
- `users.auth0_subject` now also holds `pactlab|<user id>` subjects; a later
  contract migration renames it to `identity_subject`.
- Deployed email delivery (SES) is a follow-up; until then codes are only
  delivered locally (`LOCAL_MAIL_DIR`).
