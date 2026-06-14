'use strict';
const fs = require('node:fs');
const path = require('node:path');

function statePath(dir) { return path.join(dir, 'state.json'); }

function loadState(dir) { return JSON.parse(fs.readFileSync(statePath(dir), 'utf8')); }

function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  // Persist lean: the bin `text` is re-read from disk on each discovery pass, so
  // keep it out of state.json (avoids bloating state with full brief/plan bodies).
  const lean = { ...state, bins: state.bins.map(({ text, ...b }) => b) };
  fs.writeFileSync(statePath(dir), JSON.stringify(lean, null, 2));
}

function initState({ runId, startedAt, branch }) {
  return { runId, startedAt, iterations: 0, branch, currentBinId: null, bins: [] };
}

// Merge freshly discovered bins into state, carrying over status by id+hash.
// New or content-changed files appear as 'pending'.
function mergeDiscovered(state, discovered) {
  const prev = new Map(state.bins.map(b => [b.id + '@' + b.hash, b]));
  const bins = discovered.map(d => {
    const carried = prev.get(d.id + '@' + d.hash);
    // Always carry the freshly-read `text` (needed to render the brief); status
    // comes from the prior run if this id+hash was already seen.
    return carried
      ? { ...carried, kind: d.kind, text: d.text }
      : { id: d.id, hash: d.hash, kind: d.kind, status: 'pending', text: d.text };
  });
  return { ...state, bins };
}

function firstPending(bins) { return bins.find(b => b.status === 'pending') || null; }

function setBinStatus(state, id, patch) {
  return { ...state, bins: state.bins.map(b => (b.id === id ? { ...b, ...patch } : b)) };
}

module.exports = { statePath, loadState, saveState, initState, mergeDiscovered, firstPending, setBinStatus };
