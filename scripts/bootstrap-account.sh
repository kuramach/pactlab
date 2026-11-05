#!/usr/bin/env bash
# One time per new AWS account: prepare it for CDK deploys in us-east-2 (the only region the
# organization allows). Safe to re-run. Usage: scripts/bootstrap-account.sh stage   (or live)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_NAME="${1:?environment, e.g. stage or live}"
# Live's AWS resources (and its profile) keep the CDK name `prod`.
[ "$ENV_NAME" = live ] && ENV_NAME=prod
PROFILE="pactlab-${ENV_NAME}"
ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
echo "Bootstrapping account ${ACCOUNT} (profile ${PROFILE}) in us-east-2"
pnpm --filter @pactlab/cdk exec cdk bootstrap "aws://${ACCOUNT}/us-east-2" --profile "$PROFILE" --no-color
