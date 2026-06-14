'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'hooks', 'shift-stop.cjs');

function setupRun() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-hook-'));
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '01.md'), 'bin one');
  fs.writeFileSync(path.join(cwd, 'queue', '02.md'), 'bin two');
  const dir = path.join(cwd, '.shift');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    sources: [{ path: 'queue', kind: 'briefs' }],
    bounds: { maxHours: 24, maxIterations: 10 },
    definitionOfDone: 'done', git: {}
  }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    runId: 'r', startedAt: new Date().toISOString(), iterations: 0,
    branch: 'shift/x', currentBinId: null, bins: []
  }));
  fs.writeFileSync(path.join(dir, 'log.md'), '# log\n');
  return { cwd, dir };
}

function runHook(cwd, input) {
  const out = cp.execFileSync('node', [HOOK], { cwd, input: JSON.stringify(input), encoding: 'utf8' });
  return JSON.parse(out || '{}');
}

test('no-ops (allows stop) when no .shift/state.json exists', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-none-'));
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
});

test('first stop blocks bin 1; second marks it done + blocks bin 2; third drains -> allow + summary', () => {
  const { cwd, dir } = setupRun();
  const r1 = runHook(cwd, { stop_hook_active: false });
  assert.equal(r1.decision, 'block');
  assert.match(r1.reason, /bin one/);

  const r2 = runHook(cwd, { stop_hook_active: true });
  assert.equal(r2.decision, 'block');
  assert.match(r2.reason, /bin two/);
  const s2 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(s2.bins.find(b => b.id === 'queue/01.md').status, 'done');

  const r3 = runHook(cwd, { stop_hook_active: true });
  assert.deepEqual(r3, {});
  assert.ok(fs.existsSync(path.join(dir, 'summary.md')));
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /queue empty/);
});

test('blocked.jsonl marks the current bin blocked and surfaces it in the summary', () => {
  const { cwd, dir } = setupRun();
  runHook(cwd, { stop_hook_active: false });
  fs.writeFileSync(path.join(dir, 'blocked.jsonl'), JSON.stringify({ id: 'queue/01.md', note: 'needs key' }) + '\n');
  runHook(cwd, { stop_hook_active: true });
  runHook(cwd, { stop_hook_active: true });
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /needs key/);
});

test('logged "Needs you:" lines surface in the summary', () => {
  const { cwd, dir } = setupRun();
  runHook(cwd, { stop_hook_active: false });
  fs.appendFileSync(path.join(dir, 'log.md'), '\nNeeds you: push the release tag\n');
  runHook(cwd, { stop_hook_active: true });
  runHook(cwd, { stop_hook_active: true });
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /push the release tag/);
});

test('kill switch ends the run immediately', () => {
  const { cwd, dir } = setupRun();
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /kill switch/);
});

test('resolves .shift from the hook payload cwd, not the process cwd', () => {
  const { cwd } = setupRun();
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-neutral-'));
  const out = cp.execFileSync('node', [HOOK], {
    cwd: neutral,
    input: JSON.stringify({ stop_hook_active: false, cwd }),
    encoding: 'utf8'
  });
  const r = JSON.parse(out || '{}');
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /bin one/);
});
