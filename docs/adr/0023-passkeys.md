# ADR 0023: Passkeys for email-code sign-in (T-108)

**Status:** accepted (Kumar, 2026-11-07)

## Context
Email-code organizations sign in only with a 6-digit emailed code. Kumar wanted a faster, stronger option. Auth0 (T-104) will serve SSO organizations later; email-code organizations keep Pactlab's own sign-in permanently.

## Decision
- **WebAuthn passkeys** via `@simplewebauthn/server` and `@simplewebauthn/browser` (v14, MIT, no service).
- **Relying party:** the web host per environment (`WEBAUTHN_RP_ID`, else `APP_WEB_ORIGIN`'s host). The expected origin is `APP_WEB_ORIGIN`.
- **Credential settings:** discoverable credentials, user verification required, attestation `none`.
- **Storage:** `user_passkeys` holds only public keys, at most 10 per user. `passkey_challenges` are single-use and expire after 5 minutes.
- **Access:** both tables are reached only through `pactlab_auth` SECURITY DEFINER functions, which take the session id rather than a user id.
- **Adding** needs a sign-in within 15 minutes. The sign-in time is measured from the session's expiry, which survives an organization switch.
- **Signing in** opens the same 8-hour session as an email code. Only email-code organizations are reachable this way.
  - A counter that goes backwards is refused and audited.
  - All sign-in failures return a uniform 401.
- **Notices:** a security email goes out on every passkey added or removed. Audit events: `login.passkey_added`, `login.passkey_removed`, `login.passkey_succeeded`, `login.passkey_failed`.
- **Fallback:** the email code always works. There is no owner policy to require passkeys yet.
- **Offer:** a one-time offer appears after an email sign-in. "Not now" is stored in `users.passkey_offer_dismissed_at`.

## Consequences
- Passkeys don't carry across environments (each environment is its own relying party).
- An organization that moves to Auth0 stops using Pactlab passkeys, just as it stops using email codes.
- Rollback: the migration is expand-only. Hiding the web buttons disables the feature; the stored rows are harmless.
