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
      if (typeof s.iterations === 'number') state.iterations = s.iterations; // simulate engine progress
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

test('incomplete spawn WITH progress resumes and finishes', async () => {
  // spawn 1: clean exit, no finalize, but the engine advanced iterations (partial work);
  // spawn 2: resumes and finalizes.
  const { effects, calls, config } = makeEffects({
    spawns: [
      { result: { status: 0 }, finalize: false, iterations: 1 }, // progress, not done
      { result: { status: 0 }, finalize: true, iterations: 2 }   // resume → drain
    ],
    usage: null
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /finalized/);
  assert.equal(calls.spawns, 2);
});

test('incomplete spawn WITHOUT progress stops with a hook-wiring diagnostic (no false-green)', async () => {
  // claude exits 0 but the engine never advanced (e.g. Stop hook not wired). Must NOT
  // report success, and must NOT keep re-spawning pointlessly.
  const { effects, calls, config } = makeEffects({
    spawns: [{ result: { status: 0 }, finalize: false }], // iterations stays 0
    usage: null
  });
  const r = await runLoop({ config, effects });
  assert.doesNotMatch(r.reason, /finalized/);
  assert.match(r.reason, /no progress|hook/i);
  assert.equal(calls.spawns, 1, 'must not spin');
});

test('pause idles the runner (no spawn) until unpaused, then proceeds', async () => {
  const { effects, calls, config } = makeEffects({
    spawns: [{ result: { status: 0 }, finalize: true }],
    usage: null
  });
  let checks = 0;
  effects.isPaused = () => checks++ < 2; // paused for the first two loop iterations
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /finalized/);
  assert.ok(calls.sleepUntil.length >= 2, 'idled while paused');
  assert.equal(calls.spawns, 1, 'no spawn while paused; one after resume');
});

test('rate-limited with a stale/past reset stops instead of busy-spinning', async () => {
  // Reset time is already in the past (stale cache). sleepUntil(past) would return
  // instantly and re-spawn forever (bounded only by maxResumes) — guard must stop.
  const usage = { weeklyPercent: 50, sessionUsedPercent: 99, sessionResetAt: Math.floor(Date.now() / 1000) - 600 };
  const { effects, calls, config } = makeEffects({
    spawns: [{ result: { status: 1, stderr: 'Error: rate limit exceeded' }, finalize: false }],
    usage,
    bounds: { maxHours: 8, maxResumes: 12, autoResumeOnReset: true }
  });
  const r = await runLoop({ config, effects });
  assert.match(r.reason, /stale|past|reset/i);
  assert.equal(calls.spawns, 1);
  assert.equal(calls.sleepUntil.length, 0, 'must not sleep on a past reset');
});
