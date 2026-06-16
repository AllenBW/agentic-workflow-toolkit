'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'hooks', 'shift-stop.cjs');
// Engine state lives out of the repo; point its base at a tmp dir so tests never touch
// ~/.local/state, and so the test process's engineDir() matches the spawned hook's.
const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-statebase-'));
process.env.SHIFT_STATE_DIR = STATE_BASE;
const { engineDir } = require('../lib/store.cjs');

function setupRun(configOverride) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-hook-'));
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '01.md'), 'bin one');
  fs.writeFileSync(path.join(cwd, 'queue', '02.md'), 'bin two');
  const dir = path.join(cwd, '.shift');          // repo-side: log, summary, control
  const edir = engineDir(cwd);                   // out-of-repo: state, config snapshot, history, usage
  fs.mkdirSync(dir, { recursive: true });
  const config = JSON.stringify(Object.assign({
    sources: [{ path: 'queue', kind: 'briefs' }],
    bounds: { maxHours: 24, maxIterations: 10 },
    definitionOfDone: 'done', git: {}
  }, configOverride || {}));
  fs.writeFileSync(path.join(edir, 'config.json'), config);
  fs.writeFileSync(path.join(edir, 'state.json'), JSON.stringify({
    runId: 'r', startedAt: new Date().toISOString(), iterations: 0,
    branch: 'shift/x', currentBinId: null, bins: []
  }));
  fs.writeFileSync(path.join(dir, 'log.md'), '# log\n');
  return { cwd, dir, edir };
}

function runHook(cwd, input) {
  const out = cp.execFileSync('node', [HOOK], {
    cwd, input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, SHIFT_STATE_DIR: STATE_BASE }
  });
  return JSON.parse(out || '{}');
}
const readState = edir => JSON.parse(fs.readFileSync(path.join(edir, 'state.json'), 'utf8'));

test('no-ops (allows stop) when there is no active run', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-none-'));
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
});

test('first stop blocks bin 1; second marks it done + blocks bin 2; third drains -> allow + summary', () => {
  const { cwd, dir, edir } = setupRun();
  const r1 = runHook(cwd, { stop_hook_active: false });
  assert.equal(r1.decision, 'block');
  assert.match(r1.reason, /bin one/);

  const r2 = runHook(cwd, { stop_hook_active: true });
  assert.equal(r2.decision, 'block');
  assert.match(r2.reason, /bin two/);
  assert.equal(readState(edir).bins.find(b => b.id === 'queue/01.md').status, 'done');

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

test('SKIP control marks the current bin skipped and advances to the next', () => {
  const { cwd, dir, edir } = setupRun();
  runHook(cwd, { stop_hook_active: false });            // start bin 1 (current = queue/01.md)
  fs.writeFileSync(path.join(dir, 'SKIP'), 'queue/01.md');
  const r = runHook(cwd, { stop_hook_active: true });   // skip bin 1, block bin 2
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /bin two/);
  assert.equal(readState(edir).bins.find(b => b.id === 'queue/01.md').status, 'skipped');
  assert.ok(!fs.existsSync(path.join(dir, 'SKIP')), 'SKIP is consumed');
});

test('a SKIP naming a non-current bin is consumed and discarded, not applied to a later bin', () => {
  const { cwd, dir, edir } = setupRun();
  runHook(cwd, { stop_hook_active: false });                       // start bin 1
  fs.writeFileSync(path.join(dir, 'SKIP'), 'queue/99-nope.md');    // stale / wrong id
  runHook(cwd, { stop_hook_active: true });                        // bin 1 -> done (skip ignored)
  assert.equal(readState(edir).bins.find(b => b.id === 'queue/01.md').status, 'done');
  assert.ok(!fs.existsSync(path.join(dir, 'SKIP')), 'stale SKIP is consumed, never left to fire on a later bin');
});

test('kill switch ends the run immediately', () => {
  const { cwd, dir } = setupRun();
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /kill switch/);
});

test('resolves the repo from the hook payload cwd, not the process cwd', () => {
  const { cwd } = setupRun();
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-neutral-'));
  const out = cp.execFileSync('node', [HOOK], {
    cwd: neutral,
    input: JSON.stringify({ stop_hook_active: false, cwd }),
    encoding: 'utf8',
    env: { ...process.env, SHIFT_STATE_DIR: STATE_BASE }
  });
  const r = JSON.parse(out || '{}');
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /bin one/);
});

test('engine state lives OUTSIDE the repo (agent cannot reach it)', () => {
  const { cwd, edir } = setupRun();
  runHook(cwd, { stop_hook_active: false });
  assert.ok(fs.existsSync(path.join(edir, 'state.json')), 'state.json is in the engine dir');
  assert.ok(!fs.existsSync(path.join(cwd, '.shift', 'state.json')), 'state.json is NOT in the repo .shift/');
  assert.ok(!edir.startsWith(cwd), 'the engine dir is outside the working repo');
});

// ---- v3: verify gate ----

test('verify gate (passing) marks bins done and drains', () => {
  const { cwd, edir } = setupRun({ verify: { command: 'true', maxAttempts: 2 } });
  runHook(cwd, { stop_hook_active: false }); // start bin 1
  runHook(cwd, { stop_hook_active: true });  // verify passes -> bin1 done, start bin2
  assert.equal(readState(edir).bins.find(b => b.id === 'queue/01.md').status, 'done');
});

test('verify gate (failing) re-blocks the same bin with feedback, then blocks after maxAttempts', () => {
  const { cwd, edir } = setupRun({ verify: { command: 'false', maxAttempts: 2 } });
  runHook(cwd, { stop_hook_active: false });            // start bin 1
  const r1 = runHook(cwd, { stop_hook_active: true });  // verify fails, attempt 1 < 2 -> retry SAME bin
  assert.equal(r1.decision, 'block');
  assert.match(r1.reason, /failed verification/);
  assert.match(r1.reason, /bin one/);
  let s = readState(edir);
  assert.equal(s.bins.find(b => b.id === 'queue/01.md').status, 'pending');
  assert.equal(s.bins.find(b => b.id === 'queue/01.md').attempts, 1);

  const r2 = runHook(cwd, { stop_hook_active: true });  // verify fails again, attempt 2 == max -> blocked, move on
  assert.equal(r2.decision, 'block');
  assert.match(r2.reason, /bin two/);
  assert.equal(readState(edir).bins.find(b => b.id === 'queue/01.md').status, 'blocked');
});

// ---- watch: per-bin tokens/runtime + work-record history ----

test('records per-bin tokens + runtime from the transcript and appends a history record', () => {
  const { cwd, dir, edir } = setupRun();
  const tpath = path.join(dir, 'transcript.jsonl');
  const asst = (ts, output) => JSON.stringify({
    type: 'assistant', timestamp: ts,
    message: { role: 'assistant', usage: { output_tokens: output, input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  });

  runHook(cwd, { stop_hook_active: false, transcript_path: tpath }); // start bin 1
  const started = readState(edir).bins.find(b => b.id === 'queue/01.md').startedAt;
  assert.ok(started, 'bin 1 got a startedAt when it became current');
  fs.writeFileSync(tpath, asst(started, 500) + '\n');

  runHook(cwd, { stop_hook_active: true, transcript_path: tpath }); // finish bin 1, start bin 2
  const b1 = readState(edir).bins.find(b => b.id === 'queue/01.md');
  assert.equal(b1.status, 'done');
  assert.equal(b1.tokens.output, 500, 'bin 1 output tokens attributed from the transcript window');
  assert.equal(typeof b1.durationMs, 'number');

  runHook(cwd, { stop_hook_active: true, transcript_path: tpath }); // finish bin 2, drain -> finalize
  const hist = fs.readFileSync(path.join(edir, 'history.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(hist.length, 1, 'one history record appended on finalize');
  assert.equal(hist[0].bins.done, 2);
  assert.ok(hist[0].tokens.output >= 500, 'run output tokens recorded');
  assert.equal(hist[0].perBin.length, 2);
});

test('history is append-only across runs and not duplicated by a stray extra stop', () => {
  const { cwd, edir } = setupRun();
  runHook(cwd, { stop_hook_active: false });
  runHook(cwd, { stop_hook_active: true });
  runHook(cwd, { stop_hook_active: true }); // drain -> finalize (appends record 1)
  runHook(cwd, { stop_hook_active: true }); // stray extra stop -> summary already exists -> no 2nd append
  const hist = fs.readFileSync(path.join(edir, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(hist.length, 1, 'no duplicate history record from a repeated finalize');
});

test('a planted repo-side .shift/state.json is ignored — the engine drives from out-of-repo state', () => {
  const { cwd, dir } = setupRun();
  // a confused/hostile agent writes a repo-side state.json claiming everything is done
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    runId: 'r', startedAt: new Date().toISOString(), iterations: 9, branch: 'shift/x',
    currentBinId: null, bins: [{ id: 'queue/01.md', status: 'done' }, { id: 'queue/02.md', status: 'done' }]
  }));
  const r = runHook(cwd, { stop_hook_active: false });
  assert.equal(r.decision, 'block');     // still blocks bin 1 from the real (engine-dir) state
  assert.match(r.reason, /bin one/);
});

test('config falls back to the repo .shift/config.json when the engine snapshot is absent', () => {
  const { cwd, dir, edir } = setupRun();
  fs.unlinkSync(path.join(edir, 'config.json')); // no engine snapshot → must fall back to repo copy
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    sources: [{ path: 'queue', kind: 'briefs' }], bounds: { maxHours: 24, maxIterations: 10 },
    definitionOfDone: 'done', git: {}
  }));
  const r = runHook(cwd, { stop_hook_active: false });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /bin one/);
});

test('history per-bin tokens fall back to the transcript window when state.bins was clobbered', () => {
  const { cwd, dir, edir } = setupRun();
  const tpath = path.join(dir, 'transcript.jsonl');
  const asst = (ts, out) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { usage: { output_tokens: out, input_tokens: 1 } } });

  runHook(cwd, { stop_hook_active: false, transcript_path: tpath }); // start bin 1
  const started = readState(edir).bins.find(b => b.id === 'queue/01.md').startedAt;
  fs.writeFileSync(tpath, asst(started, 700) + '\n');
  runHook(cwd, { stop_hook_active: true, transcript_path: tpath });  // finish bin 1 (tokens=700), start bin 2

  // simulate the agent clobbering state: strip every bin's recorded tokens
  const s = readState(edir);
  s.bins = s.bins.map(({ tokens, ...rest }) => rest);
  fs.writeFileSync(path.join(edir, 'state.json'), JSON.stringify(s));

  runHook(cwd, { stop_hook_active: true, transcript_path: tpath });  // finish bin 2, drain -> finalize
  const hist = fs.readFileSync(path.join(edir, 'history.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const b1 = hist[0].perBin.find(p => p.id === 'queue/01.md');
  assert.equal(b1.tokensOutput, 700, 'recovered from the timeline window + transcript, not from state.bins');
});

// ---- v2: usage cap + cache ----

test('usage cap from the hook payload ends the run and caches usage', () => {
  const { cwd, dir, edir } = setupRun({ bounds: { maxHours: 24, maxIterations: 10, usageCapPercent: 90 } });
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const r = runHook(cwd, {
    stop_hook_active: false,
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: reset },
      seven_day: { used_percentage: 95, resets_at: reset }
    }
  });
  assert.deepEqual(r, {});
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /usage cap/);
  const usage = JSON.parse(fs.readFileSync(path.join(edir, 'usage.json'), 'utf8'));
  assert.equal(usage.weeklyPercent, 95);
  assert.equal(usage.sessionResetAt, reset);
});
