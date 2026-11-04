#!/usr/bin/env bash
# Wake a paused environment and wait until it serves (ADR 0019). Used by the deploy and wake workflows.
# With --hold (the deploy): an environment that is already awake is re-confirmed awake through the same
# wake process, which restarts its idle clock, so the idle check cannot pause it in the middle of a deploy.
# Needs AWS credentials for the environment's account (the GitHub deploy role) and AWS_REGION.
set -euo pipefail
ENV_NAME="${1:?environment}"
HOLD="${2:-}"
POWER=$(aws ssm get-parameter --name "/pactlab/${ENV_NAME}/power" --query Parameter.Value --output text 2>/dev/null || echo none)
case "$POWER" in
  none) echo "${ENV_NAME}: no idle pause here yet (first deploy, or production)"; exit 0 ;;
  awake) [ "$HOLD" = "--hold" ] || { echo "${ENV_NAME}: awake"; exit 0; } ;;
esac
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
MACHINE="arn:aws:states:${AWS_REGION}:${ACCOUNT}:stateMachine:pactlab-${ENV_NAME}-wake"
if [ "$POWER" = "awake" ]; then
  # Already serving: nothing stops or reroutes; the run ends by marking it awake again (a fresh idle window).
  aws stepfunctions start-execution --state-machine-arn "$MACHINE" --name "hold-${GITHUB_RUN_ID:-$(date +%s)}-${GITHUB_RUN_ATTEMPT:-1}" --input '{}' >/dev/null
  echo "${ENV_NAME}: awake; holding it awake for this deploy"
  # Wait for the run to take the state through waking and back to awake.
  for _ in $(seq 1 30); do
    [ "$(aws ssm get-parameter --name "/pactlab/${ENV_NAME}/power" --query Parameter.Value --output text)" != "awake" ] && break
    sleep 2
  done
fi
if [ "$POWER" = "paused" ]; then
  VERSION=$(aws ssm get-parameter --name "/pactlab/${ENV_NAME}/power" --query Parameter.Version --output text)
  # Same name as the wake page uses for this pause, so a click and a deploy start one wake, not two.
  aws stepfunctions start-execution --state-machine-arn "$MACHINE" --name "wake-${VERSION}" --input '{}' >/dev/null 2>&1 || true
  echo "${ENV_NAME}: paused, waking (about 5–8 minutes)"
fi
for _ in $(seq 1 90); do
  POWER=$(aws ssm get-parameter --name "/pactlab/${ENV_NAME}/power" --query Parameter.Value --output text)
  [ "$POWER" = "awake" ] && { echo "${ENV_NAME}: awake"; exit 0; }
  sleep 20
done
echo "${ENV_NAME}: still ${POWER} after 30 minutes; see the pactlab-${ENV_NAME}-wake executions in Step Functions" >&2
exit 1
