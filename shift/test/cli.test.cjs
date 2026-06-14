'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'shift');

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
  return cp.execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('--dry-run lists the queue and writes nothing', () => {
  const cwd = repoWithQueue();
  const out = run(cwd, ['start', '--dry-run']);
  assert.match(out, /queue\/01\.md/);
  assert.ok(!fs.existsSync(path.join(cwd, '.shift', 'state.json')));
});

test('start writes config + state and creates the run branch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'state.json')));
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'config.json')));
  const branch = cp.execSync('git branch --show-current', { cwd, encoding: 'utf8' }).trim();
  assert.match(branch, /^shift\//);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, '.shift', 'state.json'), 'utf8'));
  assert.equal(state.bins.length, 1);
});

test('stop creates the kill switch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  run(cwd, ['stop']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'STOP')));
});
