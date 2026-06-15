#!/usr/bin/env bash
# shift installer — Agentic Workflow Toolkit (module 2)
# Wires shift's Stop hook into ~/.claude/settings.json, idempotently.
#
# Unlike the status-bar installer, this one is LOCAL-ONLY: the hook entry points at
# this clone's hooks/shift-stop.cjs by absolute path, so it must run from the files
# on disk (no curl | bash). Re-running after `git pull` (or after moving the repo)
# updates the path in place — it never duplicates the hook.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Error: shift needs Node on your PATH (the hook + this installer run via node)." >&2
  exit 1
fi

# Resolve this script's directory; the hook lives next to it under hooks/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
HOOK="$SCRIPT_DIR/hooks/shift-stop.cjs"
MERGER="$SCRIPT_DIR/lib/install.cjs"
if [ -z "$SCRIPT_DIR" ] || [ ! -f "$HOOK" ] || [ ! -f "$MERGER" ]; then
  echo "Error: run this from a shift clone — couldn't find hooks/shift-stop.cjs next to install.sh." >&2
  echo "       (clone the toolkit, then: bash shift/install.sh)" >&2
  exit 1
fi

COMMAND="node $HOOK"
SETTINGS_DIR="$HOME/.claude"
DEST="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

# Compute the merged settings into a temp file via the unit-tested merger, then
# move it into place — a failed merge never leaves a broken settings.json behind.
TMP="$(mktemp)"
ACTION="$(node -e '
  const fs = require("node:fs");
  const { mergeStopHook } = require(process.argv[1]);
  const dest = process.argv[2], command = process.argv[3], tmp = process.argv[4];
  let settings = {};
  if (fs.existsSync(dest)) {
    const raw = fs.readFileSync(dest, "utf8").trim();
    if (raw) {
      try { settings = JSON.parse(raw); }
      catch { console.error("Error: " + dest + " is not valid JSON; fix or move it, then re-run."); process.exit(2); }
    }
  }
  const r = mergeStopHook(settings, command);
  fs.writeFileSync(tmp, JSON.stringify(r.settings, null, 2) + "\n");
  process.stdout.write(r.action);
' "$MERGER" "$DEST" "$COMMAND" "$TMP")" || { rm -f "$TMP"; exit 1; }

if [ ! -s "$TMP" ]; then
  echo "Error: merge produced an empty file; aborting (your settings are untouched)." >&2
  rm -f "$TMP"; exit 1
fi

if [ "$ACTION" = "unchanged" ]; then
  echo "Already wired: shift Stop hook is present in $DEST (no change)."
  rm -f "$TMP"
else
  if [ -f "$DEST" ]; then
    BAK="$DEST.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$DEST" "$BAK"
    echo "Backed up existing settings -> $BAK"
  fi
  mv "$TMP" "$DEST"
  case "$ACTION" in
    added)   echo "Installed: shift Stop hook -> $DEST" ;;
    updated) echo "Updated: shift Stop hook path -> $DEST" ;;
    *)       echo "Wrote: $DEST ($ACTION)" ;;
  esac
fi

echo "  hook: $COMMAND"
echo
echo "Safe globally — the hook no-ops in any repo without an active .shift/ run."
echo "Next: cd into a repo, add briefs under queue/, then: ${SCRIPT_DIR}/bin/shift start"
echo "(optional) put it on PATH:  ln -s ${SCRIPT_DIR}/bin/shift /usr/local/bin/shift"
echo
echo "To remove later, delete the shift Stop entry from $DEST (restore a .bak-* backup)."
