'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { engineDir } = require('./store.cjs');

// Append-only record of bin boundaries (one event per line) — the source of per-bin
// runtime + token windows, paired with the transcript for tokens. Lives in the engine's
// out-of-repo state dir (see store.cjs) so the agent can't delete or rewrite it.

function timelinePath(cwd) { return path.join(engineDir(cwd), 'timeline.jsonl'); }

function appendEvent(cwd, ev) { // ev: { t: iso, event: 'start'|'finish', id }
  try { fs.appendFileSync(timelinePath(cwd), JSON.stringify(ev) + '\n'); } catch { /* best-effort */ }
}

function readTimeline(cwd) {
  let raw;
  try { raw = fs.readFileSync(timelinePath(cwd), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function clearTimeline(cwd) { try { fs.unlinkSync(timelinePath(cwd)); } catch { /* none */ } }

// binWindows(events) -> { id: { startedAt, finishedAt } } — first start, last finish.
function binWindows(events) {
  const w = {};
  for (const e of events) {
    if (!e || !e.id) continue;
    if (!w[e.id]) w[e.id] = { startedAt: null, finishedAt: null };
    if (e.event === 'start' && !w[e.id].startedAt) w[e.id].startedAt = e.t;
    if (e.event === 'finish') w[e.id].finishedAt = e.t;
  }
  return w;
}

module.exports = { timelinePath, appendEvent, readTimeline, clearTimeline, binWindows };
