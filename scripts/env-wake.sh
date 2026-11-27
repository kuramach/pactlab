#!/usr/bin/env bash
# Kumar's one-liner: wake dev, qa or stage (ADR 0063; docs/runbooks/hibernate.md). Hibernated: rebuilt from its snapshot
# in about 30–40 minutes. Paused: the quick wake (about 5–8 minutes). Never live (always on).
#   scripts/env-wake.sh stage
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa or stage}"
case "$ENV_NAME" in dev | qa | stage) ;; prod | live) echo "Live is always on." >&2; exit 1 ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac
gh workflow run wake.yml --ref main -f environment="$ENV_NAME"
echo "Dispatched: wake ${ENV_NAME}. Follow it with: gh run watch \$(gh run list --workflow wake.yml --limit 1 --json databaseId -q '.[0].databaseId')"
