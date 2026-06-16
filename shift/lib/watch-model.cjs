'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadState } = require('./state.cjs');
const { isPaused, isStopRequested } = require('./control.cjs');
const { sumUsage, readLines } = require('./transcript.cjs');
const { readTimeline, binWindows } = require('./timeline.cjs');
const { engineDir } = require('./store.cjs');

// --- model -----------------------------------------------------------------

function readLog(dir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dir, 'log.md'), 'utf8'); } catch { return { recent: [], needsYou: [] }; }
  const lines = raw.split('\n');
  const recent = [];
  const needsYou = [];
  for (const line of lines) {
    const m = line.match(/^##\s*(\S+)\s*—\s*(.+)$/); // "## <iso> — work <id> (iter N)"
    if (m) {
      const time = (m[1].match(/T(\d{2}:\d{2})/) || [])[1] || m[1];
      recent.push(`${time}  ${m[2]}`);
    }
    const n = line.match(/^Needs you:\s*(.+)$/);
    if (n) needsYou.push(n[1].trim());
  }
  return { recent: recent.slice(-6), needsYou };
}

function readBrief(cwd, binId) {
  try { return fs.readFileSync(path.join(cwd, binId), 'utf8'); } catch { return ''; }
}

// buildModel({ dir, now }) — read the run into a plain view model. `dir` is the repo's
// .shift/ (log, control, summary); the engine state (state.json) lives out-of-repo.
function buildModel({ dir, now }) {
  const cwd = path.dirname(dir);
  const edir = engineDir(cwd);
  let state;
  try { state = loadState(edir); } catch { return { exists: false }; }

  // Per-bin runtime + tokens are derived from the timeline (agent-proof boundaries) and
  // the transcript (parsed once), so they survive a state.json the agent rewrote. We fall
  // back to any stamps the hook left on state.bins when no timeline/transcript is present.
  const windows = binWindows(readTimeline(path.dirname(dir))); // timeline keyed by repo cwd, not .shift
  const lines = state.transcriptPath ? readLines(state.transcriptPath) : [];
  const startMs = b => (windows[b.id] && windows[b.id].startedAt) ? Date.parse(windows[b.id].startedAt) : null;
  const finMs = (b, current) => {
    const w = windows[b.id] || {};
    if (w.finishedAt) return Date.parse(w.finishedAt);
    return current ? now : null; // current bin: open window up to now (live)
  };

  const bins = (state.bins || []).map(b => {
    const current = b.id === state.currentBinId && b.status === 'pending';
    const s = startMs(b), f = finMs(b, current);
    let durationMs = (s != null && f != null) ? Math.max(0, f - s)
      : (typeof b.durationMs === 'number' ? b.durationMs : null);
    let tokens = b.tokens || null;
    let tokensOutput = (tokens && typeof tokens.output === 'number') ? tokens.output : null;
    if (tokensOutput == null && lines.length && s != null) {
      const t = sumUsage(lines, s, f != null ? f : null);
      if (t.messages > 0) { tokens = { output: t.output, input: t.input, cacheRead: t.cacheRead, total: t.total }; tokensOutput = t.output; }
    }
    return { id: b.id, status: b.status, commit: b.commit || null, note: b.note || null, current, durationMs, tokensOutput, tokens };
  });
  const count = s => bins.filter(b => b.status === s).length;
  const counts = {
    done: count('done'), blocked: count('blocked'), skipped: count('skipped'),
    pending: count('pending'), total: bins.length
  };

  const { recent, needsYou: logged } = readLog(dir);
  const needsYou = [
    ...bins.filter(b => b.status === 'blocked').map(b => `${b.id}: ${b.note || 'blocked'}`),
    ...logged
  ];

  const startedMs = Date.parse(state.startedAt);
  const elapsedMin = Number.isFinite(startedMs) ? Math.max(0, Math.round((now - startedMs) / 60000)) : 0;

  // Run output tokens: the transcript over [run start, now) (climbs live during a run);
  // fall back to the sum of per-bin tokens when no transcript is known.
  let outputTokens = bins.reduce((s, b) => s + (b.tokensOutput || 0), 0);
  if (lines.length && Number.isFinite(startedMs)) {
    const t = sumUsage(lines, startedMs, now);
    if (t.messages > 0) outputTokens = t.output;
  }

  return {
    exists: true,
    cwd: path.dirname(dir),
    runId: state.runId, branch: state.branch, iterations: state.iterations || 0,
    elapsedMin, outputTokens,
    paused: isPaused(dir), stopping: isStopRequested(dir),
    finalized: fs.existsSync(path.join(dir, 'summary.md')),
    bins, counts, recent, needsYou
  };
}

// --- render ----------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', inverse: '\x1b[7m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m'
};
function paint(color, code, s) { return color ? code + s + ANSI.reset : s; }

const GLYPH = { done: '✓', blocked: '✗', skipped: '⤫', pending: '·' };
function binGlyph(b) { return b.current ? '▶' : (GLYPH[b.status] || '·'); }
function binColor(b) {
  if (b.current) return ANSI.cyan;
  return { done: ANSI.green, blocked: ANSI.red, skipped: ANSI.gray, pending: ANSI.dim }[b.status] || '';
}

function bar(done, total, width) {
  if (total <= 0) return '';
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}
function pad(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
}
function fmtTok(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

// renderFrame(model, { width, color, selectedIndex }) -> string. Pure.
function renderFrame(model, opts = {}) {
  const width = opts.width || 80;
  const color = opts.color !== false;
  const sel = typeof opts.selectedIndex === 'number' ? opts.selectedIndex : -1;
  const c = (code, s) => paint(color, code, s);

  if (!model || !model.exists) {
    return c(ANSI.dim, 'No active shift run in this directory. Start one with `shift start`.') + '\n';
  }

  const L = [];
  const status = model.finalized
    ? c(ANSI.green, '● finalized')
    : model.stopping ? c(ANSI.red, '■ stopping after current bin')
      : model.paused ? c(ANSI.yellow, '⏸ PAUSED') : c(ANSI.green, '▶ running');
  L.push(`${c(ANSI.bold, 'shift')} ${c(ANSI.dim, '·')} ${c(ANSI.cyan, model.branch)} ${c(ANSI.dim, '·')} iter ${model.iterations}   ${status} ${c(ANSI.dim, '·')} ${model.elapsedMin}m ${c(ANSI.dim, '·')} ${c(ANSI.bold, '↑' + fmtTok(model.outputTokens))} out`);
  L.push(c(ANSI.dim, '─'.repeat(Math.min(width, 64))));

  const { done, blocked, skipped, total } = model.counts;
  const resolved = done + blocked + skipped; // bar reaches full at finalize
  const extra = (blocked + skipped) ? c(ANSI.dim, ` (${blocked + skipped} blocked/skipped)`) : '';
  L.push(`${c(ANSI.green, bar(resolved, total, 24))}  ${c(ANSI.bold, `${done}/${total}`)} done${extra}`);
  L.push('');

  model.bins.forEach((b, i) => {
    const cursor = i === sel ? c(ANSI.cyan, '▸') : ' ';
    const g = c(binColor(b), binGlyph(b));
    const id = c(b.current ? ANSI.cyan : (b.status === 'pending' ? ANSI.dim : ANSI.reset), pad(b.id, 24));
    const dur = c(ANSI.dim, lpad(fmtDur(b.durationMs), 6));
    const tok = c(ANSI.dim, lpad(b.tokensOutput == null ? '—' : fmtTok(b.tokensOutput), 6));
    let tail = b.status;
    if (b.current) tail = 'working ← current';
    else if (b.commit) tail = `(${b.commit.slice(0, 7)})`;
    else if (b.note) tail = `— ${b.note}`;
    else tail = '';
    L.push(`${cursor}${g} ${id} ${dur} ${tok}  ${c(ANSI.dim, tail)}`);
  });
  L.push('');

  const needs = model.needsYou.length;
  const needsLabel = needs ? c(ANSI.yellow, `Needs you: ${needs}`) : c(ANSI.dim, 'Needs you: 0');
  const nav = sel >= 0 ? `${c(ANSI.bold, '↑/↓')} select  ${c(ANSI.bold, '⏎')} details  ` : '';
  const hints = `${nav}${c(ANSI.bold, '[p]')}ause  ${c(ANSI.bold, '[k]')}skip  ${c(ANSI.bold, '[q]')}stop  ${c(ANSI.bold, '[x]')}exit`;
  L.push(`${needsLabel}   ${c(ANSI.dim, '·')}   ${hints}`);

  return L.join('\n') + '\n';
}

// renderDetail(model, index, { width, color }) -> string. Drill-down for one bin.
function renderDetail(model, index, opts = {}) {
  const color = opts.color !== false;
  const width = opts.width || 80;
  const c = (code, s) => paint(color, code, s);
  if (!model || !model.exists || !model.bins[index]) return renderFrame(model, opts);
  const b = model.bins[index];
  const t = b.tokens || {};
  const L = [];
  L.push(`${c(ANSI.bold, b.id)} ${c(ANSI.dim, '·')} ${c(binColor(b), b.current ? 'working (current)' : b.status)}    ${c(ANSI.dim, '[esc] back  [k] skip  [q] stop')}`);
  L.push(c(ANSI.dim, '─'.repeat(Math.min(width, 64))));
  L.push(`${c(ANSI.dim, 'status  ')} ${b.current ? 'working (current)' : b.status}${b.note ? '  — ' + b.note : ''}`);
  L.push(`${c(ANSI.dim, 'runtime ')} ${fmtDur(b.durationMs)}`);
  L.push(`${c(ANSI.dim, 'tokens  ')} ${c(ANSI.bold, fmtTok(b.tokensOutput) + ' out')} ${c(ANSI.dim, '·')} ${fmtTok(t.input)} in ${c(ANSI.dim, '·')} ${fmtTok(t.cacheRead)} cache-read ${c(ANSI.dim, '·')} ${fmtTok(t.total)} total`);
  L.push(`${c(ANSI.dim, 'commit  ')} ${b.commit || '—'}`);
  L.push('');
  L.push(c(ANSI.dim, 'brief'));
  const brief = readBrief(model.cwd, b.id).trimEnd();
  const briefLines = brief ? brief.split('\n') : ['(brief unavailable)'];
  for (const line of briefLines.slice(0, 14)) L.push('  ' + c(ANSI.gray, line.slice(0, width - 2)));
  return L.join('\n') + '\n';
}

// renderHistory(records, agg, { color }) -> string. The work record ledger.
function renderHistory(records, agg, opts = {}) {
  const color = opts.color !== false;
  const c = (code, s) => paint(color, code, s);
  if (!records || !records.length) return c(ANSI.dim, 'No shift runs recorded yet. They appear here once a run finalizes.') + '\n';
  const L = [];
  L.push(`${c(ANSI.bold, 'shift work record')} ${c(ANSI.dim, `· ${agg.runs} run${agg.runs === 1 ? '' : 's'}`)}`);
  L.push(c(ANSI.dim, '─'.repeat(64)));
  L.push(c(ANSI.dim, ` ${pad('when', 17)}${pad('branch', 20)}${lpad('time', 7)} ${lpad('out', 7)}  bins`));
  for (const r of records.slice(-25)) {
    const when = (r.endedAt || r.startedAt || '').slice(0, 16).replace('T', ' ');
    const b = r.bins || {};
    const tally = `${c(ANSI.green, (b.done || 0) + '✓')} ${c(ANSI.gray, (b.skipped || 0) + '⤫')} ${c(ANSI.red, (b.blocked || 0) + '✗')}`;
    L.push(` ${pad(when, 17)}${c(ANSI.cyan, pad(r.branch || '', 20))}${lpad(fmtDur(r.durationMs), 7)} ${lpad(fmtTok(r.tokens && r.tokens.output), 7)}  ${tally}`);
  }
  L.push(c(ANSI.dim, '─'.repeat(64)));
  L.push(`${c(ANSI.bold, 'totals')}  ${agg.runs} runs ${c(ANSI.dim, '·')} ${fmtDur(agg.durationMs)} ${c(ANSI.dim, '·')} ${c(ANSI.bold, fmtTok(agg.outputTokens) + ' out')} ${c(ANSI.dim, '·')} ${agg.bins.done}✓ ${agg.bins.skipped}⤫ ${agg.bins.blocked}✗`);
  return L.join('\n') + '\n';
}

// One-line summary for a status bar (module 1 / ccstatusline custom-command).
function renderLine(model, opts = {}) {
  const color = opts.color !== false;
  const c = (code, s) => paint(color, code, s);
  if (!model || !model.exists) return '';
  const flag = model.finalized ? '●' : model.paused ? '⏸' : '⚙';
  const needs = model.needsYou.length ? ` ${c(ANSI.yellow, '⚑' + model.needsYou.length)}` : '';
  return `${flag} shift ${c(ANSI.bold, model.counts.done + '/' + model.counts.total)} ${c(ANSI.dim, model.elapsedMin + 'm')} ${c(ANSI.dim, '↑' + fmtTok(model.outputTokens))}${needs}`;
}

// Pure selection arithmetic for the `shift watch` TUI (n = bin count). Extracted so the
// off-by-one-prone wrap/clamp cases are unit-testable without a TTY.
function moveSelection(sel, n, dir) {
  if (n <= 0) return -1;
  if (dir === 'up') return (sel <= 0 ? n : sel) - 1; // wrap to the last bin
  if (dir === 'down') return (sel + 1) % n;          // wrap to the first
  return sel;
}
function clampSelection(sel, n) { // keep a selection valid when the bin list grows/shrinks
  if (n <= 0) return -1;
  if (sel < 0) return 0;
  return sel >= n ? n - 1 : sel;
}

module.exports = { buildModel, renderFrame, renderDetail, renderHistory, renderLine, fmtDur, fmtTok, moveSelection, clampSelection };
