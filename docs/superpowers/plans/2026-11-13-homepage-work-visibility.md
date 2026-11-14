# Agent Studio — Homepage Layout & Working-Agent Visibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage panels non-overlapping and readable at 1280×720 and up, and make any working agent unmistakable: its task, what remains, which agent, and which provider/model.

**Architecture:** Keep the single `/state` snapshot and HUD. Add identity + work fields at the server boundary (`activity.ts`, `server.ts`), unify the "is it working" rule across server and UI, then render one "Working now" strip reused by Agent detail and the tool rows. Layout is fixed in CSS with explicit column sizing and internal scrolling, not by hiding panels.

**Tech Stack:** Bun + TypeScript (`server.ts`, `activity.ts`), vanilla ES modules (`public/studio.js`, `public/studio-data.js`), CSS (`public/studio.css`), Three.js (`public/hq3d.js`), bun:test.

**Spec:** this document. Codex Astra (high) review: `docs/review/astra-2026-11-13.md`.

## Global Constraints

- Read-only telemetry: never write to Orca, agents, or session stores.
- `/state` TTL stays 1500 ms; no per-client CLI spawns (share the cached collect).
- No fabricated data: unknown model/provider/remaining work renders `—`.
- `bun test` must stay green (92 passing at baseline `0b50a8f`).
- No WebGL/scene regressions; visitors already exist for unmapped workers.

## Measured audit (2026-11-13, baseline `0b50a8f`)

| Viewport | Overlap (`getBoundingClientRect`) | Clipped (`scrollHeight > clientHeight`) |
|---|---|---|
| 1280×720 | `.panel.operations` × `.panel.navigator` — 220×6 px | `#status-groups` 254→24, `.tool-list` 109→96, `.panel.live-work` 164→148, `.panel.preferences` 131→122 |
| 1440×900 | none | `#status-groups` 254→72, `.tool-list` 109→96 |

Astra's CSS budget confirms it: at 1280×720 the left rail is 474 px; `status 120 + tools 132 + gaps 30`
leaves 192 px for task board + operations, which need ~205–225 px → 13–33 px overflow.

Astra P1/P2 findings folded into the tasks below: inconsistent `running` status (renders Idle), one
row per tool collapsing multiple direct sessions, omp children expiring after 60 s by spawn age,
child clicks losing identity, `role.model` shown as a running model, `assignee` dropped, cached
failed `worker-show` lookups, and a finished process reading as working for 120 s.

## Review Focus

- A working agent must show name, agent, provider · model, task and remaining (or `—`) at every viewport.
- Panels may scroll internally but never overlap or collapse their header at 1280×720.
- A second working agent must not push the first out of view.
- A wrong model is worse than none: unknown renders `—`.
- A finished process must not keep reading as working beyond the tool's freshness window.

---

### Task 1: Laptop layout — no overlap, no collapsed panels

**Files:**
- Modify: `public/studio.css` (`.left-column`, `.agent-status`, `.task-board`, `.tool-activity`, `.operations`, `.navigator`, `.preferences`, `.tool-row`)
- Modify: `public/studio.js` (HUD markup only if the operations row must move)
- Test: `tests/layout.audit.mjs` (new, run with `node`), `tests/ui-contract.test.js`

**Interfaces:**
- Produces: a left rail that scrolls inside its bounds; `.operations` no longer intersects `.navigator`; `#status-groups` gets ≥96 px at 1280×720; `.preferences` scrolls when shorter than its content; `.tool-row` icon track 13 px.

- [ ] **Step 1: Write the failing audit** — `tests/layout.audit.mjs` opens `/` at 1280×720, 1365×768, 1440×900, collects `.left-column > *, .right-column > *, .events, .navigator, .preferences`, fails when two visible rects intersect >2 px, any `.panel-head h2` has height 0, or `#status-groups` clientHeight < 96.
- [ ] **Step 2: Run it** — `node tests/layout.audit.mjs`; expected FAIL on the operations × navigator pair.
- [ ] **Step 3: Fix CSS** — move `.operations` out of flow (`position:absolute; left:var(--side); bottom:var(--rail-bottom)`), make `.left-column` `overflow:auto` with `min-height:0` children, compact `.tool-activity` below 800 px height (`flex:0 0 96px`), give `.preferences` `overflow:auto; max-height:…`, set `.tool-row` first track to `13px`.
- [ ] **Step 4: Verify** — audit passes at all three sizes; `bun test` 92 pass.
- [ ] **Step 5: Commit** — `fix(studio): prevent HUD panel overlap at laptop sizes`

### Task 2: One "working" rule across server and UI

**Files:**
- Modify: `public/studio-data.js` (`isPresent`, `workerStatus`, tool-evidence branch in `agentStatuses`)
- Modify: `server.ts` (`MOVING_STATES`/`isMovingWorker`)
- Test: `tests/status.test.js`, `tests/activity.test.ts`

**Interfaces:**
- Produces: `MOVING_STATES = ['starting','running','pending','dispatched','queued']` exported from `studio-data.js` and used by `workerStatus`; a worker with `workerState='running'` and no `liveness` reads **working**, never idle.
- Produces: tool evidence in `agentStatuses` only upgrades a role whose current status is `idle` (never overrides `pending`/`failed`), and keeps the task text when present.

- [ ] **Step 1: Failing tests** — running-without-liveness → `working`; pending dispatch + busy tool → still `pending`; tool upgrade keeps `entry.task`.
- [ ] **Step 2: Run** — `bun test tests/status.test.js` → FAIL.
- [ ] **Step 3: Implement** — share `MOVING_STATES`, adjust precedence, keep evidence strings.
- [ ] **Step 4: Run** — `bun test` → pass.
- [ ] **Step 5: Commit** — `fix(studio): unify the working-state rule`

### Task 3: Per-session identity (no collapsed or vanishing agents)

**Files:**
- Modify: `activity.ts` (`collectToolActivity`, `readOmpSubagents`, `ToolActivity`)
- Modify: `public/studio.js` (`withToolWorkers`)
- Modify: `server.ts` (retry failed `worker-show` lookups; do not cache nulls forever)
- Test: `tests/activity.test.ts`, `tests/routes.test.ts`

**Interfaces:**
- Produces: `ToolActivity.sessions: { pid, cwd, model, command }[]` — one entry per matching live process, each with its own cwd/model; `processes`/`pids`/`cwd`/`model` stay as the newest session (backward compatible).
- Produces: `OmpSubagent.id` is session-qualified (`<sessionId>:<childId>`), and expiry uses the last child record time or `stale` flag, not the spawn age alone.
- Produces: `withToolWorkers()` emits one synthetic worker per session and per omp child; a direct session is never dropped when a dispatch exists for the same tool.

- [ ] **Step 1: Failing tests** — two pids with different cwd/model → two sessions; omp child older than 60 s but with recent parent output → still listed (or explicitly `stale`).
- [ ] **Step 2: Run** — `bun test tests/activity.test.ts` → FAIL.
- [ ] **Step 3: Implement** — build `sessions` from `procs` and per-pid cwd cache; qualify child ids with the session id; retry `worker-show` failures once per collect instead of caching.
- [ ] **Step 4: Run** — `bun test` → pass.
- [ ] **Step 5: Commit** — `fix(studio): keep one row per live session`

### Task 4: Work payload — task, provider, model, remaining

**Files:**
- Modify: `activity.ts` (`providerOf`, `modelFromArgv`, `parseOmpTodos`, `ToolActivity.remaining`, `OmpSubagent` detail)
- Modify: `server.ts` (`WorkerView.provider`, `.remainingTasks`; `OrcaTaskView.assignee`; join by assignee)
- Test: `tests/activity.test.ts`, `tests/routes.test.ts`

**Interfaces:**
- Produces: `providerOf(model: string|null): string|null` = text before the first `/`; `null` for no model.
- Produces: `modelFromArgv(command: string): string|null` reading `-m|--model`.
- Produces: `parseOmpTodos(text: string): { current: string|null, remaining: number|null }` from the newest `todo` tool result.
- Produces: `ToolActivity.provider|model|remaining`; `WorkerView.provider|remainingTasks: string[]`.
- Consumes: `orcaTasks` (status in `pending/ready/dispatched/blocked`), joined by `assignee` handle or role text.

- [ ] **Step 1: Failing tests** — argv model/provider; todo parse (current + remaining); `remainingTasks` join from fixtures.
- [ ] **Step 2: Run** — `bun test tests/activity.test.ts` → FAIL.
- [ ] **Step 3: Implement** — sources in priority order: worker-show → argv → session store; unknowns stay `null`.
- [ ] **Step 4: Run** — `bun test` → pass.
- [ ] **Step 5: Commit** — `feat(studio): expose provider, model, task and remaining work`

### Task 5: Working-now strip, child detail, floor labels

**Files:**
- Modify: `public/studio.js` (`renderWorkers`, `renderDetail`, tools dialog, `renderTools`)
- Modify: `public/studio.css` (`.working-now`, `.work-card`, `.work-meta`)
- Modify: `public/hq3d.js` (`createActor` visitor `roleTag` / status label; no layout changes)
- Test: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `WorkerView.agent|provider|model|taskTitle|remainingTasks|workerState`, `ToolActivity.subagents|sessions|remaining`.
- Produces: top `.working-now` section in Live work with one `.work-card` per working item: task; `agent · provider · model`; `remaining: N · next: …` (or `—`).
- Produces: clicking an `omp-child` opens that child's own detail (task, agent, state, parent tool), never `tool:omp`; visitors get a role/status tag.

- [ ] **Step 1: Structural test first** — `working-now`, `remainingTasks`, `provider` present in `studio.js`.
- [ ] **Step 2: Run** — `bun test tests/ui-contract.test.js` → FAIL.
- [ ] **Step 3: Implement** — strip ordered by recency; counts consistent; unknown fields `—`.
- [ ] **Step 4: Verify visually** — 1280×720 and 1440×900 with `claude -p`, `codex exec`, `omp -p` running; each card shows all four facts; floor shows the visitor tag.
- [ ] **Step 5: Commit** — `feat(studio): highlight working agents with task, model and remaining work`

### Task 6: Astra re-review and close-out

**Files:** `docs/review/astra-2026-11-13.md` (append), plan checkboxes.

- [ ] **Step 1:** Run `codex exec -m codex/gpt-6-astra -c model_reasoning_effort="high" -s read-only --skip-git-repo-check` over `merge-base..HEAD`; append findings.
- [ ] **Step 2:** Fix or explicitly park each high-severity finding with a one-line rationale.
- [ ] **Step 3:** `bun test` + `node tests/layout.audit.mjs` green; screenshots at three viewports saved to `docs/review/`.
- [ ] **Step 4:** Commit `chore(studio): astra re-review and verification artifacts`


## Completion (2026-11-13)

Branch `feat/homepage-work-visibility`, commits `0b50a8f..<HEAD>`. Six tasks landed with per-task
reviews; final review and scoped re-reviews recorded in `docs/review/`. Verification:

- `bun test` — 160 pass, 0 fail.
- `node tests/layout.audit.mjs` — PASS at 1280×720, 1365×768, 1440×900 (no overlap >2px, status list ≥96px, tool header + first row painted); `--base-css` reproduces the original operations × navigator overlap.
- Live `/state` on :8787 — working items expose task, agent · provider · model and remaining; header, strip, Agent status and campus badge agree; finished omp children settle from wait/async results.
