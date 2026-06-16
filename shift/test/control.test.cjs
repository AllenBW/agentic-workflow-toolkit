'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  requestStop, isStopRequested,
  setPause, isPaused,
  requestSkip, readSkip, clearSkip
} = require('../lib/control.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-ctl-')); }

test('stop: absent by default, present after request', () => {
  const d = tmp();
  assert.equal(isStopRequested(d), false);
  requestStop(d);
  assert.equal(isStopRequested(d), true);
  // STOP is the existing kill switch file name (engine already honors it)
  assert.ok(fs.existsSync(path.join(d, 'STOP')));
});

test('pause: toggles on and off', () => {
  const d = tmp();
  assert.equal(isPaused(d), false);
  setPause(d, true);
  assert.equal(isPaused(d), true);
  setPause(d, false);
  assert.equal(isPaused(d), false);
  setPause(d, false); // idempotent off
  assert.equal(isPaused(d), false);
});

test('skip: records a bin id, reads it back, clears it', () => {
  const d = tmp();
  assert.equal(readSkip(d), null);
  requestSkip(d, 'queue/03-build.md');
  assert.equal(readSkip(d), 'queue/03-build.md');
  clearSkip(d);
  assert.equal(readSkip(d), null);
});

test('skip: reading a malformed/empty file yields null (no throw)', () => {
  const d = tmp();
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKIP'), '   ');
  assert.equal(readSkip(d), null);
});

test('all readers are safe on a missing dir', () => {
  const d = path.join(os.tmpdir(), 'shift-ctl-missing-' + process.pid);
  assert.equal(isStopRequested(d), false);
  assert.equal(isPaused(d), false);
  assert.equal(readSkip(d), null);
});
