# Agent Studio

A live **studio floor** for multi-agent work: one page that shows which agent is doing what,
right now — roles arranged in rooms, real workers on the floor, tasks on the board.

Built on top of [Claude Code Game Studios](https://github.com/donchitos/claude-code-game-studios)
(CCGS) for its 49-role studio roster and its subagent audit hooks. No game development involved:
the roster is used as the *organizational* model.

## What it shows

| Panel | Source | Meaning |
|---|---|---|
| **Live floor** | `orca orchestration worker-list` + `terminal list` | Every supervised Orca worker: label (the worker terminal's own title), state, liveness, terminal state, next action |
| **CCGS subagents** | `$CCGS_ROOT/production/session-logs/agent-audit.log` | Real per-role activity from CCGS's `SubagentStart`/`SubagentStop` hooks (`invoked` / `completed` / `active`) |
| **Kanban** | `hermes kanban list` + `stats` | The persistent task board by status lane |
| **Studio rooms** | `roster.json` (generated from CCGS `.claude/agents`) | 49 roles in 10 rooms; a chip lights when that role is active |
| **Activity** | poll diff | Worker/task state transitions as they happen |

A role is considered active when either source says so:

1. the CCGS audit log shows an unmatched `invoked` for that role, or
2. a currently working worker's task title/spec names that role.

## Run

```bash
bun run server.ts          # http://127.0.0.1:8787
bun run --hot server.ts    # same, with reload
```

Environment:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `ORCA_COORDINATOR` | unset | Coordinator terminal handle; when set, task titles/specs are read via `orca orchestration task-list --from <handle>` and used for role matching |
| `CCGS_ROOT` | `/tmp/ccgs` when present | CCGS project root holding `production/session-logs/agent-audit.log` |
| `AGENT_STUDIO_AUDIT` | unset | Point directly at an audit log file (overrides `CCGS_ROOT`) |

Everything is read-only: the server only reads CLI output and log files.

## Files

- `server.ts` — Bun HTTP server: collects the sources, serves `/state`, `/roster.json`, `/`
- `index.html` — the whole UI (no framework, no build step)
- `roster.json` — generated roster: `{ rooms: [...], agents: [{ name, model, desc, room, tier }] }`

## Regenerating the roster

```bash
python3 - <<'PY'   # from a CCGS checkout's .claude/agents
# see the mapping used: rooms → role names, then read each agent's frontmatter
PY
```

## Limits

- Orca workers are generic agents (`claude`, `opencode`, `cursor`), not CCGS roles — role
  attribution comes from the task text, so an untitled or generically-titled task shows as a
  worker without a lit room.
- The audit feed only exists while Claude Code runs inside a CCGS project (the hooks live there).
- Short tasks finish faster than a poll: a worker can go from `pending` to `succeeded` between two
  polls (2 s apart). Long tasks show the pulsing "working" state.
- `hermes kanban` and `orca` must be on `PATH` for the server process.
