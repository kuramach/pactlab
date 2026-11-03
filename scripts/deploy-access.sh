#!/usr/bin/env bash
# Deploy the GitHub deploy role (Pactlab<Env>DeployAccess) for dev and qa with the admin profile.
# The deploy workflow cannot change its own permissions, so a person runs this after the role changes.
# Usage: scripts/deploy-access.sh            (sign in first if needed: aws login --profile pactlab-mgmt)
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT=379959319207
pnpm --filter @pactlab/cdk exec cdk --profile pactlab-dev --no-color \
  -c "pactlab:dev:account=$ACCOUNT" -c pactlab:dev:githubOidc=existing \
  -c "pactlab:qa:account=$ACCOUNT" -c pactlab:qa:githubOidc=existing \
  deploy PactlabDevDeployAccess PactlabQaDeployAccess --require-approval never
