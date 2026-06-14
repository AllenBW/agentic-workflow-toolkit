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

if [ "$COLORED" -eq 1 ] && ! command -v node >/dev/null 2>&1; then
  echo "Error: --colored needs Node on your PATH (the helper runs via node)." >&2
  echo "Install Node, or use the default (no-flag) config." >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"

# Only treat the script's directory as a real clone if it actually contains this
# module (both files present). When run via `curl | bash`, BASH_SOURCE is unset and
# this stays 0, so we always download instead of copying a stray local file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
LOCAL_OK=0
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install.sh" ] && [ -f "$SCRIPT_DIR/settings.json" ]; then
  LOCAL_OK=1
fi

# fetch <relative-path> <destination>: download (or copy from a verified clone) to a
# temp file, validate, then move into place — so a failed fetch never leaves a broken
# or empty config at the destination.
fetch() {
  local rel="$1" out="$2" tmp
  tmp="$(mktemp)"
  if [ "$LOCAL_OK" -eq 1 ] && [ -f "$SCRIPT_DIR/$rel" ]; then
    cp "$SCRIPT_DIR/$rel" "$tmp"
  else
    curl -fsSL "$REPO_RAW/$rel" -o "$tmp"
  fi
  if [ ! -s "$tmp" ]; then
    echo "Error: fetched '$rel' is empty; aborting (your existing config is untouched)." >&2
    rm -f "$tmp"; exit 1
  fi
  case "$rel" in
    *.json)
      if command -v node >/dev/null 2>&1; then
        node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$tmp" 2>/dev/null \
          || { echo "Error: fetched '$rel' is not valid JSON; aborting." >&2; rm -f "$tmp"; exit 1; }
      fi
      ;;
  esac
  mv "$tmp" "$out"
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
