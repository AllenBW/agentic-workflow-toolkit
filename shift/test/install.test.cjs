'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { mergeStopHook } = require('../lib/install.cjs');

const CMD = 'node /abs/path/to/shift/hooks/shift-stop.cjs';
const INSTALL = path.resolve(__dirname, '..', 'install.sh');
const HOOK = path.resolve(__dirname, '..', 'hooks', 'shift-stop.cjs');

function runInstall(home) {
  return cp.execFileSync('bash', [INSTALL], {
    env: { ...process.env, HOME: home }, encoding: 'utf8'
  });
}
function readSettings(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
}

test('adds the Stop hook to empty settings', () => {
  const r = mergeStopHook({}, CMD);
  assert.equal(r.action, 'added');
  assert.equal(r.changed, true);
  const groups = r.settings.hooks.Stop;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], { matcher: '', hooks: [{ type: 'command', command: CMD }] });
});

test('is idempotent — same command twice does not duplicate', () => {
  const once = mergeStopHook({}, CMD).settings;
  const twice = mergeStopHook(once, CMD);
  assert.equal(twice.action, 'unchanged');
  assert.equal(twice.changed, false);
  assert.equal(twice.settings.hooks.Stop.length, 1);
});

test('preserves unrelated hooks and existing Stop groups', () => {
  const existing = {
    statusLine: { type: 'command', command: 'x' },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'other-stop-hook' }] }]
    }
  };
  const r = mergeStopHook(existing, CMD);
  assert.equal(r.action, 'added');
  // unrelated settings + hooks untouched
  assert.deepEqual(r.settings.statusLine, { type: 'command', command: 'x' });
  assert.equal(r.settings.hooks.PreToolUse.length, 1);
  // shift appended, the foreign Stop group kept
  assert.equal(r.settings.hooks.Stop.length, 2);
  assert.equal(r.settings.hooks.Stop[0].hooks[0].command, 'other-stop-hook');
  assert.equal(r.settings.hooks.Stop[1].hooks[0].command, CMD);
});

test('updates the path when the shift hook moved', () => {
  const old = mergeStopHook({}, 'node /old/path/shift/hooks/shift-stop.cjs').settings;
  const r = mergeStopHook(old, CMD);
  assert.equal(r.action, 'updated');
  assert.equal(r.changed, true);
  assert.equal(r.settings.hooks.Stop.length, 1);
  assert.equal(r.settings.hooks.Stop[0].hooks[0].command, CMD);
});

test('does not mutate the input settings object', () => {
  const input = { hooks: { Stop: [] } };
  const snapshot = JSON.stringify(input);
  mergeStopHook(input, CMD);
  assert.equal(JSON.stringify(input), snapshot);
});

test('install.sh wires the hook into a fresh ~/.claude/settings.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-inst-'));
  const out = runInstall(home);
  assert.match(out, /Installed: shift Stop hook/);
  const s = readSettings(home);
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.Stop[0].hooks[0].command, `node ${HOOK}`);
});

test('install.sh is idempotent and preserves existing settings + backs up', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-inst-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'x' } }, null, 2));

  const out1 = runInstall(home);
  assert.match(out1, /Backed up existing settings/);
  const s1 = readSettings(home);
  assert.deepEqual(s1.statusLine, { type: 'command', command: 'x' }); // preserved
  assert.equal(s1.hooks.Stop.length, 1);

  const out2 = runInstall(home);
  assert.match(out2, /Already wired/);
  assert.equal(readSettings(home).hooks.Stop.length, 1); // no duplicate
  const baks = fs.readdirSync(claude).filter(f => f.startsWith('settings.json.bak-'));
  assert.equal(baks.length, 1); // unchanged run made no second backup
});
