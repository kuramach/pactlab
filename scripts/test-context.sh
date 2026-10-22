#!/usr/bin/env bash
#
# test-context.sh — checks for the context tiers (scripts/context.sh).
#   1. a light docs/task-file-only task starts with <= 25% of a deep run's context
#   2. standard adds the lane's spec sections; an unmapped lane warns
#   3. every Lane: used by a task file is in docs/agent/context-map.tsv
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

cat >"$TMP/light.md" <<'T'
# T-999 — Fix a typo in the runbook index
Context: light
Touches: docs/runbooks/README.md tasks
Lane: hardening
T
core=$(wc -c <"$ROOT/CLAUDE.md")
light=$(( core + $("$ROOT/scripts/context.sh" "$TMP/light.md" light "$ROOT" | wc -c) ))
deep=$(( core + $("$ROOT/scripts/context.sh" "$TMP/light.md" deep "$ROOT" | wc -c) ))
pct=$(( light * 100 / deep ))
echo "light=$light deep=$deep (${pct}%)"
(( light * 4 <= deep )) || fail "light is ${pct}% of deep (limit 25%)"

std="$("$ROOT/scripts/context.sh" "$TMP/light.md" standard "$ROOT")"
grep -q '^===== spec §13 =====' <<<"$std" || fail "standard for hardening lacks spec §13"
grep -q '^## 13\. ' <<<"$std" || fail "spec §13 body missing"
grep -q '^## 12\. ' <<<"$std" && fail "standard leaked an unmapped spec section"

sed 's/^Lane: .*/Lane: no-such-lane/' "$TMP/light.md" >"$TMP/unmapped.md"
"$ROOT/scripts/context.sh" "$TMP/unmapped.md" standard "$ROOT" 2>&1 >/dev/null | grep -q 'not in docs/agent/context-map.tsv' \
  || fail "unmapped lane did not warn"

missing=""
for lane in $(grep -h '^Lane:' "$ROOT"/tasks/*/*.md 2>/dev/null | sed 's/^Lane:[[:space:]]*//' | sort -u); do
  awk -F'\t' -v l="$lane" '!/^#/ && $1 == l { found = 1 } END { exit !found }' "$ROOT/docs/agent/context-map.tsv" || missing+=" $lane"
done
[[ -z "$missing" ]] || fail "lanes missing from context-map.tsv:$missing"

echo "context tiers: ok"
