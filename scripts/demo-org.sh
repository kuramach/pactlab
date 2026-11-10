#!/usr/bin/env bash
# Build (or top up) the demo organization in a deployed environment, in one command:
#   scripts/demo-org.sh                 # live: adds whatever demo pacts are missing
#   scripts/demo-org.sh stage           # stage (every pack)
#   scripts/demo-org.sh live --reset    # deletes the demo pacts, then rebuilds them (asks first)
#   scripts/demo-org.sh live pool       # the shared demo pool (T-113): end expired shares, rebuild, build missing slots
# or `pnpm demo:live`. Checks your AWS sign-in and the latest deploy first, then runs
# src/ops/demo-org.ts inside the environment through scripts/ops-task.sh (docs/runbooks/demo-org.md).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME="${1:-live}"
RESET="${2:-}"
case "$ENV_NAME" in dev | qa | stage | live) ;; *) echo "Unknown environment '$ENV_NAME': use live, stage, dev or qa." >&2; exit 2 ;; esac
case "$RESET" in '' | --reset | pool) ;; *) echo "Unknown option '$RESET': use --reset or pool." >&2; exit 2 ;; esac
# macOS's bash 3.2 cannot parse `case` inside $( ), so plain ifs.
if [ "$ENV_NAME" = live ]; then PROFILE=pactlab-prod; elif [ "$ENV_NAME" = qa ]; then PROFILE=pactlab-dev; else PROFILE="pactlab-$ENV_NAME"; fi
if [ "$ENV_NAME" = live ]; then APP_URL=https://app.pactlab.ai; else APP_URL="https://app.$ENV_NAME.pactlab.ai"; fi

echo "1/3  AWS sign-in ($PROFILE)"
if ! aws sts get-caller-identity --profile "$PROFILE" --query Account --output text >/dev/null 2>&1; then
  echo "     Not signed in. Run this, then try again:"
  echo "       aws login --profile $PROFILE"
  exit 1
fi
echo "     OK"

echo "2/3  Latest deploy"
if command -v gh >/dev/null 2>&1; then
  LATEST="$(gh run list --workflow deploy.yml --limit 1 --json status,conclusion,headSha,url -q '.[0] | "\(.status) \(.conclusion) \(.headSha[0:7]) \(.url)"' 2>/dev/null || true)"
  read -r STATUS CONCLUSION SHA URL <<<"${LATEST:-unknown - - -}"
  if [ "$STATUS" != completed ]; then
    echo "     A deploy is still running ($SHA): $URL"
    echo "     Wait for it to finish (the demo runs the deployed version), then try again."
    exit 1
  fi
  if [ "$CONCLUSION" != success ]; then echo "     Warning: the latest deploy ended '$CONCLUSION' ($SHA): $URL"; else echo "     OK ($SHA)"; fi
else
  echo "     Skipped (GitHub CLI not installed)"
fi

if [ "$RESET" = --reset ] && [ "$ENV_NAME" = live ]; then
  read -r -p "     --reset deletes the demo pacts on LIVE and rebuilds them. Type RESET to continue: " ANSWER
  [ "$ANSWER" = RESET ] || { echo "     Cancelled."; exit 1; }
fi

if [ "$RESET" = pool ]; then
  echo "3/3  Sweeping the shared demo pool in $ENV_NAME (a few minutes per demo it rebuilds)"
  exec scripts/ops-task.sh "$ENV_NAME" src/ops/demo-pool.ts sweep
fi
echo "3/3  Building the demo organization in $ENV_NAME (a few minutes)"
if scripts/ops-task.sh "$ENV_NAME" src/ops/demo-org.ts ${RESET:+"$RESET"}; then
  echo
  echo "Done. Sign in at $APP_URL with:"
  echo "  kumar+demo@pactlab.ai        buyer: organization owner, deal lead"
  echo "  kumar+demoseller@pactlab.ai  seller: guest on each pact"
  echo "Codes arrive in the kumar@pactlab.ai inbox (check Spam)."
else
  CODE=$?
  echo
  echo "The demo task failed (exit $CODE). Its output is above; the full log is in CloudWatch,"
  echo "log group /pactlab/$([ "$ENV_NAME" = live ] && echo prod || echo "$ENV_NAME")/app, stream seed/seed/<task id>."
  exit "$CODE"
fi
