'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep the out-of-repo timeline in a tmp base so tests never touch ~/.local/state.
process.env.SHIFT_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-statebase-'));
const { appendEvent, readTimeline, clearTimeline, timelinePath, binWindows } = require('../lib/timeline.cjs');
const { engineDir } = require('../lib/store.cjs');

function repo() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-repo-')); }

test('timeline lives OUTSIDE the repo (agent-proof), under the state base', () => {
  const c = repo();
  const f = timelinePath(c);
  assert.ok(f.startsWith(process.env.SHIFT_STATE_DIR), 'under the state base');
  assert.ok(!f.startsWith(path.resolve(c)), 'NOT inside the working repo');
});

test('append + read round-trips; clear removes', () => {
  const c = repo();
  appendEvent(c, { t: '2026-06-16T00:00:00Z', event: 'start', id: 'a' });
  appendEvent(c, { t: '2026-06-16T00:01:00Z', event: 'finish', id: 'a' });
  assert.equal(readTimeline(c).length, 2);
  clearTimeline(c);
  assert.deepEqual(readTimeline(c), []);
});

test('distinct repos get distinct timelines (no key collision)', () => {
  const a = repo(), b = repo();
  appendEvent(a, { t: 't', event: 'start', id: 'x' });
  assert.equal(readTimeline(a).length, 1);
  assert.equal(readTimeline(b).length, 0);
});

test('the key is canonical: /tmp and /private/tmp resolve to the same store (macOS symlink)', () => {
  // realpath collapses the symlink, so a reader using either form agrees with the hook.
  const real = fs.realpathSync(repo());
  if (real.startsWith('/private/')) {
    const aliased = real.replace(/^\/private/, '');
    assert.equal(engineDir(aliased), engineDir(real), '/tmp alias must map to the same store as /private/tmp');
  } else {
    assert.ok(true); // not on a /private symlink platform; nothing to assert
  }
});

test('readTimeline tolerates malformed lines', () => {
  const c = repo();
  appendEvent(c, { t: 't', event: 'start', id: 'a' });
  fs.appendFileSync(timelinePath(c), 'garbage\n');
  assert.equal(readTimeline(c).length, 1);
});

test('binWindows takes first start and last finish per bin', () => {
  const w = binWindows([
    { t: 't1', event: 'start', id: 'a' },
    { t: 't1b', event: 'start', id: 'a' },
    { t: 't2', event: 'finish', id: 'a' },
    { t: 't3', event: 'start', id: 'b' }
  ]);
  assert.equal(w.a.startedAt, 't1');
  assert.equal(w.a.finishedAt, 't2');
  assert.equal(w.b.startedAt, 't3');
  assert.equal(w.b.finishedAt, null);
});
