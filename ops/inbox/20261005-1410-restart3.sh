id="$(basename "$0" .sh)"
pkill -9 -f '[o]ps/poll.sh' 2>/dev/null
sleep 2
cd ~/pactlab-ops
git fetch -q origin 2>/dev/null
git reset -q --hard origin/main 2>/dev/null
git rm -q "ops/inbox/${id}.sh" 2>/dev/null
git commit -qm "ops: poller restarted v3" --allow-empty 2>/dev/null
git push -q origin main 2>/dev/null || true
nohup ops/poll.sh >/tmp/pactlab-ops-poller.log 2>&1 &
