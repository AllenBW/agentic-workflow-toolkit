'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The shift work record: an append-only ledger of finalized runs at <engineDir>/history.jsonl
// (out-of-repo, alongside state.json/usage.json/timeline.jsonl — see store.cjs). `shift start`
// resets the engine state but never touches this, so it accumulates across runs. All callers
// pass the engineDir. One JSON line per run (totals + per-bin breakdown). Read for `shift history`.

function historyPath(dir) { return path.join(dir, 'history.jsonl'); }

function appendRecord(dir, record) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(historyPath(dir), JSON.stringify(record) + '\n');
  } catch { /* best-effort: never let a logging failure break the run */ }
}

function readHistory(dir) {
  let raw;
  try { raw = fs.readFileSync(historyPath(dir), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// aggregate(records) -> totals across the ledger.
function aggregate(records) {
  const a = { runs: 0, durationMs: 0, outputTokens: 0, bins: { total: 0, done: 0, skipped: 0, blocked: 0 } };
  for (const r of records) {
    a.runs += 1;
    a.durationMs += (r.durationMs || 0);
    a.outputTokens += ((r.tokens && r.tokens.output) || 0);
    const b = r.bins || {};
    for (const k of ['total', 'done', 'skipped', 'blocked']) a.bins[k] += (b[k] || 0);
  }
  return a;
}

module.exports = { historyPath, appendRecord, readHistory, aggregate };
