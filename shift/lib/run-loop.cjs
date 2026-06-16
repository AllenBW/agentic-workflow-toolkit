'use strict';
const { evaluateBounds } = require('./bounds.cjs');
const { classifyOutcome } = require('./outcome.cjs');

const RESET_BUFFER_MS = 60_000;
const PAUSE_POLL_MS = 5_000;

// The headless outer loop (v2). All side effects are injected so the loop is
// fully testable without a real `claude` or real sleeping.
//
// effects: {
//   now(): ms, loadState(): state, readUsage(): usageCache|null, log(msg),
//   finalized(): bool,                 // did the engine write summary.md this run?
//   spawn(n): { status, stderr },      // run claude once (n = 1-based spawn count)
//   sleepUntil(ms): Promise<void>
// }
// Returns { reason, spawns }.
async function runLoop({ config, effects }) {
  const bounds = (config && config.bounds) || {};
  const maxResumes = typeof bounds.maxResumes === 'number' ? bounds.maxResumes : 12;
  let spawns = 0;
  let lastOutcome = null;

  for (;;) {
    const state = effects.loadState();
    const now = effects.now();
    const usage = effects.readUsage();

    const bound = evaluateBounds(state, config, now, usage ? usage.weeklyPercent : undefined);
    if (bound) return { reason: bound.reason, spawns };
    if (spawns >= maxResumes) return { reason: `max resumes (${maxResumes}) reached`, spawns };

    if (lastOutcome === 'completed') return { reason: 'run finalized by the engine', spawns };
    if (lastOutcome === 'error') return { reason: 'run errored — stopping (see output)', spawns };

    // Paused via `shift watch` ([p]): idle without spawning until resumed. Still bounded
    // by maxHours/usage (re-checked each poll), so a forgotten pause can't run forever.
    if (effects.isPaused && effects.isPaused()) {
      // [q] stops even while paused — otherwise pause+stop would park until the time box.
      if (effects.isStopRequested && effects.isStopRequested()) return { reason: 'stopped while paused', spawns };
      effects.log('paused — waiting (resume with [p] in `shift watch`)');
      await effects.sleepUntil(now + PAUSE_POLL_MS);
      continue;
    }

    if (lastOutcome === 'rate_limited') {
      if (!bounds.autoResumeOnReset) return { reason: 'rate limited; auto-resume disabled', spawns };
      const resetAt = usage && typeof usage.sessionResetAt === 'number' ? usage.sessionResetAt * 1000 : null;
      if (!resetAt) return { reason: 'rate limited but no reset time available — stopping', spawns };
      const until = resetAt + RESET_BUFFER_MS;
      // The cached reset time is only refreshed by the Stop hook; a wall that kills the
      // session before any hook fires leaves it stale. If it's already in the past,
      // sleepUntil(past) returns instantly and we'd re-spawn in a tight loop — stop instead.
      if (until <= now) return { reason: 'rate limited but the reset window is stale/past — stopping', spawns };
      if (typeof bounds.maxHours === 'number') {
        const deadline = Date.parse(state.startedAt) + bounds.maxHours * 3_600_000;
        if (until >= deadline) return { reason: 'rate limited; reset is past the time box — stopping', spawns };
      }
      effects.log(`rate limited — waiting until ${new Date(until).toISOString()}`);
      await effects.sleepUntil(until);
      lastOutcome = null;
      continue;
    }

    const iterBefore = (state && typeof state.iterations === 'number') ? state.iterations : 0;
    spawns += 1;
    effects.log(`spawn #${spawns}: running claude`);
    const res = effects.spawn(spawns);
    const outcome = classifyOutcome({
      finalized: effects.finalized(),
      code: res ? res.status : 1,
      stderr: res ? res.stderr : '',
      usage: effects.readUsage(),
      now: effects.now()
    });

    // 'incomplete' = claude exited cleanly but the engine never finalized. If it advanced
    // the queue (partial progress), resume to finish it; if it advanced nothing, resuming
    // won't help — stop with a diagnostic rather than spin or report a false-green.
    if (outcome === 'incomplete') {
      const after = effects.loadState();
      const iterAfter = (after && typeof after.iterations === 'number') ? after.iterations : iterBefore;
      if (iterAfter <= iterBefore) {
        return { reason: 'claude exited without finalizing and made no progress — is the Stop hook wired? (nothing committed)', spawns };
      }
      effects.log('claude exited mid-queue with progress — resuming');
    }
    lastOutcome = outcome;
  }
}

module.exports = { runLoop, RESET_BUFFER_MS };
