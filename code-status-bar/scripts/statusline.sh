#!/bin/sh
# statusline.sh — Claude Code statusLine entry point for the Code Status Bar.
#
# Runs the pinned ccstatusline engine that install.sh placed under
# ~/.config/ccstatusline/engine. No network on the render path: `npx -y
# ccstatusline@latest` queries the npm registry on every refresh (~1s), and when
# the registry is unreachable it hangs past Claude Code's timeout and the whole
# bar — context window included — goes blank.
#
# If Orca's status hook is installed, the payload is also forwarded to it, so
# Orca keeps its rate-limit view without replacing this status line.

CONFIG_DIR="${CCSTATUSLINE_CONFIG_DIR:-$HOME/.config/ccstatusline}"
ENGINE="$CONFIG_DIR/engine/node_modules/ccstatusline/dist/ccstatusline.js"
PINNED_VERSION="2.2.32"

payload=$(cat)

ORCA_HOOK="$HOME/.orca/agent-hooks/claude-statusline.sh"
if [ -x "$ORCA_HOOK" ]; then
  printf '%s' "$payload" | /bin/sh "$ORCA_HOOK" >/dev/null 2>&1 &
fi

# Claude Code may launch us with a minimal PATH; fall back to fnm's stable alias.
NODE=$(command -v node 2>/dev/null)
if [ -z "$NODE" ] && [ -x "$HOME/.local/share/fnm/aliases/default/bin/node" ]; then
  NODE="$HOME/.local/share/fnm/aliases/default/bin/node"
fi

if [ -n "$NODE" ] && [ -f "$ENGINE" ]; then
  printf '%s' "$payload" | "$NODE" "$ENGINE"
else
  # Engine missing: still render, but pinned (no @latest registry lookup).
  printf '%s' "$payload" | npx -y "ccstatusline@$PINNED_VERSION"
fi
