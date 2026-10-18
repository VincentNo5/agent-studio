# Agent Studio

A live **studio floor** for multi-agent work: two views of the same state — a panel dashboard and
an office floor plan — showing which agent is doing what, right now.

**Panel view** (`/`) — workers, subagents, board, rooms, activity feed:

![Panel view](docs/studio.png)

**Floor plan** (`/floor`) — rooms, desks, a corridor of visiting workers:

![Floor plan](docs/floor.png)

Built on top of [Claude Code Game Studios](https://github.com/donchitos/claude-code-game-studios)
(CCGS) for its 49-role studio roster and its subagent audit hooks. No game development involved:
the roster is used as the *organizational* model.

## What it shows

| Panel | Source | Meaning |
|---|---|---|
| **Live floor** | `orca orchestration worker-list` + `terminal list` | Every supervised Orca worker: label (the worker terminal's own title), state, liveness, terminal state, next action |
| **CCGS subagents** | `$CCGS_ROOT/production/session-logs/agent-audit.log` | Real per-role activity from CCGS's `SubagentStart`/`SubagentStop` hooks (`invoked` / `completed` / `active`) |
| **Kanban** | `hermes kanban list` + `stats` | The persistent task board by status lane |
| **Studio rooms / floor plan** | `roster.json` (generated from CCGS `.claude/agents`) | 49 roles in 10 rooms; a desk lights when that role is active |
| **Corridor** (floor view) | same worker feed | Supervised workers as visitors, with their task label |
| **Activity** | poll diff | Worker/task state transitions as they happen |

A role counts as active when either source says so:

1. the CCGS audit log shows an unmatched `invoked` for that role, or
2. a currently working worker's task title/spec names that role.

## Run

```bash
bun run server.ts          # http://127.0.0.1:8787        (panel)
                           # http://127.0.0.1:8787/floor  (floor plan)
bun run --hot server.ts    # same, with reload
```

Environment:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `ORCA_COORDINATOR` | unset | Coordinator terminal handle; when set, task titles/specs are read via `orca orchestration task-list --from <handle>` and used for role matching |
| `CCGS_ROOT` | `/tmp/ccgs` when present | CCGS project root holding `production/session-logs/agent-audit.log` |
| `AGENT_STUDIO_AUDIT` | unset | Point directly at an audit log file (overrides `CCGS_ROOT`) |
| `PATH` | inherited | **Must include the directories holding `orca` and `hermes`** — see the launchd note below |

Everything is read-only: the server only reads CLI output and log files.

## Adding a view (the cheap way)

Both views are plain HTML files reading the same `/state` and `/roster.json`. A new view is:

1. a new `something.html` that fetches `/state` on an interval and paints,
2. four lines in `server.ts` serving it.

No build step, no framework, no new endpoint. `floor.html` is exactly that: SVG drawn once at load
from the roster, then only per-desk classes updated each poll — which is why it stays cheap at 49
desks and 2-second polling.

## Run it as a service (macOS launchd)

```bash
# ~/Library/LaunchAgents/com.vincent.agent-studio.plist  →  then:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vincent.agent-studio.plist
launchctl kickstart -k gui/$(id -u)/com.vincent.agent-studio   # restart after editing
launchctl bootout gui/$(id -u)/com.vincent.agent-studio        # stop
```

**launchd starts with a minimal environment.** Without an explicit `PATH` in
`EnvironmentVariables`, the server cannot find `orca` or `hermes` and every panel silently
renders empty — the HTTP endpoint still answers `200`, so the failure looks like "no agents are
running" rather than an error. Set `PATH` to include `~/.local/bin` and `/opt/homebrew/bin`.

Logs: `~/Library/Logs/agent-studio.log` and `.err.log`.

## Before committing

This repo is public. A pre-commit hook blocks staged content that looks like a credential:

```bash
git config core.hooksPath .githooks   # once per clone
```

`.gitignore` also excludes `.env*`, keys, credential JSON, and logs.

## Files

- `server.ts` — Bun HTTP server: collects the sources, serves `/state`, `/roster.json`, `/`, `/floor`
- `index.html` — panel view (no framework, no build step)
- `floor.html` — office floor plan (inline SVG, desks per role, corridor for visiting workers)
- `roster.json` — generated roster: `{ rooms: [...], agents: [{ name, model, desc, room, tier }] }`
- `docs/*.png` — screenshots (redacted: repository names and local paths replaced)

## Limits

- Orca workers are generic agents (`claude`, `opencode`, `cursor`), not CCGS roles — role
  attribution comes from the task text, so an untitled or generically-titled task shows as a
  worker without a lit room.
- The audit feed only exists while Claude Code runs inside a CCGS project (the hooks live there).
- Short tasks finish faster than a poll: a worker can go from `pending` to `succeeded` between two
  polls (2 s apart). Long tasks show the pulsing "working" state.
- `hermes kanban` and `orca` must be on the server process's `PATH`.
- The floor plan is top-down 2D on purpose: labels stay readable at 49 desks, and it needs no 3D
  or canvas code. An isometric view is possible but costs legibility, not capability.

## Credits

- Studio roster and audit-hook format: [Donchitos/Claude-Code-Game-Studios](https://github.com/donchitos/claude-code-game-studios) (MIT).

## License

MIT — see [LICENSE](LICENSE).
