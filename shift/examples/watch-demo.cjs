#!/usr/bin/env node
'use strict';
// Zero-cost demo of `shift watch`: spins up a throwaway run, drives the real Stop hook
// through it with a synthetic transcript, and prints the live dashboard at each step —
// runtime + token columns, a [k] skip, a [q] stop, and the work-record history — so you
// can see the whole visibility + control surface without spawning a real `claude`.
//   node shift/examples/watch-demo.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const SHIFT = path.resolve(__dirname, '..');
const { buildModel, renderFrame, renderDetail, renderHistory } = require(path.join(SHIFT, 'lib', 'watch-model.cjs'));
const { readHistory, aggregate } = require(path.join(SHIFT, 'lib', 'history.cjs'));
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
const T = path.join(dir, 'transcript.jsonl');
fs.writeFileSync(T, '');

const fire = (active) => cp.execFileSync('node', [HOOK], { cwd, input: JSON.stringify({ stop_hook_active: active, cwd, transcript_path: T }), encoding: 'utf8' });
const work = (out) => { // simulate the agent producing `out` output tokens on the current bin
  fs.appendFileSync(T, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { usage: { output_tokens: out, input_tokens: out * 6, cache_read_input_tokens: out * 40 } } }) + '\n');
};
const show = (label) => {
  process.stdout.write(`\n\x1b[1m=== ${label} ===\x1b[0m\n`);
  process.stdout.write(renderFrame(buildModel({ dir, now: Date.now() }), { width: 78, color: true, selectedIndex: 0 }));
};

fire(false); work(8400);                show('1) bin 01 working — tokens climbing live');
fire(true); work(21300);                show('2) bin 01 done (runtime + tokens) -> bin 02 working');
requestSkip(dir, 'queue/02-flaky.md');  // you press [k] while bin 02 is current
fire(true); work(5100);                 show('3) you pressed [k] -> bin 02 SKIPPED, bin 03 working');
requestStop(dir);                       show('4) you pressed [q] -> stopping after current bin');
fire(true);                             show('5) bin 03 done, STOP honored -> finalized');

process.stdout.write('\n\x1b[1m=== ⏎ details on bin 01 (drill-down) ===\x1b[0m\n');
process.stdout.write(renderDetail(buildModel({ dir, now: Date.now() }), 0, { width: 78, color: true }));

process.stdout.write('\n\x1b[1m=== shift history (work record across runs) ===\x1b[0m\n');
process.stdout.write(renderHistory(readHistory(dir), aggregate(readHistory(dir)), { color: true }));
process.stdout.write(`\n(throwaway repo: ${cwd})\n`);
