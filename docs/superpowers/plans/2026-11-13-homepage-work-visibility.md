# Agent Studio — Homepage Layout & Working-Agent Visibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage panels non-overlapping and readable at 1280×720 and up, and make any
working agent unmistakable: its task, what remains, which agent, and which provider/model.

**Architecture:** Keep the existing single `/state` snapshot and HUD. Add identity + work fields to
the state at the server boundary (`activity.ts`, `server.ts`), then render one "Working now" strip
in Live work and reuse the same data in Agent detail and the tool rows. Layout is fixed in CSS with
explicit column sizing and internal scrolling, not by hiding panels.

**Tech Stack:** Bun + TypeScript server (`server.ts`, `activity.ts`), vanilla ES modules
(`public/studio.js`, `public/studio-data.js`), CSS (`public/studio.css`), Three.js floor
(`public/hq3d.js`), bun:test.

**Spec:** This document, plus the measured audit below and the working tree diff on 2026-11-13.

## Global Constraints

- Read-only telemetry: the server never writes to Orca, agents or session stores.
- `/state` TTL stays 1500 ms; no new CLI spawn per client (share the cached collect).
- No fabricated data: unknown model/provider/remaining work renders as `—`, never an invented value.
- Existing tests must keep passing: `bun test` (currently 92 pass).
- 3D scene must keep working without WebGL changes; visitors already exist for unmapped workers.

## Measured audit (2026-11-13, current working tree)

Browser measurements of `/` (panels by selector, `getBoundingClientRect`):

| Viewport | Overlap | Clipped (scrollHeight > clientHeight) |
|---|---|---|
| 1280×720 | `.panel.operations` × `.panel.navigator` — 220×6 px | `#status-groups` 254→24, `.tool-list` 109→96, `.panel.live-work` 164→148, `.panel.preferences` 131→122 |
| 1440×900 | none | `#status-groups` 254→72, `.tool-list` 109→96 |

Consequences today: at 1280×720 the Agent status panel shows only the "Tools working" group (role
rows are cut to 24 px), Live work hides its last worker row, and the operations row physically
overlaps the campus navigator.

Data audit of `/state` at the same moment: a working Codex session (`cwd=agent-studio`) and a
working omp session report `agents: []`, no model, no provider, no task and no remaining work. The
UI can therefore only say "direct session".

## Review Focus

- A working agent must never be visible only as a coloured dot: at every viewport it shows name,
  agent, provider · model, task and remaining work (or an explicit `—`).
- Panels may scroll internally, but must not overlap or hide their header at 1280×720.
- A second working agent must not push the first out of view; the strip is ordered by recency.
- Unknown model/provider must render `—`, not a guessed default, because a wrong model is worse
  than none.
- `/floor` shares `studio.js`; the same data must be visible there without the dashboards.

---

### Task 1: Fix the 1280×720 layout (no overlap, no hidden headers)

**Files:**
- Modify: `public/studio.css` (`--left-w`, `.left-column`, `.agent-status`, `.task-board`,
  `.tool-activity`, `.operations`, `.navigator`, `.right-column`, `.live-work`, `.preferences`)
- Modify: `public/studio.js` only if the HUD markup order must change (operations out of the column)
- Test: `tests/ui-contract.test.js` (structural assertions), plus a browser audit script

**Interfaces:**
- Produces: `.left-column` children all have `min-height:0` and a scroll container; `.operations`
  moves to the fixed bottom rail (`left: var(--side); bottom: var(--rail-bottom)`), sharing no box
  with `.navigator`.

- [ ] **Step 1: Write the failing audit**

Create `tests/layout.audit.mjs` (run with `node`, not part of `bun test`) that opens
`http://127.0.0.1:8787/` at 1280×720 and 1440×900, collects
`.left-column > *, .right-column > *, .events, .navigator, .ticker` rects, and exits non-zero when
two visible rects intersect by more than 2 px or any `h2.panel-head` has height 0.

- [ ] **Step 2: Run it and confirm the current failures**

Run: `node tests/layout.audit.mjs` · Expected: FAIL listing `.panel.operations × .panel.navigator`
at 1280×720.

- [ ] **Step 3: Move operations to the bottom rail and give every panel a scroll box**

In `public/studio.css`: position `.operations` absolutely at `left: var(--side); bottom: var(--rail-bottom)`;
remove it from `.left-column` flex flow (keep the markup in the column but `position:absolute`).
Set `.left-column > .panel { min-height:0 }`, `.agent-status { flex:1 1 0 }`, and
`.operations + .panel, .tool-activity { flex:0 0 132px }`; `.status-groups, .tool-list, .worker-list`
keep `overflow:auto`.

- [ ] **Step 4: Run the audit and the suite**

Run: `node tests/layout.audit.mjs` · Expected: PASS at both sizes.
Run: `bun test` · Expected: 92 pass.

- [ ] **Step 5: Commit**

```bash
git add public/studio.css public/studio.js tests/layout.audit.mjs
git commit -m "fix(studio): keep HUD panels from overlapping at 1280x720"
```

---

### Task 2: Add identity to every work item (agent · provider · model)

**Files:**
- Modify: `activity.ts` (`ToolActivity`, `cwdfor` sibling helpers, `collectToolActivity`)
- Modify: `server.ts` (`WorkerView`, `DispatchAgent`, `joinToolAgents` call site)
- Test: `tests/activity.test.ts` (parsing), `tests/routes.test.ts` (shape)

**Interfaces:**
- Produces: `providerOf(model: string|null): string|null` in `activity.ts` — text before the first
  `/` (`opencode-go/deepseek-v4.1-flash` → `opencode-go`), `null` when there is no model.
- Produces: `modelFromArgv(command: string): string|null` — reads `-m` / `--model` from a process
  command (`codex exec -m codex/gpt-6-astra` → `codex/gpt-6-astra`).
- Produces: `ToolActivity.provider: string|null`, `ToolActivity.model: string|null`.
- Produces: `WorkerView.provider: string|null` (filled from `model`, or the agent default:
  `claude`→`claude`, `codex`→`codex`, `opencode`→`opencode-go`, `cursor`→`cursor`), `model` stays.
- Consumes: existing `worker-show --full` launch data.

- [ ] **Step 1: Failing tests for provider/model parsing**

```ts
test('model parses out of an argv', () => {
  expect(modelFromArgv('codex exec -m codex/gpt-6-astra -s read-only')).toBe('codex/gpt-6-astra');
  expect(modelFromArgv('/usr/bin/claude -p hi --model opencode-go/glm-5.3-flash')).toBe('opencode-go/glm-5.3-flash');
  expect(modelFromArgv('opencode run hi')).toBeNull();
});
test('provider is the model namespace, never a guess', () => {
  expect(providerOf('codex/gpt-6-astra')).toBe('codex');
  expect(providerOf('magpie/opencode-go/glm-5.3-flash')).toBe('magpie');
  expect(providerOf(null)).toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure** · `bun test tests/activity.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement the two helpers and wire them**

In `collectToolActivity`, for each tool with live pids take the shortest command line (already
used for cwd), set `model = modelFromArgv(cmd)` and `provider = providerOf(model)`. In
`server.ts`, when building `WorkerView`, set `provider = providerOf(worker.model) ?? defaultProvider(worker.agent)`.

- [ ] **Step 4: Run tests** · `bun test` → all pass.

- [ ] **Step 5: Commit** · `git commit -m "feat(studio): expose provider and model for every work item"`

---

### Task 3: Task + remaining work per agent

**Files:**
- Modify: `activity.ts` (`readOmpSubagents` → also return session model and todo items)
- Modify: `server.ts` (`ToolDispatch` gains `remaining`, `WorkerView` gains `remainingTasks`)
- Test: `tests/activity.test.ts`, `tests/routes.test.ts`

**Interfaces:**
- Produces: `OmpSessionWork { model, todos: {content,status}[], subagents }` returned by the omp
  session reader; `ToolActivity.remaining: number|null` = count of todo items with status
  `pending` or `in_progress`.
- Produces: `WorkerView.remainingTasks: string[]` — Orca tasks for the worker's run whose status is
  `pending|ready|dispatched|blocked` and whose title matches the worker role; empty when no run is
  bound.
- Consumes: `orcaTasks` from `collect()`; omp session `todo` tool results (last one wins).

- [ ] **Step 1: Failing test for todo extraction**

```ts
const line = JSON.stringify({ type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { todos: [
  { content: 'Ship layout fix', status: 'in_progress' }, { content: 'Add tests', status: 'pending' }, { content: 'Audit', status: 'completed' },
] } } });
expect(parseOmpTodos(line).remaining).toBe(2);
expect(parseOmpTodos(line).current).toBe('Ship layout fix');
```

- [ ] **Step 2: Run and confirm failure** · `bun test tests/activity.test.ts` → FAIL.

- [ ] **Step 3: Implement `parseOmpTodos` and the Orca remaining-task join**

Read the newest `todo` tool result in the omp session tail; map statuses. In `collect()`, build
`remainingTasks` from `taskRows` filtered by worker run + role match, and attach to `WorkerView`.
Return `null`/`[]` when the source is absent — the UI prints `—`.

- [ ] **Step 4: Run tests** · `bun test` → pass.

- [ ] **Step 5: Commit** · `git commit -m "feat(studio): show current task and remaining work"`

---

### Task 4: "Working now" strip and highlight

**Files:**
- Modify: `public/studio.js` (`renderWorkers` → `renderWorkingNow`, `renderTools`, tooltip)
- Modify: `public/studio.css` (`.working-now`, `.work-card`, `.work-meta`, pulse)
- Modify: `public/hq3d.js` only if the working actor needs a visible ring (reuse `setStatus`)
- Test: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `WorkerView.agent|provider|model|taskTitle|remainingTasks|workerState`,
  `ToolActivity.subagents|remaining|model|provider`.
- Produces: one `.working-now` section at the top of Live work, one `.work-card` per working item:
  line 1 `task`, line 2 `agent · provider · model`, line 3 `remaining: N · next: <title>` or `—`.

- [ ] **Step 1: Structural test first**

```js
expect(studio).toContain('working-now');
expect(studio).toContain('remainingTasks');
expect(studio).toContain('provider');
```

- [ ] **Step 2: Run and confirm failure** · `bun test tests/ui-contract.test.js` → FAIL.

- [ ] **Step 3: Render the strip, sort by recency, keep the old list below**

Working cards use the existing `meta('working').color`, a pulsing dot and `data-work-id` so the
floor and detail can select them. Non-working rows move below a divider. Unknown fields render `—`.

- [ ] **Step 4: Verify visually**

Run the app, open `/` at 1280×720 and 1440×900, start one real agent per tool (`claude -p`,
`codex exec`, `omp -p` with a task) and confirm each card shows task, agent, provider · model and
remaining (`—` when absent), and that the same item is highlighted on the floor.

- [ ] **Step 5: Commit** · `git commit -m "feat(studio): highlight working agents with task, provider and remaining work"`

---

### Task 5: Astra review follow-ups

**Files:** those named by the review output.

- [ ] **Step 1:** Run `codex exec -m codex/gpt-6-astra -c model_reasoning_effort="high" -s read-only --skip-git-repo-check` against the finished diff and capture findings to `docs/review/astra-YYYY-MM-DD.md`.
- [ ] **Step 2:** Convert each high-severity finding into a task here; do not ship Task 1–4 before they are addressed or explicitly waived.

## Out of scope

- Rewriting the 3D campus, new rooms, new characters.
- Orca run-binding fixes beyond reading the tasks that already arrive in `orcaTasks`.
- Provider quota dashboards (already rendered from `state.quotas`).

---

## Revision 2 — after the Codex Astra (high) review

Full review: `docs/review/astra-2026-11-13.md`. Findings that change this plan:

| Sev | Finding | Where |
|---|---|---|
| P1 | A worker with `workerState=running` renders **Idle**: `isMovingWorker()` accepts running, `workerStatus()` still requires `liveness=live` or a pending dispatch. Tool fallback also promotes a *pending* role to Working and drops its task. | `server.ts:69`, `public/studio-data.js:82` |
| P1 | Direct sessions collapse: `withToolWorkers()` emits one row per tool only when the tool has zero dispatches/children, so two Codex sessions merge and a direct session next to a dispatch disappears. `collectToolActivity()` also aggregates all pids/cwd/newest store into one row that may describe different sessions. | `public/studio.js:415`, `activity.ts:480` |
| P1 | omp children vanish after 60 s: expiry uses the spawn-record timestamp, not the child's execution, and parent output does not refresh it. | `activity.ts:269` |
| P1 | The 132 px Agent tools panel overcommits 720p: rail is 474 px; status 120 + tools 132 + gaps 30 leaves 192 px for board + operations, which need ~205–225 px → 13–33 px overflow into the navigator. | `public/studio.css:533` |
| P2 | Child clicks route to `tool:omp` and lose the child's task; Agent detail and the tools dialog omit `subagents`; synthetic visitors get no `roleTag` (no WORKING/task label on the floor); the headline count excludes unmatched sessions. | `studio.js:471,673`, `hq3d.js:1796` |
| P2 | `OrcaTaskRow.assignee` is dropped; failed `worker-show` lookups are cached forever; `renderDetail()` falls back to `role.model` (shows roster config as a running model); 120 s freshness can present a finished process as working. | `server.ts:165,647`, `studio.js:305`, `activity.ts:320` |
| P3 | `.preferences` needs ~155–165 px but gets 124 px at 720; `.tool-row` gives a 13 px icon a 6 px track (2 px bleed). | `studio.css:1400,994` |

Final task list (supersedes the task headings above where they conflict):

1. **Layout**: left rail scrolls inside its bounds; compact Agent tools below 800 px height; reserve a usable status-list viewport; preferences gets enough height or inner scroll; icon track 13 px. Acceptance: 0 overlaps at 1280×720/1365×768/1440×900, no 0-height headers, `#status-groups` ≥ 96 px.
2. **Status semantics**: one shared rule for `running|starting|pending|dispatched|queued|live`; pending keeps precedence over working-only-tool evidence; tool evidence never overrides a failed/pending dispatch.
3. **Session identity**: split a tool's rows per live pid/session (`sessionId = pid + cwd`), keep omp child ids session-qualified, retry failed `worker-show` lookups instead of caching them, and stop expiring children by spawn age (use last child output or explicit stale state).
4. **Work payload**: provider/model per session (argv → session store → worker-show), task summary, remaining steps (Orca `pending/ready/dispatched/blocked` joined by `assignee`; omp last `todo` result), explicit `null` unknowns.
5. **Highlight UI**: `Working now` strip (task / agent · provider · model / remaining N · next), child detail routing, visitor `roleTag`, counts consistent with the strip.
6. **Astra follow-up + verification**: rerun Astra high on the finished diff, record in `docs/review/astra-2026-11-13.md`, screenshots at three viewports with two concurrent working agents.
