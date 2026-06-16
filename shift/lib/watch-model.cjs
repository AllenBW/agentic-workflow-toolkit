'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadState } = require('./state.cjs');
const { isPaused, isStopRequested } = require('./control.cjs');

// --- model -----------------------------------------------------------------

function readLog(dir) {
  let raw;
  try { raw = fs.readFileSync(path.join(dir, 'log.md'), 'utf8'); } catch { return { recent: [], needsYou: [] }; }
  const lines = raw.split('\n');
  const recent = [];
  const needsYou = [];
  for (const line of lines) {
    // hook writes: "## <iso> — work <id> (iter N)"
    const m = line.match(/^##\s*(\S+)\s*—\s*(.+)$/);
    if (m) {
      const time = (m[1].match(/T(\d{2}:\d{2})/) || [])[1] || m[1];
      recent.push(`${time}  ${m[2]}`);
    }
    const n = line.match(/^Needs you:\s*(.+)$/);
    if (n) needsYou.push(n[1].trim());
  }
  return { recent: recent.slice(-6), needsYou };
}

// buildModel({ dir, now }) — read .shift/ into a plain view model. Pure of rendering.
function buildModel({ dir, now }) {
  let state;
  try { state = loadState(dir); } catch { return { exists: false }; }

  const bins = (state.bins || []).map(b => ({
    id: b.id, status: b.status, commit: b.commit || null, note: b.note || null,
    current: b.id === state.currentBinId && b.status === 'pending'
  }));
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

  return {
    exists: true,
    runId: state.runId, branch: state.branch, iterations: state.iterations || 0,
    elapsedMin, paused: isPaused(dir), stopping: isStopRequested(dir),
    finalized: fs.existsSync(path.join(dir, 'summary.md')),
    bins, counts, recent, needsYou
  };
}

// --- render ----------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
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

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

// renderFrame(model, { width, color }) -> string. Pure.
function renderFrame(model, opts = {}) {
  const width = opts.width || 80;
  const color = opts.color !== false;
  const c = (code, s) => paint(color, code, s);

  if (!model || !model.exists) {
    return c(ANSI.dim, 'No active shift run in this directory. Start one with `shift start`.') + '\n';
  }

  const L = [];
  const status = model.finalized
    ? c(ANSI.green, '● finalized')
    : model.stopping ? c(ANSI.red, '■ stopping after current bin')
      : model.paused ? c(ANSI.yellow, '⏸ PAUSED') : c(ANSI.green, '▶ running');
  L.push(`${c(ANSI.bold, 'shift')} ${c(ANSI.dim, '·')} ${c(ANSI.cyan, model.branch)} ${c(ANSI.dim, '·')} iter ${model.iterations}   ${status}`);
  L.push(c(ANSI.dim, '─'.repeat(Math.min(width, 64))));

  const { done, total } = { done: model.counts.done, total: model.counts.total };
  L.push(`${c(ANSI.green, bar(done, total, 24))}  ${c(ANSI.bold, `${done}/${total}`)} bins ${c(ANSI.dim, '·')} ${model.elapsedMin}m elapsed`);
  L.push('');

  for (const b of model.bins) {
    const g = c(binColor(b), binGlyph(b));
    const id = c(b.current ? ANSI.cyan : (b.status === 'pending' ? ANSI.dim : ANSI.reset), pad(b.id, 28));
    let tail = b.status;
    if (b.current) tail = 'working  ← current';
    else if (b.commit) tail = `done  (${b.commit.slice(0, 7)})`;
    else if (b.note) tail = `${b.status}  — ${b.note}`;
    L.push(` ${g} ${id} ${c(ANSI.dim, tail)}`);
  }
  L.push('');

  if (model.recent.length) {
    L.push(c(ANSI.dim, 'recent:'));
    for (const r of model.recent.slice(-4)) L.push(c(ANSI.gray, `   ${r}`));
    L.push('');
  }

  const needs = model.needsYou.length;
  const needsLabel = needs ? c(ANSI.yellow, `Needs you: ${needs}`) : c(ANSI.dim, 'Needs you: 0');
  const hints = `${c(ANSI.bold, '[p]')}ause  ${c(ANSI.bold, '[k]')}skip current  ${c(ANSI.bold, '[q]')}stop  ${c(ANSI.bold, '[x]')}exit watcher`;
  L.push(`${needsLabel}   ${c(ANSI.dim, '·')}   ${hints}`);

  return L.join('\n') + '\n';
}

// One-line summary for a status bar (module 1 / ccstatusline custom-command).
function renderLine(model, opts = {}) {
  const color = opts.color !== false;
  const c = (code, s) => paint(color, code, s);
  if (!model || !model.exists) return '';
  const flag = model.finalized ? '●' : model.paused ? '⏸' : '⚙';
  const needs = model.needsYou.length ? ` ${c(ANSI.yellow, '⚑' + model.needsYou.length)}` : '';
  return `${flag} shift ${c(ANSI.bold, model.counts.done + '/' + model.counts.total)} ${c(ANSI.dim, model.elapsedMin + 'm')}${needs}`;
}

module.exports = { buildModel, renderFrame, renderLine };
