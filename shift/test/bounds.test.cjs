'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateBounds } = require('../lib/bounds.cjs');

const base = { startedAt: '2026-06-13T00:00:00Z', iterations: 0 };
const t0 = Date.parse(base.startedAt);

test('returns null when within bounds', () => {
  const cfg = { bounds: { maxHours: 2, maxIterations: 10 } };
  assert.equal(evaluateBounds(base, cfg, t0 + 60_000), null);
});

test('terminates on max iterations', () => {
  const cfg = { bounds: { maxHours: 2, maxIterations: 5 } };
  assert.match(evaluateBounds({ ...base, iterations: 5 }, cfg, t0 + 1000).reason, /max iterations/);
});

test('terminates on time box', () => {
  const cfg = { bounds: { maxHours: 1, maxIterations: 100 } };
  assert.match(evaluateBounds(base, cfg, t0 + 3_600_001).reason, /time box/);
});

test('iterations checked before time', () => {
  const cfg = { bounds: { maxHours: 1, maxIterations: 1 } };
  assert.match(evaluateBounds({ ...base, iterations: 1 }, cfg, t0 + 3_600_001).reason, /max iterations/);
});

test('terminates on usage cap when usage is known', () => {
  const cfg = { bounds: { maxHours: 8, usageCapPercent: 90 } };
  assert.match(evaluateBounds(base, cfg, t0 + 1000, 92).reason, /usage cap/);
});

test('usage cap is ignored when usage is unknown', () => {
  const cfg = { bounds: { maxHours: 8, usageCapPercent: 90 } };
  assert.equal(evaluateBounds(base, cfg, t0 + 1000, undefined), null);
  assert.equal(evaluateBounds(base, cfg, t0 + 1000, null), null);
});
