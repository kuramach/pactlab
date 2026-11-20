# ADR 0036: Signing behind a provider seam, BoldSign first; the signing provider per organization (T-136)

**Status:** accepted (Kumar, 2026-11-17/18). Builds on ADR 0022 (two-sided close, e-signature) and ADR 0030 (letter of intent).

## Context
- **The ask** (Kumar, 2026-11-16): parties sign without leaving the Pactlab workflow. Integrate best-in-class signing; do not build it.
- **Pricing changed the plan** (2026-11-18):
  - DocuSign embedded signing for our customers is ISV licensing, sold by sales, and account-level Connect sits in its $480/mo tier.
  - BoldSign (Syncfusion) covers embedded signing and webhooks on pay-as-you-go: $30/mo with 40 envelopes, then $0.75 each, with no go-live review.
- **So:** a provider seam, as T-132 did for AI. BoldSign is the launch adapter, and DocuSign waits until an enterprise customer justifies the ISV path.
- **Before:** T-107 sent from the buyer organization's own DocuSign when connected, and the fixture otherwise.

## Decision
- **One contract** (`packages/connectors/src/signing/types.ts`), with no provider types beyond it:
  - create an envelope from a pact document;
  - read its status (the polling fallback);
  - open an embedded signing session for one signer (`null` when the provider has none);
  - fetch the signed document and the certificate of completion.

  **Webhooks** have their own small contract: verify the raw body, recognise the endpoint check, and reduce the event to `{ eventId, envelopeId, status, reason }`.
- **Contract tests** (`signing.test.ts`) run the same suite against the fixture, BoldSign and DocuSign. `SIGNING_PROVIDERS` (a `satisfies Record<…>` registry) says which adapters embed.
- **Provider-neutral documents.** Every PDF prints `signHereMarker(n)` (`{{sign|n|*}}`) in white where signer n signs:
  - BoldSign reads it as its text tag;
  - DocuSign finds it as an anchor string.
- **Statuses:** SENT → DELIVERED (opened) → COMPLETED, DECLINED, EXPIRED or VOIDED, with the provider's reason where it gives one.
- **Status is pact state, idempotently.**
  - **Recording:** every observation goes through `app_signing_event` (SECURITY DEFINER), keyed by the provider's event id. A second delivery changes nothing, and status only moves forward.
  - **Settling:** a settled envelope settles its letter of intent or agreed terms as before. An expired one expires its letter, so the exclusivity clock never starts.
  - **Timeline:** `signing_envelope_events` is the envelope's timeline (APP, WEBHOOK or POLL), shown on the LOI and Closing pages. Each change is also audited on the deal's chain.
- **Webhooks first, polling as fallback.**
  - **BoldSign:** `POST /v1/webhooks/signing/boldsign`, verified against `X-BoldSign-Signature` (`t=…, s0=…`: hex HMAC-SHA256 of `t.body`, 5 minutes of skew; `Verification` pings are answered 200). DocuSign Connect uses the same path.
  - **Polling:** when a pact's signing state is read, each open envelope is asked at most once a minute, so a missed webhook never leaves a silent state.
- **Signed artifacts are the legal record.**
  - **Storage:** on completion, the signed PDF and the certificate are stored byte-for-byte under `<org>/<deal>/signing/<envelope>/`. `signing_artifacts` records them (write-once, immutable), and every download re-checks the SHA-256.
  - **Not intake documents:** they are not fed to document intake or AI. A signed legal artifact is evidence of the signature, not material to analyse (the same principle as T-089's original-file rule).
- **Embedded signing for guests.**
  - **Identity:** the signer is signed in to Pactlab, so a guest's emailed code is their identity. Pactlab checks they are the envelope's named signatory before asking BoldSign for a 10-minute signing link, and the session runs in a frame on the pact.
  - **Emails:** BoldSign's own emails are off (`DisableEmails`).
- **Signing provider per organization** (`organizations.signing_provider`):
  - **Choices:** `PACTLAB` (the default) or `DOCUSIGN` (only once its own DocuSign is connected). Owners and admins change it, enforced by row security and the service, and audited.
  - **Envelopes in flight** finish on the provider they were sent with. A disconnected DocuSign falls back to Pactlab signing for new envelopes, and Settings and Closing say so.
  - **Migration:** organizations already connected to DocuSign were moved to `DOCUSIGN`, so nothing changes for them.
- **Config:**
  - `SIGNING_PROVIDER` lists Pactlab signing's adapters in order: `boldsign`, then `fixture` (never in production).
  - BoldSign reads `BOLDSIGN_API_KEY`, `BOLDSIGN_API_BASE_URL` (default `https://api.boldsign.com`) and `BOLDSIGN_WEBHOOK_SECRET`.
  - **Test recipients:** until `BOLDSIGN_PRODUCTION_SENDING=true` (the later, separate go), `SIGNING_TEST_RECIPIENTS` is required, and every envelope from any adapter goes only to those addresses or domains. Anything else is refused before the provider is called.
  - **Deployed:** the three values are Secrets Manager secrets created `unset`, set by `scripts/signing-key.sh`.

## Consequences
- **Live testing:** live uses the BoldSign **sandbox** account until the production go, with test recipients only. Swapping in the production key is the separate go.
- **DocuSign:** it stays the organization's own account, signed from DocuSign's email (no embedded session) until the ISV path is justified. Its webhook has no event id, so `event:envelope` is the deduplication key.
- **Polling runs when a page is read.** A pact nobody opens converges on the next read. A worker sweep is a follow-up (apps/worker was outside this task).
- **Not verified from the documentation:** BoldSign's formal status enum. Statuses are matched loosely. The live smoke test confirms the text-tag field placement.
- **Rollback:** the migration is expand-only (see its header). Setting `SIGNING_PROVIDER=fixture` (or the key back to `unset`) turns BoldSign off.
