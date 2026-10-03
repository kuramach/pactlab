# Pactlab — continuous agent-built development

This repo is built by parallel Claude agents, coordinated by the task queue in
`tasks/` and the scheduler in `scripts/`. Humans review PRs; agents do the rest.

**Start here:** `CLAUDE.md` (engineering rules) → `docs/spec/` (full spec) →
`docs/PARALLEL_OPS.md` (the runbook: starter tasks, parallel map, monitoring).

## Quickstart

Prerequisites on the machine that runs the loop: git, node 22, pnpm,
`claude` CLI (authenticated), `gh` CLI (authenticated).

```bash
# 1. Push this repo to GitHub (main branch)
git remote add origin git@github.com:<you>/pactlab.git
git push -u origin main

# 2. Run the first task alone (foundation — everything depends on it)
./scripts/run-task.sh T-001

# 3. Start the continuous loop (2 parallel workers)
WORKERS=2 ./scripts/agent-loop.sh
# Unattended: export CLAUDE_FLAGS=--dangerously-skip-permissions first
# (see docs/PARALLEL_OPS.md for what this means).
# Auto-merge green, in-scope PRs: ./scripts/agent-loop.sh --auto-merge
```

## Where to run it

An EC2 box in the `pactlab-dev` AWS account, inside `tmux` — so it keeps
building while you are out. Your laptop works too, but sleep kills the loop.

```bash
tmux new -s pactlab
WORKERS=2 ./scripts/agent-loop.sh --auto-merge
# detach: Ctrl-b d — it keeps running
```

## Watching it

```bash
ls tasks/ready tasks/active tasks/review tasks/done tasks/blocked
gh pr list
git worktree list
```

PRs land on GitHub — review and merge from your phone. In `--auto-merge`
mode the loop merges PRs itself when CI is green and the diff stays inside
the task's declared scope.

## Smoke test first

Before leaving it alone for hours, run one task with one worker and a cap:

```bash
WORKERS=1 MAX_ITERS=1 ./scripts/agent-loop.sh
```

If that claims, builds, PRs, and merges cleanly, the loop is trustworthy.
