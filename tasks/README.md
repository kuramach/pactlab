# Task queue

One file per task. The scheduler reads the header fields; everything below
`## Brief` is the agent's instructions.

## Header fields

```text
Status: ready
Needs: T-001, T-002        # all must be in tasks/done/ (or: none)
Touches: path/a path/b    # only these paths may change; space-separated, prefix match
Lane: metrics             # parallel lane; picks the docs a standard run gets (docs/agent/context-map.tsv)
Context: standard         # light | standard | deep (absent = standard) — see docs/PARALLEL_OPS.md
Model: sonnet             # haiku | sonnet | opus (absent = routed from Context:)
Engine: claude            # claude | codex (absent = claude) — see "Engine split" below
Checks: pnpm lint && pnpm typecheck && pnpm test
```

## Model routing

`Model:` sets the Claude model the runner launches with. When it is absent the
runner routes from the attempt's Context tier: light → haiku, standard → sonnet,
deep → opus (a context-starved retry that escalates tier escalates model with
it). `MODEL` env overrides both. Inside a session, subagents default to haiku
unless the brief says otherwise.

## Engine split

`Engine:` chooses the builder: easy tasks go to Codex, hard tasks stay with
Claude. Easy = light/standard context, well-specified deliverables, one
surface, verifiable by tests or screenshots, no money movement, no schema or
core-model design, no security-critical logic. Hard = deep context, design
judgment, money, security/confidentiality, calibration-sensitive work,
infrastructure, cross-cutting core changes. The runner dispatches on the
header (`ENGINE` env overrides); codex runs launch `codex exec`, and the
repo-root `AGENTS.md` symlinks to `CLAUDE.md` so both engines read the same
law. Whoever builds, the other engine reviews.

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
