'use strict';

// now: epoch ms. usagePercent: latest weekly usage % (or undefined/null if unknown).
// Returns null (continue) or { reason } (terminate the run).
function evaluateBounds(state, config, now, usagePercent) {
  const b = (config && config.bounds) || {};
  if (typeof b.maxIterations === 'number' && state.iterations >= b.maxIterations) {
    return { reason: `max iterations (${b.maxIterations}) reached` };
  }
  if (typeof b.usageCapPercent === 'number' && typeof usagePercent === 'number'
      && usagePercent >= b.usageCapPercent) {
    return { reason: `usage cap (${b.usageCapPercent}%) reached at ${usagePercent}%` };
  }
  if (typeof b.maxHours === 'number') {
    if (now - Date.parse(state.startedAt) >= b.maxHours * 3_600_000) {
      return { reason: `time box (${b.maxHours}h) reached` };
    }
  }
  return null;
}

module.exports = { evaluateBounds };
