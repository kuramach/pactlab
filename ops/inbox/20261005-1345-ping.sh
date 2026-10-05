echo "=== poller test ==="
hostname
date
echo "=== agent loop ==="
pgrep -f agent-loop.sh >/dev/null && echo "loop RUNNING" || echo "loop NOT running"
echo "=== pactlab repo ==="
cd /Users/kumar/projects/pactlab && git log --oneline -1 && git status -sb | head -3
echo "=== docker ==="
docker ps --format '{{.Names}}' 2>/dev/null | head -5 || echo "docker not running"
