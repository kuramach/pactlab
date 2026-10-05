#!/bin/bash
# pactlab ops poller: runs command scripts Muse drops in ops/inbox/, posts results to ops/outbox/.
# Start: nohup ops/poll.sh >/tmp/pactlab-ops-poller.log 2>&1 &
# Stop:  pkill -f '[o]ps/poll.sh'
set -u
cd "$(dirname "$0")/.."

while true; do
  git fetch -q origin 2>/dev/null && git reset -q --hard origin/main 2>/dev/null || true
  for f in ops/inbox/*.sh; do
    [[ -e "$f" ]] || continue
    id="$(basename "$f" .sh)"
    [[ -f "ops/outbox/${id}.txt" ]] && continue
    bash "$f" > "ops/outbox/${id}.txt" 2>&1
    code=$?
    printf '\n### exit: %s at %s\n' "$code" "$(date -u +%FT%TZ)" >> "ops/outbox/${id}.txt"
    got=yes; [[ -f "ops/outbox/${id}.txt" ]] || got=no
    git rm -q "$f"
    git add "ops/outbox/${id}.txt"
    git commit -qm "ops: ran ${id} (outbox=${got})" && git push -q origin main || true
  done
  sleep 30
done
