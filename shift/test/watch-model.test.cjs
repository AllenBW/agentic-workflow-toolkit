'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Out-of-repo timeline base → tmp (fixtures have no timeline → per-bin falls back to state.bins).
process.env.SHIFT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-wmbase-'));
const { buildModel, renderFrame, renderDetail, renderHistory } = require('../lib/watch-model.cjs');
const { aggregate } = require('../lib/history.cjs');
const { engineDir } = require('../lib/store.cjs');

function fixture({ paused = false, currentBinId = 'queue/03-build.md' } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-'));
  const dir = path.join(cwd, '.shift');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '03-build.md'), '# Build the thing\n\nCompile and commit.\n');
  const startedAt = new Date(Date.now() - 12 * 60_000).toISOString();
  fs.writeFileSync(path.join(engineDir(cwd), 'state.json'), JSON.stringify({
    runId: '2026-06-16T00-00-00', startedAt, iterations: 7, branch: 'shift/smoke',
    currentBinId,
    bins: [
      { id: 'queue/01-hello.md', status: 'done', commit: 'a1b2c3d', durationMs: 68000, tokens: { output: 84000, input: 1000, cacheRead: 50000, total: 135000 } },
      { id: 'queue/02-notes.md', status: 'done', commit: 'd4e5f6a', durationMs: 161000, tokens: { output: 213000, input: 2000, cacheRead: 90000, total: 305000 } },
      { id: 'queue/03-build.md', status: 'pending', startedAt },
      { id: 'queue/04-test.md', status: 'pending' },
      { id: 'queue/05-ship.md', status: 'blocked', note: 'needs API key', durationMs: 52000, tokens: { output: 31000, input: 500, cacheRead: 0, total: 31500 } }
    ]
  }));
  fs.writeFileSync(path.join(dir, 'log.md'),
    '# shift log\n\n## 2026-06-16T00:05:00Z — work queue/03-build.md (iter 7)\nNeeds you: confirm the deploy target\n');
  if (paused) fs.writeFileSync(path.join(dir, 'PAUSE'), '');
  return dir;
}

test('buildModel reads per-bin runtime + tokens and a run output-token total', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  assert.equal(m.counts.done, 2);
  assert.equal(m.counts.blocked, 1);
  const b1 = m.bins.find(b => b.id === 'queue/01-hello.md');
  assert.equal(b1.durationMs, 68000);
  assert.equal(b1.tokensOutput, 84000);
  // no transcriptPath in fixture -> run output tokens = sum of recorded per-bin output
  assert.equal(m.outputTokens, 84000 + 213000 + 31000);
});

test('buildModel marks the current bin and surfaces Needs you', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  assert.equal(m.bins.find(b => b.current).id, 'queue/03-build.md');
  assert.ok(m.needsYou.some(n => /API key/.test(n)));
  assert.ok(m.needsYou.some(n => /deploy target/.test(n)));
});

test('buildModel reflects pause + exists:false when no run', () => {
  assert.equal(buildModel({ dir: fixture({ paused: true }), now: Date.now() }).paused, true);
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-none-'));
  assert.equal(buildModel({ dir: path.join(none, '.shift'), now: Date.now() }).exists, false);
});

test('renderFrame shows progress, the token header, runtime/token columns, and nav hints', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  const out = renderFrame(m, { width: 80, color: false, selectedIndex: 2 });
  assert.match(out, /2\/5/);                  // progress
  assert.match(out, /shift\/smoke/);          // branch
  assert.match(out, /↑\d+k out/);             // run output-token header
  assert.match(out, /queue\/05-ship\.md/);    // bin row
  assert.match(out, /needs API key/);         // blocker note
  assert.match(out, /1m08s/);                 // bin 1 runtime column
  assert.match(out, /84k/);                   // bin 1 token column
  assert.match(out, /▸/);                     // selection cursor (selectedIndex)
  assert.match(out, /select/);                // nav hint shown when selecting
  assert.match(out, /\[q\].*stop/i);
});

test('renderFrame PAUSED banner toggles', () => {
  assert.match(renderFrame(buildModel({ dir: fixture({ paused: true }), now: Date.now() }), { color: false }), /PAUSED/);
  assert.doesNotMatch(renderFrame(buildModel({ dir: fixture({ paused: false }), now: Date.now() }), { color: false }), /PAUSED/);
});

test('renderDetail shows the bin brief + token breakdown', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  const idx = m.bins.findIndex(b => b.id === 'queue/01-hello.md');
  const out = renderDetail(m, idx, { color: false });
  assert.match(out, /queue\/01-hello\.md/);
  assert.match(out, /84k out/);          // token breakdown
  assert.match(out, /cache-read/);
  assert.match(out, /1m08s/);            // runtime
  assert.match(out, /a1b2c3d/);          // commit
});

test('renderDetail reads the brief file for the current bin', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  const idx = m.bins.findIndex(b => b.id === 'queue/03-build.md');
  const out = renderDetail(m, idx, { color: false });
  assert.match(out, /brief/);
  assert.match(out, /Build the thing/); // read from queue/03-build.md
});

test('renderFrame on no active run is a friendly message', () => {
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-none2-'));
  assert.match(renderFrame(buildModel({ dir: path.join(none, '.shift'), now: Date.now() }), { color: false }), /no active.*run/i);
});

test('renderHistory shows per-run rows and a totals footer', () => {
  const records = [
    { runId: 'r1', branch: 'shift/a', endedAt: '2026-06-16T01:00:00Z', durationMs: 600000, iterations: 3, tokens: { output: 120000, total: 1 }, bins: { total: 2, done: 2, skipped: 0, blocked: 0 } },
    { runId: 'r2', branch: 'shift/b', endedAt: '2026-06-16T02:00:00Z', durationMs: 1200000, iterations: 5, tokens: { output: 340000, total: 1 }, bins: { total: 5, done: 3, skipped: 1, blocked: 1 } }
  ];
  const out = renderHistory(records, aggregate(records), { color: false });
  assert.match(out, /work record/);
  assert.match(out, /shift\/a/);
  assert.match(out, /shift\/b/);
  assert.match(out, /totals/);
  assert.match(out, /2 runs/);
  assert.match(out, /460k out/);  // 120k + 340k aggregate output
  assert.match(out, /5✓/);        // aggregate done
});

test('renderHistory with no records is a friendly message', () => {
  assert.match(renderHistory([], aggregate([]), { color: false }), /No shift runs recorded/i);
});
