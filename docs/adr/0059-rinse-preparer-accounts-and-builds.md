# ADR 0059: Pactlab Rinse: preparer accounts, prep invites, desktop sign-in, AI jobs and signed builds (T-178b)

**Status:** accepted (2026-11-27), with Kumar's decisions recorded at the end. Where the plan below differs from them, the decisions win.

## Context
- T-178 shipped the rinse engine, the manifest and the injection at sync (ADR 0058). The manifest already has `set.preparedBy` and `set.intendedPact`, but today the desktop fills both in itself. Nothing on the server checks either one.
- T-178b asks for seven things: a preparer account, a prep invite, desktop sign-in, AI rinse jobs, a hosted deal-room destination, the bundled shell, and signed builds in CI.
- What this repository can't do today:
  - Sessions always live in an organization. `resolvePrincipal`, `app_auth_session_*` and every RLS policy key on `app.organization_id`.
  - `ai_runs` needs a deal: its composite foreign key is (organization, deal). ADR 0057 (help chat) ran into the same wall and deferred it to T-185.
  - The build machine has no Rust toolchain, LibreOffice or Tesseract, and no signing identity exists. CI builds and signing therefore can't be checked here.

## Proposed decision (for approval)

1. **A preparer is a user with a preparer workspace, not a new kind of session.**
   - **Sign-up:** preparer sign-up (`POST /v1/rinse/signup`, email code or passkey) creates the user plus a one-person organization, `created_via = PREPARER` (a new `organization_origin` value). The organization is ACTIVE at once (no operator approval) and has billing turned off.
   - **Why:** sessions, step-up, passkeys, trusted devices and RLS all work unchanged.
   - **Access:** the workspace holds no pacts. Creating a deal is refused for `PREPARER` organizations, in the service and in the `deals` insert policy.
   - **Becoming a customer:** a preparer who later becomes a customer signs up normally. A workspace is never upgraded in place.
2. **A prep invite is not a deal invitation.**
   - **Table:** `rinse_prep_invites`, created from the pact by the buyer side with `DEAL_WRITE`. It holds org, deal, email, a token hash, an expiry and a status, and follows the ADR 0014 token rules: 32 random bytes, SHA-256 at rest, 14 days, single use.
   - **The link:** it deep-links to `pactlab.ai/rinse?invite=…` (the page itself is T-178c). It is also shown as a QR code, which reuses no new UI pattern until one is approved.
   - **Accepting:** this creates or signs in the preparer and writes `rinse_preparer_bindings` (preparer user, org, deal, invite, bound at, revoked at).
   - **What a binding gives:** the right to have a manifest accepted for that pact, and the AI metering scope. It gives **no** deal membership and no read access.
   - **Who reads bindings:**
     - the pact's own side, in `rinse_prep_invites` and the bindings table;
     - the preparer, through a SECURITY DEFINER view of their own bindings: pact name and inviting organization only.
3. **The binding is attested, not just written by the desktop.**
   - **The token:** on sign-in the API issues a binding attestation. It is an Ed25519-signed token over set id, preparer user id, org, deal and binding id. The key is a new platform secret.
   - **In the manifest:** the manifest carries the attestation. That is a schema change to `pactlab-rinse-manifest` **version 2**, and version 1 stays readable.
   - **At sync:** sync verifies the signature and that the binding is live. A manifest bound to another pact is refused, and so is a forged or revoked attestation. An unbound v1/v2 manifest is still accepted, labelled "preparer not verified".
4. **Desktop sign-in.**
   - **Login:** the shell signs in through the OAuth 2.1 device or authorization-code flow that ADR 0024 already runs. It is a new protected resource, `<origin>/v1/rinse`, with scope `rinse:prep`, and the token is refused everywhere else.
   - **Offline:** the refresh token is kept in the OS keychain (Tauri `stronghold` or the platform keyring; the plugin is chosen when it's verified). The cached session lets the app open offline, and the `AiQueue` holds AI steps and uploads until the app is signed in and online.
5. **AI rinse jobs.**
   - **Endpoints:** `POST /v1/rinse/ai/classify` and `POST /v1/rinse/ai/vision`, behind the `rinse:prep` token, through the existing gateway: job types `classification` and `vision`, the ADR 0034 terms gate, and the people-data classification check before any call.
   - **Rate limit:** per preparer account, plus a daily page cap.
   - **Metering:** this needs `ai_runs` rows without a deal. The proposal is an expand-only `rinse_ai_runs` table (preparer org, optional bound deal, job type, provider, model, tokens, status; never content). It is metered in Hosting cost under the bound pact's organization, or under the preparer workspace when unbound.
   - `HttpRinseAiClient` implements the existing `RinseAiClient` against these endpoints.
6. **The shell and its sidecars** (one PR, verified on CI runners, not locally):
   - Vite bundles the renderer into `apps/desktop/dist`.
   - The engine is a Node single-executable sidecar (Tauri `externalBin`).
   - LibreOffice (headless) and Tesseract are downloaded per target at build time, pinned by version and SHA-256.
7. **Builds** (`.github/workflows/rinse-desktop.yml`, dispatched by a person):
   - **Platforms:** a matrix of macos-14 (arm64), macos-13 (x64), windows-2022 and ubuntu-24.04.
   - **Signing:** Apple Developer ID plus notarization, Windows code signing, and the Tauri updater key, all from a GitHub Environment `rinse-release`.
   - **Unsigned builds:** each step is skipped when its secret is absent, and the artifact is then labelled unsigned. The runbook records exactly what was signed.

## Conflicts and decisions that need Kumar (why the task is blocked)
1. **"Upload to a Pactlab-hosted deal room" conflicts with ADR 0016** ("Pactlab is not a data room") **and ADR 0058 decision 9** ("Destinations are the seller's own … Pactlab needs no write access to anyone's cloud"). It also conflicts with item 1 of this brief: a preparer who uploads into the pact has write access to it.
   - **Options:**
     - (a) drop it;
     - (b) upload into the bound pact as SHARED documents through a preparer-scoped intake endpoint that writes and never reads, with ADR 0016 amended;
     - (c) a Pactlab-hosted holding folder per binding, which the buyer connects like any source.
   - **Recommendation:** (b), with an ADR 0016 amendment.
2. **Paid dependencies** (CLAUDE.md: ask first):
   - Apple Developer Program, about $99 a year;
   - a Windows code-signing certificate, or Azure Trusted Signing, which is billed monthly.
   - Neither identity exists, and agents can't create them.
3. **Bundling LibreOffice and Tesseract** adds roughly 300–400 MB per installer and brings their licences (MPL-2.0 and Apache-2.0) into the distribution. Confirm both. The alternative is to have the seller install LibreOffice and keep the current `TOOL_MISSING` fail-closed behaviour.
4. **Who pays for a preparer's AI:** the inviting organization (metered to the pact), or Pactlab, which would be free and capped. And should unbound preparers get AI at all?
5. **The manifest attestation** (decision 3) bumps the manifest schema to version 2 and adds a platform signing key. Confirm it, or accept a desktop-asserted binding that the server cross-checks only against live bindings.

## Consequences (once approved)
- **Migrations:** expand-only. One enum value, three tables (`rinse_prep_invites`, `rinse_preparer_bindings`, `rinse_ai_runs`) and their SECURITY DEFINER functions. Rollback is dropping them.
- **Slicing:** each part is its own PR. The order is schema and auth (1–3), then desktop sign-in and AI (4–5), then shell and builds (6–7). Destination work waits for conflict 1.


## Kumar's decisions (2026-11-27)
1. **Destination: the seller's own storage only** (Google Drive, OneDrive, Dropbox, Box). There's no Pactlab-hosted deal room; ADR 0016 stands. The pact reads the finished folder through the existing read-only sync.
2. **Signing:**
   - **macOS:** the Apple Developer Program ($99 a year), with Developer ID signing and notarization.
   - **Windows:** **Azure Artifact Signing, Basic plan ($9.99 a month)**, not a purchased certificate. The Windows build calls it from CI, through Tauri's custom sign command; check the current Tauri and Microsoft docs before wiring it. The publisher name is the organization's verified legal name.
   - Kumar subscribes to both. The agent prepares the CI wiring, the secrets list and a short setup script, and records what is signed honestly in `docs/runbooks/rinse.md` until the identities exist.
3. **Converters: bundled on the machine.** LibreOffice (Office to PDF) and Tesseract (OCR) ship inside the installer, so nothing leaves the seller's machine until upload and it works offline.
   - **Licences:** MPL-2.0 and Apache-2.0, carried in the app's licence notices.
   - **Bedrock:** classifies and flags gaps only; it never converts or transcribes, because AI never reads values (ADR 0042).
4. **Cost: there's no separate Rinse billing.** This also settles the `ai_runs` foreign-key wall in Context: every Rinse AI job has a deal, so it fits the existing (organization, deal) key. Rinse works only on a pact that already exists, and the pact is paid for when it's created, by the seller or the buyer. A preparer's AI jobs are counted against that pact, like any other AI work on it, with no free allowance and no separate meter.
