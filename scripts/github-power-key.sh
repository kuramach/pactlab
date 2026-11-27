#!/usr/bin/env bash
# Set the GitHub token the sleep page's Wake up button dispatches env-power.yml with (ADR 0063): a fine-grained token,
# this repository only, permission Actions: read and write, nothing else. Read from stdin; never echoed or stored here.
#   scripts/github-power-key.sh stage < token.txt
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa or stage}"
case "$ENV_NAME" in dev | qa | stage) ;; *) echo "Only dev, qa and stage hibernate." >&2; exit 2 ;; esac
PROFILE="pactlab-$([ "$ENV_NAME" = qa ] && echo dev || echo "$ENV_NAME")"
IFS= read -r TOKEN
case "$TOKEN" in github_pat_*) ;; *) echo "Expected a fine-grained token (github_pat_…)." >&2; exit 2 ;; esac
aws secretsmanager put-secret-value --profile "$PROFILE" --region us-east-2 --secret-id "pactlab/${ENV_NAME}/github-power" --secret-string "$TOKEN" >/dev/null
echo "Set pactlab/${ENV_NAME}/github-power. The Wake up button on app.${ENV_NAME}.pactlab.ai can now start a wake."
