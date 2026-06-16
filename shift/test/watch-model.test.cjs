'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildModel, renderFrame } = require('../lib/watch-model.cjs');

function fixture({ paused = false, currentBinId = 'queue/03-build.md' } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-'));
  const dir = path.join(cwd, '.shift');
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = new Date(Date.now() - 12 * 60_000).toISOString(); // 12 min ago
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    runId: '2026-06-16T00-00-00', startedAt, iterations: 7, branch: 'shift/smoke',
    currentBinId,
    bins: [
      { id: 'queue/01-hello.md', status: 'done', commit: 'a1b2c3d' },
      { id: 'queue/02-notes.md', status: 'done', commit: 'd4e5f6a' },
      { id: 'queue/03-build.md', status: 'pending' },
      { id: 'queue/04-test.md', status: 'pending' },
      { id: 'queue/05-ship.md', status: 'blocked', note: 'needs API key' }
    ]
  }));
  fs.writeFileSync(path.join(dir, 'log.md'),
    '# shift log\n\n## 2026-06-16T00:05:00Z — work queue/03-build.md (iter 7)\nNeeds you: confirm the deploy target\n');
  if (paused) fs.writeFileSync(path.join(dir, 'PAUSE'), '');
  return dir;
}

test('buildModel reads run state and computes counts + elapsed', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  assert.equal(m.exists, true);
  assert.equal(m.branch, 'shift/smoke');
  assert.equal(m.iterations, 7);
  assert.equal(m.counts.done, 2);
  assert.equal(m.counts.blocked, 1);
  assert.equal(m.counts.pending, 2);
  assert.equal(m.counts.total, 5);
  assert.ok(m.elapsedMin >= 11 && m.elapsedMin <= 13);
});

test('buildModel marks the current bin and surfaces Needs you', () => {
  const m = buildModel({ dir: fixture(), now: Date.now() });
  const current = m.bins.find(b => b.current);
  assert.equal(current.id, 'queue/03-build.md');
  assert.ok(m.needsYou.some(n => /API key/.test(n)));        // blocked note
  assert.ok(m.needsYou.some(n => /deploy target/.test(n)));  // logged "Needs you:" line
});

test('buildModel reflects pause state', () => {
  assert.equal(buildModel({ dir: fixture({ paused: true }), now: Date.now() }).paused, true);
  assert.equal(buildModel({ dir: fixture({ paused: false }), now: Date.now() }).paused, false);
});

test('buildModel returns exists:false when no run is present', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-none-'));
  const m = buildModel({ dir: path.join(cwd, '.shift'), now: Date.now() });
  assert.equal(m.exists, false);
});

test('renderFrame (no color) shows progress, the current bin, and control hints', () => {
  const out = renderFrame(buildModel({ dir: fixture(), now: Date.now() }), { width: 80, color: false });
  assert.match(out, /2\/5/);                 // progress count
  assert.match(out, /shift\/smoke/);         // branch
  assert.match(out, /queue\/05-ship\.md/);   // a bin row
  assert.match(out, /needs API key/);        // blocker surfaced
  assert.match(out, /\[q\].*stop/i);         // control hint
  assert.match(out, /\[k\]/);                // skip hint
  assert.match(out, /\[p\]/);                // pause hint
});

test('renderFrame shows a PAUSED banner when paused', () => {
  const paused = renderFrame(buildModel({ dir: fixture({ paused: true }), now: Date.now() }), { color: false });
  assert.match(paused, /PAUSED/);
  const running = renderFrame(buildModel({ dir: fixture({ paused: false }), now: Date.now() }), { color: false });
  assert.doesNotMatch(running, /PAUSED/);
});

test('renderFrame on no active run is a friendly message, not a crash', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-none2-'));
  const out = renderFrame(buildModel({ dir: path.join(cwd, '.shift'), now: Date.now() }), { color: false });
  assert.match(out, /no active.*run/i);
});
