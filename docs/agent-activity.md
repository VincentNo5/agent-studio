# Agent tool activity — what to watch and why

The studio answers one question per tool: **is an agent working right now, or merely
installed?** No tool exposes that uniformly, so `activity.ts` derives it from two signals
every local agent has: the process table and its own session store.

## What each tool writes

Verified on this machine (2026-11) and against vendor docs where they exist.

| Tool | Session store | Format | Documented | Notes for detection |
|---|---|---|---|---|
| Claude Code | `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` | JSONL | yes | `cleanupPeriodDays` (default 30) deletes old files; `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` stops writing; `CLAUDE_CONFIG_DIR` moves the root |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL | no | `[history] persistence="none"` only affects `history.jsonl`, **not** rollouts; `CODEX_HOME` moves the root |
| opencode | `~/.local/share/opencode/opencode.db` (+ `-wal`) | SQLite (WAL) | partially | flat JSON tree was migrated to one DB in v1.2.0; `opencode db path` is the supported lookup; logs are capped by file count, not size |
| Cursor CLI | `~/.cursor/chats/<chat>/<uuid>/store.db` + `meta.json` | SQLite | no | `meta.json` carries `updatedAtMs`, `cwd`, `title`; ACP sessions use `~/.cursor/acp-sessions/`; `XDG_CONFIG_HOME` relocates chats |
| Amp | `~/.local/share/amp/threads/T-*.json` | JSON per thread | no | server is the source of truth, the local file is a mirror |
| pi | `~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl` | JSONL tree | yes | the file is written **after** an exchange completes, so a fresh session can have an empty directory; `PI_CODING_AGENT_SESSION_DIR` moves it |
| VS Code agents | `~/Library/Application Support/Code/User/globalStorage/agent-host.db` | SQLite | no | one host DB for every agent extension |
| Windsurf | `~/.codeium/windsurf/{cascade,database}` | internal | no | — |

Claude Code is also the only one with a push channel: a `statusLine` command receives JSON on
stdin (`session_id`, `transcript_path`, `prompt_id`, `rate_limits.five_hour.resets_at`,
`context_window`), and hooks fire on `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop` and
`Notification`. Both are opt-in per user/project, so a dashboard that reads them only sees
machines where someone configured them. This studio deliberately reads nothing that requires
setup.

Dashboards in the same space (Vibe Kanban, Minion Orchestra, AgentsRoom, runpane) all converge on
the same primitives: one row per session, read from the store above (or the terminal tail the
orchestrator owns), with `working` / `waiting` / `done` derived from recent output plus process
liveness. None of them agree on a protocol, which is why the adapter is per tool.

## The derivation

`TOOL_DEFS` holds one row per tool: executable basenames for the process match, the agent names
Orca reports for it, and the store directories to walk. `collectToolActivity()` does one `ps -axo pid=,time=,command=`, one bounded
walk per store (3000 entries, depth 4, skips `*.lock`, `*.tmp`, logs, caches, SQLite `-shm`),
then `interpretTools()` maps the evidence to a state:

| Evidence | State |
|---|---|
| newest store file ≤ 120 s old | `working` |
| cumulative CPU advanced ≥ 0.15 s since the previous sample | `working` |
| process alive, no recent output | `idle` |
| installed, nothing running | `available` |
| no binary and no store | `offline` |

Only the **executable position** is matched (`argv[0]`, or the first script argument after
`node`/`bun`/`python`), never arbitrary arguments — otherwise a prompt that mentions `Cursor`
makes Cursor look busy. That bug was caught live: `claude -p "… Cursor …"` registered as a
Cursor process.

Why mtime instead of parsing each format: the stores are documented for two tools out of eight,
and opencode already replaced its format once. mtime + process liveness is the only signal every
tool provides without a schema commitment, and it stays correct when a store moves (the tool just
reads `available`). Parsing is reserved for the next step, where a `lastPrompt` line is worth the
per-tool maintenance.

Project resolution has two layers. While a process runs, one `lsof -a -p <pid> -d cwd -Fn`
(cached per pid) names it exactly. After the run, the session slug is resolved against the
worktree paths Orca already reports — exact, and unaffected by dashes that slugs cannot encode.

The join to agents is by name first (`worker-show.agent` → tool row), then by project path, so a
dispatch whose agent Orca cannot name still lands on the tool that is writing in its worktree.
Orca's concise `worker-show` payload drops `startOptions` (the only place the launched agent
appears), so the lookup passes `--full` and accepts both the wrapped and the flat result shape;
without that, every dispatch reads agent-less and the join silently produces nothing.

Why not `lsof` for every process: it costs 20–50 ms per pid, so it runs once per tool per collect
and only while that tool has a live process.

## Surfaces

The HUD reads one state:

- **Agent tools** — live/idle tools with their brand mark, state colour, age or process count and
  the number of dispatches running on them; quiet tools fold into one row. The `Detail ↗` table
  lists every row with `State`, `Project` (cwd), `Processes`, newest session output and `Agents`.
- **Agent status** — a working tool lights the roster role named by its dispatch and a *Tools
  working* group names the tool + project; role rows and tool rows share the same status colours.
- **Live work** — Orca workers plus direct tool sessions (no dispatch), each row naming the tool,
  the project leaf and the process count. A tool row without a dispatch opens the tool's detail.
- **Agent detail** — `tool:<id>` selection shows state, pids, project, session, evidence and the
  dispatches on that tool; `worker:<dispatch>` adds a `Tool` field with its state.
- **The floor** — tool work is converted to worker rows (`tool:<id>` for a direct session,
  `omp-child:<id>` for an omp `task` child) and handed to the scene, where the existing visitor
  pass gives it a hot desk or a corridor place. That is the same path Orca workers without a
  roster role already use, so the character matches the work rather than a roster name.

omp is the one tool that names its children on disk: each `task` call's tool result carries
`details.progress[]` with `id`, `agent`, `status` and `task`. The parser keeps the newest record
per child, maps `pending` (the spawn record) to `running`, and drops settled statuses. Because a
child never writes a completion record, a child ages out after 60 s of silence — a finished child
can read as running for up to a minute, and a child that runs longer than a minute while writing
nothing new would drop early.

Icons come from `public/tool-icons.js` (Simple Icons, CC0) for tools with a public mark; the rest
render their initial so a missing brand asset never blanks a row.

## Limits

- Undocumented paths (Codex rollouts, opencode schema, Cursor chats) change without notice.
- `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR` relocate stores;
  the defaults above assume none of them are set.
- A GUI IDE with no store write reads `available` even while its chat is open.
- A tool's first, long exchange can be invisible when it writes its session file only at the end
  (pi) — the process is then `idle`, not `working`.

Sources: Claude Code status line and hooks docs (`code.claude.com/docs/en/statusline`,
`/hooks`), "Where six AI coding CLIs store your session logs" (allaboutcoding.ghinda.com,
2026-08), opencode and pi documentation, and direct inspection of the stores in this home
directory.
