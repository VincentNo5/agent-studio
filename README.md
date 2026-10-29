# Agent Studio

A live **three-dimensional headquarters** for multi-agent work, with a cinematic command
HUD and two desktop views of the same read-only state.

**Command Overview** (`/`) — the complete three-level tower, task lanes, active roles,
agent inspection, live events, and operational panels.

**Studio Floor** (`/floor`) — the same world, initially focused on Engineering & Design,
with live worker output in the inspection sidebar. Orbit, zoom, select characters, or use
the floor navigator to inspect any level. All 49 roster roles have stable workstations;
Orca dispatches occupy the lobby.

**Mobile** (`/mobile`) — phone-first single screen (390×844, no scrolling): quota bars, worker
counts, active agents, rooms. This is the view to open from an iPhone; see
[docs/REMOTE-CONTROL.md](docs/REMOTE-CONTROL.md).

**System Anatomy** (`/anatomy`) — an isometric cutaway of the data plane, `/state` collector and
the four experience views, with live counts and keyboard-accessible hotspots.

<img src="docs/anatomy.png" alt="Agent Studio system anatomy" width="720">

## 3D asset pipeline

The live floor is still procedural and has no runtime Blender dependency. An optional Blender kit
and the production path for agent-authored assets live in
[docs/BLENDER-PIPELINE.md](docs/BLENDER-PIPELINE.md), with the deterministic source at
`blender/agent_studio_kit.py`. Run `scripts/build-blender-assets.sh` when Blender is installed;
otherwise the procedural fallback remains the source of truth.

The kit desk/chair/plant/rack parts are instanced across the 49 workstation slots; the
procedural monitors and status strips stay because they carry live state.

<img src="docs/floor-kit.png" alt="Blender kit workstations on the Agent Studio engineering floor" width="720">

<img src="docs/mobile.png" alt="Mobile view" width="330">

Built on top of [Claude Code Game Studios](https://github.com/donchitos/claude-code-game-studios)
(CCGS) for its 49-role studio roster and its subagent audit hooks. No game development involved:
the roster is used as the *organizational* model.

## What it shows

| Panel | Source | Meaning |
|---|---|---|
| **Live Floor** | `orca orchestration worker-list` + `terminal list` | Every supervised Orca worker: label (the worker terminal's own title), state, liveness, terminal state, next action |
| **Subagent Activity** | `$CCGS_ROOT/production/session-logs/agent-audit.log` | Real per-role activity from CCGS's `SubagentStart`/`SubagentStop` hooks (`invoked` / `completed` / `active`) |
| **Task Board** | `orca orchestration task-list`, else `hermes kanban list` | Tasks by status lane — see *Task board sources* below |
| **Studio Roster** / floor plan | `roster.json` (generated from CCGS `.claude/agents`) | 49 roles in 10 rooms; a seat lights when that role is active |
| **Corridor** (floor view) | same worker feed | Supervised workers as visitors, with their task label |
| **Live Work** (`/floor` sidebar) | `/state` + `/worker/<id>` | The run on the floor, the agents behind it, the tasks in flight, and the picked worker's live tail |
| **Activity** | poll diff | Worker/task state transitions as they happen |

All interface text is **English**; runtime data (task titles, role descriptions) is shown as-is.

Every agent has exactly one status, derived only from reported fields (`agentStatuses` /
`workerStatus` in `public/studio-data.js`), in this precedence:

| Status | Evidence |
|---|---|
| **Working** | a floor worker naming the role is live and unsettled, or the audit log has an unmatched `invoked` for it |
| **Pending** | a matching dispatch is still `pending` |
| **Failed** | a matching worker or dispatch reported `failed` |
| **Completed** | a matching floor worker settled (`succeeded` / `stopped` / `cancelled`), or the role's last audit event is `completed` within 30 minutes |
| **Idle** | none of the above |

Only the floor-scoped `workers` count, never run history, and the 30-minute window keeps every
role that ever finished from reading as freshly completed. Each status carries its evidence
(`worker ctx_… · succeeded`, `audit completed 14:22`) and a `since` time only when an audit
event provides one. The HUD pairs every status with an icon and a label, never colour alone;
the scene gives each agent a status halo, a billboard badge and a desk strip in the same colours.

## Run

```bash
bun run server.ts          # http://127.0.0.1:8787        (panel)
                           # http://127.0.0.1:8787/floor  (floor plan)
bun run --hot server.ts    # same, with reload
bun run visual-review      # capture /, /floor, /anatomy and /mobile into docs/review
```

Environment:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `ORCA_COORDINATOR` | unset | Coordinator terminal handle; when set, task titles/specs are read via `orca orchestration task-list --from <handle>` and used for role matching |
| `CCGS_ROOT` | `/tmp/ccgs` when present | CCGS project root holding `production/session-logs/agent-audit.log` |
| `AGENT_STUDIO_AUDIT` | unset | Point directly at an audit log file (overrides `CCGS_ROOT`) |
| `AGENT_STUDIO_TTL_MS` | `1500` | Shared `/state` cache window. Every collect spawns CLI processes, so all clients share one collect per TTL; concurrent callers join the in-flight promise. Before this, several tabs polling every 2 s queued behind each other and `/state` took ~9 s. |
| `AGENT_STUDIO_FLOOR_GRACE_MS` | `1800000` (30 min) | How long a finished run keeps its dispatches on the floor before they fade. A run that still owns a live or pending worker is never hidden, whatever this says. |
| `AGENT_STUDIO_RUN_HISTORY` | `10` | How many runs `/state` carries in `runs` for the history view, newest first. |
| `AGENT_STUDIO_AGENT_LOOKUPS` | `12` | `worker-show` lookups per collect that fill in which AI a dispatch launched. Results are cached per dispatch, so this only bounds a cold start. |
| `PATH` | inherited | **Must include the directories holding `orca` and `hermes`** — see the launchd note below |

**Floor scope.** `orca orchestration worker-list` has no run binding when a service calls it, so its
receipt says `scope.source: "all"` and it returns every dispatch of every run, newest first, forever:
a finished smoke test would keep its failures in the FAILED dial for good. `/state` therefore scopes
the floor to the newest non-legacy run that still owns a live or pending worker, else the newest run
overall. It keeps that run while it owns a live or pending worker or is within
`AGENT_STUDIO_FLOOR_GRACE_MS` of its creation, and never hides a worker that is still live or
pending — a hidden live worker would be a lie. `ORCA_COORDINATOR` is not a floor filter: it only
feeds the task board, so a run started from an omp `/team` session shows up too. The `workerScope`
field reports the run shown, whether it is live, and how many dispatches were left out; the panel
prints that under the dial.

**Task board sources.** The board has two sources, and Orca wins. When `ORCA_COORDINATOR` is set
and `orca orchestration task-list --from <handle>` returns any tasks, `/state` carries them in
`orcaTasks` (`id`, `title`, `spec`, `status`, `runId`) and the board draws one lane per Orca status
(`pending`, `ready`, `dispatched`, `running`, `blocked`, `completed`, `failed`, then any other
status it sees). With no Orca tasks it falls back to the Hermes kanban (`kanban`/`kanbanStats`)
and its eight lanes. The header note always names the source: `Orca · 20 tasks · 2 lanes` or
`Hermes · 3 tasks · 2 of 8 lanes`.

**Which AI is working.** `worker-list` reports a null `projection.agent`, so the launched agent
(and model, and terminal exit cause) is only in `orca orchestration worker-show`. The server looks
it up for the dispatches on the floor and for the newest run, caches it per dispatch — it never
changes — and the floor, the history detail and the mobile view all name it (`ORCA · claude`).

**Worker output.** `/worker/<dispatch-id>` proxies `orca orchestration worker-read --source auto`
(bounded tail) for one dispatch. The history detail opens it in an overlay and refreshes it every
two seconds while open; ids are validated, and a dispatch Orca cannot read answers `502` rather
than an empty box. Orca holds a terminal tail only while that terminal lives, so a finished
dispatch reads empty — the overlay says so, with the source, terminal status and line count.

The floor view (`/floor`) carries the same thing in its sidebar: **LIVE WORK** names the run on the
floor, the agents behind it (`working · claude ×2 · codex ×1`) and the tasks in flight, and follows
the first working worker's tail live. Click a row or a lobby figure to watch a different one. When
nothing is running it falls back to the newest run, so the card is never blank.

Everything is read-only: the server only reads CLI output and log files.

## Desktop rendering and controls

Both desktop pages use the same `public/hq3d.js` Three.js scene and `public/studio.js`
controller. There is no framework, CDN, or build step. The import map loads the installed
Three.js package through `/vendor/three/`; `/assets/` serves `public/`. Static routes reject
traversal and symlink escapes. The responsive HUD is designed for 1280×720 and above;
use `/mobile` for the phone interface.

- Drag to orbit; scroll/pinch to zoom; right-drag to pan.
- The top bar and building navigator focus a floor. Reset camera returns to the tower.
- With the canvas focused, `1`, `2`, `3` focus floors and `Home` resets.
- Click a character, active role, or roster entry to inspect it. Associated dispatches
  offer **View full logs**. Clicking a worker stops automatic worker following.
- Task lanes filter the task inspector and highlight matching characters.
- Run history, audit, quotas, Paseo, and the full roster open in keyboard-accessible dialogs.
- Particle and low-performance settings persist locally. Low-performance mode disables
  bloom and shadows, reduces particles, and caps rendering at 1× device pixel ratio.

The scene uses procedural geometry, instanced character parts, merged static architecture,
local canvas labels, and generated environment lighting. Animation pauses in hidden tabs;
reduced-motion preferences stop ambient movement. Normal rendering caps DPR at 1.65.
No operational activity is simulated. Missing state is labeled as unavailable, and failed
JSON requests retain the last scene with a retryable connection indicator.

## Verification

```bash
bun test
bun build public/hq3d.js --outdir /tmp/astra-check --target browser
PORT=8788 bun run server.ts   # separate from the 8787 service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/
```

The tests cover state interpretation, non-JSON error handling, local module routing,
traversal rejection, structural geometry, roster bounds, character instancing, and
stable positions across polls. Route tests invoke the actual request handler without
binding a socket; they do not replace a browser/GPU check. Stop the test server with Ctrl-C.

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
- `index.html` — command overview entry and local import map
- `floor.html` — focused floor entry and local import map
- `public/` — shared Three.js world, state interpretation, responsive HUD and styles
- `tests/` — data, routing and procedural scene regression checks
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
- Desktop 3D requires WebGL 2. If GPU initialization fails, the data HUD and operational
  panels remain usable and show a renderer error.
- Character motion is a stylized representation of reported status, not a reconstruction
  of an agent's real-world actions. Matching roles to workers still depends on task text.
- Provider quotas and Paseo sessions depend on their local services. No synthetic metrics
  are substituted when a service reports nothing.
- The committed screenshots in `docs/` predate the 3D redesign.

## Credits

- Studio roster and audit-hook format: [Donchitos/Claude-Code-Game-Studios](https://github.com/donchitos/claude-code-game-studios) (MIT).

## License

MIT — see [LICENSE](LICENSE).
