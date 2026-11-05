#!/usr/bin/env bash
# Run an operator script inside a deployed environment, as a one-off ECS task: the migrate task
# definition (tools image, schema-owner credentials) with its command replaced. For what has to
# happen from inside the environment's network, e.g. making the first platform operator:
#   scripts/ops-task.sh live src/ops/operator.ts you@example.com
#   scripts/ops-task.sh stage src/ops/org-admin.ts approve <org-slug>
# Uses your own AWS sign-in (aws login --profile pactlab-mgmt). Waits and exits with the task's code.
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa, stage or live}"; shift
SCRIPT="${1:?script under apps/api, e.g. src/ops/operator.ts}"; shift
[ "$ENV_NAME" = live ] && ENV_NAME=prod
case "$ENV_NAME" in dev | qa | stage | prod) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
case "$SCRIPT" in src/ops/*.ts) ;; *) echo "only scripts under src/ops/ run this way" >&2; exit 2 ;; esac
PROFILE="pactlab-$([ "$ENV_NAME" = qa ] && echo dev || echo "$ENV_NAME")"
STACK="Pactlab$(echo "${ENV_NAME:0:1}" | tr a-z A-Z)${ENV_NAME:1}"
export AWS_PROFILE="$PROFILE" AWS_REGION=us-east-2
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER=$(out ClusterName); FAMILY=$(out MigrateTaskDefinition); SUBNETS=$(out AppSubnets); GROUP=$(out AppTaskSecurityGroupId)
# The command as JSON: tsx, the script, then each argument as its own string.
COMMAND=$(node -e 'console.log(JSON.stringify(["./node_modules/.bin/tsx", ...process.argv.slice(1)]))' "$SCRIPT" "$@")
TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$GROUP],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"migrate\",\"command\":$COMMAND}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "Running $SCRIPT in $ENV_NAME: $TASK"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
echo "Exit code: $CODE (logs: CloudWatch /pactlab/${ENV_NAME}/app, stream migrate/)"
[ "$CODE" = 0 ]
