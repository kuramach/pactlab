id="$(basename "$0" .sh)"
pkill -9 -f '[o]ps/poll.sh' 2>/dev/null
sleep 2
cd ~/pactlab-ops
fetch_out=$(git fetch origin 2>&1 | head -2 | tr '\n' ';')
reset_out=$(git reset --hard origin/main 2>&1 | head -2 | tr '\n' ';')
addf=$(grep -c 'git add -f' ops/poll.sh 2>/dev/null || echo 0)
rhard=$(grep -c 'reset --hard' ops/poll.sh 2>/dev/null || echo 0)
pollhead=$(git log --oneline -1 -- ops/poll.sh 2>/dev/null || echo none)
git rm -q "ops/inbox/${id}.sh" 2>/dev/null
git commit -qm "ops: poller restarted | fetch=${fetch_out} reset=${reset_out} addf=${addf} resethard=${rhard} poll.sh=${pollhead}" --allow-empty
git push -q origin main || true
if [ "$addf" -gt 0 ] && [ "$rhard" -gt 0 ]; then
  nohup ops/poll.sh >/tmp/pactlab-ops-poller.log 2>&1 &
  echo started
else
  echo "NOT starting: fix not present"
fi
