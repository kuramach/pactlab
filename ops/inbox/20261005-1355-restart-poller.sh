id="$(basename "$0" .sh)"
pkill -f '[o]ps/poll.sh'
sleep 2
cd ~/pactlab-ops
git pull -q --ff-only origin main
git rm -q "ops/inbox/${id}.sh"
git commit -qm "ops: poller restarted" && git push -q origin main || true
nohup ops/poll.sh >/tmp/pactlab-ops-poller.log 2>&1 &
