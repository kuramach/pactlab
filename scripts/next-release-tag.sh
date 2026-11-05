#!/usr/bin/env bash
# The next release tag for a month (T-100): CalVer vYYYY.MM.N, N = highest in that month + 1.
# Existing tags arrive on stdin (one per line, e.g. `git tag --list 'v*'`); other months and
# anything that is not a release tag are ignored, and gaps never matter.
# Usage: git tag --list 'v*' | scripts/next-release-tag.sh 2026.11      → v2026.11.1, v2026.11.4, …
set -euo pipefail
MONTH="${1:-}"
if ! [[ "$MONTH" =~ ^[0-9]{4}\.(0[1-9]|1[0-2])$ ]]; then
  echo "usage: next-release-tag.sh YYYY.MM   (existing tags on stdin)" >&2
  exit 2
fi
HIGHEST=0
while IFS= read -r TAG; do
  if [[ "$TAG" =~ ^v${MONTH//./\\.}\.([1-9][0-9]*)$ ]] && (( BASH_REMATCH[1] > HIGHEST )); then HIGHEST=${BASH_REMATCH[1]}; fi
done
echo "v${MONTH}.$((HIGHEST + 1))"
