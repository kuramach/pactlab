# Pactlab Rinse

The seller's desktop bench (T-178, ADR 0058). The seller rinses the set, closes the gaps and uploads a finished folder with `pactlab-manifest.json`. The buyer connects that folder to the pact.

## Status (2026-11-27, first slice)

| Piece | State |
|---|---|
| Rinse engine: ingest (folders, zips, watch folder), deterministic checks, conversion audit, gap list, hand entry, readiness, manifest, folder destination | Built and tested (`apps/desktop`, `packages/domain/src/rinse`) |
| Offline: deterministic checks and conversion with the network off; AI steps queued on disk, run on reconnect, cached by SHA-256 | Built and tested |
| Pact side: manifest read at sync, files matched by SHA-256, seller classifications filed through intake, hand-sourced entries as labelled claims | Built and tested (`apps/api/src/documents/rinse-injection.api.test.ts`) |
| Rinse screens and the animated flask (reduced motion honoured) | Components built and tested; not yet bundled into the shell |
| Tauri 2 shell (`apps/desktop/src-tauri`) | **Scaffold only. Not compiled:** no Rust toolchain on the build machine |
| macOS (Apple Silicon, Intel), Windows and Linux installers | **Not produced** |
| Signing and notarization (Apple Developer ID, Windows code signing) | **Not set up.** No signing identities exist yet |
| Auto-update (Tauri updater) | Configured; the update signing key **is not generated** (the `pubkey` is a placeholder) |
| Bundled office-to-PDF and OCR tools | Converter seam built (`LocalToolConverter`, LibreOffice headless); **not bundled**, and fails closed (`TOOL_MISSING`) |
| Preparer accounts, prep invites, desktop sign-in, AI rinse job endpoint, hosted deal-room upload | T-178b |
| Download page `pactlab.ai/rinse` (all site locales), reading the release feed at build time; trademark-clearance entry | Built (T-178c). Shows "not published" until T-178b publishes a feed; see `website.md` |
| OneDrive / Google Drive / Box destinations; one-time folder import (injection path b); first-class provenance records | T-178d |

## Connecting a rinsed folder (pact side)

1. **Connect:** on the pact's Documents page, connect the folder the seller uploaded to, as for any drive (ADR 0038).
2. **Sync:** **Sync now** reads `pactlab-manifest.json` first. The page then lists who prepared the set, how many conversions were checked against originals, the gaps the seller noted, any source discrepancies, and the hand-sourced claims.
3. **What each file shows:**
   - *Handled by the manifest*: an original kept at the source, or a hand entry recorded as a claim.
   - *Refused*: added after the rinse, or changed since. Ask the seller to rinse again.
4. **Claims:** hand-sourced entries appear in **Claims** with the source "Hand-sourced — entered by … (Pactlab Rinse; not documentary evidence)". Verify them like any seller claim.

A fixture folder, `harbour-lane-rinsed`, is offered where fixture connections are allowed.

## When a manifest is refused
A manifest the schema refuses (malformed, with an unresolved error, or an open required gap) makes the sync say so. The files then come in as an ordinary folder. Ask the seller to rinse the set again in the current app.

## Releasing the app (when T-178b lands)
- **Builds:** in CI on macOS, Windows and Linux runners, never from a laptop.
- **Signing:** Apple Developer ID plus notarization; a Windows code-signing certificate; the Tauri updater key. The keys live in GitHub Environment secrets, never in the repo.
- **Published:** installers, SHA-256 checksums and release notes go to the download page. Record here which builds are signed and which are not.
