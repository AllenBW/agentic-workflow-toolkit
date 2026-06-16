'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendRecord, readHistory, aggregate } = require('../lib/history.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-hist-')); }
const rec = (runId, over = {}) => Object.assign({
  runId, branch: 'shift/x', startedAt: '2026-06-16T00:00:00Z', endedAt: '2026-06-16T00:30:00Z',
  durationMs: 30 * 60000, iterations: 4, endReason: 'queue empty',
  bins: { total: 3, done: 2, skipped: 1, blocked: 0 }, tokens: { output: 1000, total: 50000 }
}, over);

test('append then read round-trips records in order', () => {
  const d = tmp();
  appendRecord(d, rec('r1'));
  appendRecord(d, rec('r2'));
  const h = readHistory(d);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map(r => r.runId), ['r1', 'r2']);
  assert.ok(fs.existsSync(path.join(d, 'history.jsonl')));
});

test('readHistory tolerates a malformed line', () => {
  const d = tmp();
  appendRecord(d, rec('r1'));
  fs.appendFileSync(path.join(d, 'history.jsonl'), 'not json\n');
  appendRecord(d, rec('r2'));
  assert.deepEqual(readHistory(d).map(r => r.runId), ['r1', 'r2']);
});

test('readHistory on a fresh dir is empty (no throw)', () => {
  assert.deepEqual(readHistory(tmp()), []);
});

test('aggregate totals runs, duration, output tokens, and bins', () => {
  const recs = [
    rec('r1', { durationMs: 10 * 60000, tokens: { output: 1000, total: 1 }, bins: { total: 2, done: 2, skipped: 0, blocked: 0 } }),
    rec('r2', { durationMs: 20 * 60000, tokens: { output: 3000, total: 1 }, bins: { total: 5, done: 3, skipped: 1, blocked: 1 } })
  ];
  const a = aggregate(recs);
  assert.equal(a.runs, 2);
  assert.equal(a.durationMs, 30 * 60000);
  assert.equal(a.outputTokens, 4000);
  assert.equal(a.bins.done, 5);
  assert.equal(a.bins.skipped, 1);
  assert.equal(a.bins.blocked, 1);
});
