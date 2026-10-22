#!/usr/bin/env bash
#
# build.sh — regenerate the public synthetic demo data set
# (https://github.com/kuramach/pactlab-demo-data): <pack>/<CURRENCY>/files.
#
# Usage: ./scripts/demo-data/build.sh <out_dir>
#   1. generate.py writes CSVs, Markdown documents and READMEs (deterministic).
#   2. The FreshCo kit builder (apps/api/src/ops/test-kit.ts) turns each
#      documents/*.md into a PDF, so PDFs match what Pactlab's upload reads.
# Then copy <out_dir>/* over a clone of pactlab-demo-data and open a PR there.
# Synthetic data only — never edit real data into the generator.
#
set -euo pipefail
OUT="${1:?usage: build.sh <out_dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

python3 "$ROOT/scripts/demo-data/generate.py" "$OUT" >/dev/null

n=0
for d in "$OUT"/*/*/; do
  t="$WORK/$(basename "$(dirname "$d")")-$(basename "$d")"
  mkdir -p "$t/documents"
  cp "$d"documents/*.md "$t/documents/"
  # The kit builder also expects a subscriptions file; its billing output is discarded.
  printf 'customer_id,customer_name,plan,currency,monthly_amount,start_month,end_month,change_month,changed_monthly_amount\nx-0001,Placeholder,Plan,USD,1.00,2026-09,,,\n' >"$t/subscriptions.csv"
  (cd "$ROOT/apps/api" && pnpm exec tsx src/ops/test-kit.ts "$t" 2026-09 >/dev/null)
  cp "$t"/generated/*.pdf "$d"documents/
  n=$((n + 1))
done
echo "demo data: $n pack/currency folders in $OUT"
