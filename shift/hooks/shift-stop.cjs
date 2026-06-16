#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { discoverBins } = require('../lib/discovery.cjs');
const { loadState, saveState, mergeDiscovered, setBinStatus } = require('../lib/state.cjs');
const { decide } = require('../lib/decision.cjs');
const { runVerify } = require('../lib/verify.cjs');
const { writeUsageCache } = require('../lib/usage.cjs');
const { readSkip, clearSkip } = require('../lib/control.cjs');
const { sumTokens } = require('../lib/transcript.cjs');
const { appendRecord } = require('../lib/history.cjs');
const { appendEvent, readTimeline, binWindows } = require('../lib/timeline.cjs');
const { engineDir } = require('../lib/store.cjs');

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function readBlocked(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'blocked.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function readNeedsYou(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'log.md'), 'utf8')
      .split('\n').map(l => l.match(/^Needs you:\s*(.+)$/)).filter(Boolean).map(m => m[1].trim());
  } catch { return []; }
}

function tail(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(s.length - n) : s;
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function writeSummary(dir, state, reason, now, runTok) {
  const done = state.bins.filter(b => b.status === 'done').length;
  const blocked = state.bins.filter(b => b.status === 'blocked');
  const skipped = state.bins.filter(b => b.status === 'skipped').length;
  const pending = state.bins.filter(b => b.status === 'pending').length;
  const mins = Math.round((now - Date.parse(state.startedAt)) / 60000);
  const items = [
    ...blocked.map(b => `- ${b.id}: ${b.note || 'blocked'}`),
    ...readNeedsYou(dir).map(n => `- ${n}`)
  ];
  const lines = [
    `# shift summary — ${state.runId}`, '',
    `Ended: ${reason}`,
    `Duration: ${mins} min · Iterations: ${state.iterations}`,
    `Branch: ${state.branch}`,
    `Bins: ${done} done · ${blocked.length} blocked · ${skipped} skipped · ${pending} pending`
  ];
  if (runTok) lines.push(`Tokens: ${fmtTokens(runTok.output)} output · ${fmtTokens(runTok.total)} total`);
  lines.push('', '## Needs you', ...(items.length ? items : ['- (nothing flagged)']));
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n') + '\n');
}

// Append this run to the work record (<engineDir>/history.jsonl, out-of-repo). One row per finalized run.
// Per-bin metrics come from the timeline (boundaries) + transcript (tokens) so they
// survive even if the agent rewrote state.json mid-run.
function appendRunRecord(edir, cwd, state, reason, now, runTok, transcriptPath) {
  const tally = s => state.bins.filter(b => b.status === s).length;
  const windows = binWindows(readTimeline(cwd));
  const nowIso = new Date(now).toISOString();
  appendRecord(edir, {
    runId: state.runId, branch: state.branch,
    startedAt: state.startedAt, endedAt: nowIso,
    durationMs: Math.max(0, now - Date.parse(state.startedAt)),
    iterations: state.iterations, endReason: reason,
    bins: { total: state.bins.length, done: tally('done'), skipped: tally('skipped'), blocked: tally('blocked') },
    tokens: { output: runTok ? runTok.output : 0, total: runTok ? runTok.total : 0 },
    perBin: state.bins.map(b => {
      const w = windows[b.id] || {};
      const durationMs = (w.startedAt && w.finishedAt)
        ? Math.max(0, Date.parse(w.finishedAt) - Date.parse(w.startedAt))
        : (b.durationMs || null);
      let tokensOutput = (b.tokens && b.tokens.output) || null;
      if (tokensOutput == null && transcriptPath && w.startedAt) {
        const t = sumTokens(transcriptPath, w.startedAt, w.finishedAt || nowIso);
        if (t.messages > 0) tokensOutput = t.output;
      }
      return { id: b.id, status: b.status, durationMs, tokensOutput, commit: b.commit || null };
    })
  });
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  // Resolve the repo from the hook payload's cwd (the hook's process cwd is not
  // guaranteed to be the project root); fall back to process.cwd().
  const cwd = (input && typeof input.cwd === 'string' && input.cwd) ? input.cwd : process.cwd();
  const dir = path.join(cwd, '.shift');           // user/agent-facing: config, summary, log, control
  const edir = engineDir(cwd);                    // engine-owned, out of the agent's reach: state, usage, history, timeline
  if (!fs.existsSync(path.join(edir, 'state.json'))) { process.stdout.write('{}'); return; }

  // config is snapshotted into the engine dir at `shift start`; prefer that (the agent
  // can't delete it) and fall back to the repo copy.
  const cfgFile = fs.existsSync(path.join(edir, 'config.json')) ? path.join(edir, 'config.json') : path.join(dir, 'config.json');
  const config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const killSwitch = fs.existsSync(path.join(dir, 'STOP'));
  const payloadTranscript = (input && typeof input.transcript_path === 'string') ? input.transcript_path : null;

  // Capture rate limits from the hook payload: enforce the usage cap and cache
  // reset times for the headless runner. Absent on non-Pro/Max or pre-first-response.
  const usagePercent = writeUsageCache(edir, input.rate_limits, Math.floor(now / 1000));

  // Re-discover (fresh text + new files) and carry over status/attempts.
  let state = mergeDiscovered(loadState(edir), discoverBins(config.sources, cwd));
  const transcriptPath = payloadTranscript || state.transcriptPath || null;

  const prevBinId = state.currentBinId;
  const verifyCmd = config.verify && config.verify.command;
  const maxAttempts = (config.verify && config.verify.maxAttempts) || 2;
  let retryFeedback = null;

  // When a bin finishes, attribute its runtime + tokens. The window [start, now) comes
  // from the append-only timeline (agent-proof) — NOT state.json, which an autonomous
  // agent may rewrite mid-run — and tokens are summed from the transcript (also outside
  // the repo). `fm` is merged into whichever terminal status the bin lands on, but the
  // durable copy is the timeline + the history record, not these (clobberable) fields.
  const prevStart = prevBinId ? (binWindows(readTimeline(cwd))[prevBinId] || {}).startedAt : null;
  let fm = {};
  if (prevBinId) {
    const tok = (transcriptPath && prevStart) ? sumTokens(transcriptPath, prevStart, nowIso) : null;
    fm = {
      finishedAt: nowIso,
      durationMs: prevStart ? Math.max(0, now - Date.parse(prevStart)) : undefined,
      tokens: tok ? { output: tok.output, input: tok.input, cacheRead: tok.cacheRead, total: tok.total } : undefined
    };
  }

  // Attribute the just-finished work to the current bin (skipped / blocked / verify gate / done).
  let binFinished = false;
  if (prevBinId) {
    const skipId = readSkip(dir);
    if (skipId) clearSkip(dir); // consume on read: a skip that misses its target is discarded, never left to fire on a later bin
    const blocked = readBlocked(dir).find(x => x.id === prevBinId);
    if (skipId === prevBinId) {
      // User hit [k] in `shift watch`: drop this bin and move on (work, if any, stays on the branch).
      state = setBinStatus(state, prevBinId, { status: 'skipped', note: 'skipped by user', ...fm });
      binFinished = true;
    } else if (blocked) {
      state = setBinStatus(state, prevBinId, { status: 'blocked', note: blocked.note, ...fm });
      binFinished = true;
    } else if (verifyCmd) {
      const v = runVerify(verifyCmd, cwd);
      if (v.ok) {
        state = setBinStatus(state, prevBinId, { status: 'done', ...fm });
        binFinished = true;
      } else {
        const bin = state.bins.find(b => b.id === prevBinId) || {};
        const attempts = (bin.attempts || 0) + 1;
        if (attempts < maxAttempts) {
          state = setBinStatus(state, prevBinId, { attempts }); // stays pending → re-blocked below (not finished yet)
          retryFeedback = `Your previous attempt failed verification (\`${verifyCmd}\`). Fix it and make it pass. Output (tail):\n${tail(v.output, 2000)}`;
        } else {
          state = setBinStatus(state, prevBinId, { status: 'blocked', attempts, note: `failed verification after ${attempts} attempts`, ...fm });
          binFinished = true;
        }
      }
    } else {
      state = setBinStatus(state, prevBinId, { status: 'done', ...fm });
      binFinished = true;
    }
    if (binFinished) appendEvent(cwd, { t: nowIso, event: 'finish', id: prevBinId });
  }

  const result = decide({
    bins: state.bins, state, config, now, usagePercent,
    stopHookActive: !!input.stop_hook_active, killSwitch
  });

  if (transcriptPath) state.transcriptPath = transcriptPath; // so `shift watch` can live-parse tokens

  if (result.action === 'block') {
    let reason = result.reason;
    if (retryFeedback && result.nextBinId === prevBinId) reason += `\n\n${retryFeedback}`;
    state.iterations += 1;
    state.currentBinId = result.nextBinId;
    // Record the bin's start. binWindows keeps the FIRST start per bin, so re-emitting on
    // a verify retry (or after the agent clobbers state.json so prevBinId looks unchanged)
    // is harmless — and unconditionally appending guarantees every bin has a start event.
    appendEvent(cwd, { t: nowIso, event: 'start', id: result.nextBinId });
    const nb = state.bins.find(b => b.id === result.nextBinId);
    if (nb && !nb.startedAt) state = setBinStatus(state, result.nextBinId, { startedAt: nowIso });
    saveState(edir, state);
    fs.appendFileSync(path.join(dir, 'log.md'),
      `\n## ${nowIso} — work ${result.nextBinId} (iter ${state.iterations})\n`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } else {
    // First finalize only (summary.md absent) appends the work record — guards against a
    // stray extra Stop firing after the run already finalized.
    const alreadyFinalized = fs.existsSync(path.join(dir, 'summary.md'));
    const runTok = transcriptPath ? sumTokens(transcriptPath, state.startedAt, nowIso) : null;
    state.currentBinId = null;
    saveState(edir, state);
    if (!alreadyFinalized) appendRunRecord(edir, cwd, state, result.reason, now, runTok, transcriptPath);
    writeSummary(dir, state, result.reason, now, runTok);
    process.stdout.write('{}');
  }
}

main();
