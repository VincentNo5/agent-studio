⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
The branch is **not ready to merge**. Tests and the layout audit both pass, but I found five Important problems. The two worst I reproduced with probes: an idle CLI process hides the recorded run, and finished omp children still read as `running`. Two of the others break the plan's "no fabricated data" rule, and two of the deferred items you asked me to triage turn out to show wrong data now.

## Test and audit output

**`bun test`** (exit 0):
```
 155 pass
 0 fail
 2938 expect() calls
Ran 155 tests across 14 files. [1238.00ms]
```
The routes test replaces `Bun.serve` with a stub, so the "Agent Studio on http://127.0.0.1:8787" line in its output is just a log. It does not open a second server.

**`node tests/layout.audit.mjs`** (exit 0):
```
1280×720: 9 painted panels; 6 headings; #status-groups painted height=104.41px; first tool row=20.00px
  Painted panel heights: .agent-status=200.00px, .task-board=136.00px, .tool-activity=68.00px, .operations=40.00px, .detail=314.00px, .live-work=150.00px, .events=124.00px, .navigator=124.00px, .preferences=124.00px
  PASS: panels >=40px; status >=96px; no overlap >2px; tool header and first row fully painted
1365×768: 9 painted panels; 6 headings; #status-groups painted height=154.41px; first tool row=20.00px
  Painted panel heights: .agent-status=248.00px, .task-board=136.00px, .tool-activity=68.00px, .operations=40.00px, .detail=362.00px, .live-work=150.00px, .events=124.00px, .navigator=124.00px, .preferences=124.00px
  PASS: panels >=40px; status >=96px; no overlap >2px; tool header and first row fully painted
1440×900: 9 painted panels; 6 headings; #status-groups painted height=110.20px; first tool row=20.00px
  Painted panel heights: .agent-status=220.00px, .task-board=201.00px, .tool-activity=87.00px, .operations=80.00px, .detail=392.00px, .live-work=220.00px, .events=140.00px, .navigator=140.00px, .preferences=140.00px
  PASS: panels >=40px; status >=96px; no overlap >2px; tool header and first row fully painted
```

## Global Constraints

| Constraint | Result |
|---|---|
| Read-only telemetry | **Met.** No write calls in production code; `writeFileSync` and similar appear only in test fixtures. |
| `/state` additive, TTL 1500 ms | **Met.** Fields were only added (`provider`, `remainingTasks`, `assignee`, `sessions`, `model`, `provider`, `current`, `remaining`). One semantic change: omp child ids now include the session id, which the plan asked for. The cache is still shared and now also handles a clock that goes backwards. |
| No fabricated data | **Not met** (findings 3, 4 and 5). |
| Test count (150+) | **Met:** 155 pass, up from 92 at baseline. |
| Layout audit | **Met** at all three sizes. |
| Collect performance | The tool-activity part (`collectToolActivity`) takes 83–188 ms. A full uncached `/state` takes about 1.5 s, but most of that is outside this diff. |

## Critical
None.

## Important

1. **An idle CLI process hides the recorded run's workers** (`public/studio.js:461-506`, introduced in c09f790).
   - `withToolWorkers` now adds a row for every live process, idle ones included, then sets `workerScope.live = true`.
   - `floorWorkers()` falls back to `runs[0].workers` only when `state.workers` is empty, so those idle rows replace the recorded run's workers.
   - Probe result: one idle `claude` process plus a recorded run gives `before: ["d-rec"]`, `after: ["tool:claude-code:1"]`, `scope.live = true`, working = 0.
   - At baseline, this needed a *working* tool with no owner (old `studio.js:431-432`).
   - On this machine right now there are 11 live sessions, 10 of them idle, so this happens almost all the time. The floor also fills with "IDLE · Claude Code session" visitors.

2. **Finished omp children keep reading as `running`** (`activity.ts`, `consumeOmpRecords`, the `async-result` branch).
   - Settlement is only read from `custom_message`/`async-result` records.
   - In the real session `01a1cc05…`, children the parent waited on settle only inside a `toolResult` from the `wait` tool. Both `review-task-5` and `re-review-task-5` have `<task-result … status="completed">` in the file, yet live `/state` reports them as `state:"running"`.
   - Probe: a spawn record followed by a wait settlement still gives `[["c1","running"]]`.
   - Effect: for up to 60 s while the child's transcript is fresh, a finished child counts as **Working**. After that it stays listed for 10 minutes as a STALE visitor whose detail says State: running.
   - The docstring "Real omp lifecycle" claims this case is handled.

3. **`modelFromArgv` turns prompt text into a model.** This was parked; it should be promoted.
   - Live `/state` right now shows Claude session pid 84127 with `model: "flag;"`. It came from this review's own prompt, `claude -p …can look like a -m flag; …`.
   - Its card would read `Claude Code · claude · flag;`, which breaks "a wrong model is worse than none."
   - Suggested fix: stop scanning after the first non-option token that follows `-p`, or only trust argv for tools whose prompt is not passed inline.

4. **`renderDetail` still falls back to the roster's configured model** (`public/studio.js:311`, `['Model', worker?.model || role?.model]`).
   - Astra flagged this, and the plan says it was folded into the tasks, but it was not fixed.
   - The detail panel can show a configured model as if it were the running one, even though `Provider` beside it reads `—`.

5. **Provider is guessed from the tool when the model is unknown** (`activity.ts`, `providerFor`; `server.ts`, `worker.provider = providerFor(worker.model, worker.agent)`).
   - `providerFor(null, "omp")` returns `"opencode-go"`. The tests at `tests/activity.test.ts:523-524` and `:553` lock this in.
   - The UI hides this guess for synthetic rows (`session.model ? … : null`) but **not** for Orca dispatches. An omp dispatch with no model would show `omp · opencode-go · —`.
   - This machine's real omp models are `claude/…` and `magpie/claude/…`, so that guess would be wrong.
   - It also contradicts `providerOf`'s own comment, "never infer a vendor from an executable or role". The same fallback produces the `codex` vs `openai` mismatch.

## Minor
- **Deferred list triage:**
  - prompt text as `-m` flag → promoted to Important #3;
  - `codex`/`openai` naming → part of Important #5;
  - no store-age check → stays Minor: the omp session join takes the newest of the 8 newest transcripts in the same cwd with no age limit, so a live pid can show an older session's todos;
  - worker-session join not realpath-normalised (`server.ts`, `session.cwd === worker.path`; `studio.js`, `dispatchPaths`) → stays Minor, since the failure is a duplicate row, never a dropped one;
  - role detail hides an empty remaining list → stays Minor: `remainingTasks?.length ? … : null` shows a known `[]` as `—`, the same as unknown;
  - mobile settled dot colour, `new Function` in `mobile.test.js`, plan saying `remainingTasks: string[]` → all stay Minor.
- `tests/routes.test.ts:155` gets `withToolWorkers` by cutting source text between two function names. Moving or renaming `renderWorkers` breaks it silently, and none of its tests cover an idle session alongside a recorded run (finding 1).
- "Working now" is ordered newest first, so a second agent pushes the first one down. Live work is 150 px tall at 1280×720 and the audit doesn't check card visibility. The Review Focus says a second agent must not push the first out of view. I did not measure this.
- `.left-column{pointer-events:auto!important}` (`studio.css`) may now block canvas drag and picking in the gaps between rail panels. Not verified.
- Each collect reads the child-transcript directory of every omp session ever recorded, not just the 8 it parses (deferred as "child-dir stat cost"). It costs little with today's 19 session files.
- Task 6 is unfinished: no Astra re-review appended (this review replaces it, as the ledger notes), no viewport screenshots in `docs/review/`, and no plan checkboxes ticked.

## What's solid
- One "working" rule (`MOVING_STATES`, `isPresent`) is now shared by `server.ts`, `studio-data.js` and `mobile.html`.
- Tool evidence only upgrades roles that are `idle`, and keeps their task text.
- `remainingTasks: null` correctly means "unknown", distinct from `[]`.
- Failed `worker-show` lookups are retried, and empty answers back off.
- omp files are parsed incrementally, with checks for truncation and rewrites.
- Child ids that would point outside their session directory are rejected.
- The `workingItems` / `roleWork` helpers keep the header, strip, status panel and campus counts consistent.
- The unit tests run real logic rather than just matching strings, apart from `ui-contract`'s structural checks.

## Declined to judge (outside the plan)
- The ~1.5 s full `/state` collect: Orca CLI time, not this diff.
- Floor 1–3 status badges always empty: already there before this branch.
- Visual polish of cards and chips: no design spec to judge against.
- Accuracy of Claude Code's provider when it runs through Bedrock or Vertex.
- Mobile layout beyond the shared status rule.
- The 3D scene and WebGL performance: the diff only touches tag text and visibility in `hq3d.js`.
- Paseo agent status handling: unchanged.
- Quota panel behaviour: unchanged.
- Security and allowlist handling in `server.ts`: unchanged.
- Whether showing idle sessions as rows is the right product choice: the plan asks for it.
- The `tool-activity` panel at 68 px instead of 96 px: accepted in the Task 1 re-review.
- Rewrites to `docs/agent-activity.md` and the plan itself.

**Verdict: NOT READY.** Fixing Important #1–#5 should be enough: limit synthetic rows so they don't replace the recorded run, read settlement from `wait` results, harden the argv parsing, drop the `role.model` fallback, and stop guessing a provider for multi-provider tools. The Minor items can follow later.

Nothing in the repo or the running server was changed. My probe scripts are in `/tmp/rv-probe/`.
