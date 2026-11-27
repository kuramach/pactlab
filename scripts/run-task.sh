#!/usr/bin/env bash
#
# run-task.sh — run ONE task end-to-end with a headless Claude agent:
#   claim → worktree → claude -p → checks → push branch → PR → review/done/blocked
#
# Usage: ./scripts/run-task.sh T-003 [--auto-merge]
#
# Task states: tasks/ready/ → tasks/active/ → tasks/review/ → tasks/done/
#                                                 └→ tasks/blocked/ (on failure)
# Every state change is a commit on the task's branch (agent/<T-ID>), never on main: the task starts
# from origin/main, main is merged in before the checks (a conflict blocks the task), and main records
# the task's state when its PR is merged. Logs and the last outcome stay local in tasks/.runs/.
#
set -euo pipefail

TASK_ID="${1:?usage: run-task.sh <TASK_ID> [--auto-merge]}"
AUTO_MERGE=false
[[ "${2:-}" == "--auto-merge" ]] && AUTO_MERGE=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ACTIVE="tasks/active/${TASK_ID}.md"
READY="tasks/ready/${TASK_ID}.md"

# --- start from GitHub's main, never a local copy that may have drifted (2026-11-25: a task branched from a
#     diverged local main carried copies of other tasks' commits into its PR). Nothing here commits to main:
#     the claim and every state change are commits on the task's own branch, so they arrive with its PR.
git fetch -q origin main
git pull -q --ff-only origin main || echo "warn: could not fast-forward local main (the task starts from origin/main regardless)"
if ! git cat-file -e "origin/main:$READY" 2>/dev/null && ! git cat-file -e "origin/main:$ACTIVE" 2>/dev/null; then
  echo "task not found in tasks/ready or tasks/active on origin/main: $TASK_ID"; exit 1
fi

# Logs and the run's outcome stay local (tasks/.runs is ignored): never committed to main.
RUNS="$REPO_ROOT/tasks/.runs"
mkdir -p "$RUNS"
LOG="$RUNS/${TASK_ID}.log"
: > "$LOG"
: > "${LOG%.log}.stream.log"

BRANCH="agent/$TASK_ID"
WT="$REPO_ROOT/../pactlab-wt-$TASK_ID"
git worktree remove --force "$WT" 2>/dev/null || true
git branch -D "$BRANCH" 2>/dev/null || true
# A run cut off by a usage limit pushed its unfinished work (WIP commit): carry on from it, on top of main.
git fetch -q origin "$BRANCH" 2>/dev/null || true
if git log -1 --format=%s "origin/$BRANCH" 2>/dev/null | grep -q '^WIP (usage limit)'; then
  git worktree add -B "$BRANCH" "$WT" "origin/$BRANCH" >>"$LOG" 2>&1
  (cd "$WT" && git merge -q --no-edit origin/main >>"$LOG" 2>&1) || echo "warn: could not merge main into the resumed work" | tee -a "$LOG"
  echo "resuming $TASK_ID from its unfinished work on origin/$BRANCH" | tee -a "$LOG"
  RESUMING=true
else
  git worktree add -B "$BRANCH" "$WT" origin/main >>"$LOG" 2>&1
fi

# --- claim, on the task's branch (no-op when resuming, or when the task is already in tasks/active) ---
if [[ -f "$WT/$READY" ]]; then
  # tasks/active may not exist on main (git keeps no empty folders once every task has moved on).
  (cd "$WT" && mkdir -p "$(dirname "$ACTIVE")" && git mv "$READY" "$ACTIVE" && git commit -qm "chore: claim $TASK_ID") >>"$LOG" 2>&1 \
    || { echo "### $TASK_ID: could not claim the task on its branch (see $LOG)" | tee -a "$LOG"; exit 1; }
fi
ACTIVE="$WT/$ACTIVE"

RESUMING="${RESUMING:-false}"

# --- context tier: CONTEXT_TIER env > task's Context: > standard ---
TIER="${CONTEXT_TIER:-$(grep -E '^Context:' "$ACTIVE" | head -1 | sed 's/^Context:[[:space:]]*//' || true)}"
TIER="${TIER:-standard}"
case "$TIER" in light|standard|deep) ;; *) echo "warn: unknown Context: '$TIER', using standard" | tee -a "$LOG"; TIER=standard ;; esac

# --- model routing: MODEL env > task's Model: > routed from the attempt's tier (see tasks/README.md) ---
TASK_MODEL="$(grep -E '^Model:' "$ACTIVE" | head -1 | sed 's/^Model:[[:space:]]*//' || true)"
case "$TASK_MODEL" in ""|haiku|sonnet|opus) ;; *) echo "warn: unknown Model: '$TASK_MODEL', ignoring" | tee -a "$LOG"; TASK_MODEL="" ;; esac

# --- engine: ENGINE env > task's Engine: > claude (see tasks/README.md "Engine split") ---
TASK_ENGINE="${ENGINE:-$(grep -E '^Engine:' "$ACTIVE" | head -1 | sed 's/^Engine:[[:space:]]*//' || true)}"
TASK_ENGINE="${TASK_ENGINE:-claude}"
case "$TASK_ENGINE" in claude|codex) ;; *) echo "warn: unknown Engine: '$TASK_ENGINE', using claude" | tee -a "$LOG"; TASK_ENGINE=claude ;; esac
next_tier() { case "$1" in light) echo standard ;; standard) echo deep ;; *) echo "" ;; esac; }

# No Checks: line must not kill the run (set -e + pipefail used to exit here silently, right after the worktree).
CHECKS="$(grep -E '^Checks:' "$ACTIVE" | head -1 | sed 's/^Checks:[[:space:]]*//' || true)"
CHECKS="${CHECKS:-pnpm lint && pnpm typecheck && pnpm test}"
CTX="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$CTX" "$OUT"' EXIT

run_attempt() { # run_attempt <tier> — build context, run the agent, install, check. Sets CHECKS_OK, STARVED.
  local tier="$1" core ctx_chars prompt
  ./scripts/context.sh "$ACTIVE" "$tier" "$WT" >"$CTX" 2> >(tee -a "$LOG" >&2)
  prompt="You are an engineer on the Pactlab repo, working in this worktree: $WT (branch $BRANCH).
CLAUDE.md at the repo root is loaded; follow it exactly, including the Autonomous multi-agent operation section.
Your task file is $ACTIVE — implement ONLY that task, touching ONLY its Touches: paths.
$($RESUMING && echo "An earlier run of this task was cut off by a usage limit; its unfinished work is already in this worktree (the last commit, WIP). Review it with git log and git diff origin/main, keep what is sound, and finish the task.")
Your context tier is $tier: the context below is what you start with. Open other docs only when the task needs them.
If missing context blocks you, print a line starting CONTEXT-STARVED: naming what you needed, then stop.
When finished: run the task's Checks:, commit your work on this branch, and push the branch to origin. Do NOT merge or touch main.
End with a plain report: files changed, each command run with its result, and anything unfinished.

$(cat "$CTX")"
  local model="${MODEL:-$TASK_MODEL}"
  if [[ -z "$model" ]]; then case "$tier" in light) model=haiku ;; deep) model=opus ;; *) model=sonnet ;; esac; fi
  core=$(wc -c <"$WT/CLAUDE.md" 2>/dev/null || echo 0)
  ctx_chars=$(printf '%s' "$prompt" | wc -c)
  # Initial context = always-loaded CLAUDE.md + this prompt; ~4 characters per token.
  echo "context: tier=$tier chars=$((core + ctx_chars)) claude_md=$core prompt=$ctx_chars approx_tokens=$(((core + ctx_chars) / 4))" | tee -a "$LOG"

  if [[ "$TASK_ENGINE" == "codex" ]]; then
    local cflag=""
    [[ -n "${CODEX_MODEL:-}" ]] && cflag="-m $CODEX_MODEL"
    echo "=== launching codex for $TASK_ID (tier $tier) ===" | tee -a "$LOG"
    # shellcheck disable=SC2086
    (cd "$WT" && codex exec --sandbox workspace-write -c approval_policy="never" $cflag ${CODEX_FLAGS:-} "$prompt" 2>&1 | tee "$OUT" | tee -a "$LOG") \
      || echo "warn: codex exited non-zero" | tee -a "$LOG"
  else
    echo "=== launching claude for $TASK_ID (tier $tier, model $model) ===" | tee -a "$LOG"
    # shellcheck disable=SC2086
    # stream-json shows progress as it happens (plain -p prints nothing until the very end, which looks
    # like a hang); the full stream goes to the log, one line per step to the terminal, the final text to $OUT.
    (cd "$WT" && claude -p "$prompt" --model "$model" --output-format stream-json --verbose ${CLAUDE_FLAGS:-} 2>&1 \
      | tee -a "${LOG%.log}.stream.log" \
      | jq -Rrj --unbuffered --arg id "$TASK_ID" '
          (fromjson? // empty) | if .type == "assistant" then (.message.content[]? | if .type == "tool_use" then "[\($id)] \(.name) \((.input.description // .input.file_path // .input.command // "") | tostring | .[0:100])\n" else empty end)
          elif .type == "result" then "\(.result // "")\n" else empty end' 2>/dev/null \
      | tee "$OUT" | tee -a "$LOG") \
      || echo "warn: claude exited non-zero" | tee -a "$LOG"
  fi
  STARVED="$(grep -m1 -E '^CONTEXT-STARVED:' "$OUT" || true)"

  # --- bring the branch up to date with main before checking, so the PR it opens merges cleanly ---
  MERGE_CONFLICT=false
  (cd "$WT" && git add -A && { git diff --cached --quiet || git commit -qm "$TASK_ID: agent work"; } \
    && git fetch -q origin main && git merge -q --no-edit origin/main) >>"$LOG" 2>&1 \
    || { (cd "$WT" && git merge --abort) >/dev/null 2>&1; MERGE_CONFLICT=true; echo "### $TASK_ID: conflicts with main (resolve on $BRANCH)" | tee -a "$LOG"; }

  # --- install deps before checks (agent may not have run it) ---
  echo "=== pnpm install ===" | tee -a "$LOG"
  (cd "$WT" && pnpm install 2>&1 | tee -a "$LOG") || echo "warn: pnpm install failed" | tee -a "$LOG"

  # --- checks ---
  CHECKS_OK=true
  if [[ -n "$CHECKS" ]]; then
    echo "=== checks: $CHECKS ===" | tee -a "$LOG"
    (cd "$WT" && bash -lc "$CHECKS" 2>&1 | tee -a "$LOG") || CHECKS_OK=false
  fi
  [[ -z "$STARVED" ]] || CHECKS_OK=false
  ! $MERGE_CONFLICT || CHECKS_OK=false
}

# A usage or spend limit is not the task's fault: hand the task back to ready and stop (exit 75), so
# the loop can stop too instead of marking every remaining task blocked.
usage_limited() { grep -qE '"api_error_status":429|hit your (monthly spend|usage|session) limit' "${LOG%.log}.stream.log" 2>/dev/null; }
release_on_limit() {
  usage_limited || return 0
  local when; when="$(grep -oE 'resets [^"]*' "${LOG%.log}.stream.log" | tail -1)"
  echo "### $TASK_ID: Claude usage limit reached${when:+ ($when)}; returned to ready" | tee -a "$LOG"
  # Keep what the agent did so far: commit it to the task branch and push, so the next run resumes from it.
  if (cd "$WT" && git add -A && git commit -qm "WIP (usage limit): $TASK_ID unfinished, resumed on the next run" && git push -q origin "$BRANCH") >>"$LOG" 2>&1; then
    echo "### unfinished work saved on origin/$BRANCH" | tee -a "$LOG"
  fi
  git worktree remove --force "$WT" 2>/dev/null || true
  # The task is still in tasks/ready on main: nothing to move back.
  echo ready > "$RUNS/$TASK_ID.state"
  exit 75
}

run_attempt "$TIER"
release_on_limit
# Guardrail: tiering never silently starves a task. One retry, one tier up,
# when checks fail or the agent reports CONTEXT-STARVED.
if ! $CHECKS_OK && [[ -n "$(next_tier "$TIER")" ]]; then
  UP="$(next_tier "$TIER")"
  echo "### context retry: $TIER -> $UP (${STARVED:-checks failed})" | tee -a "$LOG"
  TIER="$UP"
  run_attempt "$TIER"
  release_on_limit
fi

# --- backstop commit + push ---
(cd "$WT" && git add -A && git commit -qm "$TASK_ID: agent work" || true)
PUSHED=false
(cd "$WT" && git push -q -u origin "$BRANCH" 2>&1 | tee -a "$LOG") && PUSHED=true \
  || echo "warn: branch push failed" | tee -a "$LOG"

finish() { # finish <state> <id> — record the state on the task's branch (never on main) and push the branch
  local state="$1" id="$2"
  (cd "$WT" && mkdir -p "tasks/$state" && git mv "tasks/active/$id.md" "tasks/$state/$id.md" \
    && git commit -qm "chore: $id → $state" && git push -q origin "$BRANCH") >>"$LOG" 2>&1 || true
  echo "$state" > "$RUNS/$id.state"
}

if ! $CHECKS_OK; then
  echo "### $TASK_ID BLOCKED: checks failed" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi
# An agent that changed nothing (it stopped, e.g. on an unmerged prerequisite) never opens a PR: its report says why.
if [[ -z "$(cd "$WT" && git diff --name-only origin/main...HEAD -- . ':!tasks')" ]]; then
  echo "### $TASK_ID BLOCKED: the agent changed nothing (see its report in $LOG)" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi
if ! $PUSHED; then
  echo "### $TASK_ID BLOCKED: branch push failed" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi

# --- PR (retries on transient GitHub API failures) ---
TITLE="$(head -1 "$ACTIVE" | sed 's/^# //')"
TOUCHES="$(grep -E '^Touches:' "$ACTIVE" | head -1 | sed 's/^Touches:[[:space:]]*//')"
# The PR carries the task's move to review (on its branch), so main records it only when merged.
finish review "$TASK_ID"
PR_URL=""
for attempt in 1 2 3; do
  PR_URL="$(gh pr create --title "$TITLE" \
    --body "Agent-built. Task: tasks/review/$TASK_ID.md. Checks: \`$CHECKS\`" \
    --head "$BRANCH" 2>&1 | tee -a "$LOG" | grep -oE 'https://[^ ]+/pull/[0-9]+' | head -1)" || PR_URL=""
  if [[ -z "$PR_URL" ]]; then
    PR_URL="$(gh pr list --head "$BRANCH" --json url -q '.[0].url' 2>/dev/null)"
  fi
  [[ -n "$PR_URL" ]] && break
  echo "### PR create attempt $attempt failed; retrying in 15s..." | tee -a "$LOG"
  sleep 15
done
[[ -z "$PR_URL" ]] && { echo "### $TASK_ID BLOCKED: PR creation failed (branch $BRANCH is pushed)" | tee -a "$LOG"; echo blocked > "$RUNS/$TASK_ID.state"; exit 1; }
echo "### PR: $PR_URL" | tee -a "$LOG"

# --- merge (auto mode only, and only if the diff stays in scope) ---
if $AUTO_MERGE; then
  OUT_OF_SCOPE=false
  while read -r f; do
    [[ -z "$f" ]] && continue
    ok=false
    for t in $TOUCHES; do [[ "$f" == "$t"* ]] && ok=true; done
    # The task's own file (notes, diagnosis, outcome) is always in scope.
    [[ "$f" == tasks/*/"$TASK_ID".md ]] && ok=true
    $ok || { OUT_OF_SCOPE=true; echo "out of scope: $f" | tee -a "$LOG"; }
  done < <(git diff --name-only "origin/main...$BRANCH" 2>/dev/null || git diff --name-only "main...$BRANCH")

  if $OUT_OF_SCOPE; then
    echo "### $TASK_ID → review (diff left task scope; needs human)" | tee -a "$LOG"
    exit 0
  fi
  # Wait for CI to register and finish. "No checks reported" and pending are not failures: when
  # GitHub's queue is busy, CI can take well over ten minutes to start (T-168, 2026-11-26).
  CI_OK=false
  for _ in $(seq 1 240); do   # 240 × 30s = 2 hours
    sleep 30
    STATES="$(gh pr checks "$PR_URL" --json state --jq '.[].state' 2>/dev/null || true)"
    [[ -z "$STATES" ]] && continue
    grep -qvE '^(SUCCESS|SKIPPED|NEUTRAL)$' <<<"$STATES" || { CI_OK=true; break; }
    grep -qE '^(FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$' <<<"$STATES" && break
  done
  gh pr checks "$PR_URL" >>"$LOG" 2>&1 || true
  if $CI_OK; then
    if gh pr merge "$PR_URL" --squash --delete-branch >>"$LOG" 2>&1; then
      git worktree remove --force "$WT" 2>/dev/null || true
      git pull -q --ff-only origin main 2>/dev/null || true
      echo "### $TASK_ID DONE (merged; the task file moves to done in the next sweep)" | tee -a "$LOG"
      echo done > "$RUNS/$TASK_ID.state"; exit 0
    fi
  fi
  echo "### $TASK_ID BLOCKED: CI failed on $PR_URL" | tee -a "$LOG"
  echo blocked > "$RUNS/$TASK_ID.state"; exit 1
fi

echo "### $TASK_ID → review (awaiting merge: $PR_URL)" | tee -a "$LOG"
