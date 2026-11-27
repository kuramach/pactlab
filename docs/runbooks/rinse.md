# Pactlab Rinse

The seller's desktop bench (T-178, ADR 0058). The seller rinses the set, closes the gaps and uploads a finished folder with `pactlab-manifest.json`. The buyer connects that folder to the pact.

## Status (2026-11-27, after T-178e)

| Piece | State |
|---|---|
| Rinse engine: ingest (folders, zips, watch folder), deterministic checks, conversion audit, gap list, hand entry, readiness, manifest, folder destination | Built and tested (`apps/desktop`, `packages/domain/src/rinse`) |
| Offline: deterministic checks and conversion with the network off; AI steps queued on disk, run on reconnect, cached by SHA-256 | Built and tested |
| Pact side: manifest read at sync, files matched by SHA-256, seller classifications filed through intake, hand-sourced entries as HAND_SOURCED claims | Built and tested (`apps/api/src/documents/rinse-injection.api.test.ts`) |
| Rinse screens and the animated flask (reduced motion honoured) | Built, tested and bundled into the window (T-178e) |
| Tauri 2 shell (`apps/desktop/src-tauri`) | Configured with the engine sidecar, bundled resources, the shell and deep-link (`pactlab-rinse://`) plugins (T-178b). **Not compiled:** no Rust toolchain on the build machine |
| Engine sidecar (`src/engine/sidecar.ts`, `bench.ts`, `scripts/build-sidecar.mjs`) | Built and tested: one JSON request per line; sign-in, session status, sign-out, the AI queue, and the bench (T-178e): open a folder, rinse, add a file for a gap, exclude, re-run, note a gap, hand entry, write the finished folder, sign in to and upload to the seller's own drive. The bundle was built and answered requests locally |
| The window (`src/ui/main.tsx`, `app.tsx`, `scripts/build-renderer.mjs`) | Built and tested (T-178e): sign-in from the prep invite (name and company stamped on the set), set-up (pact, company type, currency), the bench (rinse with the flask at work, review queue, gap list, hand entry, notes), write the folder or upload to the seller's drive. Tailwind with the Pactlab tokens. Talks only to the sidecar, through Tauri's injected globals (`withGlobalTauri`); the folder and file pickers are the dialog plugin. **Not run inside a compiled shell here:** no Rust toolchain on this machine |
| macOS (Apple Silicon, Intel), Windows and Linux installers | Workflow `rinse-desktop` written (T-178b). **Not produced:** never run (it stops at the window step) |
| Signing and notarization (Apple Developer ID, Windows via Azure Artifact Signing) | Wired in the workflow, each step only when its identity is configured; each build writes `SIGNING.json`. **Nothing is signed:** the Apple Developer Program membership and the Azure Artifact Signing account do not exist yet (Kumar subscribes; then `apps/desktop/scripts/rinse-signing-setup.sh`) |
| Licence notices | `THIRD-PARTY-NOTICES.md` ships in the app's resources, with each bundled converter's own licence files under `vendor/notices/` and the bundles' library notices (T-178e) |
| Release feed (`pactlab-rinse-releases` v1) | Built by every `rinse-desktop` run (`scripts/release-feed.mjs`, tested), from the builds' `SHA256SUMS.txt` and `SIGNING.json`; each asset `signed: false` unless its build was code-signed. Published with the installers only when the run is dispatched with `publish` |
| Auto-update (Tauri updater) | Configured; the key is passed at build time (`RINSE_UPDATER_PUBKEY`, `TAURI_SIGNING_PRIVATE_KEY`). **Not generated yet:** without it the workflow builds no updater artifacts |
| Bundled office-to-PDF and OCR tools (LibreOffice MPL-2.0, Tesseract Apache-2.0; decision 3) | The app uses them when present (`BundledConverter`, T-178e): LibreOffice for office files, Tesseract for images, the deterministic writer for Word, PDF and text either way. The fetch script verifies the pinned SHA-256, unpacks .dmg, .msi and the Linux .deb tarball with the platform's own tools, and copies each tool's own licence files into the app's notices. **Not pinned, so not bundled:** LibreOffice's URLs and checksums could not be fetched or verified from the build environment (no network), so none was entered; Tesseract publishes source only, so it needs a CI build from source. See "Pinning the converters" |
| Preparer accounts, prep invites, desktop sign-in (cached for offline use), AI rinse jobs (classification, vision), the sync refusing a set bound to another pact | Built and tested (T-178b: `packages/db/src/rinse-preparers.test.ts`, `apps/api/src/rinse/preparer.api.test.ts`, `apps/desktop/src/engine/pactlab.test.ts`, `sidecar.test.ts`). The session sits in an owner-only file, not yet the OS keychain. No Pactlab-hosted deal room: uploads go to the seller's own storage (decision 1) |
| Download page `pactlab.ai/rinse` (all site locales), trademark-clearance entry | Built (T-178c, `apps/site/views/rinse.tsx`). Shows the empty state until a release feed is set; see "The download page". "Pactlab Rinse" is on `docs/runbooks/trademark-clearance.md`, **not cleared** |
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
1. **Dispatch** the `rinse-desktop` workflow from GitHub (Actions → rinse-desktop → Run workflow), never from a laptop. Leave **publish** off for a trial build. It builds on GitHub's runners: macOS Apple Silicon (`macos-15`), macOS Intel (`macos-15-intel`), Windows (`windows-2022`), Linux (`ubuntu-24.04`).
2. **Check each build's artifact** (`pactlab-rinse-<target>`): the installers, `SIGNING.json` (code-signed, notarized, updater-signed, converters bundled) and `SHA256SUMS.txt`. The `pactlab-rinse-releases` artifact holds `releases.json`, the feed, and every checksum.
3. **Try an unsigned build** on each platform before publishing: on macOS, right-click the app → **Open** → **Open** (Gatekeeper warns that the developer cannot be verified); on Windows, SmartScreen's **More info → Run anyway**; on Linux, `chmod +x` the AppImage. Sign in with a prep invite and rinse a test folder with the network off.
4. **Publish:** dispatch again with **publish** on. The run creates the GitHub prerelease `rinse-v<version>` (from `src-tauri/tauri.conf.json`) with the installers (spaces in names become hyphens), `releases.json`, `SHA256SUMS.txt` and each build's `SIGNING-<target>.json`.
5. **Point the site at the feed:** set the site's build setting `RINSE_RELEASES_URL` to `https://github.com/kuramach/pactlab/releases/download/rinse-v<version>/releases.json` and rebuild the site (`docs/runbooks/website.md`). The page then lists the release, each installer marked unsigned. A new version needs a new feed that also carries the earlier releases you want listed.
6. **Bump the version** in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` (and `RINSE_APP_VERSION`) before the next release; a tag that exists is refused.

- **Signing (ADR 0059 decision 2):** builds are **unsigned** until Kumar's Apple Developer ID ($99 a year, then notarization) and Azure Artifact Signing (Basic, $9.99 a month, called by `trusted-signing-cli` as Tauri's `bundle.windows.signCommand`) exist. Load them into the `rinse-release` GitHub Environment with `apps/desktop/scripts/rinse-signing-setup.sh`; they never enter the repo. Check the current Tauri and Microsoft docs for the sign command before the first signed run. Once signed, the hardened runtime applies `src-tauri/Entitlements.plist` (JIT for the Node engine; library validation off for the bundled converters).
- **Updater:** no updater keys are generated by agents. Kumar generates them with `rinse-signing-setup.sh`; until then the workflow builds no updater artifacts and the app does not update itself.
- **Drives:** register the Rinse app as a public client with Microsoft and Google (see "Cloud destinations"), then set `RINSE_ONEDRIVE_CLIENT_ID` and `RINSE_GOOGLE_CLIENT_ID` as variables in the `rinse-release` environment. Until then the window says a drive is not registered and offers the folder.
- **What is signed today:** nothing. Nothing has been published.

## Pinning the converters
Each entry in `apps/desktop/converters.lock.json` needs a URL from the project's own release page or download mirror and the SHA-256 the project publishes for that exact file. Invent nothing; an entry left `null` is simply not bundled.
- **LibreOffice:** from https://www.libreoffice.org/download/download-libreoffice/ (files on download.documentfoundation.org): the macOS `.dmg` for aarch64 and for x86-64, the Windows x86-64 `.msi`, and the Linux x86-64 `.deb` tarball, all the same version. Check each file's SHA-256 against the checksum the download site publishes for it, then enter `version`, `url` and `sha256`.
- **Tesseract:** the project's own releases (https://github.com/tesseract-ocr/tesseract/releases) are source only; the binaries its documentation points to (Homebrew, UB Mannheim, Linux distributions) are third parties'. Bundling it means a CI job that builds it from a pinned source release (and its `tessdata` language files from https://github.com/tesseract-ocr/tessdata_fast) per target: a follow-up task.
- After pinning, run the workflow: each build's `SIGNING.json` (`converters`) and the app's `vendor/BUNDLED.json` record what was bundled; a converter whose archive carries no licence file fails the build.
- Size: LibreOffice adds roughly 300–400 MB to each installer (ADR 0059).

## The download page (`pactlab.ai/rinse`, T-178c)
- **Source of releases:** the site reads the release feed at build time from `RINSE_RELEASES_URL` (a build setting, not a secret). With no address, a failed fetch or a feed that fails its schema, the page says "The installers are not published yet". It never shows a placeholder link.
- **Feed contract** (`apps/site/lib/rinse.ts`, schema `pactlab-rinse-releases` version 1): releases with `version`, `publishedAt`, `notes[]` and `assets[]`; each asset has `platform` (`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`), an https `url`, a lower-case `sha256`, `signed`, and optionally `sizeBytes` and `minimumOs`. T-178b's release job must publish exactly this, then rebuild the site. Each platform shows its newest installer, with its SHA-256 and whether it is signed.
- **Claims on the page** are limited to what T-178 and ADR 0058 ship: on-machine reading, conversion and checks; the audit against the original; the expected-input checklist; hand entries labelled not documentary evidence; AI jobs only when online and signed in. Cloud destinations are not mentioned until they are live-tested. Limits quoted (200 MB a file; 500 files and 500 MB unpacked) come from `apps/desktop/src/engine`. Change the page when those change.
- **Minimum OS versions** are not invented: each release states its own in the feed.
- **Languages:** de, fr and ja catalogs carry the page (machine translation; the native review in `site-translations.md` covers it). Release notes stay in English.
- **Deep links:** prep invites (T-178b) link to `https://pactlab.ai/rinse#download`.
