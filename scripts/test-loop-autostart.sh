#!/usr/bin/env bash
# test-loop-autostart.sh — behaviour tests for loop-autostart.sh using stubbed claude and loop.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'pkill -f "$T/" 2>/dev/null; rm -rf "$T"' EXIT
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }

# A throwaway git repo with a remote so `git pull --ff-only` succeeds.
git init -q --bare "$T/remote.git"
git clone -q "$T/remote.git" "$T/repo" 2>/dev/null
git -C "$T/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$T/repo" push -q origin HEAD 2>/dev/null

mkdir -p "$T/bin"
printf '#!/bin/sh\necho OK\n' >"$T/bin/claude-ok"
printf '#!/bin/sh\necho "usage limit reached" >&2; exit 1\n' >"$T/bin/claude-fail"
printf '#!/bin/sh\necho started >> "%s/started"; sleep 30\n' "$T" >"$T/bin/loopx-agent.sh"
printf '#!/bin/sh\nshift; exec "$@"\n' >"$T/bin/caffeinate"
chmod +x "$T"/bin/*

run() { # run <claude stub>
  REPO_ROOT="$T/repo" LOOP_AUTOSTART_CONFIG=/nonexistent LOOP_LOG_DIR="$T/logs" \
  CLAUDE_BIN="$T/bin/$1" CAFFEINATE_BIN="$T/bin/caffeinate" LOOP_SCRIPT="$T/bin/loopx-agent.sh" \
  LOOP_PGREP_PATTERN="$T/bin/loopx-agent\\.sh" bash "$HERE/loop-autostart.sh"
}

run claude-fail; sleep 1
check "failing probe exits 0, starts nothing" "[[ ! -e $T/started ]]"
check "failing probe is logged" "grep -q 'probe failed' $T/logs/loop.log"

run claude-ok; sleep 1
check "usage available starts the loop" "[[ -e $T/started ]]"

: >"$T/started"
run claude-ok; sleep 1
check "loop running (idle) -> second start refused" "[[ ! -s $T/started ]]"
pkill -f "$T/bin/loopx-agent" ; sleep 1

# Diverge: a commit on the remote from a second clone, plus a different local commit.
git clone -q "$T/remote.git" "$T/other" 2>/dev/null
git -C "$T/other" -c user.name=t -c user.email=t@t commit -q --allow-empty -m remote-side
git -C "$T/other" push -q origin HEAD 2>/dev/null
git -C "$T/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m local-side
: >"$T/started"
run claude-ok; sleep 1
check "failed git pull aborts start and logs why" "[[ ! -s $T/started ]] && grep -q 'git pull' $T/logs/loop.log"

[[ $fails -eq 0 ]] && echo "all passed" || { echo "$fails failed"; exit 1; }
