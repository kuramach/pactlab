#!/usr/bin/env bash
#
# loop-autostart.sh — start the agent loop when Claude usage is available again.
# Run by launchd (scripts/launchd/ai.pactlab.loop.plist) every 30 minutes; safe to run by hand.
#
# Order: loop already running -> exit; git pull --ff-only; probe Claude; start the loop detached.
# The probe is a one-word headless call: at the usage limit it fails at once and costs nothing.
# It never touches tasks/ — only the loop claims or moves tasks.
#
# Tool paths come from ~/.config/pactlab/loop-autostart.env (written by loop-autostart-install.sh),
# because launchd's PATH is minimal. Env vars override the file (tests use this).
#
set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG="${LOOP_AUTOSTART_CONFIG:-$HOME/.config/pactlab/loop-autostart.env}"
# shellcheck disable=SC1090
[[ -f "$CONFIG" ]] && . "$CONFIG"

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
GIT_BIN="${GIT_BIN:-git}"
CAFFEINATE_BIN="${CAFFEINATE_BIN:-caffeinate}"
LOOP_SCRIPT="${LOOP_SCRIPT:-$REPO_ROOT/scripts/agent-loop.sh}"
LOOP_PGREP_PATTERN="${LOOP_PGREP_PATTERN:-agent-loop\\.sh}"
PROBE_TIMEOUT_SECS="${PROBE_TIMEOUT_SECS:-120}"
LOG_DIR="${LOOP_LOG_DIR:-$HOME/Library/Logs/pactlab-loop}"
LOG="$LOG_DIR/loop.log"
mkdir -p "$LOG_DIR"

log() { printf '%s loop-autostart: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

# Never two loops, including one that is running but idle.
if pgrep -f "$LOOP_PGREP_PATTERN" >/dev/null 2>&1; then
  exit 0
fi

cd "$REPO_ROOT" || { log "cannot cd to $REPO_ROOT"; exit 0; }

# Never force, stash or reset: a failed pull aborts the start.
if ! pull_out="$("$GIT_BIN" pull --ff-only 2>&1)"; then
  log "git pull --ff-only failed, not starting: $(printf '%s' "$pull_out" | tr '\n' ' ')"
  exit 0
fi

# Probe. perl alarm bounds a hung call (macOS has no timeout(1)).
if ! probe_out="$(perl -e 'alarm shift; exec @ARGV' "$PROBE_TIMEOUT_SECS" \
  "$CLAUDE_BIN" -p "Reply with the single word OK" ${CLAUDE_FLAGS:---dangerously-skip-permissions} 2>&1)"; then
  log "usage not available (probe failed): $(printf '%s' "$probe_out" | tr '\n' ' ' | cut -c1-200)"
  exit 0
fi

log "usage available; starting agent loop"
CLAUDE_FLAGS="${CLAUDE_FLAGS:---dangerously-skip-permissions}" \
  nohup "$CAFFEINATE_BIN" -i "$LOOP_SCRIPT" --auto-merge >>"$LOG" 2>&1 </dev/null &
disown 2>/dev/null || true
exit 0
