'use strict';

// The rate-limit termination signature of a headless `claude -p` run is not
// documented, so we classify defensively: prefer inference from cached usage
// (near-limit + a future reset), then fall back to stderr patterns.
const DEFAULT_PATTERNS = [/rate.?limit/i, /usage limit/i, /quota/i, /\b429\b/];
const NEAR_LIMIT_PERCENT = 95;

// ctx: { finalized, code, stderr, usage, now (ms), patterns? }
// returns 'completed' | 'incomplete' | 'rate_limited' | 'error'
function classifyOutcome(ctx) {
  const { finalized, code, stderr, usage, now, patterns } = ctx;
  if (finalized) return 'completed';      // the engine wrote summary.md → run is done
  // A clean exit WITHOUT finalize is NOT success: claude stopped but the engine never
  // wrote summary.md (hook not wired, or a partial stop). Caller resumes or stops — it
  // must never be reported as 'completed' (that was a silent false-green).
  if (code === 0) return 'incomplete';

  const nowSec = (typeof now === 'number' ? now : Date.now()) / 1000;
  const resetFuture = usage && typeof usage.sessionResetAt === 'number' && usage.sessionResetAt > nowSec;
  const nearLimit = usage && (
    (typeof usage.sessionUsedPercent === 'number' && usage.sessionUsedPercent >= NEAR_LIMIT_PERCENT) ||
    (typeof usage.weeklyPercent === 'number' && usage.weeklyPercent >= NEAR_LIMIT_PERCENT)
  );
  if (resetFuture && nearLimit) return 'rate_limited';

  const pats = patterns || DEFAULT_PATTERNS;
  if (typeof stderr === 'string' && pats.some(p => p.test(stderr))) return 'rate_limited';

  return 'error';
}

module.exports = { classifyOutcome, DEFAULT_PATTERNS, NEAR_LIMIT_PERCENT };
