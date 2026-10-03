# Task queue

One file per task. The scheduler reads the header fields; everything below
`## Brief` is the agent's instructions.

## Header fields

```text
Status: ready
Needs: T-001, T-002        # all must be in tasks/done/ (or: none)
Touches: path/a path/b    # only these paths may change; space-separated, prefix match
Lane: metrics             # parallel lane name (informational)
Checks: pnpm lint && pnpm typecheck && pnpm test
```

## Lifecycle

`tasks/ready/` → `tasks/active/` → `tasks/review/` → `tasks/done/`
(or `tasks/blocked/` on failure).

- **Claim:** `git mv tasks/ready/<id>.md tasks/active/<id>.md`, commit, push.
- **Review:** checks green, branch pushed, PR opened → `tasks/review/`. A
  task's `Needs:` are satisfied only by `tasks/done/`, so dependents wait
  until the PR is merged into `main`.
- **Done:** PR merged → `tasks/done/`. (With `--auto-merge` the loop merges
  itself when CI is green and the diff stays inside `Touches:`.)
- **Blocked:** checks red, push/PR failure, or ambiguous brief →
  `tasks/blocked/` with the log kept alongside.

## Adding tasks

Copy an existing file, bump the id (`T-008`, …), fill in `Needs:` from the
parallel map in `docs/PARALLEL_OPS.md`, and keep `Touches:` tight — narrow
scopes are what make parallel workers safe.
