# Pactlab Rinse (`apps/desktop`)

*Rinse your deal documents clean before they go in the room.*

The seller's desktop bench (T-178, ADR 0058): drop the whole document set in, rinse it (convert, check, audit,
list the gaps), fix the gaps, and upload the finished folder with its `pactlab-manifest.json`.

- `src/engine/` — the rinse engine (Node): ingest, conversion, the conversion audit, the offline AI queue,
  hand-sourced entries, the manifest and the folder destination. Tested with `pnpm test`.
- `src/ui/` — the Rinse screens (React, `@pactlab/ui`), including the animated flask.
- `src-tauri/` — the Tauri 2 shell (macOS, Windows, Linux) with the updater.

What is built, what is not, and the signing status: `docs/runbooks/rinse.md`.
