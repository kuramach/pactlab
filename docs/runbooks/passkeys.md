# Passkeys (T-108, ADR 0023)

- **Users:** passkeys are managed under Settings → Sign-in. The email code always works as a fallback.
- **Lost device:** the user signs in with an email code and removes the passkey in Settings. If they can't, an operator revokes it as the schema owner:
  `UPDATE user_passkeys SET revoked_at = now() WHERE user_id = '<user id>' AND revoked_at IS NULL;`
- **Audit:** events `login.passkey_added`, `_removed`, `_succeeded` and `_failed`. A `_failed` event with DENIED usually means a counter went backwards, which suggests a possibly cloned key.
- **"Sign in again to add":** adding a passkey needs an email-code sign-in within the last 15 minutes. This is by design.
- **New environment:** set `WEBAUTHN_RP_ID` only if passkeys must bind to a host other than the web origin's host. Never change it on a live environment: doing so invalidates every passkey.
