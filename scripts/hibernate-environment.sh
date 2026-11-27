#!/usr/bin/env bash
# Hibernate one environment (ADR 0063). Run by .github/workflows/env-power.yml only, with the environment's power role;
# Kumar runs it through scripts/env-hibernate.sh. Never for live.
#
#   1. quiesce: pause it first if it is awake (wake page on, services to zero)
#   2. the queue check: jobs waiting, delayed or running stop the hibernate, unless --drop-queues
#   3. snapshot the database and verify it; ANY failure here stops before anything is deleted
#   4. record the snapshot, the images and the schema it slept on; pin those images (keep- tags)
#   5. delete the database, with a final snapshot (stage: deletion protection off first)
#   6. deploy the hibernated shape (and, for dev or qa, the shared base when the other one is asleep too)
#   7. mark it hibernated, keep the last N hibernations' snapshots, and write the summary
#
# Needs: AWS_REGION, CDK (the cdk command with the account context), a checkout with pnpm installed.
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa or stage}"; shift
DROP_QUEUES=false
for arg in "$@"; do case "$arg" in --drop-queues) DROP_QUEUES=true ;; *) echo "unknown option $arg" >&2; exit 2 ;; esac; done
case "$ENV_NAME" in dev | qa | stage) ;; prod | live) echo "::error::Live never hibernates (ADR 0063)." >&2; exit 1 ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac
: "${CDK:?CDK: the cdk command with the account context}"
cd "$(dirname "$0")/.."
STACK="Pactlab$(echo "${ENV_NAME:0:1}" | tr a-z A-Z)${ENV_NAME:1}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
say() { echo "$*"; echo "$*" >> "$SUMMARY"; }
power() { aws ssm get-parameter --name "/pactlab/${ENV_NAME}/power" --query Parameter.Value --output text; }
set_power() { aws ssm put-parameter --name "/pactlab/${ENV_NAME}/power" --value "$1" --type String --overwrite >/dev/null; }
resource() { aws cloudformation describe-stack-resources --stack-name "$STACK" --query "StackResources[?ResourceType=='$1' && starts_with(LogicalResourceId, '$2')].PhysicalResourceId | [0]" --output text; }
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
SETTINGS=$(pnpm --silent --filter @pactlab/cdk exec tsx bin/hibernation.ts config "$ENV_NAME")
KEEP=$(node -e 'console.log(JSON.parse(process.argv[1]).snapshotsKept)' "$SETTINGS")
NEIGHBOUR=$(node -e 'console.log(JSON.parse(process.argv[1]).neighbour || "")' "$SETTINGS")

STATE=$(power)
case "$STATE" in
  hibernated) say "${ENV_NAME} is already hibernated; nothing to do."; exit 0 ;;
  awake | paused | hibernating) ;;
  *) echo "::error::${ENV_NAME} is ${STATE}; hibernate it once that has finished." >&2; exit 1 ;;
esac
[ -n "${SLEEP_CERTIFICATE_ARN:-}" ] || { echo "::error::SLEEP_CERTIFICATE_ARN is not set for ${ENV_NAME}-power: request the sleep page certificate first (docs/runbooks/hibernate.md)." >&2; exit 1; }
STARTED=$(date -u +%s)
TS=$(date -u +%Y%m%dt%H%Mz)
SNAPSHOT="pactlab-${ENV_NAME}-hibernate-${TS}"
FINAL="pactlab-${ENV_NAME}-final-${TS}"
say "## Hibernate ${ENV_NAME} (${TS})"

# Anything that fails before the database is deleted leaves the environment paused, as it was.
DELETED=false
on_exit() {
  local code=$?
  if [ "$code" != 0 ] && [ "$DELETED" = false ]; then
    set_power paused || true
    DB=$(resource AWS::RDS::DBInstance Postgres 2>/dev/null || true)
    [ -n "$DB" ] && [ "$DB" != None ] && aws rds stop-db-instance --db-instance-identifier "$DB" >/dev/null 2>&1 || true
    say "**Stopped before deleting anything** (exit ${code}): ${ENV_NAME} is paused, with its database and data as they were."
  elif [ "$code" != 0 ]; then
    say "**Failed after the database was deleted** (exit ${code}). Its snapshots are \`${SNAPSHOT}\` and \`${FINAL}\`; re-run this hibernate, or wake it (docs/runbooks/hibernate.md)."
  fi
}
trap on_exit EXIT

# 1. Quiesce: today's pause first (wake page on, services to zero, database stopping).
if [ "$STATE" = awake ]; then
  STEPS=$(resource AWS::Lambda::Function IdlePausePowerSteps)
  aws lambda invoke --function-name "$STEPS" --payload '{"step":"pause"}' --cli-binary-format raw-in-base64-out /dev/null >/dev/null
  say "- Paused it first (services at zero)."
fi
set_power hibernating

# 2. The queue check: never put work to sleep.
CLUSTER=$(out ClusterName); FAMILY=$(out MigrateTaskDefinition); SUBNETS=$(out AppSubnets); GROUP=$(out AppTaskSecurityGroupId)
TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$GROUP],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["./node_modules/.bin/tsx","src/ops/queue-check.ts"]}]}' \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
QUEUES=$(aws logs get-log-events --log-group-name "/pactlab/${ENV_NAME}/app" --log-stream-name "migrate/migrate/${TASK##*/}" --start-from-head --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | grep '^QUEUE_CHECK' | tail -1 || true)
case "$CODE" in
  0) say "- Queues: empty. ${QUEUES#QUEUE_CHECK }" ;;
  3)
    if [ "$DROP_QUEUES" = true ]; then say "- Queues: **not empty, dropped by --drop-queues**. ${QUEUES#QUEUE_CHECK }"
    else echo "::error::${ENV_NAME} still has work queued (${QUEUES#QUEUE_CHECK }). Wait for it, or run with drop_queues." >&2; exit 1; fi ;;
  *) echo "::error::The queue check could not run (exit ${CODE})." >&2; exit 1 ;;
esac

# 3. Snapshot, and verify it before anything is deleted.
DB=$(resource AWS::RDS::DBInstance Postgres)
[ -n "$DB" ] && [ "$DB" != None ] || { echo "::error::No database instance in ${STACK}." >&2; exit 1; }
if [ "$STATE" = hibernating ] && ! aws rds describe-db-instances --db-instance-identifier "$DB" >/dev/null 2>&1; then
  # An earlier run deleted the database and stopped before the deploy: finish from its recorded snapshot.
  RECORDED=$(aws ssm get-parameter --name "/pactlab/${ENV_NAME}/hibernation" --query Parameter.Value --output text 2>/dev/null || echo '{}')
  SNAPSHOT=$(node -e 'console.log(JSON.parse(process.argv[1]).snapshot || "")' "$RECORDED")
  aws rds describe-db-snapshots --db-snapshot-identifier "$SNAPSHOT" --query 'DBSnapshots[0].Status' --output text 2>/dev/null | grep -qx available \
    || { echo "::error::The database is gone and no recorded snapshot is available; see docs/runbooks/hibernate.md (recovery)." >&2; DELETED=true; exit 1; }
  DELETED=true
  say "- Resuming: the database was already deleted; its snapshot is \`${SNAPSHOT}\`."
fi
if [ "$DELETED" = false ]; then
STATUS=$(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].DBInstanceStatus' --output text)
if [ "$STATUS" = stopping ]; then aws rds wait db-instance-stopped --db-instance-identifier "$DB" 2>/dev/null || true; STATUS=stopped; fi
if [ "$STATUS" = stopped ]; then aws rds start-db-instance --db-instance-identifier "$DB" >/dev/null; fi
aws rds wait db-instance-available --db-instance-identifier "$DB"
ENGINE=$(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].EngineVersion' --output text)
aws rds create-db-snapshot --db-instance-identifier "$DB" --db-snapshot-identifier "$SNAPSHOT" \
  --tags "Key=pactlab:environment,Value=${ENV_NAME}" "Key=pactlab:hibernation,Value=${TS}" >/dev/null
aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAPSHOT"
read -r SNAP_STATUS SNAP_ENCRYPTED SNAP_KEY <<<"$(aws rds describe-db-snapshots --db-snapshot-identifier "$SNAPSHOT" --query 'DBSnapshots[0].[Status,Encrypted,KmsKeyId]' --output text)"
DATA_KEY=$(resource AWS::KMS::Key DataKey)
[ "$SNAP_STATUS" = available ] && [ "$SNAP_ENCRYPTED" = True ] && [ "${SNAP_KEY##*/}" = "${DATA_KEY##*/}" ] \
  || { echo "::error::Snapshot ${SNAPSHOT} did not verify (status ${SNAP_STATUS}, encrypted ${SNAP_ENCRYPTED}, key ${SNAP_KEY##*/})." >&2; exit 1; }
say "- Snapshot \`${SNAPSHOT}\`: available, encrypted with the data key, PostgreSQL ${ENGINE}."

# 4. Record what it sleeps on, and pin those images so the registry's lifecycle never expires them.
MIGRATION=$(ls packages/db/prisma/migrations | grep -v '\.toml$' | sort | tail -1)
IMAGES=$(node -e 'const [w,a,k,t]=process.argv.slice(1); console.log(JSON.stringify({ web: w, api: a, worker: k, tools: t }))' "$(out WebImageTag)" "$(out ApiImageTag)" "$(out WorkerImageTag)" "$(out ToolsImageTag)")
RECORD=$(node -e 'const [s,a,e,i,m,c]=process.argv.slice(1); console.log(JSON.stringify({ snapshot: s, at: a, engineVersion: e, images: JSON.parse(i), migration: m, sleepCertificateArn: c }))' \
  "$SNAPSHOT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENGINE" "$IMAGES" "$MIGRATION" "$SLEEP_CERTIFICATE_ARN")
aws ssm put-parameter --name "/pactlab/${ENV_NAME}/hibernation" --value "$RECORD" --type String --overwrite >/dev/null
pin() {  # repository, tag
  local manifest
  manifest=$(aws ecr batch-get-image --repository-name "pactlab-${ENV_NAME}-$1" --image-ids imageTag="$2" --query 'images[0].imageManifest' --output text)
  [ -n "$manifest" ] && [ "$manifest" != None ] || { echo "::error::Image pactlab-${ENV_NAME}-$1:$2 is gone." >&2; exit 1; }
  aws ecr put-image --repository-name "pactlab-${ENV_NAME}-$1" --image-tag "keep-${TS}-$2" --image-manifest "$manifest" >/dev/null 2>&1 || true
}
pin web "$(out WebImageTag)"
for TAG in $(printf '%s\n%s\n%s-tools\n' "$(out ApiImageTag)" "$(out WorkerImageTag)" "$(out ToolsImageTag)" | sort -u); do pin server "$TAG"; done
say "- Images it wakes on: \`${IMAGES}\` (pinned as keep-${TS}-…); schema at \`${MIGRATION}\`."

# 5. Delete the database, with a final snapshot. Only this script deletes it: its CloudFormation policy is Retain.
if [ "$ENV_NAME" = stage ]; then
  aws rds modify-db-instance --db-instance-identifier "$DB" --no-deletion-protection --apply-immediately >/dev/null
  aws rds wait db-instance-available --db-instance-identifier "$DB"
fi
DELETED=true
aws rds delete-db-instance --db-instance-identifier "$DB" --final-db-snapshot-identifier "$FINAL" --delete-automated-backups >/dev/null
aws rds wait db-instance-deleted --db-instance-identifier "$DB"
say "- Deleted the database \`${DB}\`, with its final snapshot \`${FINAL}\`."
fi
# The instance it named is gone; the next wake names its own snapshot.
aws ssm delete-parameter --name "/pactlab/${ENV_NAME}/database-source" >/dev/null 2>&1 || true

# 6. The hibernated shape: everything that bills by the hour goes; data, secrets, keys and names stay.
CTX=$(scripts/power-context.sh "$ENV_NAME" "${ENV_NAME}=hibernated")
PLAN_FLAG=""
if [ -n "$NEIGHBOUR" ] && echo "$CTX" | grep -q "pactlab:${NEIGHBOUR}:power=hibernated"; then PLAN_FLAG=--neighbour-hibernated; fi
PLAN=$(pnpm --silent --filter @pactlab/cdk exec tsx bin/hibernation.ts plan "$ENV_NAME" $PLAN_FLAG)
# shellcheck disable=SC2086 # CTX holds separate -c flags
$CDK deploy "$STACK" --exclusively --require-approval never $CTX
if [ -n "$PLAN_FLAG" ]; then
  # shellcheck disable=SC2086
  $CDK deploy PactlabNonliveBase --exclusively --require-approval never $CTX
  say "- ${NEIGHBOUR} is asleep too: the shared network, NAT instance, load balancer and Redis are gone."
elif [ -n "$NEIGHBOUR" ]; then
  say "- The shared base stays: ${NEIGHBOUR} is awake."
fi
set_power hibernated

# 7. Keep the last N hibernations' snapshots (and their pinned images); delete older ones.
KEEP_TS=$(aws rds describe-db-snapshots --snapshot-type manual --query "DBSnapshots[?starts_with(DBSnapshotIdentifier, 'pactlab-${ENV_NAME}-hibernate-')].DBSnapshotIdentifier" --output text \
  | tr '\t' '\n' | sed "s/^pactlab-${ENV_NAME}-hibernate-//" | sort -r | head -n "$KEEP")
for ID in $(aws rds describe-db-snapshots --snapshot-type manual --query "DBSnapshots[?starts_with(DBSnapshotIdentifier, 'pactlab-${ENV_NAME}-')].DBSnapshotIdentifier" --output text | tr '\t' '\n'); do
  STAMP=${ID##*-}
  echo "$KEEP_TS" | grep -qx "$STAMP" && continue
  case "$ID" in "pactlab-${ENV_NAME}-hibernate-"* | "pactlab-${ENV_NAME}-final-"*) aws rds delete-db-snapshot --db-snapshot-identifier "$ID" >/dev/null && say "- Deleted the older snapshot \`${ID}\`." ;; esac
done
for REPO in web server; do
  for KEEPTAG in $(aws ecr list-images --repository-name "pactlab-${ENV_NAME}-${REPO}" --filter tagStatus=TAGGED --query "imageIds[?starts_with(imageTag, 'keep-')].imageTag" --output text | tr '\t' '\n'); do
    STAMP=$(echo "$KEEPTAG" | cut -d- -f2)
    echo "$KEEP_TS" | grep -qx "$STAMP" || aws ecr batch-delete-image --repository-name "pactlab-${ENV_NAME}-${REPO}" --image-ids imageTag="$KEEPTAG" >/dev/null
  done
done

{
  echo; echo "### What changed"; echo; echo '```'; echo "$PLAN"; echo '```'
  echo; echo "Snapshots kept: $(echo "$KEEP_TS" | sed "s/^/pactlab-${ENV_NAME}-hibernate-/" | tr '\n' ' ')(and each one's final snapshot)."
  echo; echo "Took $(( ($(date -u +%s) - STARTED) / 60 )) minutes. ${ENV_NAME} is hibernated; app.${ENV_NAME}.pactlab.ai shows the sleep page."
} >> "$SUMMARY"
echo "${ENV_NAME}: hibernated"
