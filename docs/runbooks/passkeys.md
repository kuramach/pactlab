# Passkeys (T-108, ADR 0023)

- **Users:** passkeys are managed under Settings → Sign-in. The email code always works as a fallback.
- **Lost device:** the user signs in with an email code and removes the passkey in Settings. If they can't, an operator revokes it as the schema owner:
  `UPDATE user_passkeys SET revoked_at = now() WHERE user_id = '<user id>' AND revoked_at IS NULL;`
- **Audit:** events `login.passkey_added`, `_removed`, `_succeeded` and `_failed`. A `_failed` event with DENIED usually means a counter went backwards, which suggests a possibly cloned key.
- **"Sign in again to add":** adding a passkey needs an email-code sign-in within the last 15 minutes. This is by design.
- **New environment:** set `WEBAUTHN_RP_ID` only if passkeys must bind to a host other than the web origin's host. Never change it on a live environment: doing so invalidates every passkey.

## Trusted devices and session limits (T-112, ADR 0027)
- **Users:** Settings → Signed-in devices lists every live session. Each can be ended there, or all the others at once with "End all other sessions".
- **Lost or shared device:** the person ends its session from another device. If they can't, an operator ends all of their sessions as the schema owner:
  `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = '<user id>' AND revoked_at IS NULL;`
  This takes effect on their next request.
- **Organization limit:** owners and admins set it in Settings (Off, 1 day, 1 week or 30 days; the default is 1 week). Lowering it ends longer sessions at once. Audited as `organization.session_policy_changed`.
- **Why it asks to sign in again:** sensitive actions (invitations, DocuSign, connecting an AI assistant, billing, deleting a pact, the session limit) need a sign-in under 8 hours old, even on a trusted device (`RECENT_SIGN_IN_REQUIRED`). This is by design.
- **Audit:** `session.trusted`, `session.revoked`, `session.revoked_others`.
