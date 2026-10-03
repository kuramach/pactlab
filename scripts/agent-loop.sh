#!/usr/bin/env bash
#
# agent-loop.sh — continuous scheduler. Keeps up to WORKERS Claude agents busy
# on tasks/ready/, honoring each task's Needs: and Touches: disjointness.
#
# Usage: WORKERS=2 POLL_SECS=60 MAX_ITERS=0 ./scripts/agent-loop.sh [--auto-merge]
#
# Task states: tasks/ready/ → tasks/active/ → tasks/review/ → tasks/done/
#                                                 └→ tasks/blocked/
# A task's Needs: are satisfied only by tasks/done/ (merged to main).
# In manual mode, merged review PRs are picked up by watch_reviews().
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WORKERS="${WORKERS:-2}"
POLL_SECS="${POLL_SECS:-60}"
MAX_ITERS="${MAX_ITERS:-0}"
AUTO_MERGE_FLAG=""
[[ "${1:-}" == "--auto-merge" ]] && AUTO_MERGE_FLAG="--auto-merge"

field() { grep -E "^$2:" "$1" | head -1 | sed "s/^$2:[[:space:]]*//"; }

needs_met() {
  local needs n
  needs="$(field "$1" Needs)"
  [[ -z "$needs" || "$needs" == "none" ]] && return 0
  for n in ${needs//,/ }; do
    [[ -f "tasks/done/$n.md" ]] || return 1
  done
  return 0
}

active_touches() {
  local f
  for f in tasks/active/*.md; do
    [[ -e "$f" ]] || continue
    field "$f" Touches
  done
}

touches_overlap() { # 0 = overlap (prefix match either direction)
  local x y
  for x in $1; do for y in $2; do
    [[ "$x" == "$y"* || "$y" == "$x"* ]] && return 0
  done; done
  return 1
}

claim_task() { # claim_task <id> — synchronous, so no double-claims
  local id="$1"
  git mv "tasks/ready/$id.md" "tasks/active/$id.md"
  git commit -qm "chore: claim $id"
  git push -q origin HEAD || echo "warn: claim push failed (offline?)"
}

watch_reviews() { # promote merged PRs: review/ → done/
  local f id state
  for f in tasks/review/*.md; do
    [[ -e "$f" ]] || continue
    id="$(basename "$f" .md)"
    state="$(gh pr view "agent/$id" --json state -q .state 2>/dev/null || echo OPEN)"
    if [[ "$state" == "MERGED" ]]; then
      git worktree remove --force "../pactlab-wt-$id" 2>/dev/null || true
      git pull -q --ff-only origin main 2>/dev/null || true
      git mv "$f" "tasks/done/$id.md"
      [[ -f "tasks/review/$id.log" ]] && git mv "tasks/review/$id.log" "tasks/done/$id.log" || true
      git commit -qm "chore: $id merged → done"
      git push -q origin HEAD || true
      echo "### $id merged → done"
    fi
  done
}

declare -a PIDS=()
running() {
  local n=0 p alive=()
  for p in ${PIDS[@]:-}; do
    if kill -0 "$p" 2>/dev/null; then alive+=("$p"); n=$((n+1)); fi
  done
  PIDS=("${alive[@]:-}")
  echo "$n"
}

iter=0
while true; do
  iter=$((iter+1))
  watch_reviews

  while [[ "$(running)" -lt "$WORKERS" ]]; do
    claimed=false
    AT="$(active_touches)"
    for f in tasks/ready/T-*.md; do
      [[ -e "$f" ]] || continue
      needs_met "$f" || continue
      T="$(field "$f" Touches)"
      touches_overlap "$T" "$AT" && continue
      id="$(basename "$f" .md)"
      echo "### claiming $id"
      claim_task "$id"
      # shellcheck disable=SC2086
      ./scripts/run-task.sh "$id" $AUTO_MERGE_FLAG &
      PIDS+=($!)
      claimed=true
      break
    done
    $claimed || break
  done

  ready_empty=true; ls tasks/ready/T-*.md >/dev/null 2>&1 || ready_empty=false
  active_empty=true; [[ -z "$(ls -A tasks/active 2>/dev/null)" ]] || active_empty=false
  review_empty=true; [[ -z "$(ls -A tasks/review 2>/dev/null)" ]] || review_empty=false

  if ! $ready_empty && $active_empty && [[ "$(running)" -eq 0 ]] && { $review_empty || [[ -n "$AUTO_MERGE_FLAG" ]]; }; then
    echo "### queue drained — all tasks finished"
    break
  fi
  if [[ "$MAX_ITERS" -gt 0 && "$iter" -ge "$MAX_ITERS" ]]; then
    echo "### max iterations reached ($MAX_ITERS)"
    break
  fi

  wait -n 2>/dev/null || sleep "$POLL_SECS"
done
