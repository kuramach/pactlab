#!/usr/bin/env bash
# Load the GitHub token live log triage opens issues with (T-150; docs/runbooks/log-triage.md).
#   scripts/github-triage-key.sh            # asks for the token, typed hidden; never saved locally
#   scripts/github-triage-key.sh off        # no token again (the value becomes `unset`; no issues opened)
# The token: a fine-grained personal access token for the repository kuramach/pactlab only, with
# Issues read and write and nothing else. The triage Lambda reads it on every run, so nothing restarts.
# Uses your AWS sign-in to live (scripts/aws.sh login).
set -euo pipefail
MODE="${1:-}"
export AWS_PROFILE=pactlab-prod AWS_REGION=us-east-2 AWS_PAGER=""
SECRET=pactlab/live/github-triage

aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in. Run: scripts/aws.sh login" >&2; exit 1; }

if [ "$MODE" = off ]; then
  VALUE=unset
else
  printf 'Paste the fine-grained GitHub token (kuramach/pactlab, Issues read/write only), then Enter: '
  IFS= read -rs VALUE
  echo
  [ -n "$VALUE" ] || { echo "Nothing entered; nothing changed." >&2; exit 1; }
  case "$VALUE" in
    github_pat_*) ;;
    *) echo "That is not a fine-grained token (they start github_pat_). Classic tokens reach every repository; refusing." >&2; unset VALUE; exit 1 ;;
  esac
fi
# The value travels on stdin to the AWS CLI, never on a command line (where other processes could see it).
printf '%s' "$VALUE" | aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
unset VALUE
echo "Saved ${SECRET}. The next triage run uses it (to check now: the runbook's manual invoke, in dry run)."
