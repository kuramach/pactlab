#!/usr/bin/env bash
# Set Pactlab's RentCast API key for an environment (T-158, docs/runbooks/rentcast.md), then restart the API so it reads it.
#   scripts/rentcast-key.sh live       # the key (RentCast: API Dashboard -> API Keys), typed hidden
#   scripts/rentcast-key.sh live off   # market rents and RentCast property facts off again (the value becomes `unset`)
# The key is asked, never saved locally. Uses your AWS sign-in (scripts/aws.sh login).
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa, stage or live}"
MODE="${2:-}"
case "$ENV_NAME" in live | prod) CDK_ENV=prod; PROFILE=pactlab-prod ;; stage) CDK_ENV=stage; PROFILE=pactlab-stage ;; dev | qa) CDK_ENV="$ENV_NAME"; PROFILE=pactlab-dev ;; *) echo "Unknown environment '$ENV_NAME'." >&2; exit 2 ;; esac
export AWS_PROFILE="$PROFILE" AWS_REGION=us-east-2 AWS_PAGER=""
STACK="Pactlab$(echo "${CDK_ENV:0:1}" | tr a-z A-Z)${CDK_ENV:1}"
SECRET="pactlab/${CDK_ENV}/credentials/rentcast-api-key"

aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in. Run: scripts/aws.sh login" >&2; exit 1; }

if [ "$MODE" = off ]; then
  VALUE=unset
else
  printf 'Enter the RentCast API key for %s (hidden), then Enter: ' "$ENV_NAME"
  IFS= read -rs VALUE
  echo
  # A paste often carries a stray space or newline; neither belongs in a key.
  VALUE=$(printf '%s' "$VALUE" | tr -d '[:space:]')
  [ -n "$VALUE" ] || { echo "Nothing entered; nothing changed." >&2; exit 1; }
  # Refuse what cannot be right, before anything is saved: a short or mangled paste fails only later, on the first check.
  [[ "$VALUE" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "That key holds characters a RentCast key doesn't (letters, digits, - and _ only). Copy it again. Nothing changed." >&2; exit 1; }
  [ "${#VALUE}" -ge 20 ] && [ "${#VALUE}" -le 128 ] || { echo "That key is ${#VALUE} characters; copy the whole key from the API Dashboard. Nothing changed." >&2; exit 1; }
  if [ "$VALUE" = unset ]; then echo "Use '$0 $ENV_NAME off' to turn it off." >&2; exit 1; fi
  echo "A ${#VALUE}-character key: it looks right."
fi
# The value travels on stdin to the AWS CLI, never on a command line (where other processes could see it).
printf '%s' "$VALUE" | aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
unset VALUE
echo "Saved ${SECRET}."

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER=$(out ClusterName)
SERVICE=$(out ApiServiceName)
if [ -z "$SERVICE" ] || [ "$SERVICE" = None ]; then
  echo "The API reads it on its next deploy."
  exit 0
fi
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --query 'service.serviceName' --output text >/dev/null
echo "Restarting the API in ${ENV_NAME} so it reads it (a few minutes). Then a multifamily pact's Home shows Check rents against the market."
