# ADR 0005 — GitHub access: Pactlab App by default, token fallback

- **Status:** Accepted (2026-10-09)
- **Builds on:** ADR 0004 (adapters only for source control), connector contract

## Context

Source control connects only through adapters. Sellers must grant read access
to selected repositories before signing, often under a security review, and
some cannot install third-party apps.

## Decision

1. **Default: a Pactlab-owned GitHub App** with repository permissions
   *Contents: read* and *Metadata: read*, no webhooks. The seller installs it
   on chosen repositories. Each request mints an RS256 app JWT (iat −60 s,
   exp ≤ 10 min), finds the repository's installation and requests an
   installation token narrowed to that repository and those permissions.
   Tokens live in memory for under an hour and are never stored.
2. **Fallback: a seller's fine-grained token** (one repository, Contents
   read-only), stored once through the `SecretStore` port under
   `secretref:<org>/<deal>/github/<connection>` and never returned, logged or
   audited (only `connection.credential_stored`).
3. **Secret store:** an AES-256-GCM local store (`LOCAL_SECRETS_*`) until
   Secrets Manager arrives with T-007; elsewhere the store is unavailable and
   token connections fail closed.
4. **Reads are metadata only:** repository, default branch, commit dates,
   author identity, line counts and paths (REST API version 2026-03-10).
   Never contents, diffs or archives. Sync evidence stays
   `code.repository_head`, citing the exact commit.
5. **Tests replay sanitized cassettes** recorded from the public
   `octocat/Hello-World`, with identities pseudonymized and a sanitizer test
   guarding every cassette; App token exchange is tested against a stub of
   the documented responses.
6. Repository names follow GitHub's owner rules and may not be `.` or `..`,
   so a configured repository can never walk the API URL path.

## Consequences

- Sellers can approve access the way their security team expects, and
  revoke it themselves.
- A real end-to-end App run needs the App registered (runbook) — tests cannot
  prove GitHub accepts Pactlab's JWT.
- Live clones for scans (scanner-orchestrator) remain fixture-only; they will
  use the same narrowed installation tokens.
