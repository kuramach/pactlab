#!/usr/bin/env bash
#
# imf-nightly.sh: the IMF DataMapper live check, run from this Mac. The IMF blocks GitHub's hosted
# runners (403 text/html to datacenter addresses, T-137), so the nightly check runs here instead.
# launchd runs it every night (install with scripts/imf-nightly-install.sh); it can also be run by hand.
#
# It checks out the latest main in its own worktree (../pactlab-nightly), so it never touches your
# checkout or the task loop's, and runs only the IMF live test. On failure: a macOS notification.
# Log: ~/Library/Logs/pactlab/imf-nightly.log
#
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$(dirname "$REPO")/pactlab-nightly"
LOG_DIR="$HOME/Library/Logs/pactlab"
LOG="$LOG_DIR/imf-nightly.log"
mkdir -p "$LOG_DIR"

notify() { osascript -e "display notification \"$1\" with title \"Pactlab IMF check\"" >/dev/null 2>&1 || true; }

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
  git -C "$REPO" fetch -q origin main || { echo "fetch failed (offline?)"; notify "Could not fetch main (offline?)"; exit 1; }
  if [[ ! -d "$WT" ]]; then git -C "$REPO" worktree add -q --detach "$WT" origin/main; fi
  git -C "$WT" checkout -q --detach origin/main
  echo "main at $(git -C "$WT" log --oneline -1)"
  (cd "$WT" && pnpm install --frozen-lockfile --silent) || { echo "pnpm install failed"; notify "pnpm install failed; see the log"; exit 1; }
  if (cd "$WT/packages/connectors" && INTEGRATION_LIVE=1 pnpm exec vitest run src/live/imf.live.test.ts); then
    echo "IMF check: OK"
  else
    echo "IMF check: FAILED"
    notify "IMF DataMapper live check failed; see ~/Library/Logs/pactlab/imf-nightly.log"
    exit 1
  fi
} >>"$LOG" 2>&1
