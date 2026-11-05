#!/usr/bin/env bash
# Deploy the GitHub deploy role (Pactlab<Env>DeployAccess) for one or more environments, with your own
# AWS sign-in. The deploy workflow cannot change its own permissions, so a person runs this whenever the
# role changes (and once when an environment is first set up).
# Usage: scripts/deploy-access.sh dev qa      or      scripts/deploy-access.sh stage
# Sign in first if needed: aws login --profile pactlab-mgmt
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" -gt 0 ] || set -- dev qa
CONTEXT=()
STACKS=()
PROFILE=""
for ENV_NAME in "$@"; do
  case "$ENV_NAME" in dev | qa | stage) ;; *) echo "unknown environment: $ENV_NAME (dev, qa or stage)" >&2; exit 2 ;; esac
  # dev and qa share the dev account; stage has its own.
  ENV_PROFILE="pactlab-$([ "$ENV_NAME" = qa ] && echo dev || echo "$ENV_NAME")"
  if [ -n "$PROFILE" ] && [ "$PROFILE" != "$ENV_PROFILE" ]; then echo "run stage on its own: scripts/deploy-access.sh stage" >&2; exit 2; fi
  PROFILE="$ENV_PROFILE"
  ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
  CONTEXT+=(-c "pactlab:${ENV_NAME}:account=${ACCOUNT}")
  # The dev account already holds GitHub's sign-in provider (the site's deploy access); a new account creates it.
  [ "$PROFILE" = pactlab-dev ] && CONTEXT+=(-c "pactlab:${ENV_NAME}:githubOidc=existing")
  STACKS+=("Pactlab$(echo "${ENV_NAME:0:1}" | tr a-z A-Z)${ENV_NAME:1}DeployAccess")
done
echo "Deploying ${STACKS[*]} to account ${ACCOUNT} (profile ${PROFILE})"
pnpm --filter @pactlab/cdk exec cdk --profile "$PROFILE" --no-color "${CONTEXT[@]}" deploy "${STACKS[@]}" --require-approval never
