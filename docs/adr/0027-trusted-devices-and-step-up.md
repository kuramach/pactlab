# ADR 0027: Trusted devices, session limits and step-up for sensitive actions (T-112)

**Status:** accepted (Kumar, 2026-11-09)

## Context
- **The problem:** every email-code or passkey sign-in opened a fixed 8-hour session, so people signed in again every working day, even on their own laptop.
- **The request** (Kumar): "allow for a login session to stay longer on a Trusted machine … 1 day or 1 week … on trusted machines only."
- **Kumar's choices:**
  - **Lengths:** 8 hours (default), 1 day, 1 week or 30 days.
  - **Admin cap:** organization admins may cap the length or turn it off.
  - **Idle timeout:** 24 hours.
  - **Device list:** with sign-out.
  - **Step-up:** sensitive actions need a sign-in under 8 hours old.

## Decision
- **Opt-in per sign-in:** the sign-in page asks "Stay signed in on this device?". The default is "No, 8 hours".
  - **Trust function:** a trusted choice calls `app_auth_session_trust`. It is a `pactlab_auth` SECURITY DEFINER function, allowed once and only within 2 minutes of signing in, so it cannot extend an old or stolen session.
  - **Clamp:** the expiry is `signed_in_at + least(chosen, 30 days, organization cap)`.
- **Organization cap:** `organizations.trusted_session_max_hours` is 0 (off: 8 hours), 24, 168 (the default) or 720.
  - **Who sets it:** owners and admins, in Settings. The existing `organizations_admin_update` RLS policy checks the role again. Audited as `organization.session_policy_changed`.
  - **Live sessions:** the cap is checked on every request, so lowering it ends longer sessions at once.
  - **Moving organizations:** moving a session into another organization clamps it to that organization's cap.
- **Checked on every request:** `app_auth_session_check` replaces `app_auth_session_active` (which stays for rolling deploys). A trusted session also needs:
  - use within the last 24 hours (`last_seen_at`, written at most every 5 minutes);
  - to be within the current cap.

  It returns `signed_in_at`. Revocation already took effect on the next request; that is unchanged.
- **Real sign-in time:** `auth_sessions.signed_in_at` is kept when a session moves between organizations. It replaces the `expires_at - 8 hours` derivation the passkey "recent sign-in" check used.
- **Step-up:** `@RecentSignIn()` routes refuse a Pactlab session whose sign-in is more than 8 hours old, with **422 `RECENT_SIGN_IN_REQUIRED`**. 422 is the API's rule-failure status; passkeys use `REAUTH_REQUIRED` for their own 15-minute rule. The routes are:
  - inviting people (pact and bidder invitations) and adding members;
  - DocuSign connect;
  - OAuth consent for AI assistants;
  - billing checkout and portal, and creating promo codes;
  - deleting a pact;
  - changing the session limit.

  The web sends the person to `/login?reauth=1&returnTo=…` and retires the old session after the new sign-in. Auth0 sessions follow the identity provider's rules.
- **Devices:** Settings → Signed-in devices lists the person's live sessions: a readable label such as "Chrome on macOS" (derived from the user agent by the web app), whether the device is trusted, sign-in time, last activity and expiry.
  - **Actions:** "End session" and "End all other sessions", audited as `session.revoked` and `session.revoked_others`.
  - **Not stored:** the raw user agent and IP addresses.
- **Ended sessions in the browser:** when the API stops accepting a session cookie (ended elsewhere, idle, or past a lowered cap), the app clears the cookie through `/login/ended` and says the person was signed out.

## Consequences
- **Migration:** `20261202000000_trusted_sessions` is expand-only. Rollback: drop the new functions and columns, and restore the previous `app_auth_session_rescope` and `app_passkey_account` bodies.
- **Exposure:** a stolen cookie from a trusted device is usable for longer. This is bounded by the 24-hour idle rule, the cap, step-up on sensitive actions, and "End all other sessions". The cookie is httpOnly, Secure and SameSite=Lax.
