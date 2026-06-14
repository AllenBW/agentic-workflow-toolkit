'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decide } = require('../lib/decision.cjs');

const cfg = { bounds: { maxHours: 2, maxIterations: 10 }, definitionOfDone: 'done', git: {} };
const state = { startedAt: '2026-06-13T00:00:00Z', iterations: 0, currentBinId: null };
const t0 = Date.parse(state.startedAt) + 1000;

test('blocks with the first pending bin', () => {
  const bins = [{ id: 'a', status: 'done' }, { id: 'b', status: 'pending', text: 'work b' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'block');
  assert.equal(r.nextBinId, 'b');
  assert.match(r.reason, /work b/);
});

test('allows stop when queue empty', () => {
  const bins = [{ id: 'a', status: 'done' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /queue empty/);
});

test('kill switch allows stop even with pending work', () => {
  const bins = [{ id: 'b', status: 'pending', text: 'x' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: true });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /kill switch/);
});

test('a bound (time box) allows stop even with pending work', () => {
  const bins = [{ id: 'b', status: 'pending', text: 'x' }];
  const late = Date.parse(state.startedAt) + 3 * 3_600_000;
  const r = decide({ bins, state, config: cfg, now: late, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /time box/);
});
