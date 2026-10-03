# Parallel & continuous operation runbook

How to keep multiple Claude agents building Pactlab around the clock, unattended.

## Where the loop runs

- **Recommended:** an EC2 box in the `pactlab-dev` AWS account, inside `tmux`
  (or a systemd unit), so it keeps running while you are away. Laptop works
  but sleep kills it.
- **Prerequisites on that box:** git, node 22, pnpm, `claude` CLI (authenticated),
  `gh` CLI (authenticated), and this repo pushed to GitHub with `main` as default.
- **Build target is local until T-007.** Everything through T-006 builds and
  tests on the loop box with Docker (Postgres/Redis). Agents never deploy to
  AWS; AWS account and environment setup is a T-007 activity, done by the
  operator — not by agents.

## Starter tasks — what runs first

`T-001` (foundation: monorepo, CI, RLS proof) runs **alone, first**. Nothing
parallels it; everything depends on it. Start the loop with:

```bash
./scripts/run-task.sh T-001
```

Once `T-001` is done, start the continuous loop:

```bash
WORKERS=2 ./scripts/agent-loop.sh
```

## Parallelization map

Increments are sequential **except** where noted. After `T-002` (deal/evidence
spine) lands, three lanes run concurrently:

```text
T-001 (foundation)                      ← alone, first
  └─ T-002 (deal/evidence spine)        ← alone, second
       ├─ T-003 (saas metrics) ──────┐
       ├─ T-004 (findings/tech) ─────┼─ T-005 (valuation, needs T-003+T-004)
       └─ T-006 (document ai) ───────┘
            └─ T-007 (pilot hardening, needs all)  ← alone, last
```

The scheduler (`scripts/agent-loop.sh`) enforces this automatically: a task only
starts when every task in its `Needs:` is in `tasks/done/`, and it never starts
two tasks whose `Touches:` paths overlap.

## Claim protocol

1. Task files live in `tasks/ready/`. One file per task, filename `<id>.md`.
2. The scheduler (or you, manually) claims by `git mv tasks/ready/<id>.md
   tasks/active/<id>.md`, committing and pushing the claim.
3. The worker gets a fresh git worktree at `../pactlab-wt-<id>` on branch
   `agent/<id>`. No two workers share a worktree or branch.
4. On success (checks green, branch pushed, PR opened): file moves to
   `tasks/review/`. On merge to `main` it moves to `tasks/done/` (the loop
   watches for this). On failure: `tasks/blocked/` with the log attached.

## Merge policy

- Workers open PRs; they never push to `main`.
- With `--auto-merge`, the loop squash-merges a PR only when: CI is green,
  and the diff touches **only** paths in the task's `Touches:` list.
- Without `--auto-merge` (default), PRs wait for your review. This is the
  recommended mode until the loop has earned trust.

## Monitoring

```bash
ls tasks/ready tasks/active tasks/done tasks/blocked  # queue state
gh pr list                                             # open agent PRs
git worktree list                                      # active workers
tail -f tasks/active/<id>.log                         # watch one worker
```

## Stopping

`pkill -f agent-loop.sh` — in-flight workers finish their current task and stop
taking new ones. To stop immediately: `pkill -f run-task.sh` too.

## Costs and safety

- Headless sessions bill to your Claude subscription/API usage. Keep `WORKERS`
  modest (2 is plenty to start).
- Unattended mode sets `CLAUDE_FLAGS=--dangerously-skip-permissions` so agents
  are not blocked on permission prompts. Scope this risk down via the
  `Touches:` discipline and PR review.
- Secrets never enter the repo. Agents use `.env` files that are git-ignored;
  only variable *names* go in `.env.example`.
- If a worker goes rogue (huge diff, files outside `Touches:`), close its PR,
  delete its worktree (`git worktree remove --force`), and move its task back
  to `tasks/ready/`.
