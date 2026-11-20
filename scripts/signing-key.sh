#!/usr/bin/env bash
# Set Pactlab signing's BoldSign settings for an environment (T-136, ADR 0036), then restart the API so it reads them.
#   scripts/signing-key.sh live recipients   # the test recipients, e.g. you@example.com,@yourdomain.com (asked; never saved locally)
#   scripts/signing-key.sh live key          # the BoldSign API key (BoldSign: Settings > API Keys), typed hidden
#   scripts/signing-key.sh live webhook      # the webhook's signing secret, once the webhook is registered (runbook)
#   scripts/signing-key.sh live key off      # BoldSign off again (the value becomes `unset`)
# Until the production go, envelopes go to the test recipients only: set them before the key, or the API refuses to
# start with a key and no recipients. The SANDBOX key until then. Uses your AWS sign-in (scripts/aws.sh login).
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa, stage or live}"
WHAT="${2:?what: recipients, key or webhook}"
MODE="${3:-}"
case "$WHAT" in
  recipients) NAME=test-recipients; LABEL='test recipients (comma-separated addresses or @domains)'; HIDDEN=no ;;
  key) NAME=boldsign-api-key; LABEL='BoldSign API key'; HIDDEN=yes ;;
  webhook) NAME=boldsign-webhook-secret; LABEL='BoldSign webhook signing secret'; HIDDEN=yes ;;
  *) echo "Unknown setting '$WHAT': use recipients, key or webhook." >&2; exit 2 ;;
esac
case "$ENV_NAME" in live | prod) CDK_ENV=prod; PROFILE=pactlab-prod ;; stage) CDK_ENV=stage; PROFILE=pactlab-stage ;; dev | qa) CDK_ENV="$ENV_NAME"; PROFILE=pactlab-dev ;; *) echo "Unknown environment '$ENV_NAME'." >&2; exit 2 ;; esac
export AWS_PROFILE="$PROFILE" AWS_REGION=us-east-2 AWS_PAGER=""
STACK="Pactlab$(echo "${CDK_ENV:0:1}" | tr a-z A-Z)${CDK_ENV:1}"
SECRET="pactlab/${CDK_ENV}/signing/${NAME}"

aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in. Run: scripts/aws.sh login" >&2; exit 1; }

if [ "$MODE" = off ]; then
  VALUE=unset
else
  if [ "$WHAT" = key ]; then
    # Fail closed: a key with no test recipients would stop the API starting (and must never reach a real counterparty).
    RECIPIENTS=$(aws secretsmanager get-secret-value --secret-id "pactlab/${CDK_ENV}/signing/test-recipients" --query SecretString --output text)
    if [ "$RECIPIENTS" = unset ]; then echo "Set the test recipients first: scripts/signing-key.sh $ENV_NAME recipients" >&2; exit 1; fi
    unset RECIPIENTS
  fi
  printf 'Enter the %s for %s, then Enter: ' "$LABEL" "$ENV_NAME"
  if [ "$HIDDEN" = yes ]; then IFS= read -rs VALUE; echo; else IFS= read -r VALUE; fi
  [ -n "$VALUE" ] || { echo "Nothing entered; nothing changed." >&2; exit 1; }
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
echo "Restarting the API in ${ENV_NAME} so it reads it (a few minutes). Then: Settings → Signing shows Pactlab signing (BoldSign)."
