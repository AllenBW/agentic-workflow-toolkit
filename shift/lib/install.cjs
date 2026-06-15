'use strict';
// Pure logic for wiring shift's Stop hook into a Claude Code settings object.
// The I/O (read/back-up/validate/write ~/.claude/settings.json) lives in install.sh;
// this stays a pure function so it can be unit-tested without touching the filesystem.

// A command string belongs to shift if it invokes our Stop hook script.
function isShiftCommand(command) {
  return typeof command === 'string' && command.includes('shift-stop.cjs');
}

function makeGroup(command) {
  return { matcher: '', hooks: [{ type: 'command', command }] };
}

// mergeStopHook(settings, command) -> { settings, changed, action }
//   action: 'added' (no prior shift hook) | 'updated' (path changed) | 'unchanged' (already wired).
// Never mutates the input; returns a fresh deep-ish copy of the parts it touches.
function mergeStopHook(settings, command) {
  const next = { ...(settings || {}) };
  const hooks = { ...(next.hooks || {}) };
  const stop = Array.isArray(hooks.Stop) ? hooks.Stop.map(g => ({ ...g })) : [];

  // Find an existing group that already points at shift's hook.
  const idx = stop.findIndex(g =>
    Array.isArray(g.hooks) && g.hooks.some(h => isShiftCommand(h && h.command)));

  let action;
  if (idx === -1) {
    stop.push(makeGroup(command));
    action = 'added';
  } else {
    const current = stop[idx].hooks.find(h => isShiftCommand(h && h.command));
    if (current.command === command) {
      action = 'unchanged';
    } else {
      // Repo moved: rewrite that group to the canonical single shift command.
      stop[idx] = makeGroup(command);
      action = 'updated';
    }
  }

  hooks.Stop = stop;
  next.hooks = hooks;
  return { settings: next, changed: action !== 'unchanged', action };
}

module.exports = { mergeStopHook, isShiftCommand };
