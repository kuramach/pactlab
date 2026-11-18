#!/usr/bin/env bash
#
# run-tasks.sh — run the tasks you name, one after another, each end-to-end through run-task.sh
# (claim → worktree → agent → checks → PR → merge with --auto-merge). Keeps the Mac awake, keeps
# going when one task is blocked, and prints a summary at the end.
#
# Usage:
#   ./scripts/run-tasks.sh T-134 T-135 T-136            # PRs left for you to merge
#   ./scripts/run-tasks.sh --auto-merge T-134 T-135     # merge each once its CI is green
#   STOP_ON_BLOCK=1 ./scripts/run-tasks.sh ...          # stop at the first blocked task
#
# Agents run with CLAUDE_FLAGS (default: --dangerously-skip-permissions, so they never wait for a prompt).
# Progress: one line per agent step on screen; full logs in tasks/<state>/<T-ID>.log.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

AUTO_MERGE=""
TASKS=()
for arg in "$@"; do
  case "$arg" in
    --auto-merge) AUTO_MERGE="--auto-merge" ;;
    T-*) TASKS+=("$arg") ;;
    *) echo "unknown argument: $arg"; exit 2 ;;
  esac
done
[[ ${#TASKS[@]} -gt 0 ]] || { sed -n 3,14p "$0"; exit 2; }

export CLAUDE_FLAGS="${CLAUDE_FLAGS:---dangerously-skip-permissions}"
command -v jq >/dev/null || { echo "jq is needed (brew install jq)"; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not found"; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "gh is not signed in (gh auth login)"; exit 2; }

# Keep the Mac awake for as long as this script runs.
caffeinate -i -w $$ &

git pull -q --ff-only origin main || echo "warn: could not fast-forward main"

RESULTS=()
for id in "${TASKS[@]}"; do
  if git ls-files --error-unmatch "tasks/done/$id.md" >/dev/null 2>&1; then
    RESULTS+=("$id  skipped (already done)"); continue
  fi
  if [[ ! -f "tasks/ready/$id.md" && ! -f "tasks/active/$id.md" ]]; then
    RESULTS+=("$id  skipped (not in tasks/ready or tasks/active)"); continue
  fi
  echo
  echo "================ $id  ($(date '+%H:%M')) ================"
  start=$SECONDS
  ./scripts/run-task.sh "$id" $AUTO_MERGE
  code=$?
  mins=$(( (SECONDS - start) / 60 ))
  state="$(ls tasks/*/"$id".md 2>/dev/null | head -1 | cut -d/ -f2)"
  pr="$(gh pr list --head "agent/$id" --state all --json url -q '.[0].url' 2>/dev/null)"
  RESULTS+=("$id  ${state:-?}  ${mins}m  ${pr:-no PR}")
  if [[ $code -ne 0 && -n "${STOP_ON_BLOCK:-}" ]]; then echo "stopping: $id did not finish"; break; fi
  git pull -q --ff-only origin main || true
done

echo
echo "================ summary ================"
printf '%s\n' "${RESULTS[@]}"
