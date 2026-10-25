#!/usr/bin/env sh
# Prepare the e2e database and files, then run the worker (background imports)
# and the API; stopping this script stops both.
set -e
cd "$(dirname "$0")/.."
pnpm exec tsx support/prepare.ts
(cd ../worker && exec pnpm exec tsx src/main.ts) &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT INT TERM
cd ../api
pnpm exec tsx src/main.ts
