#!/usr/bin/env bash
#
# loop-autostart-install.sh — install or remove the launchd agent ai.pactlab.loop.
# Usage: scripts/loop-autostart-install.sh install | uninstall
# install records the real paths of claude, git and caffeinate (launchd has a minimal PATH).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="ai.pactlab.loop"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CONFIG="$HOME/.config/pactlab/loop-autostart.env"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    for tool in claude git caffeinate; do
      command -v "$tool" >/dev/null || { echo "$tool not found on PATH" >&2; exit 1; }
    done
    mkdir -p "$(dirname "$CONFIG")" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/pactlab-loop"
    {
      echo "CLAUDE_BIN='$(command -v claude)'"
      echo "GIT_BIN='$(command -v git)'"
      echo "CAFFEINATE_BIN='$(command -v caffeinate)'"
      echo "PATH='$(dirname "$(command -v claude)"):$(dirname "$(command -v git)"):$(dirname "$(command -v gh 2>/dev/null || echo /usr/bin/gh)"):$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)"):/usr/bin:/bin:/usr/sbin:/sbin'"
      echo "export PATH"
    } >"$CONFIG"
    sed -e "s#__REPO_ROOT__#$REPO_ROOT#g" -e "s#__HOME__#$HOME#g" \
      "$REPO_ROOT/scripts/launchd/$LABEL.plist" >"$PLIST"
    plutil -lint "$PLIST"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "installed $LABEL (probe every 30 min; log: ~/Library/Logs/pactlab-loop/loop.log)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL (config $CONFIG left in place)"
    ;;
  *) echo "usage: $0 install|uninstall" >&2; exit 2 ;;
esac
