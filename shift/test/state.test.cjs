'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initState, saveState, loadState, mergeDiscovered, firstPending, setBinStatus } = require('../lib/state.cjs');

test('init + save + load round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-state-'));
  const s = initState({ runId: 'r1', startedAt: '2026-06-13T00:00:00Z', branch: 'shift/x' });
  assert.equal(s.iterations, 0);
  assert.equal(s.currentBinId, null);
  saveState(dir, s);
  assert.deepEqual(loadState(dir), s);
});

test('mergeDiscovered carries status by id+hash, new files are pending', () => {
  let s = initState({ runId: 'r', startedAt: '2026-06-13T00:00:00Z', branch: 'b' });
  s = mergeDiscovered(s, [{ id: 'queue/a.md', hash: 'h1', kind: 'briefs' }]);
  assert.equal(s.bins[0].status, 'pending');
  s = setBinStatus(s, 'queue/a.md', { status: 'done' });
  s = mergeDiscovered(s, [
    { id: 'queue/a.md', hash: 'h1', kind: 'briefs' },
    { id: 'queue/b.md', hash: 'h2', kind: 'briefs' }
  ]);
  assert.equal(s.bins.find(b => b.id === 'queue/a.md').status, 'done');
  assert.equal(s.bins.find(b => b.id === 'queue/b.md').status, 'pending');
});

test('edited file (new hash) becomes pending again', () => {
  let s = initState({ runId: 'r', startedAt: 't', branch: 'b' });
  s = mergeDiscovered(s, [{ id: 'q/a.md', hash: 'h1', kind: 'briefs' }]);
  s = setBinStatus(s, 'q/a.md', { status: 'done' });
  s = mergeDiscovered(s, [{ id: 'q/a.md', hash: 'h2', kind: 'briefs' }]);
  assert.equal(s.bins[0].status, 'pending');
});

test('firstPending returns first pending or null', () => {
  let s = initState({ runId: 'r', startedAt: 't', branch: 'b' });
  s = mergeDiscovered(s, [
    { id: 'a', hash: '1', kind: 'briefs' },
    { id: 'b', hash: '2', kind: 'briefs' }
  ]);
  s = setBinStatus(s, 'a', { status: 'done' });
  assert.equal(firstPending(s.bins).id, 'b');
  s = setBinStatus(s, 'b', { status: 'done' });
  assert.equal(firstPending(s.bins), null);
});
