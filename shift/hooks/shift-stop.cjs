#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { discoverBins } = require('../lib/discovery.cjs');
const { loadState, saveState, mergeDiscovered, setBinStatus } = require('../lib/state.cjs');
const { decide } = require('../lib/decision.cjs');
const { runVerify } = require('../lib/verify.cjs');
const { writeUsageCache } = require('../lib/usage.cjs');

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
  const now = Date.now();
  const killSwitch = fs.existsSync(path.join(dir, 'STOP'));

  // Capture rate limits from the hook payload: enforce the usage cap and cache
  // reset times for the headless runner. Absent on non-Pro/Max or pre-first-response.
  const usagePercent = writeUsageCache(dir, input.rate_limits, Math.floor(now / 1000));

  // Re-discover (fresh text + new files) and carry over status/attempts.
  let state = mergeDiscovered(loadState(dir), discoverBins(config.sources, cwd));

  const prevBinId = state.currentBinId;
  const verifyCmd = config.verify && config.verify.command;
  const maxAttempts = (config.verify && config.verify.maxAttempts) || 2;
  let retryFeedback = null;

  // Attribute the just-finished work to the current bin (blocked / verify gate / done).
  if (prevBinId) {
    const blocked = readBlocked(dir).find(x => x.id === prevBinId);
    if (blocked) {
      state = setBinStatus(state, prevBinId, { status: 'blocked', note: blocked.note });
    } else if (verifyCmd) {
      const v = runVerify(verifyCmd, cwd);
      if (v.ok) {
        state = setBinStatus(state, prevBinId, { status: 'done', finishedAt: new Date(now).toISOString() });
      } else {
        const bin = state.bins.find(b => b.id === prevBinId) || {};
        const attempts = (bin.attempts || 0) + 1;
        if (attempts < maxAttempts) {
          state = setBinStatus(state, prevBinId, { attempts }); // stays pending → re-blocked below
          retryFeedback = `Your previous attempt failed verification (\`${verifyCmd}\`). Fix it and make it pass. Output (tail):\n${tail(v.output, 2000)}`;
        } else {
          state = setBinStatus(state, prevBinId, { status: 'blocked', attempts, note: `failed verification after ${attempts} attempts` });
        }
      }
    } else {
      state = setBinStatus(state, prevBinId, { status: 'done', finishedAt: new Date(now).toISOString() });
    }
  }

  const result = decide({
    bins: state.bins, state, config, now, usagePercent,
    stopHookActive: !!input.stop_hook_active, killSwitch
  });

  if (result.action === 'block') {
    let reason = result.reason;
    if (retryFeedback && result.nextBinId === prevBinId) reason += `\n\n${retryFeedback}`;
    state.iterations += 1;
    state.currentBinId = result.nextBinId;
    saveState(dir, state);
    fs.appendFileSync(path.join(dir, 'log.md'),
      `\n## ${new Date(now).toISOString()} — work ${result.nextBinId} (iter ${state.iterations})\n`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } else {
    state.currentBinId = null;
    saveState(dir, state);
    writeSummary(dir, state, result.reason, now);
    process.stdout.write('{}');
  }
}

main();
