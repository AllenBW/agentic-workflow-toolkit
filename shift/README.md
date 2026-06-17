# shift

Autonomous work-queue runner for **Claude Code** — module 2 of the [Agentic Workflow Toolkit](../). Pre-load bins of work, leave, and `shift` keeps Claude working through them past natural stop points, using its best judgment, until the queue is empty or a bound is hit — surviving the 5-hour rate-limit wall by waiting for the window to reopen. You review the output at the end.

See [SPEC.md](./SPEC.md) and [PLAN.md](./PLAN.md) for the design.

## How it works

You drop work into source folders — hand-written briefs and/or plugin-generated plans (e.g. Superpowers' plans dir). `shift start` discovers them, records a run in `.shift/`, and creates a `shift/<date>` branch. Then:

- **Keep-going engine (Stop hook).** Each time the agent would stop, the hook marks the finished bin done, picks the next pending one, and feeds it back as the next instruction — so the session keeps working. When the queue drains (or a bound trips, or the kill switch is set) it lets the session stop and writes `.shift/summary.md`.
- **Verify gate.** If you set a `verify.command`, each bin must pass it (e.g. `npm test`) before it counts as done; failures re-feed the bin with the output (up to `maxAttempts`), then mark it blocked. This catches "looked done but wasn't."
- **All-day runner (`shift run`).** A headless outer loop that spawns Claude, lets the engine grind, and — when a spawn dies on the rate-limit wall — waits until the window resets and resumes. Bounded by wall-clock, max iterations, a usage cap, and a resume backstop.

The hook is safe to register globally: it no-ops in any repo that isn't an active `shift` run, and resolves the repo from the hook payload's `cwd`.

## Safety model

Full best-judgment autonomy on reversible, in-worktree work. By default it will **not** push, publish, send externally, or delete outside the worktree — it does the preparable part and records a `Needs you:` line, which the summary collects. All work lands on the `shift/<date>` branch, so review is a clean diff. Every decision is logged. Hard stops: time box, max iterations, usage cap, kill switch (`shift stop`).

## Install

1. Clone the toolkit (the hook runs from these files by absolute path, so it installs locally — no `curl | bash`).
2. Wire the Stop hook into `~/.claude/settings.json` — one command, idempotent:

```bash
bash shift/install.sh
```

It merges the entry below (safe globally — the hook no-ops in any repo without an active `.shift/` run), backs up any existing settings first, and never duplicates on re-run — re-running after a `git pull` or a repo move just updates the path:

```json
{ "hooks": { "Stop": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "node /ABSOLUTE/PATH/TO/shift/hooks/shift-stop.cjs" }
  ] }
] } }
```

> **Hook contract (verified against the [Claude Code hooks docs](https://code.claude.com/docs/en/hooks)).** The Stop hook returns `{"decision":"block","reason":…}` to keep the session going — the `reason` becomes the next instruction — and omits `decision` (or exits 0) to allow the stop. The usage cap and `shift run` auto-resume read the hook payload's `rate_limits` when present and **skip cleanly when it's absent** (e.g. non-Pro/Max), so the engine never depends on it.

3. (Optional) put `shift/bin/shift` on your PATH — the installer prints the `ln -s` command.

## Use

```bash
cd your-repo
shift init                     # scaffold queue/ + a template brief, and gitignore .shift/
$EDITOR queue/01-example.md    # write your first brief (one bin per file) — see "Writing bins"
shift start --dry-run          # preview the queue, branch, bounds
shift start                    # init the run + create the shift/<date> branch
```

Then either:

- **Interactive:** open Claude Code in the repo and say *"begin the shift"* — the Stop hook drives it while you're away (within this session).
- **All-day / unattended:** `shift run` — the headless loop drives Claude, survives rate-limit resets, and stops on a bound.

```bash
shift status     # progress anytime
shift stop       # stop cleanly after the current bin
```

When it ends, read `.shift/summary.md` (bins done/blocked/skipped + a "Needs you" section) and review the `shift/<date>` branch.

## Writing bins

A **bin** is one Markdown file = one unit of work. The shape that works well unattended:

```markdown
# Short title for the task

What to do, in plain language. Be specific about scope and any constraints —
the agent runs with no chance to ask follow-up questions.

Definition of done: how to tell this bin is complete (e.g. "the endpoint returns
200 with the new field and `npm test` passes; change committed on the run branch").
```

- **One bin per file**, discovered in order (source folder, then filename) — so `queue/01-…`, `queue/02-…` set the sequence.
- **The `Definition of done:` line is the load-bearing part.** Unattended, the agent can't ask "is this what you meant?" — a crisp, checkable done-condition is what keeps a bin on-target. (For a hard gate, set `verify.command` so a bin only counts as done when e.g. `npm test` passes.)
- **Scope each bin to one reviewable change.** Smaller bins → cleaner per-bin commits and a tidier `shift/<date>` diff.
- **Multiple sources**: point `sources` at more than one folder — e.g. hand-written `queue/` plus a plugin's `docs/superpowers/plans/`. They're treated identically; `kind` only frames defaults.

### Self-generated / dynamic work

shift re-discovers its source folders on **every cycle**, so a bin can grow the backlog: any new `queue/NN-*.md` an agent writes mid-run is picked up as a fresh pending bin and worked in turn. This is always true (it's how new files added between `shift start` and runtime get in), but by default the agent isn't *told* it may do this.

Set **`"allowSelfQueue": true`** in `.shift/config.json` to invite it — the brief then tells the agent it may queue genuine follow-ups as `queue/NN-<slug>.md`. It's bounded by `maxIterations`, branch isolation, and your end-of-run review, so a run can't recurse forever. Leave it off (the default) for a fixed, predictable queue.

## Watch it live + steer it (`shift watch`)

An unattended run is the *least* transparent mode there is — so `shift` gives you a live window into it. In a second terminal:

```bash
cd your-repo && shift watch
```

A dashboard redraws on an interval: a progress bar, every bin with its status (`✓` done · `▶` current · `·` pending · `⤫` skipped · `✗` blocked) plus its **runtime and output tokens**, elapsed time, the run's live output-token total (`↑…out`), and the "Needs you" count. Because a run is otherwise a black box, this is where you *see* it working.

It's also the **control + drill-down surface** — a status bar can show state but can't take input, so `watch` captures keys:

| key | action |
|---|---|
| `↑` / `↓` | move the selection between bins |
| `⏎` | open a bin's detail view (status, runtime, token breakdown in/out/cache, commit, brief); `esc` back |
| `p` | pause / resume (the headless runner idles until you resume; still bounded by the time box) |
| `k` | skip the current bin (marks it `skipped`, moves on — any work stays on the branch) |
| `q` | stop the run (finalizes after the current bin — same as `shift stop`) |
| `x` | close the watcher (the run keeps going) |

Control is file-based under `.shift/` (`PAUSE` / `SKIP` / `STOP`), so it works whether the run is interactive or headless, and from any terminal in the repo.

> **Tokens are the *output* count** — the honest "work produced" figure, read from the session transcript. A warm run's `input`/cache tokens balloon with re-sent context, so the headline deliberately isn't `total` (that's in the detail view). Both run-level and per-bin tokens/runtime are reliable, including in fully-headless runs: the engine's state lives **outside the repo** (see below), so an autonomous agent can't corrupt it.

### Where state lives (and why)

Shift keeps the engine's authoritative state — run state, timeline, usage, and the work-record history — **outside the repo**, under `$XDG_STATE_HOME/shift/<hash-of-repo-path>/` (or `~/.local/state/shift/…`). The reason is candor-meets-reality: an autonomous agent will rewrite or delete files it finds in the repo (it was caught marking bins done in `.shift/state.json` itself), so the engine puts its state where the agent — which only works inside the repo — can't reach it. `.shift/` in your repo holds only what you and the agent legitimately touch: `config.json` (you edit it), `summary.md` (you read it), `log.md`/`blocked.jsonl` (the agent appends), and the control signals. Override the location with `SHIFT_STATE_DIR`.

### The work record — `shift history`

Every finalized run is appended to an append-only ledger in the engine state dir. `shift history` prints it — one row per run (when, branch, runtime, output tokens, bin tally) and a **totals** footer across all runs; `shift history <runId>` drills into a single run's bins.

### In your status bar (module 1)

For an at-a-glance signal in the [Code Status Bar](../code-status-bar), `shift status --line` prints a one-liner (`⚙ shift 2/5 · 18m · ↑412k ⚑1`) — empty when no run is active. Wire it into a ccstatusline `custom-command` widget to surface shift "in the place you're already looking."

### See it without a run

`node shift/examples/watch-demo.cjs` drives the real engine through a scripted run (with a synthetic transcript) and prints the dashboard at each step — tokens, a `[k]` skip, a `[q]` stop, the detail view, and the history ledger — at zero cost.

## Configure (`.shift/config.json`)

```json
{
  "sources": [
    { "path": "queue", "kind": "briefs" },
    { "path": "docs/superpowers/plans", "kind": "plans" }
  ],
  "bounds": {
    "maxHours": 4,
    "maxIterations": 30,
    "maxResumes": 12,
    "spawnTimeoutMinutes": 30,
    "usageCapPercent": 90,
    "autoResumeOnReset": true
  },
  "definitionOfDone": "Builds and tests pass; work committed on the run branch.",
  "verify": { "command": "npm test", "maxAttempts": 2 },
  "permissionMode": "acceptEdits",
  "allowSelfQueue": false,
  "git": { "branch": "shift/{date}", "allowPush": false, "allowOutwardActions": false }
}
```

- **`usageCapPercent`** — stop when weekly usage reaches this (read from the hook payload's `rate_limits`; skipped when that data is absent, e.g. non-Pro/Max).
- **`autoResumeOnReset`** — on a rate-limit wall, `shift run` waits for the 5-hour window to reopen and resumes (never past the time box). If the cached reset time is stale/in the past it stops cleanly rather than busy-spinning.
- **`maxResumes`** — the runner's own backstop on the number of `claude` spawns (independent of the hook-maintained `maxIterations`/`maxHours`).
- **`spawnTimeoutMinutes`** — hard per-spawn wall: a wedged `claude` is killed (SIGTERM) so it can't hang the runner. Default 30.
- **`verify.command`** — per-bin acceptance gate; `null` disables it.
- **`allowSelfQueue`** — when `true`, the brief invites the agent to queue follow-up bins (`queue/NN-*.md`); see "Self-generated / dynamic work." Default `false`.

> A headless `shift run` grades success on `.shift/summary.md` (written only when the engine finalizes), not on the exit line: a `claude -p` that exits without finalizing is reported as *"no summary written — did NOT finalize"* with a hint to check the hook wiring, never as a false success.

### Permissions for unattended runs

`shift run` invokes `claude -p --permission-mode <permissionMode>`. `acceptEdits` (the default) auto-approves file edits but **other tools (e.g. Bash) can still prompt — and a headless run can't answer prompts.** For real unattended work that runs tests/commands, either:

- pre-allow the tools the work needs via `permissions.allow` in your Claude settings and set `"permissionMode": "dontAsk"`, or
- set `"permissionMode": "bypassPermissions"` (broadest; rely on the branch-only / no-push safety model and bounds).

Pick the narrowest mode that lets the work actually proceed.

## Using shift with your `CLAUDE.md`

When shift drives a session, the agent reads your repo's `CLAUDE.md` on top of shift's injected brief — so `CLAUDE.md` is where you set the *house style* for unattended runs. The brief sets the non-negotiable rules; `CLAUDE.md` tunes how the work gets done. A block like this earns its keep:

````markdown
## Working under shift (unattended runs)

- Keep each bin to one focused, reviewable change; commit it on the run branch with a
  clear message. Don't fold unrelated work into one commit.
- A bin is done only when its "Definition of done" is met and `npm test` passes — if it
  doesn't, fix it; don't mark it done.
- Never push, open PRs, or touch anything outside this repo. If a step needs that, append
  `Needs you: <what + why>` to `.shift/log.md` and move on.
- Prefer the smallest change that satisfies the bin; record loose ends as `Needs you:`
  notes rather than sprawling.
- (If `allowSelfQueue` is on) when you find genuine follow-up work, add it as
  `queue/NN-<slug>.md` rather than expanding the current bin.
````

Two things worth knowing:

- **Don't restate the safety rules.** shift's brief already forbids push/outward actions and protects its bookkeeping; `CLAUDE.md` is for *preferences* (commit style, test discipline, scope) that the brief deliberately leaves to you.
- **`CLAUDE.md` can also make the agent reach for shift** — a line like *"when the user has a batch of independent tasks, offer to set them up as a shift queue"* turns it into a tool your sessions suggest, not just one you remember.

### Optional: a nudge hook (encourage usage)

The only hook shift needs is the `Stop` engine. If you want active encouragement, a small `SessionStart` hook can surface an idle queue — *"this repo has N pending shift bins; `begin the shift` or `shift run`."* Genuinely helpful, but it can nag, so it's intentionally **not** part of `install.sh` — add it yourself if you want it. Easing the *start* is better handled by `shift init` than by a hook.

## Develop

```bash
cd shift && npm test     # node --test, zero dependencies
```

Pure logic lives in `lib/` (discovery, state, bounds, brief, decision, verify, usage, outcome, run-loop, control, watch-model, transcript, timeline, history, store) and is unit-tested — including `renderFrame`/`renderDetail`/`renderHistory`, so the dashboard is testable without a TTY; `hooks/shift-stop.cjs` (the keep-going engine) and the `shift run` loop are integration-tested by driving them with injected effects / crafted hook input. The `bin/shift watch` TUI is a thin shell over the tested `watch-model` + `control` modules.
