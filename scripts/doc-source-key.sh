#!/usr/bin/env bash
# Set Pactlab's OAuth client for a document-source provider in an environment (T-147), then restart the API so it reads it.
#   scripts/doc-source-key.sh live google      # Google Cloud OAuth client id and secret (docs/runbooks/document-sources.md)
#   scripts/doc-source-key.sh live microsoft   # Microsoft Entra application (client) id and a client secret
#   scripts/doc-source-key.sh live google off  # that provider's Connect button hidden again (values become `unset`)
# Both values are asked (the secret typed hidden), never saved locally. Uses your AWS sign-in (scripts/aws.sh login).
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa, stage or live}"
PROVIDER="${2:?provider: google or microsoft}"
MODE="${3:-}"
case "$PROVIDER" in
  google) LABEL='Google OAuth client' ;;
  microsoft) LABEL='Microsoft Entra application' ;;
  *) echo "Unknown provider '$PROVIDER': use google or microsoft." >&2; exit 2 ;;
esac
case "$ENV_NAME" in live | prod) CDK_ENV=prod; PROFILE=pactlab-prod ;; stage) CDK_ENV=stage; PROFILE=pactlab-stage ;; dev | qa) CDK_ENV="$ENV_NAME"; PROFILE=pactlab-dev ;; *) echo "Unknown environment '$ENV_NAME'." >&2; exit 2 ;; esac
export AWS_PROFILE="$PROFILE" AWS_REGION=us-east-2 AWS_PAGER=""
STACK="Pactlab$(echo "${CDK_ENV:0:1}" | tr a-z A-Z)${CDK_ENV:1}"
PREFIX="pactlab/${CDK_ENV}/documents/${PROVIDER}"

aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in. Run: scripts/aws.sh login" >&2; exit 1; }

if [ "$MODE" = off ]; then
  CLIENT_ID=unset
  CLIENT_SECRET=unset
else
  printf 'Enter the %s id for %s, then Enter: ' "$LABEL" "$ENV_NAME"
  IFS= read -r CLIENT_ID
  printf 'Enter its client secret (hidden), then Enter: '
  IFS= read -rs CLIENT_SECRET
  echo
  [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] || { echo "Both are needed; nothing changed." >&2; exit 1; }
fi
# Values travel on stdin to the AWS CLI, never on a command line (where other processes could see them).
printf '%s' "$CLIENT_ID" | aws secretsmanager put-secret-value --secret-id "${PREFIX}-client-id" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
printf '%s' "$CLIENT_SECRET" | aws secretsmanager put-secret-value --secret-id "${PREFIX}-client-secret" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
unset CLIENT_ID CLIENT_SECRET
echo "Saved ${PREFIX}-client-id and -client-secret."

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER=$(out ClusterName)
SERVICE=$(out ApiServiceName)
if [ -z "$SERVICE" ] || [ "$SERVICE" = None ]; then
  echo "The API reads it on its next deploy."
  exit 0
fi
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --query 'service.serviceName' --output text >/dev/null
echo "Restarting the API in ${ENV_NAME} so it reads it (a few minutes). Then: Settings → Connections shows Connect for ${PROVIDER}."
