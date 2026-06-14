'use strict';
const { evaluateBounds } = require('./bounds.cjs');
const { firstPending } = require('./state.cjs');
const { renderBrief } = require('./brief.cjs');

// ctx: { bins, state, config, now, stopHookActive, killSwitch }
// returns { action:'allow', reason } | { action:'block', reason, nextBinId }
function decide(ctx) {
  const { bins, state, config, now, killSwitch } = ctx;
  if (killSwitch) return { action: 'allow', reason: 'kill switch (.shift/STOP) present' };
  const bound = evaluateBounds(state, config, now);
  if (bound) return { action: 'allow', reason: bound.reason };
  const next = firstPending(bins);
  if (!next) return { action: 'allow', reason: 'queue empty' };
  return { action: 'block', reason: renderBrief(next, config), nextBinId: next.id };
}

module.exports = { decide };
