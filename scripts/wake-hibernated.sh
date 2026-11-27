#!/usr/bin/env bash
# Wake a hibernated environment (ADR 0063): restore its database from the hibernate snapshot and redeploy its stacks on
# the images it slept on, so code and schema match and no migration is needed. Data and DNS names come back unchanged.
# Run by .github/workflows/env-power.yml only (the sleep page's Wake up button, scripts/env-wake.sh, or wake.yml).
# Needs: AWS_REGION, CDK (the cdk command with the account context), a checkout with pnpm installed.
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa or stage}"
case "$ENV_NAME" in dev | qa | stage) ;; prod | live) echo "::error::Live never hibernates (ADR 0063)." >&2; exit 1 ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac
: "${CDK:?CDK: the cdk command with the account context}"
cd "$(dirname "$0")/.."
STACK="Pactlab$(echo "${ENV_NAME:0:1}" | tr a-z A-Z)${ENV_NAME:1}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
say() { echo "$*"; echo "$*" >> "$SUMMARY"; }
param() { aws ssm get-parameter --name "/pactlab/${ENV_NAME}/$1" --query Parameter.Value --output text 2>/dev/null || true; }
set_power() { aws ssm put-parameter --name "/pactlab/${ENV_NAME}/power" --value "$1" --type String --overwrite >/dev/null; }
field() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => (o || {})[k], JSON.parse(process.argv[1])); console.log(v ?? "")' "$1" "$2"; }

STATE=$(param power)
case "$STATE" in
  hibernated | rebuilding) ;;
  awake | paused | waking) say "${ENV_NAME} is ${STATE}, not hibernated; nothing to rebuild."; exit 0 ;;
  *) echo "::error::${ENV_NAME} is ${STATE}; wake it once that has finished." >&2; exit 1 ;;
esac
RECORD=$(param hibernation)
[ -n "$RECORD" ] && [ "$RECORD" != None ] || { echo "::error::No hibernation record for ${ENV_NAME}." >&2; exit 1; }
SNAPSHOT=$(field "$RECORD" snapshot)
aws rds describe-db-snapshots --db-snapshot-identifier "$SNAPSHOT" --query 'DBSnapshots[0].Status' --output text | grep -qx available \
  || { echo "::error::Snapshot ${SNAPSHOT} is not available." >&2; exit 1; }
export SLEEP_CERTIFICATE_ARN="${SLEEP_CERTIFICATE_ARN:-$(field "$RECORD" sleepCertificateArn)}"
STARTED=$(date -u +%s)
set_power rebuilding
say "## Wake ${ENV_NAME} from \`${SNAPSHOT}\`"
on_exit() {
  local code=$?
  # The stack may be half-built; it stays `rebuilding` (never pausable) until this is re-run. The snapshot is untouched.
  [ "$code" = 0 ] || say "**The wake failed** (exit ${code}). Nothing was deleted: the snapshot \`${SNAPSHOT}\` is untouched. Re-run the wake (docs/runbooks/hibernate.md)."
}
trap on_exit EXIT

# The images and schema it slept on: the services come back exactly as they were.
IMAGE_CTX="-c pactlab:${ENV_NAME}:imageTag=$(field "$RECORD" images.tools)"
for IMAGE in web api worker tools; do IMAGE_CTX="$IMAGE_CTX -c pactlab:${ENV_NAME}:${IMAGE}ImageTag=$(field "$RECORD" "images.${IMAGE}")"; done
# Awake again, restored from the snapshot. power-context passes the neighbour's shape, so the base wakes with the first of them.
CTX="$(scripts/power-context.sh "$ENV_NAME" "${ENV_NAME}=awake" | sed "s/ -c pactlab:${ENV_NAME}:databaseSource=[^ ]*//g") -c pactlab:${ENV_NAME}:databaseSource=${SNAPSHOT}"
# Every later deploy must name this snapshot (CloudFormation's rule for restored instances): deploy.yml reads it from here.
# Written before the deploy, so a deploy that half-succeeds is never followed by one that drops it.
aws ssm put-parameter --name "/pactlab/${ENV_NAME}/database-source" --value "$SNAPSHOT" --type String --overwrite >/dev/null
if [ "$ENV_NAME" = dev ] || [ "$ENV_NAME" = qa ]; then
  # shellcheck disable=SC2086
  $CDK deploy PactlabNonliveBase --exclusively --require-approval never $CTX $IMAGE_CTX
  say "- The shared base is awake."
fi
# shellcheck disable=SC2086
$CDK deploy "$STACK" --exclusively --require-approval never $CTX $IMAGE_CTX --outputs-file "${RUNNER_TEMP:-/tmp}/wake.json"
ORIGIN=$(node -e "console.log(require(process.argv[1])[process.argv[2]].Origin)" "${RUNNER_TEMP:-/tmp}/wake.json" "$STACK")
curl --fail --silent --show-error --retry 20 --retry-delay 15 --retry-all-errors "$ORIGIN/health" >/dev/null
curl --fail --silent --show-error --output /dev/null --retry 10 --retry-delay 10 --retry-all-errors "$ORIGIN/login"
set_power awake
say "- Restored the database from \`${SNAPSHOT}\` and redeployed on the images it slept on; ${ORIGIN} answers."
say ""
say "Woke in $(( ($(date -u +%s) - STARTED) / 60 )) minutes."
echo "${ENV_NAME}: awake"
