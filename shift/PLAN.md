# `shift` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `shift` **v1** — the intra-session keep-going engine: a Claude Code Stop hook that drives an agent through a pre-loaded queue of work bins (task briefs + plan folders), bounded by a time box and a max-iteration cap, committing each bin on a run branch and leaving a reviewable log + summary.

**Architecture:** A set of small, dependency-free Node (CommonJS) modules under `shift/lib/` hold *pure* logic (discovery, state, bounds, brief rendering, decision) so they're unit-testable without Claude. A thin I/O shell `shift/hooks/shift-stop.cjs` is the actual Stop hook: it reads hook JSON on stdin, applies state mutations, calls the pure `decide()` core, and writes `{"decision":"block","reason":…}` (continue with the next bin) or `{}` (allow the real stop, write the summary). A `shift/bin/shift` CLI sets up a run. The hook is safe to install globally — it no-ops unless `.shift/state.json` exists in the current repo.

**Tech Stack:** Node ≥ 18 (built-in `node:test` runner + `node:assert`, `node:crypto`, `node:fs`), CommonJS `.cjs`, Git. **No third-party dependencies.**

**Scope:** This plan is **v1 only** (SPEC §10). v2 (the headless `shift-runner` with rate-limit auto-resume + usage cap) and v3 (per-bin verify pass) are separable subsystems and get their own plans. v1 is independently useful: "keep working through the queue while I'm away this session."

**Plan location note:** Saved at `shift/PLAN.md` (module-local) rather than `docs/superpowers/plans/`, matching this repo's module structure and the toolkit's public-docs/transparency convention. Alongside `shift/SPEC.md`.

**Conventions for every commit in this plan:** plain commit messages, **no `Co-Authored-By` trailer** (repo preference). Run from the repo root `agentic-workflow-toolkit/`.

---

## File structure (v1)

| File | Responsibility |
|---|---|
| `shift/package.json` | Package metadata, `shift` bin, `test` script. No deps. |
| `shift/lib/discovery.cjs` | Discover bins from source folders; stable id + content hash. |
| `shift/lib/state.cjs` | Load/save/init `.shift/state.json`; merge discovered bins; query/mutate bin status. |
| `shift/lib/bounds.cjs` | Pure: evaluate run-ending bounds (time box, max iterations). |
| `shift/lib/brief.cjs` | Pure: render the unattended instruction + bin text fed back on `block`. |
| `shift/lib/decision.cjs` | Pure: compose kill-switch + bounds + next-pending into a `block`/`allow` decision. |
| `shift/hooks/shift-stop.cjs` | The Stop hook I/O shell (stdin→decision→stdout + side effects). |
| `shift/bin/shift` | CLI: `start` / `status` / `stop` / `--dry-run`. |
| `shift/test/*.test.cjs` | Unit + integration tests. |
| `shift/examples/queue/00-hello.md` | Sample bin. |
| `shift/README.md` | What it is, safety model, install (Stop hook wiring), usage. |

---

## Task 0: Scaffold

**Files:**
- Create: `shift/package.json`
- Create: `shift/examples/queue/00-hello.md`

- [ ] **Step 1: Create `shift/package.json`**

```json
{
  "name": "shift",
  "version": "0.1.0",
  "private": true,
  "description": "Autonomous work-queue runner for Claude Code (Agentic Workflow Toolkit module 2)",
  "bin": { "shift": "bin/shift" },
  "scripts": { "test": "node --test test/" }
}
```

- [ ] **Step 2: Create a sample bin `shift/examples/queue/00-hello.md`**

```markdown
# Add a project HELLO file

Create a file `HELLO.md` at the repo root containing one sentence describing
what this repository is. Commit it. Definition of done: the file exists and is committed.
```

- [ ] **Step 3: Commit**

```bash
git add shift/package.json shift/examples/queue/00-hello.md
git commit -m "shift: scaffold package + example bin"
```

---

## Task 1: Bin discovery (`lib/discovery.cjs`)

**Files:**
- Create: `shift/lib/discovery.cjs`
- Test: `shift/test/discovery.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/discovery.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverBins, hashText } = require('../lib/discovery.cjs');

function tmpRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-disc-'));
  fs.mkdirSync(path.join(d, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(d, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(d, 'queue', '02-b.md'), 'second');
  fs.writeFileSync(path.join(d, 'queue', '01-a.md'), 'first');
  fs.writeFileSync(path.join(d, 'queue', 'notes.txt'), 'ignored');
  fs.writeFileSync(path.join(d, 'plans', 'p1.md'), 'plan one');
  return d;
}

test('discovers .md files, ordered by source then filename', () => {
  const cwd = tmpRepo();
  const bins = discoverBins([{ path: 'queue', kind: 'briefs' }, { path: 'plans', kind: 'plans' }], cwd);
  assert.deepEqual(bins.map(b => b.id), ['queue/01-a.md', 'queue/02-b.md', 'plans/p1.md']);
  assert.equal(bins[0].kind, 'briefs');
  assert.equal(bins[2].kind, 'plans');
  assert.equal(bins[0].text, 'first');
});

test('hash is stable for same content, differs for different content', () => {
  assert.equal(hashText('x'), hashText('x'));
  assert.notEqual(hashText('x'), hashText('y'));
});

test('missing source folder yields no bins (no throw)', () => {
  const cwd = tmpRepo();
  const bins = discoverBins([{ path: 'does-not-exist', kind: 'briefs' }], cwd);
  assert.deepEqual(bins, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/discovery.test.cjs`
Expected: FAIL — `Cannot find module '../lib/discovery.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/lib/discovery.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function listMarkdown(dirAbs) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); }
  catch { return []; }
  return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort();
}

function discoverBins(sources, cwd) {
  const bins = [];
  for (const source of sources) {
    const dirAbs = path.resolve(cwd, source.path);
    for (const name of listMarkdown(dirAbs)) {
      const text = fs.readFileSync(path.join(dirAbs, name), 'utf8');
      bins.push({
        id: path.posix.join(source.path, name),
        hash: hashText(text),
        kind: source.kind || 'briefs',
        text
      });
    }
  }
  return bins;
}

module.exports = { discoverBins, hashText };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/discovery.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shift/lib/discovery.cjs shift/test/discovery.test.cjs
git commit -m "shift: bin discovery from source folders"
```

---

## Task 2: State store (`lib/state.cjs`)

**Files:**
- Create: `shift/lib/state.cjs`
- Test: `shift/test/state.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/state.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initState, saveState, loadState, mergeDiscovered, firstPending, setBinStatus } = require('../lib/state.cjs');

test('init + save + load round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-state-'));
  const s = initState({ runId: 'r1', startedAt: '2026-06-13T00:00:00Z', branch: 'shift/x' });
  assert.equal(s.iterations, 0);
  assert.equal(s.currentBinId, null);
  saveState(dir, s);
  assert.deepEqual(loadState(dir), s);
});

test('mergeDiscovered carries status by id+hash, new files are pending', () => {
  let s = initState({ runId: 'r', startedAt: '2026-06-13T00:00:00Z', branch: 'b' });
  s = mergeDiscovered(s, [{ id: 'queue/a.md', hash: 'h1', kind: 'briefs' }]);
  assert.equal(s.bins[0].status, 'pending');
  s = setBinStatus(s, 'queue/a.md', { status: 'done' });
  // same id+hash -> status carried; new file b appears pending
  s = mergeDiscovered(s, [
    { id: 'queue/a.md', hash: 'h1', kind: 'briefs' },
    { id: 'queue/b.md', hash: 'h2', kind: 'briefs' }
  ]);
  assert.equal(s.bins.find(b => b.id === 'queue/a.md').status, 'done');
  assert.equal(s.bins.find(b => b.id === 'queue/b.md').status, 'pending');
});

test('edited file (new hash) becomes pending again', () => {
  let s = initState({ runId: 'r', startedAt: 't', branch: 'b' });
  s = mergeDiscovered(s, [{ id: 'q/a.md', hash: 'h1', kind: 'briefs' }]);
  s = setBinStatus(s, 'q/a.md', { status: 'done' });
  s = mergeDiscovered(s, [{ id: 'q/a.md', hash: 'h2', kind: 'briefs' }]); // edited
  assert.equal(s.bins[0].status, 'pending');
});

test('firstPending returns first pending or null', () => {
  let s = initState({ runId: 'r', startedAt: 't', branch: 'b' });
  s = mergeDiscovered(s, [
    { id: 'a', hash: '1', kind: 'briefs' },
    { id: 'b', hash: '2', kind: 'briefs' }
  ]);
  s = setBinStatus(s, 'a', { status: 'done' });
  assert.equal(firstPending(s.bins).id, 'b');
  s = setBinStatus(s, 'b', { status: 'done' });
  assert.equal(firstPending(s.bins), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/state.test.cjs`
Expected: FAIL — `Cannot find module '../lib/state.cjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/lib/state.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function statePath(dir) { return path.join(dir, 'state.json'); }
function loadState(dir) { return JSON.parse(fs.readFileSync(statePath(dir), 'utf8')); }
function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2));
}
function initState({ runId, startedAt, branch }) {
  return { runId, startedAt, iterations: 0, branch, currentBinId: null, bins: [] };
}
function mergeDiscovered(state, discovered) {
  const prev = new Map(state.bins.map(b => [b.id + '@' + b.hash, b]));
  const bins = discovered.map(d => {
    const carried = prev.get(d.id + '@' + d.hash);
    return carried ? { ...carried, kind: d.kind }
                   : { id: d.id, hash: d.hash, kind: d.kind, status: 'pending' };
  });
  return { ...state, bins };
}
function firstPending(bins) { return bins.find(b => b.status === 'pending') || null; }
function setBinStatus(state, id, patch) {
  return { ...state, bins: state.bins.map(b => (b.id === id ? { ...b, ...patch } : b)) };
}

module.exports = { statePath, loadState, saveState, initState, mergeDiscovered, firstPending, setBinStatus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/state.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shift/lib/state.cjs shift/test/state.test.cjs
git commit -m "shift: state store with hash-based done-tracking"
```

---

## Task 3: Bounds (`lib/bounds.cjs`)

**Files:**
- Create: `shift/lib/bounds.cjs`
- Test: `shift/test/bounds.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/bounds.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateBounds } = require('../lib/bounds.cjs');

const base = { startedAt: '2026-06-13T00:00:00Z', iterations: 0 };
const t0 = Date.parse(base.startedAt);

test('returns null when within bounds', () => {
  const cfg = { bounds: { maxHours: 2, maxIterations: 10 } };
  assert.equal(evaluateBounds(base, cfg, t0 + 60_000), null);
});

test('terminates on max iterations', () => {
  const cfg = { bounds: { maxHours: 2, maxIterations: 5 } };
  const r = evaluateBounds({ ...base, iterations: 5 }, cfg, t0 + 1000);
  assert.match(r.reason, /max iterations/);
});

test('terminates on time box', () => {
  const cfg = { bounds: { maxHours: 1, maxIterations: 100 } };
  const r = evaluateBounds(base, cfg, t0 + 3_600_001);
  assert.match(r.reason, /time box/);
});

test('iterations checked before time', () => {
  const cfg = { bounds: { maxHours: 1, maxIterations: 1 } };
  const r = evaluateBounds({ ...base, iterations: 1 }, cfg, t0 + 3_600_001);
  assert.match(r.reason, /max iterations/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/bounds.test.cjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/lib/bounds.cjs
'use strict';
// now: epoch ms. Returns null (continue) or { reason } (terminate the run).
function evaluateBounds(state, config, now) {
  const b = (config && config.bounds) || {};
  if (typeof b.maxIterations === 'number' && state.iterations >= b.maxIterations) {
    return { reason: `max iterations (${b.maxIterations}) reached` };
  }
  if (typeof b.maxHours === 'number') {
    if (now - Date.parse(state.startedAt) >= b.maxHours * 3_600_000) {
      return { reason: `time box (${b.maxHours}h) reached` };
    }
  }
  return null;
}
module.exports = { evaluateBounds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/bounds.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shift/lib/bounds.cjs shift/test/bounds.test.cjs
git commit -m "shift: run bounds (time box + max iterations)"
```

---

## Task 4: Brief rendering (`lib/brief.cjs`)

**Files:**
- Create: `shift/lib/brief.cjs`
- Test: `shift/test/brief.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/brief.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBrief } = require('../lib/brief.cjs');

const bin = { id: 'queue/01.md', text: 'Do the thing.' };

test('includes the bin text and id', () => {
  const out = renderBrief(bin, { definitionOfDone: 'tests pass', git: {} });
  assert.match(out, /Do the thing\./);
  assert.match(out, /queue\/01\.md/);
  assert.match(out, /tests pass/);
});

test('forbids push and outward actions by default', () => {
  const out = renderBrief(bin, { git: { allowPush: false, allowOutwardActions: false } });
  assert.match(out, /Do NOT/);
  assert.match(out, /push to any remote/);
});

test('omits the guard when everything is allowed', () => {
  const out = renderBrief(bin, { git: { allowPush: true, allowOutwardActions: true } });
  assert.doesNotMatch(out, /Do NOT push/);
});

test('always tells it to log decisions and how to flag blockers', () => {
  const out = renderBrief(bin, { git: {} });
  assert.match(out, /\.shift\/log\.md/);
  assert.match(out, /blocked\.jsonl/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/brief.test.cjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/lib/brief.cjs
'use strict';
function renderBrief(bin, config) {
  const dod = (config && config.definitionOfDone) || 'Complete the task and commit your work.';
  const git = (config && config.git) || {};
  const forbidden = [];
  if (!git.allowPush) forbidden.push('push to any remote');
  if (!git.allowOutwardActions) forbidden.push('publish, send to external services, or delete files outside the working tree');
  const guard = forbidden.length
    ? `Do NOT ${forbidden.join(', or ')}; if a task needs one, record it under "Needs you" in .shift/log.md and continue.`
    : '';
  return [
    'You are running unattended under `shift`. Complete the brief below end-to-end using your best judgment.',
    'Do NOT ask questions — if you would normally ask, decide and record the decision in .shift/log.md.',
    `Definition of done: ${dod}`,
    'When finished, commit your work on the current branch.',
    'If you hit a true blocker, append one line to .shift/blocked.jsonl: {"id":"<bin id>","note":"<reason>"} then stop.',
    guard,
    '',
    `--- BIN: ${bin.id} ---`,
    bin.text
  ].filter(Boolean).join('\n');
}
module.exports = { renderBrief };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/brief.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shift/lib/brief.cjs shift/test/brief.test.cjs
git commit -m "shift: unattended brief rendering with autonomy guardrails"
```

---

## Task 5: Decision core (`lib/decision.cjs`)

**Files:**
- Create: `shift/lib/decision.cjs`
- Test: `shift/test/decision.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/decision.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decide } = require('../lib/decision.cjs');

const cfg = { bounds: { maxHours: 2, maxIterations: 10 }, definitionOfDone: 'done', git: {} };
const state = { startedAt: '2026-06-13T00:00:00Z', iterations: 0, currentBinId: null };
const t0 = Date.parse(state.startedAt) + 1000;

test('blocks with the first pending bin', () => {
  const bins = [{ id: 'a', status: 'done' }, { id: 'b', status: 'pending', text: 'work b' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'block');
  assert.equal(r.nextBinId, 'b');
  assert.match(r.reason, /work b/);
});

test('allows stop when queue empty', () => {
  const bins = [{ id: 'a', status: 'done' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /queue empty/);
});

test('kill switch allows stop even with pending work', () => {
  const bins = [{ id: 'b', status: 'pending', text: 'x' }];
  const r = decide({ bins, state, config: cfg, now: t0, stopHookActive: false, killSwitch: true });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /kill switch/);
});

test('bound (time box) allows stop even with pending work', () => {
  const bins = [{ id: 'b', status: 'pending', text: 'x' }];
  const late = Date.parse(state.startedAt) + 3 * 3_600_000;
  const r = decide({ bins, state, config: cfg, now: late, stopHookActive: false, killSwitch: false });
  assert.equal(r.action, 'allow');
  assert.match(r.reason, /time box/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/decision.test.cjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/lib/decision.cjs
'use strict';
const { evaluateBounds } = require('./bounds.cjs');
const { firstPending } = require('./state.cjs');
const { renderBrief } = require('./brief.cjs');

// ctx: { bins, state, config, now, stopHookActive, killSwitch }
// returns { action:'allow', reason } | { action:'block', reason, nextBinId }
function decide(ctx) {
  const { bins, state, config, now, killSwitch } = ctx;
  if (killSwitch) return { action: 'allow', reason: 'kill switch (.shift/STOP) present' };
  const bound = evaluateBounds(state, config, now);
  if (bound) return { action: 'allow', reason: bound.reason };
  const next = firstPending(bins);
  if (!next) return { action: 'allow', reason: 'queue empty' };
  return { action: 'block', reason: renderBrief(next, config), nextBinId: next.id };
}
module.exports = { decide };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/decision.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shift/lib/decision.cjs shift/test/decision.test.cjs
git commit -m "shift: pure decision core (kill switch + bounds + next bin)"
```

---

## Task 6: Stop hook I/O shell (`hooks/shift-stop.cjs`)

**Files:**
- Create: `shift/hooks/shift-stop.cjs`
- Test: `shift/test/hook.test.cjs` (integration — invokes the hook as a child process)

- [ ] **Step 1: Write the failing test**

```js
// shift/test/hook.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'hooks', 'shift-stop.cjs');

function setupRun() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-hook-'));
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '01.md'), 'bin one');
  fs.writeFileSync(path.join(cwd, 'queue', '02.md'), 'bin two');
  const dir = path.join(cwd, '.shift');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    sources: [{ path: 'queue', kind: 'briefs' }],
    bounds: { maxHours: 24, maxIterations: 10 },
    definitionOfDone: 'done', git: {}
  }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    runId: 'r', startedAt: new Date().toISOString(), iterations: 0,
    branch: 'shift/x', currentBinId: null, bins: []
  }));
  fs.writeFileSync(path.join(dir, 'log.md'), '# log\n');
  return { cwd, dir };
}

function runHook(cwd, input) {
  const out = cp.execFileSync('node', [HOOK], { cwd, input: JSON.stringify(input), encoding: 'utf8' });
  return JSON.parse(out || '{}');
}

test('no-ops (allows stop) when no .shift/state.json exists', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-none-'));
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
});

test('first stop blocks with bin 1; second marks it done and blocks bin 2; third drains -> allow + summary', () => {
  const { cwd, dir } = setupRun();
  const r1 = runHook(cwd, { stop_hook_active: false });
  assert.equal(r1.decision, 'block');
  assert.match(r1.reason, /bin one/);

  const r2 = runHook(cwd, { stop_hook_active: true });
  assert.equal(r2.decision, 'block');
  assert.match(r2.reason, /bin two/);
  const s2 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(s2.bins.find(b => b.id === 'queue/01.md').status, 'done');

  const r3 = runHook(cwd, { stop_hook_active: true });
  assert.deepEqual(r3, {});
  assert.ok(fs.existsSync(path.join(dir, 'summary.md')));
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /queue empty/);
});

test('blocked.jsonl marks the current bin blocked, surfaced in summary', () => {
  const { cwd, dir } = setupRun();
  runHook(cwd, { stop_hook_active: false });           // start bin 1
  fs.writeFileSync(path.join(dir, 'blocked.jsonl'), JSON.stringify({ id: 'queue/01.md', note: 'needs key' }) + '\n');
  runHook(cwd, { stop_hook_active: true });            // bin 1 -> blocked, start bin 2
  runHook(cwd, { stop_hook_active: true });            // bin 2 -> done, drain
  const summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /needs key/);
});

test('kill switch ends the run immediately', () => {
  const { cwd, dir } = setupRun();
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  assert.deepEqual(runHook(cwd, { stop_hook_active: false }), {});
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /kill switch/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/hook.test.cjs`
Expected: FAIL — hook file does not exist (ENOENT from execFileSync).

- [ ] **Step 3: Write minimal implementation**

```js
// shift/hooks/shift-stop.cjs
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

function writeSummary(dir, state, reason, now) {
  const done = state.bins.filter(b => b.status === 'done').length;
  const blocked = state.bins.filter(b => b.status === 'blocked');
  const pending = state.bins.filter(b => b.status === 'pending').length;
  const mins = Math.round((now - Date.parse(state.startedAt)) / 60000);
  const lines = [
    `# shift summary — ${state.runId}`, ``,
    `Ended: ${reason}`,
    `Duration: ${mins} min · Iterations: ${state.iterations}`,
    `Branch: ${state.branch}`,
    `Bins: ${done} done · ${blocked.length} blocked · ${pending} pending`, ``,
    `## Needs you`,
    ...(blocked.length ? blocked.map(b => `- ${b.id}: ${b.note || 'blocked'}`) : ['- (nothing flagged)'])
  ];
  fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n') + '\n');
}

function main() {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.shift');
  if (!fs.existsSync(path.join(dir, 'state.json'))) { process.stdout.write('{}'); return; }

  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/hook.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
chmod +x shift/hooks/shift-stop.cjs
git add shift/hooks/shift-stop.cjs shift/test/hook.test.cjs
git commit -m "shift: Stop hook I/O shell driving the queue"
```

---

## Task 7: CLI (`bin/shift`)

**Files:**
- Create: `shift/bin/shift`
- Test: `shift/test/cli.test.cjs`

- [ ] **Step 1: Write the failing test**

```js
// shift/test/cli.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'shift');

function repoWithQueue() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-cli-'));
  cp.execSync('git init -q', { cwd });
  cp.execSync('git config user.email t@t.co && git config user.name t', { cwd });
  cp.execSync('git commit -q --allow-empty -m init', { cwd });
  fs.mkdirSync(path.join(cwd, 'queue'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'queue', '01.md'), 'bin one');
  return cwd;
}
function run(cwd, args) {
  return cp.execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('--dry-run lists the queue and writes nothing', () => {
  const cwd = repoWithQueue();
  const out = run(cwd, ['start', '--dry-run']);
  assert.match(out, /queue\/01\.md/);
  assert.ok(!fs.existsSync(path.join(cwd, '.shift', 'state.json')));
});

test('start writes config + state and creates the run branch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'state.json')));
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'config.json')));
  const branch = cp.execSync('git branch --show-current', { cwd, encoding: 'utf8' }).trim();
  assert.match(branch, /^shift\//);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, '.shift', 'state.json'), 'utf8'));
  assert.equal(state.bins.length, 1);
});

test('stop creates the kill switch', () => {
  const cwd = repoWithQueue();
  run(cwd, ['start']);
  run(cwd, ['stop']);
  assert.ok(fs.existsSync(path.join(cwd, '.shift', 'STOP')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shift && node --test test/cli.test.cjs`
Expected: FAIL — CLI file does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// shift/bin/shift
#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { discoverBins } = require('../lib/discovery.cjs');
const { initState, saveState, loadState, mergeDiscovered } = require('../lib/state.cjs');

function isoStamp(d) { return d.toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function dateStr(d) { return d.toISOString().slice(0, 10); }

const DEFAULT_CONFIG = {
  sources: [{ path: 'queue', kind: 'briefs' }],
  bounds: { maxHours: 2, maxIterations: 20 },
  definitionOfDone: 'Builds and tests pass; work committed on the run branch.',
  git: { branch: 'shift/{date}', allowPush: false, allowOutwardActions: false }
};

function cmdStart(args) {
  const cwd = process.cwd();
  const dir = path.join(cwd, '.shift');
  const now = new Date();
  const dryRun = args.includes('--dry-run');

  let config = DEFAULT_CONFIG;
  const cfgFile = path.join(dir, 'config.json');
  if (fs.existsSync(cfgFile)) {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) };
  }
  const branch = (config.git.branch || 'shift/{date}').replace('{date}', dateStr(now));
  const discovered = discoverBins(config.sources, cwd);

  if (dryRun) {
    console.log('shift dry-run');
    console.log(`branch: ${branch}`);
    console.log(`bounds: ${JSON.stringify(config.bounds)}`);
    console.log(`queue (${discovered.length}):`);
    discovered.forEach((b, i) => console.log(`  ${i + 1}. ${b.id} [${b.kind}]`));
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, 'STOP'))) fs.unlinkSync(path.join(dir, 'STOP'));
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
  let state = initState({ runId: isoStamp(now), startedAt: now.toISOString(), branch });
  state = mergeDiscovered(state, discovered);
  saveState(dir, state);
  fs.writeFileSync(path.join(dir, 'log.md'), `# shift log — ${state.runId}\n`);

  try { cp.execSync(`git switch -c ${branch}`, { cwd, stdio: 'ignore' }); }
  catch { try { cp.execSync(`git switch ${branch}`, { cwd, stdio: 'ignore' }); } catch {} }

  console.log(`shift started: ${discovered.length} bins on branch ${branch}`);
  console.log('Now open Claude Code in this repo and say: "begin the shift".');
}

function cmdStatus() {
  const state = loadState(path.join(process.cwd(), '.shift'));
  const c = s => state.bins.filter(b => b.status === s).length;
  console.log(`run ${state.runId} · branch ${state.branch} · iter ${state.iterations}`);
  console.log(`bins: ${c('done')} done · ${c('blocked')} blocked · ${c('pending')} pending`);
}

function cmdStop() {
  const dir = path.join(process.cwd(), '.shift');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  console.log('shift will stop cleanly after the current bin.');
}

const [, , sub, ...rest] = process.argv;
if (sub === 'start') cmdStart(rest);
else if (sub === 'status') cmdStatus();
else if (sub === 'stop') cmdStop();
else { console.log('usage: shift <start|status|stop> [--dry-run]'); process.exit(1); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shift && node --test test/cli.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `cd shift && npm test`
Expected: PASS — all suites (discovery, state, bounds, brief, decision, hook, cli).

- [ ] **Step 6: Commit**

```bash
chmod +x shift/bin/shift
git add shift/bin/shift shift/test/cli.test.cjs
git commit -m "shift: CLI (start/status/stop/--dry-run)"
```

---

## Task 8: Install wiring + README

**Files:**
- Create: `shift/README.md`

- [ ] **Step 1: Write `shift/README.md`**

````markdown
# shift

Autonomous work-queue runner for **Claude Code** — module 2 of the [Agentic Workflow Toolkit](../). Pre-load bins of work, leave, and `shift` keeps Claude working through them past natural stop points, using best judgment, until the queue is empty or a bound is hit. You review the output at the end.

> **v1** is the intra-session engine (a Stop hook). It keeps a *running* session grinding the queue and is bounded by a time box + max iterations. Surviving the 5-hour rate-limit wall (auto-resume) is v2. See [SPEC.md](./SPEC.md).

## Safety model

Full best-judgment autonomy on reversible, in-worktree work. By default it will **not** push, publish, send externally, or delete outside the worktree — it does the preparable part and flags those under "Needs you" instead. All work lands on a `shift/<date>` branch, so review is a clean diff. Every decision is logged. Hard stops: time box, max iterations, and a kill switch (`shift stop`).

## Install

1. Get the files (clone the toolkit, or copy the `shift/` folder).
2. Register the Stop hook **once** in `~/.claude/settings.json`. It is safe to install globally — it no-ops in any repo that isn't an active `shift` run:

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "node /ABSOLUTE/PATH/TO/shift/hooks/shift-stop.cjs" }
      ] }
    ]
  }
}
```

> Verify the exact hook schema against the current Claude Code hooks docs; the engine only needs "block + feed `reason` back" and the `stop_hook_active` re-entry flag.

3. (Optional) put `shift/bin/shift` on your PATH.

## Use

```bash
cd your-repo
mkdir queue && $EDITOR queue/01-first-task.md     # one brief per file
shift start --dry-run                              # preview the queue, branch, bounds
shift start                                        # init run + create shift/<date> branch
# open Claude Code here and say: "begin the shift"
shift status                                       # check progress anytime
shift stop                                         # stop cleanly after the current bin
```

Point at plan folders too (e.g. Superpowers output) by editing `.shift/config.json`:

```json
{ "sources": [
    { "path": "queue", "kind": "briefs" },
    { "path": "docs/superpowers/plans", "kind": "plans" }
  ],
  "bounds": { "maxHours": 4, "maxIterations": 30 }
}
```

When the run ends, read `.shift/summary.md` and review the `shift/<date>` branch.
````

- [ ] **Step 2: Commit**

```bash
git add shift/README.md
git commit -m "shift: README — safety model, install, usage"
```

---

## Task 9: End-to-end smoke (manual)

- [ ] **Step 1: Real bounded run**

In a throwaway git repo: copy `shift/examples/queue/00-hello.md` into `queue/`, set `.shift/config.json` bounds to `{ "maxHours": 1, "maxIterations": 2 }`, register the hook, run `shift start`, open Claude Code, say "begin the shift."

- [ ] **Step 2: Verify**

Expected: the agent creates+commits `HELLO.md` on the `shift/<date>` branch; the hook drives to the next bin or drains; `.shift/summary.md` reports `1 done` and ends with "queue empty"; no work on the default branch.

- [ ] **Step 3: Verify guardrails**

Re-run with `maxIterations: 1`; confirm the run ends on "max iterations" with pending work remaining. Run `shift stop` mid-run; confirm clean halt + summary.

---

## Self-review (completed against SPEC §1–12)

- **Queue (briefs + plans folders, ordered, hash done-tracking):** Tasks 1–2. ✔
- **Bounds — time box + max iterations:** Task 3; usage cap + auto-resume explicitly deferred to v2 (SPEC §9.1, §10). ✔
- **Stop-hook keep-going (block/allow, mark finished, blocked.jsonl, summary, kill switch, stop_hook_active passed through):** Task 6. ✔
- **Full autonomy + branch-only/no-push guardrails in the brief:** Task 4. ✔
- **Branch-per-run + per-bin commits (committed by the agent per the brief), log, summary:** Tasks 4, 6, 7. ✔
- **CLI start/status/stop/--dry-run:** Task 7. ✔
- **Install/wiring + safety README:** Task 8. ✔
- **Testing strategy (unit pure modules + integration hook/CLI + manual smoke + dry-run):** Tasks 1–7, 9. ✔
- **No third-party deps:** all `node:` built-ins. ✔
- **Known gaps (deferred, documented):** usage-cap data source and rate-limit termination signature → v2 (SPEC §9). Mid-bin early-stop accepted in v1, reviewer-caught; verify pass → v3.

---

## Implementation notes (as-built deviations)

Built on branch `shift-v1`. The draft code blocks above are the design intent; these corrections were applied during implementation:

- **`state.cjs` — carry `text` through the merge, strip it on save.** `mergeDiscovered` copies each bin's freshly-read `text` into the in-memory bin (the brief needs the body); `saveState` strips `text` before writing so `state.json` stays lean. Without this the fed-back brief had the instructions but not the task body — caught by the hook integration test, not the unit tests.
- **Review fix #2 — `shift-stop.cjs` resolves the repo from the hook payload's `cwd`** (`input.cwd || process.cwd()`); a hook's process cwd isn't guaranteed to be the project root. Has a dedicated test.
- **Review fix #3 — summary surfaces logged `Needs you:` lines**, not just blocked bins; `brief.cjs` documents the `Needs you: <detail>` convention. Has a test.
- **Security — `bin/shift` uses `execFileSync('git', [...args])`** (argument array, no shell) for branch ops, so a config-supplied branch name can't inject shell metacharacters; added `git checkout` fallbacks for Git < 2.23.
- **`package.json` — `"test": "node --test"`** (Node ≥18 auto-discovery; a bare `test/` arg isn't accepted) and `"engines": { "node": ">=18" }`.

All 28 `shift` tests + 7 `code-status-bar` tests pass; `install.sh` verified end-to-end.

---

## v2 + v3 (built on the same branch)

Added after v1, same TDD discipline (52 `shift` tests total). See SPEC §13 for the design decisions.

- **v3 verify gate** — `lib/verify.cjs` (injectable exec) + a gate in the Stop hook: a bin passes only if `verify.command` exits 0; failures re-feed the bin with the output up to `verify.maxAttempts`, then block it. Tests: `verify.test.cjs` + hook gate cases.
- **v2 usage cap** — `lib/usage.cjs` caches the hook payload's `rate_limits` to `.shift/usage.json`; `evaluateBounds` gains a `usagePercent` arg (cap on weekly %); the hook reads it from the payload and degrades gracefully when absent. Tests: `usage.test.cjs` + bounds/decision/hook cases.
- **v2 headless runner** — `lib/outcome.cjs` (classify a spawn: completed / rate_limited / error, inferring rate-limit from cached usage since the exit signature is undocumented) + `lib/run-loop.cjs` (pure outer loop with injected effects: bounds, max-resumes backstop, wait-until-reset auto-resume) + `bin/shift run` (thin real-effects wiring). Tests: `outcome.test.cjs`, `run-loop.test.cjs`.
- **Security** — `lib/verify.cjs` uses `spawnSync(command, { shell: true })` with the whole user-config command (not interpolated); documented inline.
