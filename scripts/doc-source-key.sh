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
  # A paste often carries a stray space or newline; neither belongs in an id or secret.
  CLIENT_ID=$(printf '%s' "$CLIENT_ID" | tr -d '[:space:]')
  CLIENT_SECRET=$(printf '%s' "$CLIENT_SECRET" | tr -d '[:space:]')
  [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] || { echo "Both are needed; nothing changed." >&2; exit 1; }
  # Refuse what cannot be right, before anything is saved: a short paste fails only later, at sign-in.
  if [ "$PROVIDER" = google ]; then
    [[ "$CLIENT_ID" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] || { echo "That client id doesn't look like Google's (it ends in .apps.googleusercontent.com). Nothing changed." >&2; exit 1; }
    [[ "$CLIENT_SECRET" =~ ^GOCSPX-[A-Za-z0-9_-]{28}$ ]] || { echo "That client secret is ${#CLIENT_SECRET} characters; Google's are 35 and start with GOCSPX-. Copy it again (use the copy icon). Nothing changed." >&2; exit 1; }
  else
    [[ "$CLIENT_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo "That application id doesn't look like Microsoft's (a GUID like 00001111-aaaa-2222-bbbb-3333cccc4444). Nothing changed." >&2; exit 1; }
    # Copy the secret's Value, not its Secret ID (a GUID).
    if [[ "$CLIENT_SECRET" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}- ]]; then echo "That looks like the secret's ID; copy its Value instead. Nothing changed." >&2; exit 1; fi
    [ "${#CLIENT_SECRET}" -ge 30 ] || { echo "That client secret is only ${#CLIENT_SECRET} characters; copy the whole Value. Nothing changed." >&2; exit 1; }
  fi
  echo "Client id and a ${#CLIENT_SECRET}-character secret: they look right."
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
