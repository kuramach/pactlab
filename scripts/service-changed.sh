#!/usr/bin/env bash
# Prints "true" if a service's image must be rebuilt for this release, "false" if it can stay on the image it runs.
# Usage: service-changed.sh <web|api|worker|server> <running commit|none>   (compares with the checked-out commit)
# "server" means api or worker. Used by deploy.yml's Plan step (ADR 0019).
set -euo pipefail
SERVICE="${1:?service}"
RUNNING="${2:?running commit}"
changed() { echo true; exit 0; }
[ "$RUNNING" = none ] && changed
git cat-file -e "${RUNNING}^{commit}" 2>/dev/null || changed
# Inputs every image is built from.
git diff --quiet "$RUNNING" HEAD -- pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json infra/docker || changed
case "$SERVICE" in
  web) PACKAGES='@pactlab/web' ;;
  api) PACKAGES='@pactlab/api' ;;
  worker) PACKAGES='@pactlab/worker' ;;
  server) PACKAGES='@pactlab/api @pactlab/worker' ;;
  *) echo "unknown service: $SERVICE" >&2; exit 2 ;;
esac
# The server image also carries the synthetic fixtures and demo data.
if [ "$SERVICE" != web ]; then git diff --quiet "$RUNNING" HEAD -- fixtures demo-data || changed; fi
# Workspace packages changed since the running commit, and every package depending on them.
AFFECTED=$(pnpm ls -r --depth -1 --json --filter "...[$RUNNING]" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log((s.trim() ? JSON.parse(s) : []).map((p) => p.name).join(" ")));')
for PACKAGE in $PACKAGES; do
  case " $AFFECTED " in *" $PACKAGE "*) changed ;; esac
done
echo false
