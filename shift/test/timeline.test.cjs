'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendEvent, readTimeline, clearTimeline, timelinePath, binWindows } = require('../lib/timeline.cjs');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-tl-')); }

test('timeline file lives at .shift/timeline.jsonl', () => {
  const d = dir();
  assert.equal(timelinePath(d), path.join(d, 'timeline.jsonl'));
});

test('append + read round-trips events; clear removes them', () => {
  const d = dir();
  appendEvent(d, { t: '2026-06-16T00:00:00Z', event: 'start', id: 'a' });
  appendEvent(d, { t: '2026-06-16T00:01:00Z', event: 'finish', id: 'a' });
  assert.equal(readTimeline(d).length, 2);
  clearTimeline(d);
  assert.deepEqual(readTimeline(d), []);
});

test('readTimeline on a fresh dir is empty and tolerates malformed lines', () => {
  const d = dir();
  assert.deepEqual(readTimeline(d), []);
  appendEvent(d, { t: 't', event: 'start', id: 'a' });
  fs.appendFileSync(timelinePath(d), 'garbage\n');
  assert.equal(readTimeline(d).length, 1);
});

test('binWindows takes first start and last finish per bin', () => {
  const events = [
    { t: 't1', event: 'start', id: 'a' },
    { t: 't1b', event: 'start', id: 'a' },
    { t: 't2', event: 'finish', id: 'a' },
    { t: 't3', event: 'start', id: 'b' }
  ];
  const w = binWindows(events);
  assert.equal(w.a.startedAt, 't1');
  assert.equal(w.a.finishedAt, 't2');
  assert.equal(w.b.startedAt, 't3');
  assert.equal(w.b.finishedAt, null);
});
