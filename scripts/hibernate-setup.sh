#!/usr/bin/env bash
# One-time hibernation setup for one environment (docs/runbooks/hibernate.md, "One-time setup"), as one guided run.
#   scripts/hibernate-setup.sh stage        (then dev, then qa)
# Run it after that environment has been deployed once with T-189 (it needs the AppZoneNameServers output).
# It asks before each change, never prints a secret, and is safe to run again: finished steps are skipped.
set -euo pipefail
ENV="${1:?usage: scripts/hibernate-setup.sh dev|qa|stage}"
case "$ENV" in
  dev|qa) PROFILE=pactlab-dev ;;
  stage)  PROFILE=pactlab-stage ;;
  *) echo "Only dev, qa or stage (never live)."; exit 2 ;;
esac
REPO=kuramach/pactlab
REGION=us-east-2
HOST="app.$ENV.pactlab.ai"
CAP="$(tr '[:lower:]' '[:upper:]' <<<"${ENV:0:1}")${ENV:1}"
STACK="Pactlab$CAP"
ACCESS="Pactlab${CAP}DeployAccess"
ask() { read -r -p "$1 [Enter to continue, n to skip] " a; [[ "$a" != "n" ]]; }
out() { aws cloudformation describe-stacks --stack-name "$1" --profile "$PROFILE" --region "$REGION" \
          --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null || true; }

aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1 || { echo "Sign in first: aws sso login --profile $PROFILE"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login"; exit 1; }

echo "== 1. The deploy"
NS="$(out "$STACK" AppZoneNameServers)"
[[ -z "$NS" || "$NS" == None ]] && { echo "$STACK has no AppZoneNameServers yet: deploy $ENV first (ask Claude: \"deploy $ENV\")."; exit 1; }
echo "   $STACK is deployed with its Route 53 zone."

echo "== 2. Namecheap: point $HOST at AWS"
if dig NS "$HOST" +short | grep -qi awsdns; then
  echo "   Already delegated."
else
  echo "   In Namecheap → pactlab.ai → Advanced DNS, add four NS records, host \"app.$ENV\":"
  for n in $(tr ',' ' ' <<<"$NS"); do echo "      NS   app.$ENV   ${n%.}."; done
  echo "   Then delete the old CNAME \"app.$ENV\" and its \"_…app.$ENV\" validation CNAME."
  read -r -p "   Press Enter once saved (checking every 30s, up to 30 min)…" _
  for _ in $(seq 1 60); do dig NS "$HOST" +short | grep -qi awsdns && break; sleep 30; done
  dig NS "$HOST" +short | grep -qi awsdns && echo "   Delegated." || { echo "   Not visible yet; run this script again later."; exit 1; }
fi

echo "== 3. The sleep page's certificate (us-east-1)"
CERT="$(aws acm list-certificates --region us-east-1 --profile "$PROFILE" \
         --query "CertificateSummaryList[?DomainName=='$HOST'].CertificateArn | [0]" --output text)"
if [[ -z "$CERT" || "$CERT" == None ]]; then
  ask "   Request a certificate for $HOST?" || exit 1
  CERT="$(aws acm request-certificate --region us-east-1 --profile "$PROFILE" --domain-name "$HOST" --validation-method DNS --query CertificateArn --output text)"
fi
for _ in $(seq 1 40); do
  S="$(aws acm describe-certificate --region us-east-1 --profile "$PROFILE" --certificate-arn "$CERT" --query Certificate.Status --output text)"
  [[ "$S" == ISSUED ]] && break
  [[ "$_" == 1 ]] && echo "   Waiting for ISSUED (the zone usually holds the validation record already)…"
  sleep 30
done
[[ "$S" == ISSUED ]] || { echo "   Still $S. Add this record in the Route 53 console (zone $HOST), then run again:";
  aws acm describe-certificate --region us-east-1 --profile "$PROFILE" --certificate-arn "$CERT" --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output table; exit 1; }
echo "   Issued."

echo "== 4. The power roles"
POWER="$(out "$ACCESS" PowerRoleArn)"; READ="$(out "$ACCESS" PowerReadRoleArn)"
if [[ -z "$POWER" || "$POWER" == None || -z "$READ" || "$READ" == None ]]; then
  LIVE="$(aws sts get-caller-identity --profile pactlab-prod --query Account --output text 2>/dev/null || true)"
  [[ -z "$LIVE" ]] && { echo "   Sign in to live too (aws sso login --profile pactlab-prod): its account id is needed."; exit 1; }
  ask "   Deploy the power roles for $ENV?" || exit 1
  if [[ "$ENV" == stage ]]; then PACTLAB_LIVE_ACCOUNT="$LIVE" scripts/deploy-access.sh stage
  else PACTLAB_LIVE_ACCOUNT="$LIVE" scripts/deploy-access.sh dev qa; fi
  POWER="$(out "$ACCESS" PowerRoleArn)"; READ="$(out "$ACCESS" PowerReadRoleArn)"
fi
echo "   $POWER"

echo "== 5. GitHub Environments"
ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
gh api -X PUT "repos/$REPO/environments/$ENV-power" --input - >/dev/null <<JSON
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api "repos/$REPO/environments/$ENV-power/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main \
  || gh api -X POST "repos/$REPO/environments/$ENV-power/deployment-branch-policies" -f name=main -f type=branch >/dev/null
gh variable set SLEEP_CERTIFICATE_ARN --env "$ENV" --repo "$REPO" --body "$CERT"
gh variable set SLEEP_CERTIFICATE_ARN --env "$ENV-power" --repo "$REPO" --body "$CERT"
gh variable set AWS_POWER_ROLE_ARN --env "$ENV-power" --repo "$REPO" --body "$POWER"
gh variable set AWS_ACCOUNT_ID --env "$ENV-power" --repo "$REPO" --body "$ACCOUNT"
CUR="$(gh variable get POWER_READ_ROLE_ARNS --env live --repo "$REPO" 2>/dev/null || true)"
NEW="$( (tr ',' '\n' <<<"$CUR" | grep -v "^$ENV=" | grep -v '^$'; echo "$ENV=$READ") | sort | paste -sd, -)"
gh variable set POWER_READ_ROLE_ARNS --env live --repo "$REPO" --body "$NEW"
echo "   $ENV-power (main only, no reviewers) and the variables are set. Live's Hosting cost page reads them after live's next deploy."

echo "== 6. The Wake up button's token"
echo "   Create a fine-grained token: github.com → Settings → Developer settings → Fine-grained tokens."
echo "   Name pactlab-env-power, repository kuramach/pactlab only, permission Actions: read and write, nothing else."
read -r -s -p "   Paste it here (hidden; Enter alone skips): " TOKEN; echo
if [[ -n "$TOKEN" ]]; then printf '%s' "$TOKEN" | scripts/github-power-key.sh "$ENV"; unset TOKEN; fi

echo "Done for $ENV. Try it: scripts/env-hibernate.sh $ENV --dry-run"
