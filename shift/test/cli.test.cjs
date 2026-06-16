'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'shift');
// Engine state lives out of the repo; pin its base to a tmp dir for the test process + CLI.
const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-cli-base-'));
process.env.SHIFT_STATE_DIR = STATE_BASE;
const { engineDir } = require('../lib/store.cjs');

function repoWithQueue() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-cli-'));
  cp.execSync('git init -q', { cwd });
  cp.execSync('git config user.email t@t.co', { cwd });
  cp.execSync('git config user.name t', { cwd });
  cp.execSync('git commit -q --allow-empty -m init', { cwd });
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '01.md'), 'bin one');
  return cwd;
}

function run(cwd, args) {
  return cp.execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, SHIFT_STATE_DIR: STATE_BASE } });
}

test('--dry-run lists the queue and writes nothing', () => {
  const cwd = repoWithQueue();
  const out = run(cwd, ['start', '--dry-run']);
  assert.match(out, /queue\/01\.md/);
  assert.ok(!fs.existsSync(path.join(engineDir(cwd), 'state.json')));
});

test('start writes config (repo) + state (engine dir) and creates the run branch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'config.json')), 'config stays in the repo (user-editable)');
  assert.ok(fs.existsSync(path.join(engineDir(cwd), 'state.json')), 'engine state lives out of the repo');
  assert.ok(!fs.existsSync(path.join(cwd, '.shift', 'state.json')), 'no state.json in the repo for the agent to clobber');
  const branch = cp.execSync('git branch --show-current', { cwd, encoding: 'utf8' }).trim();
  assert.match(branch, /^shift\//);
  const state = JSON.parse(fs.readFileSync(path.join(engineDir(cwd), 'state.json'), 'utf8'));
  assert.equal(state.bins.length, 1);
});

test('stop creates the kill switch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  run(cwd, ['stop']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'STOP')));
});

test('a second `shift start` scrubs stale control/blocker signals from the prior run', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  const dir = path.join(cwd, '.shift');
  // Simulate residue from a prior run: a stale skip, pause, blocker, kill switch, summary.
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  fs.writeFileSync(path.join(dir, 'PAUSE'), '');
  fs.writeFileSync(path.join(dir, 'SKIP'), 'queue/01.md');
  fs.writeFileSync(path.join(dir, 'blocked.jsonl'), JSON.stringify({ id: 'queue/01.md', note: 'stale' }) + '\n');
  fs.writeFileSync(path.join(dir, 'summary.md'), '# stale\n');
  run(cwd, ['start']);
  for (const f of ['STOP', 'PAUSE', 'SKIP', 'blocked.jsonl', 'summary.md']) {
    assert.ok(!fs.existsSync(path.join(dir, f)), `${f} must not survive a fresh start (would corrupt the new run)`);
  }
});
