#!/usr/bin/env bash
# Load the GitHub token log triage opens issues with (T-150 live, T-157 dev and stage; docs/runbooks/log-triage.md).
#   scripts/github-triage-key.sh                # live (as T-150): asks for the token, typed hidden; never saved locally
#   scripts/github-triage-key.sh dev            # the dev account's deployment (it sweeps dev and qa)
#   scripts/github-triage-key.sh dev stage      # one token value into both accounts, asked once
#   scripts/github-triage-key.sh stage off      # no token again (the value becomes `unset`; no issues opened)
# The token: a fine-grained personal access token for the repository kuramach/pactlab only, with
# Issues read and write and nothing else. The triage Lambda reads it on every run, so nothing restarts.
# Uses your AWS sign-in to each named account (scripts/aws.sh login).
set -euo pipefail
export AWS_REGION=us-east-2 AWS_PAGER=""

TARGETS=() MODE=""
for ARG in "$@"; do
  case "$ARG" in
    off) MODE=off ;;
    live|dev|stage) TARGETS+=("$ARG") ;;
    qa) echo "qa is swept by the dev account's deployment: use 'dev'." >&2; exit 1 ;;
    *) echo "Unknown argument '$ARG'. Use: live, dev, stage, and optionally off." >&2; exit 1 ;;
  esac
done
[ "${#TARGETS[@]}" -gt 0 ] || TARGETS=(live)

profile_of() { case "$1" in live) echo pactlab-prod ;; *) echo "pactlab-$1" ;; esac; }
secret_of() { echo "pactlab/$1/github-triage"; }

# Every account is checked before anything is asked or written, so a half-done run never happens on sign-in.
for T in "${TARGETS[@]}"; do
  AWS_PROFILE="$(profile_of "$T")" aws sts get-caller-identity >/dev/null 2>&1 || { echo "Not signed in to $T ($(profile_of "$T")). Run: scripts/aws.sh login" >&2; exit 1; }
done

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
for T in "${TARGETS[@]}"; do
  SECRET="$(secret_of "$T")"
  # The value travels on stdin to the AWS CLI, never on a command line (where other processes could see it).
  printf '%s' "$VALUE" | AWS_PROFILE="$(profile_of "$T")" aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
  echo "Saved ${SECRET} in ${T}. Its next triage run uses it (to check now: the runbook's manual invoke, in dry run)."
done
unset VALUE
