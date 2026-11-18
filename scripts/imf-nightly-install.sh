#!/usr/bin/env bash
#
# Install (or remove) the nightly IMF live check on this Mac (T-137 follow-up).
#
#   ./scripts/imf-nightly-install.sh             # install: every night at 02:30
#   ./scripts/imf-nightly-install.sh --now       # install and run once right away
#   ./scripts/imf-nightly-install.sh --remove    # uninstall
#
# If the Mac is asleep at 02:30, launchd runs the check when it next wakes.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="ai.pactlab.imf-nightly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ "${1:-}" == "--remove" ]]; then rm -f "$PLIST"; echo "removed"; exit 0; fi

# launchd starts with a bare PATH: take node, pnpm and git from this shell.
PATHS="$(dirname "$(command -v pnpm)"):$(dirname "$(command -v node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/pactlab"
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/scripts/imf-nightly.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATHS</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/pactlab/imf-nightly.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/pactlab/imf-nightly.launchd.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: nightly at 02:30 · log ~/Library/Logs/pactlab/imf-nightly.log"
if [[ "${1:-}" == "--now" ]]; then
  launchctl kickstart "gui/$(id -u)/$LABEL"
  echo "running now: tail -f ~/Library/Logs/pactlab/imf-nightly.log"
fi
