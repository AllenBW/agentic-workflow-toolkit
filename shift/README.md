# shift

Autonomous work-queue runner for **Claude Code** — module 2 of the [Agentic Workflow Toolkit](../). Pre-load bins of work, leave, and `shift` keeps Claude working through them past natural stop points, using its best judgment, until the queue is empty or a bound is hit. You review the output at the end.

> **This is v1** — the intra-session engine (a Stop hook). It keeps a *running* session grinding the queue, bounded by a time box + max iterations. Surviving the 5-hour rate-limit wall (auto-resume) and a usage cap are **v2**. See [SPEC.md](./SPEC.md) and [PLAN.md](./PLAN.md).

## How it works

You drop work into source folders (hand-written briefs and/or plugin-generated plans). `shift start` discovers them, records a run in `.shift/`, and creates a `shift/<date>` branch. You open Claude Code and say "begin the shift." From then on, a **Stop hook** runs each time the agent would stop: it marks the finished bin done, picks the next pending bin, and feeds it back as the next instruction — so the agent keeps going. When the queue drains (or a bound trips, or you hit the kill switch), it lets the session stop and writes `.shift/summary.md`.

The hook is safe to register globally: it no-ops in any repo that isn't an active `shift` run.

## Safety model

Full best-judgment autonomy on reversible, in-worktree work. By default it will **not** push, publish, send externally, or delete outside the worktree — it does the preparable part and records a `Needs you:` line instead, which the summary collects. All work lands on the `shift/<date>` branch, so review is a clean diff. Every decision is logged. Hard stops: time box, max iterations, and a kill switch (`shift stop`).

## Install

1. Get the files (clone the toolkit, or copy the `shift/` folder).
2. Register the Stop hook **once** in `~/.claude/settings.json`:

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

> Verify the exact hook schema against the current Claude Code hooks docs. The engine only needs "block + feed `reason` back" and the `stop_hook_active` re-entry flag, and it resolves the repo from the hook payload's `cwd`.

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
{
  "sources": [
    { "path": "queue", "kind": "briefs" },
    { "path": "docs/superpowers/plans", "kind": "plans" }
  ],
  "bounds": { "maxHours": 4, "maxIterations": 30 },
  "definitionOfDone": "Builds and tests pass; work committed on the run branch.",
  "git": { "branch": "shift/{date}", "allowPush": false, "allowOutwardActions": false }
}
```

When the run ends, read `.shift/summary.md` (it lists bins done/blocked and a "Needs you" section), then review the `shift/<date>` branch.

## Develop

```bash
cd shift && npm test     # node --test, no dependencies
```

Pure logic lives in `lib/` (discovery, state, bounds, brief, decision) and is unit-tested; `hooks/shift-stop.cjs` is the thin I/O shell, integration-tested by driving it with crafted hook input.
