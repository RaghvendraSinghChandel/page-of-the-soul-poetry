#!/bin/sh
# Installs (or with --remove, removes) three launchd agents for this Mac user:
#   com.echoes.poet.generate  every day 07:00  → drafts POSTS_PER_RUN posts into output/<date>/
#   com.echoes.poet.publish   09:00, 14:00, 20:30 → publishes the oldest draft (does nothing while
#                                                    PUBLISH_TO_INSTAGRAM=false)
#   com.echoes.poet.refresh   Sunday 23:30       → renews the 60-day Instagram token in .env
# Times are the Mac's local time. A run missed while the Mac sleeps starts when it wakes.
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"
GEN="com.echoes.poet.generate"
PUB="com.echoes.poet.publish"
REF="com.echoes.poet.refresh"

unload() { launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true; rm -f "$AGENTS/$1.plist"; }

if [ "$1" = "--remove" ]; then
  unload "$GEN"; unload "$PUB"; unload "$REF"
  echo "Removed $GEN, $PUB and $REF."
  exit 0
fi

[ -n "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }
mkdir -p "$AGENTS" "$DIR/logs"

plist() { # label, command, calendar-dicts
  cat > "$AGENTS/$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/src/cli.js</string><string>$2</string></array>
  <key>StartCalendarInterval</key>
  <array>$3</array>
  <key>StandardOutPath</key><string>$DIR/logs/$2.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/$2.err.log</string>
</dict>
</plist>
EOF
  unload_only() { launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true; }
  unload_only "$1"
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
}

at() { echo "<dict>${3:+<key>Weekday</key><integer>$3</integer>}<key>Hour</key><integer>$1</integer><key>Minute</key><integer>$2</integer></dict>"; }

plist "$GEN" generate "$(at 7 0)"
plist "$PUB" publish-next "$(at 9 0)$(at 14 0)$(at 20 30)"
plist "$REF" refresh-token "$(at 23 30 0)"
echo "Installed $GEN (daily 07:00), $PUB (09:00, 14:00, 20:30) and $REF (Sunday 23:30)."
launchctl print "gui/$(id -u)/$GEN" | grep -E "state|path" | head -3
