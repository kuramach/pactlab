# ADR 0002 — Self-serve sign-up with email codes and operator approval

- **Status:** Accepted (2026-10-07)
- **Builds on:** ADR 0001 (per-organization sign-in)

## Context

The website links "Sign up"; organizations were created only by hand. The
company is small, so the option chosen must be the easiest to operate while
keeping confidential deal data away from unvetted sign-ups during pilots.

## Decision

1. Sign-up is self-serve and creates an **email-code** organization: the
   organization, its user and an `ORG_OWNER` membership are created in one
   transaction only when the emailed code verifies. Work addresses only.
2. New organizations are **`PENDING_APPROVAL`** and cannot be entered by any
   sign-in method until an operator runs `pnpm org:approve <slug>`
   (`org:reject` suspends). `SIGNUP_REQUIRES_APPROVAL=false` makes new
   organizations active at once.
3. **Company SSO (Auth0) is on request**: a sign-up checkbox records it; an
   operator links the Auth0 Organization later (runbook). Pactlab holds no
   Auth0 Management API credential.
4. Sign-up state, like login state, is reachable only through SECURITY
   DEFINER functions owned by `pactlab_auth`, whose INSERT rights are limited
   by policy to what sign-up creates.
5. Only `ACTIVE` organizations can be entered — enforced in principal
   resolution and in the email-code functions, so suspension takes effect on
   the next request.

## Consequences

- One manual step per new organization while approval is on.
- Organizations that need SSO wait for an operator; until then their owner
  can use codes.
- Operator commands run as the schema owner, like `pnpm seed`.
