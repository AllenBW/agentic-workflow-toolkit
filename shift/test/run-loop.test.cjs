'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runLoop } = require('../lib/run-loop.cjs');

function makeEffects({ spawns, usage, bounds }) {
  const state = { startedAt: new Date(Date.now()).toISOString(), iterations: 0 };
  let i = 0;
  let finalized = false;
  const calls = { sleepUntil: [], spawns: 0 };
  const effects = {
    now: () => Date.now(),
    loadState: () => state,
    readUsage: () => usage,
    log: () => {},
    finalized: () => finalized,
    sleepUntil: (ms) => { calls.sleepUntil.push(ms); return Promise.resolve(); },
    spawn: () => {
      calls.spawns += 1;
      const s = spawns[i++] || { result: { status: 1, stderr: '' }, finalize: false };
      finalized = s.finalize;
      return s.result;
    }
  };
  return { effects, calls, config: { bounds: bounds || { maxHours: 8, maxResumes: 12, autoResumeOnReset: true } } };
}

test('a single finalizing spawn completes the run', async () => {
  const { effects, calls, config } = makeEffects({
    spawns: [{ result: { status: 0 }, finalize: true }],
    usage: null
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /finalized/);
  assert.equal(r.spawns, 1);
  assert.equal(calls.sleepUntil.length, 0);
});

test('rate-limited spawn waits for reset, then resumes and finishes', async () => {
  const usage = { weeklyPercent: 50, sessionUsedPercent: 99, sessionResetAt: Math.floor(Date.now() / 1000) + 3600 };
  const { effects, calls, config } = makeEffects({
    spawns: [
      { result: { status: 1, stderr: '' }, finalize: false }, // rate-limited (inferred from usage)
      { result: { status: 0 }, finalize: true }               // resumes, finalizes
    ],
    usage
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /finalized/);
  assert.equal(r.spawns, 2);
  assert.equal(calls.sleepUntil.length, 1, 'should have waited once');
});

test('rate-limited with auto-resume disabled stops', async () => {
  const usage = { weeklyPercent: 50, sessionUsedPercent: 99, sessionResetAt: Math.floor(Date.now() / 1000) + 3600 };
  const { effects, config } = makeEffects({
    spawns: [{ result: { status: 1, stderr: '' }, finalize: false }],
    usage,
    bounds: { maxHours: 8, maxResumes: 12, autoResumeOnReset: false }
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /auto-resume disabled/);
  assert.equal(r.spawns, 1);
});

test('usage cap stops before any spawn', async () => {
  const { effects, calls, config } = makeEffects({
    spawns: [{ result: { status: 0 }, finalize: true }],
    usage: { weeklyPercent: 95 },
    bounds: { maxHours: 8, usageCapPercent: 90, autoResumeOnReset: true }
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /usage cap/);
  assert.equal(calls.spawns, 0);
});

test('maxResumes acts as a runaway backstop', async () => {
  const { effects, config } = makeEffects({
    spawns: [{ result: { status: 0 }, finalize: true }],
    usage: null,
    bounds: { maxHours: 8, maxResumes: 0, autoResumeOnReset: true }
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /max resumes/);
  assert.equal(r.spawns, 0);
});
