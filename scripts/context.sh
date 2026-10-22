#!/usr/bin/env bash
#
# context.sh — assemble the context a headless agent run starts with, by tier.
#
# Usage: ./scripts/context.sh <task-file> <light|standard|deep> [repo-root]
# Prints the context to stdout; warnings go to stderr.
#
#   light     repo map, the task file, and the files under Touches: (capped)
#   standard  light + the spec sections and docs mapped to the task's Lane:
#             (docs/agent/context-map.tsv)
#   deep      light + the whole spec, every ADR, docs/agent/ and PARALLEL_OPS
#
# CLAUDE.md is not included: Claude Code loads it on every run regardless, so
# it is the always-on core and is counted separately by run-task.sh.
#
set -euo pipefail

TASK="${1:?usage: context.sh <task-file> <tier> [repo-root]}"
TIER="${2:?usage: context.sh <task-file> <tier> [repo-root]}"
ROOT="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SPEC="$ROOT/docs/spec/Claude Code Specification.md"
MAP="$ROOT/docs/agent/context-map.tsv"
TOUCH_CAP="${TOUCH_CAP:-24000}"   # max characters of Touches: file contents

case "$TIER" in light|standard|deep) ;; *) echo "unknown tier: $TIER" >&2; exit 2 ;; esac

field() { grep -E "^$1:" "$TASK" | head -1 | sed "s/^$1:[[:space:]]*//" || true; }

emit_file() { # emit_file <repo-relative path>
  [[ -f "$ROOT/$1" ]] || { echo "context: missing $1" >&2; return 0; }
  printf '\n===== %s =====\n' "$1"
  cat "$ROOT/$1"
}

spec_section() { # spec_section <number> — one "## N. " section of the spec
  awk -v n="$1" '
    /^## / { on = ($0 ~ "^## " n "\\. ") }
    on' "$SPEC"
}

echo "# Context for this run (tier: $TIER)"
echo
echo "CLAUDE.md is already loaded. Its on-demand docs table says where everything else lives;"
echo "open those only if the task needs them."

echo
echo "===== repo map ====="
(cd "$ROOT" && git ls-files | awk -F/ 'NF>1 { d=$1; if (NF>2) d=d"/"$2; print d"/" }' | sort -u | grep -v -E '^(tasks|fixtures/cassettes)/')

echo
echo "===== task file: ${TASK#"$ROOT"/} ====="
cat "$TASK"

# Files under Touches: — contents for files, a path listing for directories, capped.
used=0
for t in $(field Touches); do
  [[ "$t" == "tasks" || "$t" == tasks/* ]] && continue
  if [[ -f "$ROOT/$t" ]]; then
    size=$(wc -c <"$ROOT/$t")
    if (( used + size <= TOUCH_CAP )); then emit_file "$t"; used=$((used + size)); else printf '\n(%s omitted: over the %s-character cap; read it if needed)\n' "$t" "$TOUCH_CAP"; fi
  elif [[ -d "$ROOT/$t" ]]; then
    printf '\n===== files under %s (paths only) =====\n' "$t"
    (cd "$ROOT" && git ls-files -- "$t" | head -200)
  fi
done

if [[ "$TIER" == standard ]]; then
  lane="$(field Lane)"
  row="$(awk -F'\t' -v l="$lane" '!/^#/ && $1 == l' "$MAP" | head -1)"
  if [[ -z "$row" ]]; then
    echo "context: lane '${lane:-<none>}' is not in docs/agent/context-map.tsv — standard falls back to the core" >&2
  else
    sections="$(cut -f2 <<<"$row")"
    docs="$(cut -f3 <<<"$row")"
    for n in ${sections//,/ }; do
      printf '\n===== spec §%s =====\n' "$n"
      spec_section "$n"
    done
    for d in $docs; do emit_file "$d"; done
  fi
fi

if [[ "$TIER" == deep ]]; then
  emit_file "docs/spec/Claude Code Specification.md"
  for f in "$ROOT"/docs/adr/*.md "$ROOT"/docs/agent/*.md; do emit_file "${f#"$ROOT"/}"; done
  emit_file "docs/PARALLEL_OPS.md"
fi
