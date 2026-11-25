# Runbook: loop autostart

Restarts the agent loop by itself when Claude usage is available again after a limit stop
(`run-task.sh` exit 75: WIP commit pushed, task returned to `ready/`).

## How it works

launchd agent `ai.pactlab.loop` runs `scripts/loop-autostart.sh` at load and every 1800 s. The wrapper:

1. exits silently if `agent-loop.sh` is already running (also when the loop is idle);
2. `git pull --ff-only` in the repo (on failure: logs why and stops — never forces, stashes or resets);
3. probes with `claude -p "Reply with the single word OK"`. At the limit this fails at once and costs nothing; the probe never touches `tasks/`;
4. on success starts `caffeinate -i scripts/agent-loop.sh --auto-merge` detached, with `CLAUDE_FLAGS=--dangerously-skip-permissions`.

The loop's own gates are unchanged: usage-limit parking, Touches/Needs claiming, and resume from the WIP commit.

Tool paths for `claude`, `git`, `caffeinate` are recorded at install time in `~/.config/pactlab/loop-autostart.env` (launchd has a minimal PATH). Re-run install if you move them.

## Install (once)

```bash
scripts/loop-autostart-install.sh install
```

This writes the env file and `~/Library/LaunchAgents/ai.pactlab.loop.plist` (from `scripts/launchd/ai.pactlab.loop.plist`), then runs `launchctl bootstrap gui/$(id -u) …`.

## Check

```bash
tail -f ~/Library/Logs/pactlab-loop/loop.log      # wrapper decisions and loop output
launchctl print gui/$(id -u)/ai.pactlab.loop      # agent state
```

launchd's own stdout/stderr are in `launchd.out.log` / `launchd.err.log` in the same directory.

## Pause / remove

```bash
scripts/loop-autostart-install.sh uninstall       # = launchctl bootout gui/$(id -u)/ai.pactlab.loop
```

To resume, run `install` again.

## Change the probe interval

Edit `StartInterval` (seconds) in `scripts/launchd/ai.pactlab.loop.plist`, then run `install` again.

## Failure modes

- **Mac asleep:** launchd runs the missed job on wake; `caffeinate -i` stops idle sleep once the loop is running.
- **Weekly usage cap:** probes keep failing (one log line each) until the weekly reset. Nothing to fix.
- **Probe succeeds, queue empty:** the loop starts, drains instantly and exits. Harmless.
- **`git pull` fails (dirty tree, divergence):** nothing starts; the log line says why. Fix the checkout by hand.
- **Probe hangs:** it is killed after `PROBE_TIMEOUT_SECS` (120) and treated as a failure.

## Tests

`scripts/test-loop-autostart.sh` runs the wrapper against stubbed `claude` and loop scripts (probe failure, start, no second loop, failed pull).
