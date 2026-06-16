'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyOutcome } = require('../lib/outcome.cjs');

const nowMs = 1_000_000_000_000;
const nowSec = nowMs / 1000;

test('finalized run is completed', () => {
  assert.equal(classifyOutcome({ finalized: true, code: 1, now: nowMs }), 'completed');
});

test('finalized wins even on a clean exit', () => {
  assert.equal(classifyOutcome({ finalized: true, code: 0, now: nowMs }), 'completed');
});

test('clean exit (code 0) WITHOUT finalize is incomplete, not completed', () => {
  // The engine writes summary.md (finalized) on a real drain; a code-0 exit without
  // it means claude stopped without the engine finalizing (e.g. hook not wired, or a
  // partial stop). That must NOT read as success — it is 'incomplete' (resume/stop).
  assert.equal(classifyOutcome({ finalized: false, code: 0, now: nowMs }), 'incomplete');
});

test('nonzero + near-limit usage + future reset is rate_limited', () => {
  const usage = { sessionUsedPercent: 99, weeklyPercent: 50, sessionResetAt: nowSec + 3600 };
  assert.equal(classifyOutcome({ finalized: false, code: 1, usage, now: nowMs }), 'rate_limited');
});

test('nonzero + rate-limit stderr is rate_limited', () => {
  assert.equal(classifyOutcome({ finalized: false, code: 1, stderr: 'Error: rate limit exceeded', now: nowMs }), 'rate_limited');
});

test('nonzero with no signal is error', () => {
  assert.equal(classifyOutcome({ finalized: false, code: 1, stderr: 'boom', now: nowMs }), 'error');
});

test('near-limit but reset already past is NOT rate_limited (no future window)', () => {
  const usage = { sessionUsedPercent: 99, sessionResetAt: nowSec - 10 };
  assert.equal(classifyOutcome({ finalized: false, code: 1, usage, stderr: 'boom', now: nowMs }), 'error');
});
