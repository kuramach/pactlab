#!/usr/bin/env bash
# Set an AI provider's API key for an environment (T-131, ADR 0034), then restart the API so it uses it.
#   scripts/ai-key.sh live openai      # asks for the key (typed hidden); nothing is printed or saved locally
#   scripts/ai-key.sh stage google
#   scripts/ai-key.sh live anthropic   # Claude through the direct Anthropic API (T-132)
#   scripts/ai-key.sh live openai off  # turns the provider off again (the key becomes `unset`)
# The key only connects the provider: its models still serve only after you record its data terms and a
# model passes evaluation in Admin → AI models. Uses your AWS sign-in (scripts/aws.sh login).
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa, stage or live}"
PROVIDER="${2:?provider: anthropic, openai or google}"
MODE="${3:-}"
case "$PROVIDER" in anthropic | openai | google) ;; *) echo "Unknown provider '$PROVIDER': use anthropic, openai or google." >&2; exit 2 ;; esac
case "$ENV_NAME" in live | prod) CDK_ENV=prod; PROFILE=pactlab-prod ;; stage) CDK_ENV=stage; PROFILE=pactlab-stage ;; dev | qa) CDK_ENV="$ENV_NAME"; PROFILE=pactlab-dev ;; *) echo "Unknown environment '$ENV_NAME'." >&2; exit 2 ;; esac
export AWS_PROFILE="$PROFILE" AWS_REGION=us-east-2 AWS_PAGER=""
STACK="Pactlab$(echo "${CDK_ENV:0:1}" | tr a-z A-Z)${CDK_ENV:1}"

aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in. Run: scripts/aws.sh login" >&2; exit 1; }

if [ "$MODE" = off ]; then
  KEY=unset
else
  printf 'Paste the %s API key for %s (hidden), then Enter: ' "$PROVIDER" "$ENV_NAME"
  IFS= read -rs KEY
  echo
  [ -n "$KEY" ] || { echo "No key entered; nothing changed." >&2; exit 1; }
fi
# The key travels on stdin to the AWS CLI, never on a command line (where other processes could see it).
printf '%s' "$KEY" | aws secretsmanager put-secret-value --secret-id "pactlab/${CDK_ENV}/ai/${PROVIDER}" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
unset KEY
echo "Saved pactlab/${CDK_ENV}/ai/${PROVIDER}."

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER=$(out ClusterName)
SERVICE=$(out ApiServiceName)
if [ -z "$SERVICE" ] || [ "$SERVICE" = None ]; then
  echo "The API reads the key on its next deploy (this stack predates ApiServiceName)."
  exit 0
fi
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --query 'service.serviceName' --output text >/dev/null
echo "Restarting the API in ${ENV_NAME} so it reads the key (a few minutes). Then: Admin → AI models → record ${PROVIDER}'s data terms, add a model, run its evaluation."
