#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { discoverBins } = require('../lib/discovery.cjs');
const { loadState, saveState, mergeDiscovered, setBinStatus } = require('../lib/state.cjs');
const { decide } = require('../lib/decision.cjs');

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function readBlocked(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'blocked.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// "Needs you: <detail>" lines the agent appended to the log (non-blocking flags).
function readNeedsYou(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'log.md'), 'utf8')
      .split('\n')
      .map(l => l.match(/^Needs you:\s*(.+)$/))
      .filter(Boolean)
      .map(m => m[1].trim());
  } catch { return []; }
}

function writeSummary(dir, state, reason, now) {
  const done = state.bins.filter(b => b.status === 'done').length;
  const blocked = state.bins.filter(b => b.status === 'blocked');
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
    `Bins: ${done} done · ${blocked.length} blocked · ${pending} pending`, '',
    '## Needs you',
    ...(items.length ? items : ['- (nothing flagged)'])
  ];
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n') + '\n');
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  // Resolve the repo from the hook payload's cwd (the hook's process cwd is not
  // guaranteed to be the project root); fall back to process.cwd().
  const cwd = (input && typeof input.cwd === 'string' && input.cwd) ? input.cwd : process.cwd();
  const dir = path.join(cwd, '.shift');
  if (!fs.existsSync(path.join(dir, 'state.json'))) { process.stdout.write('{}'); return; }

  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  let state = loadState(dir);
  const now = Date.now();
  const killSwitch = fs.existsSync(path.join(dir, 'STOP'));

  // Attribute the just-finished work to the current bin.
  if (state.currentBinId) {
    const b = readBlocked(dir).find(x => x.id === state.currentBinId);
    state = setBinStatus(state, state.currentBinId, b
      ? { status: 'blocked', note: b.note }
      : { status: 'done', finishedAt: new Date(now).toISOString() });
  }

  // Re-discover (picks up newly added files) and carry over statuses.
  state = mergeDiscovered(state, discoverBins(config.sources, cwd));

  const result = decide({
    bins: state.bins, state, config, now,
    stopHookActive: !!input.stop_hook_active, killSwitch
  });

  if (result.action === 'block') {
    state.iterations += 1;
    state.currentBinId = result.nextBinId;
    saveState(dir, state);
    fs.appendFileSync(path.join(dir, 'log.md'),
      `\n## ${new Date(now).toISOString()} — start ${result.nextBinId} (iter ${state.iterations})\n`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
  } else {
    state.currentBinId = null;
    saveState(dir, state);
    writeSummary(dir, state, result.reason, now);
    process.stdout.write('{}');
  }
}

main();
