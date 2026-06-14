'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeUsageCache, readUsageCache } = require('../lib/usage.cjs');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shift-usage-')); }

test('write + read round-trips the full rate-limit payload', () => {
  const dir = tmp();
  const weekly = writeUsageCache(dir, {
    five_hour: { used_percentage: 72, resets_at: 1000 },
    seven_day: { used_percentage: 41, resets_at: 2000 }
  }, 123);
  assert.equal(weekly, 41);
  assert.deepEqual(readUsageCache(dir), {
    weeklyPercent: 41, sessionUsedPercent: 72, sessionResetAt: 1000, weeklyResetAt: 2000, capturedAt: 123
  });
});

test('absent rate_limits returns null and writes nothing', () => {
  const dir = tmp();
  assert.equal(writeUsageCache(dir, undefined, 1), null);
  assert.equal(readUsageCache(dir), null);
});

test('partial windows degrade to null fields', () => {
  const dir = tmp();
  const weekly = writeUsageCache(dir, { five_hour: { used_percentage: 60, resets_at: 5 } }, 9);
  assert.equal(weekly, null);
  const c = readUsageCache(dir);
  assert.equal(c.sessionUsedPercent, 60);
  assert.equal(c.weeklyPercent, null);
});

test('readUsageCache returns null when no cache exists', () => {
  assert.equal(readUsageCache(tmp()), null);
});
