#!/usr/bin/env bash
# Kumar's one-liner: hibernate dev, qa or stage now (ADR 0063; docs/runbooks/hibernate.md). Never live.
#   scripts/env-hibernate.sh stage              hibernate it (the env-power workflow, on GitHub)
#   scripts/env-hibernate.sh stage --dry-run    list exactly what would be deleted and kept; changes nothing, no AWS
#   scripts/env-hibernate.sh stage --dry-run --remote   the same in the workflow, with the live CloudFormation diff
#   scripts/env-hibernate.sh stage --drop-queues        hibernate even with work still queued
set -euo pipefail
ENV_NAME="${1:?environment: dev, qa or stage}"; shift
case "$ENV_NAME" in dev | qa | stage) ;; prod | live) echo "Live never hibernates (ADR 0063)." >&2; exit 1 ;; *) echo "unknown environment $ENV_NAME" >&2; exit 2 ;; esac
DRY=false; REMOTE=false; DROP=false
for arg in "$@"; do case "$arg" in --dry-run) DRY=true ;; --remote) REMOTE=true ;; --drop-queues) DROP=true ;; *) echo "unknown option $arg" >&2; exit 2 ;; esac; done
cd "$(dirname "$0")/.."
if [ "$DRY" = true ] && [ "$REMOTE" = false ]; then
  exec pnpm --silent --filter @pactlab/cdk exec tsx bin/hibernation.ts plan "$ENV_NAME"
fi
gh workflow run env-power.yml --ref main -f environment="$ENV_NAME" -f action=hibernate -f dry_run="$DRY" -f drop_queues="$DROP"
echo "Dispatched: hibernate ${ENV_NAME}$([ "$DRY" = true ] && echo ' (dry run)'). Follow it with: gh run watch \$(gh run list --workflow env-power.yml --limit 1 --json databaseId -q '.[0].databaseId')"
