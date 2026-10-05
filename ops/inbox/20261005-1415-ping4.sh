echo "=== poller test 4 ==="
hostname
date
echo "=== agent loop ==="
pgrep -f agent-loop.sh >/dev/null && echo "loop RUNNING" || echo "loop NOT running"
echo "=== docker ==="
docker ps --format '{{.Names}}' 2>/dev/null | head -5 || echo "docker not available"
