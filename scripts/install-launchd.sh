#!/bin/sh
# Installs (or with --remove, removes) the Mac's only job: the voice worker.
#   com.echoes.poet.voice   at login and every 30 minutes → keeps voice Reels ready for the next drafts
#                           (scripts/voice-worker.mjs; logs in logs/voice.*.log)
# Drafting and publishing run on GitHub Actions. The old Mac publishing agents (generate / publish /
# refresh) are removed here too: running them as well would post twice.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"
VOICE="com.echoes.poet.voice"

unload() { launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true; rm -f "$AGENTS/$1.plist"; }

for old in com.echoes.poet.generate com.echoes.poet.publish com.echoes.poet.refresh; do unload "$old"; done

if [ "$1" = "--remove" ]; then
  unload "$VOICE"
  echo "Removed $VOICE."
  exit 0
fi

[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }
mkdir -p "$AGENTS" "$DIR/logs"
cat > "$AGENTS/$VOICE.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$VOICE</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/scripts/voice-worker.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/logs/voice.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/voice.err.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$VOICE" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENTS/$VOICE.plist"
echo "Installed $VOICE (at login and every 30 minutes)."
