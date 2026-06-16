'use strict';
const fs = require('node:fs');
const path = require('node:path');

// An append-only record of bin boundaries (one event per line in .shift/timeline.jsonl)
// — the source of per-bin runtime + token windows, paired with the transcript for tokens.
//
// Best-effort, by design: in a fully-headless autonomous run the agent may rewrite or
// delete files under .shift/ (observed), so per-bin metrics can be lost — the run-level
// totals + the work-record history (the hook's final write) remain authoritative
// regardless. Writing this out-of-repo isn't an option: Claude Code sandboxes hook
// file-writes to the project directory. See SPEC §13.

function timelinePath(dir) { return path.join(dir, 'timeline.jsonl'); }

function appendEvent(dir, ev) { // ev: { t: iso, event: 'start'|'finish', id }
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(timelinePath(dir), JSON.stringify(ev) + '\n'); }
  catch { /* best-effort */ }
}

function readTimeline(dir) {
  let raw;
  try { raw = fs.readFileSync(timelinePath(dir), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function clearTimeline(dir) { try { fs.unlinkSync(timelinePath(dir)); } catch { /* none */ } }

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
