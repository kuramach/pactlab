#!/usr/bin/env bash
#
# run-task.sh — run ONE task end-to-end with a headless Claude agent:
#   claim → worktree → claude -p → checks → push branch → PR → review/done/blocked
#
# Usage: ./scripts/run-task.sh T-003 [--auto-merge]
#
# Task states: tasks/ready/ → tasks/active/ → tasks/review/ → tasks/done/
#                                                 └→ tasks/blocked/ (on failure)
#
set -euo pipefail

TASK_ID="${1:?usage: run-task.sh <TASK_ID> [--auto-merge]}"
AUTO_MERGE=false
[[ "${2:-}" == "--auto-merge" ]] && AUTO_MERGE=true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ACTIVE="tasks/active/${TASK_ID}.md"
READY="tasks/ready/${TASK_ID}.md"

# --- claim (no-op if the scheduler already claimed it) ---
if [[ -f "$READY" ]]; then
  git mv "$READY" "$ACTIVE"
  git commit -qm "chore: claim $TASK_ID"
  git push -q origin HEAD || echo "warn: claim push failed (offline?)"
elif [[ ! -f "$ACTIVE" ]]; then
  echo "task not found: $TASK_ID"; exit 1
fi

LOG="$REPO_ROOT/tasks/active/${TASK_ID}.log"
: > "$LOG"

BRANCH="agent/$TASK_ID"
WT="$REPO_ROOT/../pactlab-wt-$TASK_ID"
git worktree remove --force "$WT" 2>/dev/null || true
git branch -D "$BRANCH" 2>/dev/null || true
git worktree add -B "$BRANCH" "$WT" HEAD >>"$LOG" 2>&1

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

CHECKS="$(grep -E '^Checks:' "$ACTIVE" | head -1 | sed 's/^Checks:[[:space:]]*//')"
CTX="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$CTX" "$OUT"' EXIT

run_attempt() { # run_attempt <tier> — build context, run the agent, install, check. Sets CHECKS_OK, STARVED.
  local tier="$1" core ctx_chars prompt
  ./scripts/context.sh "$ACTIVE" "$tier" "$REPO_ROOT" >"$CTX" 2> >(tee -a "$LOG" >&2)
  prompt="You are an engineer on the Pactlab repo, working in this worktree: $WT (branch $BRANCH).
CLAUDE.md at the repo root is loaded; follow it exactly, including the Autonomous multi-agent operation section.
Your task file is $ACTIVE — implement ONLY that task, touching ONLY its Touches: paths.
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
    (cd "$WT" && codex exec --sandbox workspace-write --ask-for-approval never $cflag ${CODEX_FLAGS:-} "$prompt" 2>&1 | tee "$OUT" | tee -a "$LOG") \
      || echo "warn: codex exited non-zero" | tee -a "$LOG"
  else
    echo "=== launching claude for $TASK_ID (tier $tier, model $model) ===" | tee -a "$LOG"
    # shellcheck disable=SC2086
    (cd "$WT" && claude -p "$prompt" --model "$model" ${CLAUDE_FLAGS:-} 2>&1 | tee "$OUT" | tee -a "$LOG") \
      || echo "warn: claude exited non-zero" | tee -a "$LOG"
  fi
  STARVED="$(grep -m1 -E '^CONTEXT-STARVED:' "$OUT" || true)"

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
}

run_attempt "$TIER"
# Guardrail: tiering never silently starves a task. One retry, one tier up,
# when checks fail or the agent reports CONTEXT-STARVED.
if ! $CHECKS_OK && [[ -n "$(next_tier "$TIER")" ]]; then
  UP="$(next_tier "$TIER")"
  echo "### context retry: $TIER -> $UP (${STARVED:-checks failed})" | tee -a "$LOG"
  TIER="$UP"
  run_attempt "$TIER"
fi

# --- backstop commit + push ---
(cd "$WT" && git add -A && git commit -qm "$TASK_ID: agent work" || true)
PUSHED=false
(cd "$WT" && git push -q -u origin "$BRANCH" 2>&1 | tee -a "$LOG") && PUSHED=true \
  || echo "warn: branch push failed" | tee -a "$LOG"

finish() { # finish <state> — move task file, commit, push
  local state="$1" id="$2"
  git mv "tasks/active/$id.md" "tasks/$state/$id.md"
  if [[ -f "tasks/active/$id.log" ]]; then git add -f -q "tasks/active/$id.log" 2>/dev/null || true; git mv "tasks/active/$id.log" "tasks/$state/$id.log" || true; fi
  git commit -qm "chore: $id → $state"
  git push -q origin HEAD || true
}

if ! $CHECKS_OK; then
  echo "### $TASK_ID BLOCKED: checks failed" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi
if ! $PUSHED; then
  echo "### $TASK_ID BLOCKED: branch push failed" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi

# --- PR (retries on transient GitHub API failures) ---
TITLE="$(head -1 "$ACTIVE" | sed 's/^# //')"
PR_URL=""
for attempt in 1 2 3; do
  PR_URL="$(gh pr create --title "$TITLE" \
    --body "Agent-built. Task: $ACTIVE. Checks: \`$CHECKS\`" \
    --head "$BRANCH" 2>&1 | tee -a "$LOG" | grep -oE 'https://[^ ]+/pull/[0-9]+' | head -1)" || PR_URL=""
  if [[ -z "$PR_URL" ]]; then
    PR_URL="$(gh pr list --head "$BRANCH" --json url -q '.[0].url' 2>/dev/null)"
  fi
  [[ -n "$PR_URL" ]] && break
  echo "### PR create attempt $attempt failed; retrying in 15s..." | tee -a "$LOG"
  sleep 15
done
[[ -z "$PR_URL" ]] && { echo "### $TASK_ID BLOCKED: PR creation failed" | tee -a "$LOG"; finish blocked "$TASK_ID"; exit 1; }
echo "### PR: $PR_URL" | tee -a "$LOG"

# --- merge (auto mode only, and only if the diff stays in scope) ---
if $AUTO_MERGE; then
  TOUCHES="$(grep -E '^Touches:' "$ACTIVE" | head -1 | sed 's/^Touches:[[:space:]]*//')"
  OUT_OF_SCOPE=false
  while read -r f; do
    [[ -z "$f" ]] && continue
    ok=false
    for t in $TOUCHES; do [[ "$f" == "$t"* ]] && ok=true; done
    $ok || { OUT_OF_SCOPE=true; echo "out of scope: $f" | tee -a "$LOG"; }
  done < <(git diff --name-only "origin/main...$BRANCH" 2>/dev/null || git diff --name-only "main...$BRANCH")

  if $OUT_OF_SCOPE; then
    echo "### $TASK_ID → review (diff left task scope; needs human)" | tee -a "$LOG"
    finish review "$TASK_ID"; exit 0
  fi
  if gh pr checks "$PR_URL" --watch --interval 30 >>"$LOG" 2>&1; then
    if gh pr merge "$PR_URL" --squash --delete-branch >>"$LOG" 2>&1; then
      git worktree remove --force "$WT" 2>/dev/null || true
      git pull -q --ff-only origin main 2>/dev/null || true
      echo "### $TASK_ID DONE (merged)" | tee -a "$LOG"
      finish done "$TASK_ID"; exit 0
    fi
  fi
  echo "### $TASK_ID BLOCKED: CI failed on $PR_URL" | tee -a "$LOG"
  finish blocked "$TASK_ID"; exit 1
fi

echo "### $TASK_ID → review (awaiting merge: $PR_URL)" | tee -a "$LOG"
finish review "$TASK_ID"
