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
mkdir queue && $EDITOR queue/01-first-task.md     # one brief per file
shift start --dry-run                              # preview the queue, branch, bounds
shift start                                        # init run + create shift/<date> branch
```

Then either:

- **Interactive:** open Claude Code in the repo and say *"begin the shift"* — the Stop hook drives it while you're away (within this session).
- **All-day / unattended:** `shift run` — the headless loop drives Claude, survives rate-limit resets, and stops on a bound.

```bash
shift status     # progress anytime
shift stop       # stop cleanly after the current bin
```

When it ends, read `.shift/summary.md` (bins done/blocked + a "Needs you" section) and review the `shift/<date>` branch.

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
  "git": { "branch": "shift/{date}", "allowPush": false, "allowOutwardActions": false }
}
```

- **`usageCapPercent`** — stop when weekly usage reaches this (read from the hook payload's `rate_limits`; skipped when that data is absent, e.g. non-Pro/Max).
- **`autoResumeOnReset`** — on a rate-limit wall, `shift run` waits for the 5-hour window to reopen and resumes (never past the time box). If the cached reset time is stale/in the past it stops cleanly rather than busy-spinning.
- **`maxResumes`** — the runner's own backstop on the number of `claude` spawns (independent of the hook-maintained `maxIterations`/`maxHours`).
- **`spawnTimeoutMinutes`** — hard per-spawn wall: a wedged `claude` is killed (SIGTERM) so it can't hang the runner. Default 30.
- **`verify.command`** — per-bin acceptance gate; `null` disables it.

> A headless `shift run` grades success on `.shift/summary.md` (written only when the engine finalizes), not on the exit line: a `claude -p` that exits without finalizing is reported as *"no summary written — did NOT finalize"* with a hint to check the hook wiring, never as a false success.

### Permissions for unattended runs

`shift run` invokes `claude -p --permission-mode <permissionMode>`. `acceptEdits` (the default) auto-approves file edits but **other tools (e.g. Bash) can still prompt — and a headless run can't answer prompts.** For real unattended work that runs tests/commands, either:

- pre-allow the tools the work needs via `permissions.allow` in your Claude settings and set `"permissionMode": "dontAsk"`, or
- set `"permissionMode": "bypassPermissions"` (broadest; rely on the branch-only / no-push safety model and bounds).

Pick the narrowest mode that lets the work actually proceed.

## Develop

```bash
cd shift && npm test     # node --test, zero dependencies
```

Pure logic lives in `lib/` (discovery, state, bounds, brief, decision, verify, usage, outcome, run-loop) and is unit-tested; `hooks/shift-stop.cjs` (the keep-going engine) and the `shift run` loop are integration-tested by driving them with injected effects / crafted hook input.
