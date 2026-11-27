#!/usr/bin/env bash
# The CDK context for an environment's shape (ADR 0063), printed as `-c …` flags for every CDK run that synthesizes it:
#   -c pactlab:<env>:power=awake|hibernated
#   -c pactlab:<env>:databaseSource=<snapshot>   once the database was restored from a snapshot. CloudFormation
#                                                 replaces a restored instance with an EMPTY one if a deploy drops it,
#                                                 so every deploy reads it from /pactlab/<env>/database-source.
#   -c pactlab:<env>:sleepCertificateArn=<arn>   the sleep page's us-east-1 certificate
# dev and qa share a base, so the neighbour's shape is printed too (the base sleeps only when both do).
#
# Usage: scripts/power-context.sh <env> [<env>=awake|hibernated ...]   (overrides, e.g. the shape being deployed)
# The environment's own sleep page certificate comes from SLEEP_CERTIFICATE_ARN (its GitHub Environment variable);
# a hibernated neighbour's from its hibernation record. Needs AWS credentials for the account; prints nothing for live.
set -euo pipefail
ENV_NAME="${1:?environment}"; shift
case "$ENV_NAME" in dev | qa | stage) ;; prod | live) exit 0 ;; *) echo "power-context: unknown environment $ENV_NAME" >&2; exit 2 ;; esac
OVERRIDES=" $* "
neighbour() { case "$1" in dev) echo qa ;; qa) echo dev ;; esac; }
param() { aws ssm get-parameter --name "/pactlab/$1/$2" --query Parameter.Value --output text 2>/dev/null || true; }
field() { node -e 'try { const v = JSON.parse(process.argv[1] || "{}")[process.argv[2]]; if (v) console.log(v); } catch { }' "$1" "$2"; }
shape() {
  local forced
  forced=$(printf '%s' "$OVERRIDES" | tr ' ' '\n' | sed -n "s/^$1=//p" | tail -1)
  if [ -n "$forced" ]; then
    case "$forced" in awake | hibernated) echo "$forced"; return ;; *) echo "power-context: $1 must be awake or hibernated" >&2; exit 2 ;; esac
  fi
  # The stack's template is hibernated from the end of a hibernate until a wake's deploy finishes.
  case "$(param "$1" power)" in hibernated | rebuilding) echo hibernated ;; *) echo awake ;; esac
}
context() {
  local env="$1" own="$2" power source record cert
  power=$(shape "$env")
  printf -- ' -c pactlab:%s:power=%s' "$env" "$power"
  source=$(param "$env" database-source)
  if [ "$power" = awake ] && [ -n "$source" ] && [ "$source" != None ]; then printf -- ' -c pactlab:%s:databaseSource=%s' "$env" "$source"; fi
  cert=""
  [ "$own" = own ] && cert="${SLEEP_CERTIFICATE_ARN:-}"
  if [ -z "$cert" ]; then record=$(param "$env" hibernation); cert=$(field "$record" sleepCertificateArn); fi
  if [ -n "$cert" ]; then printf -- ' -c pactlab:%s:sleepCertificateArn=%s' "$env" "$cert"; fi
}
context "$ENV_NAME" own
OTHER=$(neighbour "$ENV_NAME")
[ -z "$OTHER" ] || context "$OTHER" neighbour
echo
