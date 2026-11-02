#!/usr/bin/env bash
# Moves the worker to its new task revision while `cdk deploy` runs (dev and qa, fast rollout; ADR 0019).
# The worker service names its task family, so CloudFormation registers the new revision but neither updates
# the service nor waits minutes for ECS to call it steady. This script does the update and waits only until
# the new task runs. If the stack update fails, it puts the worker back on the revision it ran.
# Usage: roll-worker.sh <stack name> <file the deploy writes cdk's exit code to when it ends>
set -euo pipefail
STACK="${1:?stack}"
DONE_FILE="${2:?done file}"
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER=$(out ClusterName)
SERVICE=$(out WorkerServiceName)
FAMILY=$(out WorkerTaskFamily)
if [ -z "$SERVICE" ] || [ "$SERVICE" = None ]; then
  echo "worker: the stack does not hand the worker to the deploy yet; CloudFormation moves it this time"
  exit 0
fi
service() { aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query "services[0].$1" --output text; }
PREVIOUS=$(service taskDefinition)
echo "worker runs $PREVIOUS"

# A newer revision appears seconds into the stack update; none by the end means the worker did not change.
while :; do
  LATEST=$(aws ecs describe-task-definition --task-definition "$FAMILY" --query taskDefinition.taskDefinitionArn --output text)
  [ "$LATEST" != "$PREVIOUS" ] && break
  if [ -s "$DONE_FILE" ]; then echo "worker: unchanged"; exit 0; fi
  sleep 5
done
echo "worker: moving to $LATEST"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$LATEST" --query service.serviceName --output text >/dev/null

STARTED=$SECONDS
while :; do
  read -r STATE RUNNING DESIRED <<<"$(service "deployments[?status=='PRIMARY'] | [0].[rolloutState,runningCount,desiredCount]")"
  [ "$STATE" = FAILED ] && { echo "worker: rollout failed (ECS rolls it back)" >&2; exit 1; }
  [ "$RUNNING" -ge "$DESIRED" ] && break
  [ $((SECONDS - STARTED)) -gt 300 ] && { echo "worker: not running after 5 minutes" >&2; exit 1; }
  sleep 5
done
echo "worker: running on the new revision after $((SECONDS - STARTED))s (ECS confirms it in the background)"

# The worker must not stay ahead of a stack update that failed and rolled back.
until [ -s "$DONE_FILE" ]; do sleep 5; done
if [ "$(cat "$DONE_FILE")" != 0 ]; then
  echo "worker: the stack update failed; back to $PREVIOUS" >&2
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$PREVIOUS" --query service.serviceName --output text >/dev/null
  exit 1
fi
