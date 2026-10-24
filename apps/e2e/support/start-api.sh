#!/usr/bin/env sh
# Prepare the e2e database and files, then run the API in the foreground.
set -e
cd "$(dirname "$0")/.."
pnpm exec tsx support/prepare.ts
cd ../api
exec pnpm exec tsx src/main.ts
