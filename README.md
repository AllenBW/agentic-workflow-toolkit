# Agentic Workflow Toolkit

Small, sharp tools and conventions for working *alongside* AI coding agents — built around one idea: **candor**.

## Why this exists

When you hand work to a coding agent, a lot happens that you can't see. How much it's costing you. How close you are to a usage wall. How much context is left before it silently forgets. Which model is actually answering. How hard it's thinking. The default experience hides all of it — so you find out you hit a limit when you get cut off, find out a session was expensive when you check a dashboard later, and find out context compacted when the agent suddenly loses the thread.

This toolkit's north star is **candor** — frankness, openness, honesty:

- **Transparency** — surface the state the agent normally hides, in the place you're already looking. Make the invisible legible.
- **Openness** — open source, and open about what the agent is doing on your behalf and what it costs.
- **Empathy** — respect the person doing the work with the truth, and lower their cognitive load instead of adding to it.

Transparency isn't a feature bolted on the side; for agentic coding it's the whole point. **You can only steer what you can see.** A tool that tells you the truth about your session — plainly, continuously, without you asking — is a tool that lets you make better calls: when to push, when to switch models, when to clear context, when to slow down. These are the same values we want from the agent itself; tooling that's candid about what's happening trains the habit of expecting candor everywhere.

## Modules

| Module | What it is | Targets |
|---|---|---|
| [**code-status-bar**](./code-status-bar) | A status line that shows usage limits, cost, context health, and git/worktree state at a glance | Claude Code (via [ccstatusline](https://github.com/sirmalloc/ccstatusline)) |

> **New here? Start with the [Code Status Bar](./code-status-bar).** It installs as a portable, zero-dependency default, or an [opt-in colored variant](./code-status-bar#color--static-by-default-status-driven-by-opt-in) that recolors the usage bars **green → yellow → red** as you approach each limit — so you *feel* a wall coming before you read a single number.

More to come. Each module is self-contained, declares which agent it targets, and explains *why* every piece earns its place — because justifying the real estate is part of the philosophy.

## License

MIT — see [LICENSE](./LICENSE).
