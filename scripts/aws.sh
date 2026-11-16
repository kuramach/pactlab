#!/usr/bin/env bash
# Pactlab's AWS accounts from one place. Sign in once to the management (payer) account; the other
# accounts are reached through their OrganizationAccountAccessRole, in the terminal (profiles below)
# and in the browser (AWS switch-role links). No per-account passwords, and no credentials leave the CLI.
#
#   scripts/aws.sh login                  sign the terminal in (opens the browser once)
#   scripts/aws.sh whoami                 who you are, and which accounts you can reach
#   scripts/aws.sh console <env> [page]   open that account in the browser. Sign in to the management
#                                         console once; after that it is one click per account.
#                                         page: home, billing, cost, support, cases, ecs, rds, logs
#   scripts/aws.sh support <env>          open a new support case in that account
#   scripts/aws.sh cases <env>            open that account's support cases
#   scripts/aws.sh status                 paused or awake: dev, qa, stage
#   scripts/aws.sh cost [from] [to]       spend by account and by environment tag (~$0.01 per call)
#   scripts/aws.sh profiles               the ~/.aws/config profiles this script expects
#   eval "$(scripts/aws.sh use <env>)"    point this shell's aws commands at an account
#
# <env>: mgmt | dev | qa | stage | live   (dev and qa share the dev account; live is CDK's "prod")
# Support: every account is on Basic (free): account and billing cases only, opened in the console.
set -euo pipefail

REGION=us-east-2
ROLE=OrganizationAccountAccessRole

profile_of() {
  case "$1" in
    mgmt | management | payer) echo pactlab-mgmt ;;
    dev | qa) echo pactlab-dev ;;
    stage) echo pactlab-stage ;;
    live | prod) echo pactlab-prod ;;
    *) echo "Unknown environment '$1': use mgmt, dev, qa, stage or live." >&2; exit 2 ;;
  esac
}
account_of() {
  case "$1" in
    pactlab-mgmt) echo 042954450979 ;;
    pactlab-dev) echo 379959319207 ;;
    pactlab-stage) echo 438535681690 ;;
    pactlab-prod) echo 339764561153 ;;
  esac
}
label_of() {
  case "$1" in
    pactlab-mgmt) echo "Pactlab mgmt" ;;
    pactlab-dev) echo "Pactlab dev+qa" ;;
    pactlab-stage) echo "Pactlab stage" ;;
    pactlab-prod) echo "Pactlab LIVE" ;;
  esac
}
colour_of() {
  case "$1" in
    pactlab-prod) echo FF0000 ;;
    pactlab-stage) echo FFA500 ;;
    *) echo 008000 ;;
  esac
}

page_url() {
  case "${1:-home}" in
    home) echo "https://${REGION}.console.aws.amazon.com/console/home?region=${REGION}" ;;
    billing) echo "https://us-east-1.console.aws.amazon.com/billing/home#/" ;;
    cost) echo "https://us-east-1.console.aws.amazon.com/costmanagement/home#/cost-explorer" ;;
    support) echo "https://support.console.aws.amazon.com/support/home#/case/create" ;;
    cases) echo "https://support.console.aws.amazon.com/support/home#/" ;;
    ecs) echo "https://${REGION}.console.aws.amazon.com/ecs/v2/clusters?region=${REGION}" ;;
    rds) echo "https://${REGION}.console.aws.amazon.com/rds/home?region=${REGION}#databases:" ;;
    logs) echo "https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#logsV2:log-groups" ;;
    *) echo "Unknown page '$1': home, billing, cost, support, cases, ecs, rds or logs." >&2; exit 2 ;;
  esac
}

urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
open_url() { if [ "$(uname)" = Darwin ]; then open "$1"; else xdg-open "$1"; fi; }

signed_in() { aws sts get-caller-identity --profile pactlab-mgmt >/dev/null 2>&1; }
need_login() { signed_in || { echo "The terminal isn't signed in (or the session expired). Run: scripts/aws.sh login" >&2; exit 1; }; }

# The management account opens directly; any other account opens through AWS's switch-role page,
# which asks for no password while the browser is signed in to the management console.
open_console() {
  local profile="$1" destination="$2"
  if [ "$profile" = pactlab-mgmt ]; then
    open_url "$destination"
  else
    open_url "https://signin.aws.amazon.com/switchrole?account=$(account_of "$profile")&roleName=${ROLE}&displayName=$(urlencode "$(label_of "$profile")")&color=$(colour_of "$profile")&redirect_uri=$(urlencode "$destination")"
  fi
  echo "Opened $(label_of "$profile") ($(account_of "$profile")) in your browser."
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  login)
    aws login --profile pactlab-mgmt
    signed_in && echo "Signed in. Every account is reachable: scripts/aws.sh whoami" ;;
  whoami)
    need_login
    echo "  as $(aws sts get-caller-identity --profile pactlab-mgmt --query Arn --output text)"
    for env in mgmt dev stage live; do
      profile=$(profile_of "$env")
      if aws sts get-caller-identity --profile "$profile" >/dev/null 2>&1; then reach=ok; else reach="NOT REACHABLE"; fi
      printf '  %-6s %-14s %s  %s\n' "$env" "$profile" "$(account_of "$profile")" "$reach"
    done ;;
  console)
    env="${1:?Usage: scripts/aws.sh console <mgmt|dev|qa|stage|live> [page]}"
    open_console "$(profile_of "$env")" "$(page_url "${2:-home}")" ;;
  support)
    env="${1:?Usage: scripts/aws.sh support <mgmt|dev|qa|stage|live>}"
    open_console "$(profile_of "$env")" "$(page_url support)"
    echo "Basic support: account and billing cases. Billing for every account is on mgmt." ;;
  cases)
    env="${1:?Usage: scripts/aws.sh cases <mgmt|dev|qa|stage|live>}"
    open_console "$(profile_of "$env")" "$(page_url cases)" ;;
  status)
    need_login
    for env in dev qa stage; do
      power=$(aws ssm get-parameter --name "/pactlab/${env}/power" --profile "$(profile_of "$env")" --region "$REGION" --query Parameter.Value --output text 2>/dev/null || echo unknown)
      printf '  %-6s %s\n' "$env" "$power"
    done
    echo "  live   always on" ;;
  cost)
    need_login
    from="${1:-$(date -u +%Y-%m-01)}"
    to="${2:-$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d tomorrow +%Y-%m-%d)}"
    echo "Spend ${from} to ${to} (USD, unblended, credits included)"
    echo "By account:"
    aws ce get-cost-and-usage --profile pactlab-mgmt --region us-east-1 --time-period "Start=${from},End=${to}" --granularity MONTHLY --metrics UnblendedCost \
      --group-by Type=DIMENSION,Key=LINKED_ACCOUNT --query 'ResultsByTime[].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' --output text |
      awk '{ a[$1] += $2 } END { for (k in a) printf "  %s  %10.2f\n", k, a[k] }'
    echo "By environment tag (pactlab:environment):"
    aws ce get-cost-and-usage --profile pactlab-mgmt --region us-east-1 --time-period "Start=${from},End=${to}" --granularity MONTHLY --metrics UnblendedCost \
      --group-by Type=TAG,Key=pactlab:environment --query 'ResultsByTime[].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' --output text |
      awk '{ sub(/^pactlab:environment\$/, "", $1); a[$1 == "" ? "untagged" : $1] += $2 } END { for (k in a) printf "  %-10s %10.2f\n", k, a[k] }'
    echo "Tag status: $(aws ce list-cost-allocation-tags --profile pactlab-mgmt --region us-east-1 --tag-keys pactlab:environment --query 'CostAllocationTags[0].Status' --output text)" ;;
  use)
    env="${1:?Usage: eval \"\$(scripts/aws.sh use <env>)\"}"
    echo "export AWS_PROFILE=$(profile_of "$env") AWS_REGION=${REGION}" ;;
  profiles)
    cat <<PROFILES
# ~/.aws/config. 'scripts/aws.sh login' fills in pactlab-mgmt's sign-in; add the rest once.
[profile pactlab-mgmt]
region = ${REGION}

[profile pactlab-dev]
role_arn = arn:aws:iam::379959319207:role/${ROLE}
source_profile = pactlab-mgmt
region = ${REGION}

[profile pactlab-stage]
role_arn = arn:aws:iam::438535681690:role/${ROLE}
source_profile = pactlab-mgmt
region = ${REGION}

[profile pactlab-prod]
role_arn = arn:aws:iam::339764561153:role/${ROLE}
source_profile = pactlab-mgmt
region = ${REGION}
PROFILES
    ;;
  help | -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "Unknown command '$cmd'. Try: scripts/aws.sh help" >&2; exit 2 ;;
esac
