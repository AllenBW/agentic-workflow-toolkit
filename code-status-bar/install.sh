#!/usr/bin/env bash
# Code Status Bar installer — Agentic Workflow Toolkit
# Default: installs the portable, zero-dependency config.
#   --colored : installs the status-driven color variant (places a Node helper script).
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/AllenBW/agentic-workflow-toolkit/main/code-status-bar"
CONFIG_DIR="$HOME/.config/ccstatusline"
SCRIPTS_DIR="$CONFIG_DIR/scripts"
DEST="$CONFIG_DIR/settings.json"

COLORED=0
[ "${1:-}" = "--colored" ] && COLORED=1

mkdir -p "$CONFIG_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

# fetch <relative-path> <destination> — prefer a local clone, fall back to download.
fetch() {
  local rel="$1" out="$2"
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$rel" ]; then
    cp "$SCRIPT_DIR/$rel" "$out"
  else
    curl -fsSL "$REPO_RAW/$rel" -o "$out"
  fi
}

if [ -f "$DEST" ]; then
  BAK="$DEST.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$DEST" "$BAK"
  echo "Backed up existing config -> $BAK"
fi

if [ "$COLORED" -eq 1 ]; then
  mkdir -p "$SCRIPTS_DIR"
  fetch "scripts/usage-bar.cjs" "$SCRIPTS_DIR/usage-bar.cjs"
  fetch "settings.colored.json" "$DEST"
  echo "Installed COLORED variant -> $DEST"
  echo "Helper script           -> $SCRIPTS_DIR/usage-bar.cjs"
  echo "(needs Node on your PATH at render time — ccstatusline already provides it)"
else
  fetch "settings.json" "$DEST"
  echo "Installed -> $DEST"
fi

echo
echo "Next, make sure ~/.claude/settings.json points its status line at ccstatusline:"
cat <<'EOF'
  "statusLine": { "type": "command", "command": "npx -y ccstatusline@latest", "padding": 0, "refreshInterval": 10 }
EOF
echo
echo "Then open a new Claude Code session. The reset timestamp localizes to your timezone automatically."
