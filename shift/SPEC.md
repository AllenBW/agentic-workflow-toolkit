# `shift` — Spec

**Module 2 of the Agentic Workflow Toolkit.** An autonomous work-queue runner for Claude Code: you pre-load bins of work, leave, and `shift` keeps Claude working through them — past natural stop points and across rate-limit resets — using its best judgment, until the queue is empty or a bound is hit. You review the output at the end.

- **Status:** spec (design approved 2026-06-13)
- **Targets:** Claude Code (CLI) — hooks + headless mode
- **Philosophy fit:** candor. An unattended agent is the *least* transparent mode of all, so `shift`'s job is to make the autonomous run legible after the fact: every decision logged, every change a reviewable commit, a clear "here's what I did and what needs you" summary. You trade real-time steering for an honest paper trail.

---

## 1. Goal & non-goals

### Goal
Let a user say, in effect: *"I'm gone for N hours — here's a stack of work; grind it until it's done or you run out, decide things yourself, and leave me a reviewable trail."*

### Non-goals (v1)
- Not a multi-agent orchestrator (no parallel fan-out; one session works the queue serially).
- Not a scheduler/cron product (it runs when you start it; resets are handled, but it doesn't "wake up Tuesday 9am" — that's a thin future add).
- Not a replacement for review. It optimizes for *reviewable* output, not unreviewed merging.

---

## 2. User stories

1. **The afternoon-away.** "I'll be out ~2 hours. Work the `queue/` folder; keep going past stop points; commit each bin on a branch; summarize when done or when 2h is up."
2. **The plan-consumer.** "Point at `docs/superpowers/plans/` and implement each plan in order." (Plans are produced by the Superpowers `writing-plans` skill into its own subfolder.)
3. **The all-day.** "Work the full backlog all day. When you hit the 5-hour wall, wait for the window to reopen and continue. Stop when the queue is empty, I've burned 80% of my weekly limit, or it's been 8 hours."
4. **The reviewer (next morning).** Reads `.shift/summary.md`, skims the `shift/<date>` branch commit-by-commit, and acts on the "needs you" list.

---

## 3. Concepts

| Term | Meaning |
|---|---|
| **Bin** | One unit of work = one source file (a task brief or an implementation plan). |
| **Source** | A folder (or glob) bins are discovered from. Multiple allowed; ordered. |
| **Run** | One `shift` session from `start` until a stop condition. |
| **Cycle** | One keep-going iteration: agent finishes its current instruction → Stop hook advances to the next bin (or ends the run). |
| **Bound** | A condition that ends a run: queue empty, time box, usage cap, max iterations. |
| **Reset wall** | A rate-limit stop (5-hour window). Distinct from a bound — it triggers *auto-resume*, not termination. |

---

## 4. Architecture

Hybrid of two cooperating pieces over a shared file-based substrate. Ship the hook first; add the runner for all-day operation.

```
                          ┌─────────────────────────────┐
        sources ────────▶ │  queue discovery (glob)     │
   queue/, plans/         └─────────────┬───────────────┘
                                        ▼
   ┌──────────────────┐        ┌──────────────────┐        ┌─────────────────────┐
   │ shift-runner     │ drives │  Claude Code      │ fires  │  Stop hook          │
   │ (headless loop,  │───────▶│  session (`-p`)   │───────▶│  (keep-going engine)│
   │  bounds + resume)│◀───────│                   │◀───────│  decision: block    │
   └──────────────────┘ exit/  └──────────────────┘ next   └──────────┬──────────┘
        ▲   resets_at                                    bin           │ reads/writes
        │                                                              ▼
        │                       ┌──────────────────────────────────────────────┐
        └───────────────────────│  .shift/  state.json · config.json · log.md  │
                                 │           summary.md · STOP (kill switch)     │
                                 └──────────────────────────────────────────────┘
```

- **Piece A — Stop hook (intra-session engine).** Advances the queue *within* one running session. On each stop: check bounds/kill-switch, mark the finished bin done, pick the next pending bin, return `decision: block` with that bin's brief; or allow the real stop when the queue is empty / a bound is hit. Usable alone in an interactive session ("I'm out 90 min, go").
- **Piece B — shift-runner (cross-reset outer loop).** A headless wrapper that invokes Claude with `-p`/`--continue`, owns the wall-clock/usage/iteration bounds, and on a rate-limit wall sleeps until `resets_at` then resumes. Inside each invocation, Piece A grinds multiple bins warm. This is the "set it for the day" mode.

**Why hybrid:** the hook alone can't survive the 5-hour wall (a rate-limited session is dead; a hook can't wake it). The runner alone could spawn one bin per process but loses warm context each time. Together: survive resets *and* stay warm.

---

## 5. Data model & file formats

All run state lives under `.shift/` in the working repo (git-ignored).

### 5.1 Config — `.shift/config.json`
```json
{
  "sources": [
    { "path": "queue", "kind": "briefs" },
    { "path": "docs/superpowers/plans", "kind": "plans", "glob": "*.md" }
  ],
  "order": "source-then-name",
  "bounds": {
    "maxHours": 8,
    "maxIterations": 40,
    "usageCapPercent": 80,
    "autoResumeOnReset": true
  },
  "autonomy": "full",
  "definitionOfDone": "Builds and tests pass; work committed on the run branch.",
  "git": {
    "branch": "shift/{date}",
    "commitPerBin": true,
    "allowPush": false,
    "allowOutwardActions": false
  }
}
```
- `sources[].kind`: `briefs` (your hand-written tasks) or `plans` (plugin-generated implementation plans). Treated identically for execution; `kind` only affects default discovery glob and how the brief is framed to the agent.
- `usageCapPercent`: stop when weekly usage ≥ this. *(Enforcement source — see §9 risks; may be deferred to v2.)*
- `git.allowPush` / `allowOutwardActions`: default `false` even under `autonomy:"full"` (see §8).

### 5.2 State — `.shift/state.json`
```json
{
  "runId": "2026-06-13T14-02-11",
  "startedAt": "2026-06-13T14:02:11Z",
  "iterations": 7,
  "branch": "shift/2026-06-13",
  "usageAtStart": { "weekly": 41.0 },
  "bins": [
    { "id": "queue/01-foo.md", "hash": "ab12…", "status": "done",    "commit": "9c1f…", "finishedAt": "…" },
    { "id": "queue/02-bar.md", "hash": "cd34…", "status": "blocked", "note": "needs API key" },
    { "id": "queue/03-baz.md", "hash": "ef56…", "status": "pending" }
  ]
}
```
- **Done-tracking is here, not by moving files** — source folders (esp. a plugin's plans dir) are never mutated. A bin is identified by `path` + content `hash`; editing a source file after completion makes it a new pending bin.
- New files dropped into a source mid-run appear as `pending` on the next discovery pass.

### 5.3 Bin discovery
1. For each source, glob files (default `*.md`), in `order`.
2. Map to bins by `path`+`hash`; carry over status from prior state.
3. Next bin = first `pending` in order.
4. Queue empty = no `pending` bins remain.

### 5.4 Log — `.shift/log.md`
Append-only, one block per cycle: timestamp · bin id · what it did · **decisions made** (required under full autonomy) · result (`done`/`blocked` + why) · commit ref.

### 5.5 Summary — `.shift/summary.md`
Written when the run ends: run duration, bins done/blocked/skipped, iterations, usage consumed (start→end), the run branch + commit list, and a **"Needs you"** section aggregating every flagged/blocked item.

### 5.6 Kill switch — `.shift/STOP`
If this file exists at the start of a cycle, the hook allows the real stop and writes the summary. Lets the user (or the agent) halt cleanly.

---

## 6. The Stop hook (Piece A) — protocol & control flow

Configured as a Claude Code `Stop` (and `SubagentStop`) command hook in settings. Reads hook JSON on stdin (includes `session_id`, `transcript_path`, `stop_hook_active`, `cwd`); writes a decision JSON on stdout.

> **To verify during build:** exact Stop-hook input field names and the precise `{ "decision": "block", "reason": "…" }` output contract, against the current Claude Code hooks docs. The design depends only on (a) a "block + feed reason back" capability and (b) a `stop_hook_active`-style re-entry flag, both documented.

### Decision logic (pseudocode)
```
on Stop(input):
  if not shift_run_active():           # no .shift/state.json → not our run
      return {}                        # allow normal stop

  if exists(.shift/STOP):              # kill switch
      finalize(); return {}

  state = load(.shift/state.json)
  cfg   = load(.shift/config.json)

  # Attribute the just-finished work to the current bin.
  mark_current_bin_finished(state, input)     # done, or blocked if it logged BLOCKED

  # Bounds (terminate the run).
  if elapsed(state) >= cfg.bounds.maxHours:        finalize("time box");      return {}
  if state.iterations >= cfg.bounds.maxIterations: finalize("max iterations"); return {}
  if usage_now() >= cfg.bounds.usageCapPercent:    finalize("usage cap");     return {}

  next = first_pending(discover(cfg.sources), state)
  if next is None:                      finalize("queue empty");  return {}

  state.iterations += 1; save(state)
  return { "decision": "block", "reason": render_brief(next, cfg) }
```

### `render_brief(bin, cfg)` — what gets fed back
A compact instruction: the bin's full text, plus a standing preamble:
> "You are running unattended under `shift`. Complete this brief end-to-end using your best judgment — do **not** ask questions; if you'd normally ask, decide and **log the decision**. Definition of done: `{cfg.definitionOfDone}`. When done, commit on the current branch. If you hit a true blocker, append `BLOCKED: <reason>` to `.shift/log.md` and stop. Reversible code work is fully authorized; do **not** {push / publish / send / delete outside the worktree} unless config allows."

### Loop safety
- `stop_hook_active` true + no bin progressed since last cycle ⇒ force-allow stop (prevents tight loops on a stuck bin).
- `maxIterations` is the absolute backstop regardless of everything else.

---

## 7. The shift-runner (Piece B) — all-day / cross-reset

A headless wrapper script (`shift run`) that owns the outer loop.

```
shift run:
  init_state(); ensure_branch()
  loop:
      result = claude -p "Begin the shift. Work the queue." \
                 --permission-mode acceptEdits   # or a pre-approved allowlist; unattended must not block on prompts
      classify(result):
        QUEUE_DONE | BOUND_HIT      -> break        # Piece A already finalized
        RATE_LIMITED:
            if not cfg.autoResumeOnReset: break
            sleep_until(resets_at() + buffer)        # the wall → wait, don't stop
            continue                                 # resume; `--continue` keeps the session
        ERROR: log; bounded_retry or break
  print(.shift/summary.md path)
```

- **Permissions:** unattended runs must not stall on permission prompts. Options, safest-first: a curated **allowlist** in Claude settings for the tools the work needs; or `--permission-mode acceptEdits`; or (explicit opt-in only) `--dangerously-skip-permissions`. Spec default: **acceptEdits + a documented allowlist**, never skip-all by default.
- **Rate-limit detection & `resets_at`:** classify a rate-limit termination (non-zero exit / known stderr signature) and obtain the reset time. Source of `resets_at` to be confirmed during build (parse the limit message, or read the same `rate_limits` data the status bar uses). *(See §9.)*

---

## 8. Autonomy & safety model

User chose **full best-judgment autonomy**. Honored — with a blast-radius default:

- **Authorized freely:** all reversible, in-worktree work — editing, creating, refactoring, running builds/tests, committing to the run branch.
- **Flagged, not fired, by default** (`git.allowPush:false`, `git.allowOutwardActions:false`): `git push`, opening/merging PRs, publishing, sending to external services, and deletions outside the worktree. The agent does the *preparable* part and records a "needs you" item instead of executing the irreversible step while you're gone. Each is individually unlockable in config.
- **Branch isolation:** all work on `shift/<date>`, never on the default branch, so review is a clean diff and nothing unattended touches `main`.
- **Decision log:** under full autonomy the agent *must* log the choices it would otherwise have asked about — that's the candor tax that makes unattended acceptable.

---

## 9. Risks & open questions

1. **Usage-cap data source.** The Stop hook may not receive `rate_limits`. Enforcing `usageCapPercent` needs a reliable read of weekly usage from a hook. Candidates: reuse ccstatusline's usage fetch, a tiny helper, or a cached file. **If unresolved, v1 enforces time + iterations only; usage cap lands in v2.**
2. **Rate-limit termination signature.** How a headless `claude -p` run reports hitting the wall, and where `resets_at` is readable, needs empirical confirmation. Auto-resume (v2) depends on it.
3. **Mid-bin stops.** A bin may stop partway (model decides it's "done" early). Mitigation: explicit definition-of-done in the brief + acceptance criteria per bin; the reviewer catches misses. A future "verify bin" pass (a SubagentStop check) could harden this.
4. **Cost of being wrong, unattended.** Full autonomy + hours of runtime can produce a lot of off-target work. Mitigations: branch isolation, bounds, the decision log, and a recommended first run with a short `maxHours`/`maxIterations` to calibrate trust.
5. **Permission model friction.** Allowlist vs. acceptEdits vs. skip-all is a real UX/safety tension; documented, defaulted conservative.

---

## 10. Phasing

- **v1 — the engine you can use today (Piece A).** Queue discovery (briefs + plans folders), state store, Stop hook keep-going, bounds = **time box + max iterations**, kill switch, definition-of-done, branch-only commit-per-bin, log + summary. No auto-resume, no usage cap.
- **v2 — all-day (Piece B).** shift-runner headless loop, permission model, rate-limit detection + sleep-until-reset auto-resume, usage cap.
- **v3 — hardening (optional).** Per-bin verify pass, richer summary, simple scheduling.

---

## 11. Testing strategy

- **Unit (pure logic, no Claude):** discovery/ordering, hash-based done-tracking, bounds evaluation, decision function (feed synthetic hook-input + state → assert `block`/allow + chosen bin), brief rendering. These run as plain Node tests; the decision core is a pure function for testability.
- **Integration (mocked):** drive the Stop hook with crafted stdin JSON across a multi-bin fixture queue; assert state transitions, log/summary output, kill-switch and bound termination.
- **Smoke (real, bounded):** a 2-bin trivial queue with `maxIterations:2` in a throwaway repo, run interactively, confirm both bins get committed on the branch and the summary is correct.
- **Dry-run mode:** `shift start --dry-run` prints the discovered queue, order, branch, and bounds without executing — lets a user preview what would happen.

---

## 12. Deliverables (repo layout)

```
shift/
├─ README.md            # what it is, the safety model, install, usage, the candor framing
├─ SPEC.md              # this file
├─ PLAN.md              # implementation plan
├─ hooks/
│  └─ shift-stop.cjs    # the Stop hook (Piece A engine; pure decision core + I/O shell)
├─ bin/
│  └─ shift             # CLI: start | run | status | stop | resume | --dry-run
├─ lib/                 # pure modules: discovery, state, bounds, brief, decision (unit-tested)
└─ examples/
   └─ queue/            # sample bins
```

---

## 13. Implementation status (as built — v1 + v2 + v3)

All three phases are implemented on branch `shift-v1`. Notable as-built decisions:

- **Rate-limit detection without the undocumented exit signature (resolves §9.2).** Research confirmed the headless rate-limit termination signature is undocumented, but the **Stop hook payload includes `rate_limits`**. So the engine caches the latest reset/usage to `.shift/usage.json`, and `lib/outcome.cjs` classifies a non-finalized, non-zero spawn as `rate_limited` by **inference** — near-limit cached usage (≥95%) + a future reset — with config-overridable stderr patterns as a fallback. No dependency on an exact exit code/message.
- **Usage cap source (resolves §9.1).** Enforced from the hook payload's `rate_limits.seven_day.used_percentage`; absent data (non-Pro/Max, pre-first-response) degrades to "cap skipped," never an error.
- **Verify gate (v3, resolves §9.3).** `verify.command` runs per bin; failures re-feed the bin with the output up to `maxAttempts`, then block it — so "looked done but wasn't" is caught, not silently accepted.
- **Permissions.** `shift run` uses `--permission-mode` (default `acceptEdits`). Truly unattended work that runs commands typically needs `dontAsk` + a `permissions.allow` list, or `bypassPermissions` — documented in the README; the branch-only/no-push model and bounds are the backstop. The runner now **warns** at startup when `permissionMode` would prompt on Bash (a headless run can't answer), since that combination otherwise exits without finalizing.

**New modules beyond §12:** `lib/verify.cjs`, `lib/usage.cjs`, `lib/outcome.cjs`, `lib/run-loop.cjs`, `lib/install.cjs`; `bin/shift` gains `run`; `install.sh` wires the Stop hook.

### Smoke validation + post-smoke hardening (2026-06-15)

A real bounded `shift run` smoke (2 commit-a-file bins, `bypassPermissions`) **empirically resolved the open question behind §9.2**: headless `claude -p` **does** honor the Stop hook's `{"decision":"block"}` and continues the session warm — both bins were completed and committed within a single spawn. A pre-flight audit of the (previously untested) runner path then drove four fixes:

- **No false-green.** `classifyOutcome` only returns `completed` when the engine actually finalized (`summary.md` written). A `claude -p` that exits 0 without finalizing is `incomplete` — the runner **resumes** if the queue advanced, else **stops with a "is the Stop hook wired?" diagnostic** instead of reporting success. `shift run` grades on `summary.md`, not the exit line.
- **Stale-reset guard.** Auto-resume stops cleanly when the cached reset time is already in the past (previously a `maxResumes`-bounded busy-spin).
- **Per-spawn timeout.** `spawnTimeoutMinutes` (default 30) kills a wedged `claude` so a blocking `spawnSync` can't hang the runner; launch failures (`claude` not on PATH) and kills are now surfaced, not swallowed. *Known limitation:* the timeout SIGTERMs the `claude` process only, not any tool-subprocess grandchildren it spawned (an inherent `spawnSync` behavior) — a wedged grandchild can outlive the kill; a detached-process-group reap is a future improvement.
- **Hook-install is required for `shift run`** and `install.sh` automates it (the bin's task text reaches the agent only via the Stop-hook block).

**Tests:** 63 in `shift` (pure unit + hook/CLI/run-loop/install integration), all green.

### Live visibility + control — `shift watch` (2026-06-16)

The candor gap in v2 was that a headless run is opaque *while* it runs (good paper trail after, black box during). `shift watch` closes it: a zero-dependency live TUI that reads `.shift/` on an interval and renders a dashboard (progress bar, per-bin status, current bin, elapsed, decision-log tail, "Needs you"), plus **two-way control**. Since an output-only surface (a status bar) can't take input, control is a separate file-based channel under `.shift/` that the engine honors: `STOP` (existing kill switch / `q`), `PAUSE` (`p` — the runner idles, still bounded by the time box), `SKIP` (`k` — the hook marks the current bin `skipped` and advances). New status value: `skipped`. New modules: `lib/control.cjs` (signal channel) and `lib/watch-model.cjs` (`buildModel` + a **pure** `renderFrame`/`renderLine`, so the dashboard and the status-bar one-liner are unit-tested without a TTY). `bin/shift` gains `watch` and `status --line` (a one-liner for the module-1 status bar — ties the two modules together). **Tests:** 77 in `shift`, all green.

*Known limitation:* `pause` and `skip` apply at the next stop-hook boundary (between bins), not mid-bin — the hook is the only point the engine re-evaluates. Mid-bin interruption would need a different mechanism.
