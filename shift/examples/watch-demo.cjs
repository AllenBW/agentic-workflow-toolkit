#!/usr/bin/env node
'use strict';
// Zero-cost demo of `shift watch`: spins up a throwaway run, drives the real Stop
// hook through it, and prints the live dashboard at each step — including a [k] skip
// and a [q] stop — so you can see the visibility + control surface without spawning
// a real `claude`. Run:  node shift/examples/watch-demo.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const SHIFT = path.resolve(__dirname, '..');
const { buildModel, renderFrame } = require(path.join(SHIFT, 'lib', 'watch-model.cjs'));
const { requestSkip, requestStop } = require(path.join(SHIFT, 'lib', 'control.cjs'));
const HOOK = path.join(SHIFT, 'hooks', 'shift-stop.cjs');

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-watch-demo-'));
const dir = path.join(cwd, '.shift');
fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
fs.mkdirSync(dir, { recursive: true });
for (const [n, t] of [['01-build.md', 'build the thing'], ['02-flaky.md', 'flaky task'], ['03-docs.md', 'write docs']]) {
  fs.writeFileSync(path.join(cwd, 'queue', n), t);
}
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  sources: [{ path: 'queue', kind: 'briefs' }],
  bounds: { maxHours: 24, maxIterations: 10 }, definitionOfDone: 'done', git: {}
}));
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
  runId: 'demo', startedAt: new Date(Date.now() - 5 * 60000).toISOString(),
  iterations: 0, branch: 'shift/demo', currentBinId: null, bins: []
}));
fs.writeFileSync(path.join(dir, 'log.md'), '# log\n');

const fire = (active) => cp.execFileSync('node', [HOOK], { cwd, input: JSON.stringify({ stop_hook_active: active, cwd }), encoding: 'utf8' });
const show = (label) => {
  process.stdout.write(`\n\x1b[1m=== ${label} ===\x1b[0m\n`);
  process.stdout.write(renderFrame(buildModel({ dir, now: Date.now() }), { width: 78, color: true }));
};

fire(false);                            show('1) run started — bin 01 working');
fire(true);                             show('2) bin 01 done -> bin 02 working');
requestSkip(dir, 'queue/02-flaky.md');  // you press [k] now, while bin 02 is the current bin
fire(true);                             show('3) you pressed [k] on bin 02 -> SKIPPED, bin 03 working');
requestStop(dir);                       show('4) you pressed [q] -> stopping banner');
fire(true);                             show('5) bin 03 done, STOP honored -> finalized');
process.stdout.write('\n--- .shift/summary.md ---\n' + fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'));
process.stdout.write(`\n(throwaway repo: ${cwd})\n`);
