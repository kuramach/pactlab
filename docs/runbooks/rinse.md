# Pactlab Rinse

The seller's desktop bench (T-178, ADR 0058). The seller rinses the set, closes the gaps and uploads a finished folder with `pactlab-manifest.json`. The buyer connects that folder to the pact.

## Status (2026-11-27, after T-178b)

| Piece | State |
|---|---|
| Rinse engine: ingest (folders, zips, watch folder), deterministic checks, conversion audit, gap list, hand entry, readiness, manifest, folder destination | Built and tested (`apps/desktop`, `packages/domain/src/rinse`) |
| Offline: deterministic checks and conversion with the network off; AI steps queued on disk, run on reconnect, cached by SHA-256 | Built and tested |
| Pact side: manifest read at sync, files matched by SHA-256, seller classifications filed through intake, hand-sourced entries as HAND_SOURCED claims | Built and tested (`apps/api/src/documents/rinse-injection.api.test.ts`) |
| Rinse screens and the animated flask (reduced motion honoured) | Components built and tested; not yet bundled into the shell |
| Tauri 2 shell (`apps/desktop/src-tauri`) | Configured with the engine sidecar, bundled resources, the shell and deep-link (`pactlab-rinse://`) plugins (T-178b). **Not compiled:** no Rust toolchain on the build machine |
| Engine sidecar (`src/engine/sidecar.ts`, `scripts/build-sidecar.mjs`) | Built and tested: one JSON request per line; sign-in, session status, sign-out and the AI queue. The bundle was built and answered a status request locally |
| The window (`src/ui/main.tsx`, `scripts/build-renderer.mjs`) | **Not built.** The screens exist but are not yet wired to the sidecar; the build script and the workflow stop here on purpose, so no installer ships an empty window |
| macOS (Apple Silicon, Intel), Windows and Linux installers | Workflow `rinse-desktop` written (T-178b). **Not produced:** never run (it stops at the window step) |
| Signing and notarization (Apple Developer ID, Windows via Azure Artifact Signing) | Wired in the workflow, each step only when its identity is configured; each build writes `SIGNING.json`. **Nothing is signed:** the Apple Developer Program membership and the Azure Artifact Signing account do not exist yet (Kumar subscribes; then `apps/desktop/scripts/rinse-signing-setup.sh`) |
| Auto-update (Tauri updater) | Configured; the key is passed at build time (`RINSE_UPDATER_PUBKEY`, `TAURI_SIGNING_PRIVATE_KEY`). **Not generated yet:** without it the workflow builds no updater artifacts |
| Bundled office-to-PDF and OCR tools (LibreOffice MPL-2.0, Tesseract Apache-2.0; decision 3) | Fetch-and-verify script and paths built (`scripts/fetch-converters.mjs`, `bundledTools`). **Not bundled:** `converters.lock.json` has no pinned release URLs or SHA-256s yet; until it does, builds record `null` in `SIGNING.json` and the app fails closed (`TOOL_MISSING`) |
| Preparer accounts, prep invites, desktop sign-in (cached for offline use), AI rinse jobs (classification, vision), the sync refusing a set bound to another pact | Built and tested (T-178b: `packages/db/src/rinse-preparers.test.ts`, `apps/api/src/rinse/preparer.api.test.ts`, `apps/desktop/src/engine/pactlab.test.ts`, `sidecar.test.ts`). The session sits in an owner-only file, not yet the OS keychain. No Pactlab-hosted deal room: uploads go to the seller's own storage (decision 1) |
| Download page `pactlab.ai/rinse` (all site locales), trademark-clearance entry | T-178c |
| Cloud destinations: OneDrive (Graph, app folder), Google Drive (`drive.file`), Box, through the seller's own PKCE sign-in | Engine and screen built and tested against stand-ins of each API (`apps/desktop/src/engine/cloud.test.ts`). **Not run against a live account:** the Rinse app's own OAuth registrations with Microsoft, Google and Box do not exist yet, and the loopback listener and keychain live in the uncompiled shell. Box uploads over 50 MB are refused (its chunked upload is not built) |
| One-time zip import (injection path b), `POST /v1/deals/:id/rinse-archives` | Built and tested |
| First-class provenance: `document_provenance` per document, `rinse_sets` per manifest (gap notes, source discrepancies); discrepancies drafted as cited findings | Built and tested (`packages/db/src/rinse-provenance.test.ts`, the API test above) |

## Connecting a rinsed folder (pact side)

1. **Connect:** on the pact's Documents page, connect the folder the seller uploaded to, as for any drive (ADR 0038).
2. **Sync:** **Sync now** reads `pactlab-manifest.json` first. The page then lists who prepared the set, how many conversions were checked against originals, the gaps the seller noted, any source discrepancies, and the hand-sourced claims.
3. **What each file shows:**
   - *Handled by the manifest*: an original kept at the source, or a hand entry recorded as a claim.
   - *Refused*: added after the rinse, or changed since. Ask the seller to rinse again.
4. **Claims:** hand-sourced entries appear in **Claims** marked **Hand-sourced** (origin `HAND_SOURCED`), with the source "Hand-sourced — entered by … (Pactlab Rinse; not documentary evidence)". Verify them like any seller claim. A finding linked to one shows **Rests on a hand-sourced claim**.
5. **Provenance:** open a document to see where it came from: the seller's original (path and SHA-256), the conversion audit, the checks and the conversion steps. A finding's document citations name the original too.
6. **Source discrepancies:** an original that does not foot is stored on its set and drafted as a finding citing the page (direction 0) on the deal team's sync or import. A person decides what it means. **Sets finished in Pactlab Rinse** on the Documents page lists each set's noted gaps and links the drafts.

## Importing a rinsed set once (no connected folder)
On the Documents page, **Sets finished in Pactlab Rinse → Import the set** takes one zip of the finished folder with `pactlab-manifest.json` at its top (or inside one top folder, as a zipped folder is). The same checks as a sync apply: a file the manifest does not name, or one changed since the rinse, is refused. A seller's import is always shared with the deal; the deal team chooses. Bounds as zip intake: 10 MB, 200 files, 100 MB unpacked.

## Cloud destinations (seller side)
The seller signs in to their own OneDrive, Google Drive or Box in the app. It is not their Pactlab login, and the token never leaves their machine or reaches Pactlab. The set goes into a new folder (OneDrive: Apps/Pactlab Rinse; Google Drive: My Drive; Box: All Files). The buyer then connects that folder to the pact as any drive. Before this works live, register the Rinse app as a public client with each provider (loopback redirect, scopes: `Files.ReadWrite.AppFolder offline_access`; `drive.file`; Box: read and write). Box's token endpoint needs the app's client secret even with PKCE, which a desktop app cannot keep confidential: accept that risk or leave Box off until Box offers a public client.

A fixture folder, `harbour-lane-rinsed`, is offered where fixture connections are allowed.

## When a manifest is refused
A manifest the schema refuses (malformed, with an unresolved error, or an open required gap) makes the sync say so. The files then come in as an ordinary folder. Ask the seller to rinse the set again in the current app.

## Inviting a preparer (pact side)
On the pact's Documents page, **Sets finished in Pactlab Rinse → Preparers**: enter the preparer's email and **Invite a preparer**. The link (`https://pactlab.ai/rinse?invite=…`) is emailed and shown once; it works once, for 14 days, for that address only. The preparer's free account is bound to this pact and sees nothing of it. Their AI steps count against this pact. **End binding** refuses their sets and AI steps from then on; a set prepared under another pact's invite is refused at sync or import (`RINSE_MANIFEST_OTHER_PACT`).

## Releasing the app
- **Builds:** dispatch the `rinse-desktop` workflow (macOS Apple Silicon and Intel, Windows, Linux runners), never from a laptop. It needs `src/ui/main.tsx` first; until then it stops at the window step.
- **Signing (ADR 0059 decision 2):** Apple Developer ID plus notarization ($99 a year); Windows through Azure Artifact Signing, Basic ($9.99 a month), called by `trusted-signing-cli` as Tauri's `bundle.windows.signCommand`; the Tauri updater key. Check the current Tauri and Microsoft docs for the sign command before the first signed run. Load the identities into the `rinse-release` GitHub Environment with `apps/desktop/scripts/rinse-signing-setup.sh`; they never enter the repo.
- **Converters:** pin LibreOffice and Tesseract per target in `apps/desktop/converters.lock.json` from each project's own release page, with the SHA-256 the build checks.
- **What is signed:** each build's `SIGNING.json` (code-signed, notarized, updater-signed, converters bundled) and `SHA256SUMS.txt` sit beside its installers. Today: **nothing has been built or signed.**
- **Published:** installers, SHA-256 checksums and release notes go to the download page (T-178c).
