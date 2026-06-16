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

const { appendRecord } = require('../lib/history.cjs');

function runSafe(cwd, args) { // capture output + exit code even on non-zero exit
  try { return { out: run(cwd, args), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status }; }
}

test('status (plain) shows the run + bins lines, a PAUSED suffix, and a no-run message', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  const out = run(cwd, ['status']);
  assert.match(out, /run .* · branch shift\/.* · iter 0/);
  assert.match(out, /bins: .*done.*blocked.*skipped.*pending.*\(\dm\)/);
  fs.writeFileSync(path.join(cwd, '.shift', 'PAUSE'), '');
  assert.match(run(cwd, ['status']), /· PAUSED/);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-norun-'));
  assert.match(run(fresh, ['status']), /No active shift run here/);
});

test('status --line prints a line while running and suppresses it once finalized', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  const line = run(cwd, ['status', '--line']);
  assert.match(line, /⚙ shift/);
  assert.match(line, /\x1b\[/, 'default is colored');
  const plain = run(cwd, ['status', '--line', '--no-color']);
  assert.match(plain, /⚙ shift \d+\/\d+/);
  assert.doesNotMatch(plain, /\x1b\[/, '--no-color strips ANSI');
  fs.writeFileSync(path.join(cwd, '.shift', 'summary.md'), '# done\n'); // finalize
  assert.equal(run(cwd, ['status', '--line']).trim(), '', 'status-bar line vanishes once finalized');
});

test('history <runId> drills into one run; a branch suffix resolves; unknown -> message', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  const edir = engineDir(cwd);
  const rec = (runId, branch, perBin) => ({
    runId, branch, startedAt: '2026-06-16T00:00:00Z', endedAt: '2026-06-16T00:10:00Z',
    durationMs: 600000, iterations: 2, endReason: 'queue empty',
    bins: { total: 2, done: 1, skipped: 1, blocked: 0 }, tokens: { output: 1000, total: 5000 }, perBin
  });
  appendRecord(edir, rec('R1', 'shift/alpha', [
    { id: 'queue/01.md', status: 'done', durationMs: 60000, tokensOutput: 500, commit: 'abc1234def' },
    { id: 'queue/02.md', status: 'skipped', durationMs: null, tokensOutput: null, commit: null }
  ]));
  appendRecord(edir, rec('R2', 'shift/beta', [
    { id: 'queue/01.md', status: 'blocked', durationMs: 1000, tokensOutput: 9, commit: null }
  ]));

  const r1 = run(cwd, ['history', 'R1']);
  assert.match(r1, /run R1 · shift\/alpha/);
  assert.match(r1, /✓ queue\/01\.md/);   // done glyph
  assert.match(r1, /⤫ queue\/02\.md/);   // skipped glyph
  assert.match(r1, /abc1234/);           // commit short sha
  assert.match(run(cwd, ['history', 'beta']), /✗ queue\/01\.md/); // branch-suffix → R2's blocked bin
  assert.match(run(cwd, ['history', 'does-not-exist']), /No recorded run matching/);
});

test('unknown subcommand prints usage and exits non-zero', () => {
  const r = runSafe(repoWithQueue(), ['bogus']);
  assert.equal(r.code, 1);
  assert.match(r.out, /usage: shift <start\|run\|watch\|history\|status\|stop>/);
});

test('start shallow-merges a partial .shift/config.json over the defaults', () => {
  const cwd = repoWithQueue();
  fs.mkdirSync(path.join(cwd, '.shift'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.shift', 'config.json'),
    JSON.stringify({ definitionOfDone: 'custom DoD', git: { branch: 'shift/custom' } }));
  run(cwd, ['start']);
  const repoCfg = JSON.parse(fs.readFileSync(path.join(cwd, '.shift', 'config.json'), 'utf8'));
  const snapCfg = JSON.parse(fs.readFileSync(path.join(engineDir(cwd), 'config.json'), 'utf8'));
  assert.equal(repoCfg.definitionOfDone, 'custom DoD');  // user override wins
  assert.equal(repoCfg.permissionMode, 'acceptEdits');   // unspecified default survives
  assert.equal(repoCfg.git.branch, 'shift/custom');       // shallow merge: user git object replaces default git
  assert.deepEqual(repoCfg, snapCfg);                     // repo copy + engine snapshot are identical
});

test('a second `shift start` preserves the work record while resetting run state', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  const edir = engineDir(cwd);
  fs.appendFileSync(path.join(edir, 'history.jsonl'), JSON.stringify({ runId: 'PRIOR', bins: {} }) + '\n');
  fs.writeFileSync(path.join(edir, 'usage.json'), '{"weeklyPercent":50}');
  run(cwd, ['start']);
  assert.match(fs.readFileSync(path.join(edir, 'history.jsonl'), 'utf8'), /PRIOR/, 'history is append-only across runs');
  assert.ok(!fs.existsSync(path.join(edir, 'usage.json')), 'stale usage is cleared on a fresh start');
});
