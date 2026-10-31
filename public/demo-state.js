// Demo mode — a deterministic, clearly-labelled simulation of one studio run.
//
// The live floor reads real Orca/CCGS telemetry; on a fresh machine or between
// real runs that floor is empty, which reads as "broken". `/demo` swaps the
// `/state` feed for this scripted loop so the scene, task board, audit feed and
// status chips can be inspected (and screenshotted) without inventing real
// telemetry. Every surface built from this feed is marked simulated in the HUD.

const RUN_ID = 'demo-run';
export const DEMO_CYCLE_MS = 96_000;
export const DEMO_START = Date.UTC(2026, 0, 1, 9, 0, 0);

/** Scripted beats. `hold` is the beat length in ms from the cycle start. */
const BEATS = [
    { hold: 24_000, running: 2, pending: 1, labels: ['Build the ability cooldown into the HUD', 'Cut the lobby draw calls in half'] },
    { hold: 16_000, running: 3, pending: 0, labels: ['Ship the save-game migration', 'Rebuild the sprite atlas as a bindless batch', 'Profile the audio mixer under load'], complete: 1 },
    { hold: 20_000, running: 3, pending: 1, label: 'Pair on the save-game migration', meeting: true },
    { hold: 12_000, running: 2, pending: 0, labels: ['Harden the replay buffer against partial reads', 'Trace the VRAM spike in the lobby scene'], fail: 1 },
    { hold: 12_000, running: 1, pending: 2, labels: ['Tune the camera blend curve'] },
    { hold: 12_000, running: 0, pending: 0, labels: [] }
];

const TASKS = [
    ['Implement save-game serialization for the campaign state', 'running'],
    ['Replace the sprite atlas with a bindless batch', 'running'],
    ['Add a retry policy to the deploy step', 'pending'],
    ['Profile the audio mixer under load', 'completed'],
    ['Validate the migration against a saved replay', 'ready'],
    ['Investigate the VRAM spike on the lobby scene', 'blocked']
];

/** Roles that exist for sure are `roster.agents`; the demo never invents one. */
function pickRoles(roster) {
    const names = (roster?.agents || []).map(a => a.name).filter(Boolean);
    const fallback = ['ai-programmer', 'engine-programmer', 'gameplay-programmer', 'ui-programmer', 'performance-analyst'];
    const pool = names.length >= 5 ? names : fallback;
    return [0, 1, 2, 3, 4, 5].map(i => pool[(i * 3 + 1) % pool.length]);
}

const iso = ms => new Date(ms).toISOString();

export function createDemoFeed(roster) {
    const roles = pickRoles(roster);
    const started = DEMO_START;

    function beatAt(t) {
        let acc = 0;
        for (let i = 0; i < BEATS.length; i++) {
            acc += BEATS[i].hold;
            if (t < acc) return { index: i, start: acc - BEATS[i].hold, beat: BEATS[i] };
        }
        return { index: BEATS.length - 1, start: acc - BEATS[BEATS.length - 1].hold, beat: BEATS[BEATS.length - 1] };
    }

    function tick(now) {
        if (!Number.isFinite(now))
            throw new TypeError('Demo snapshots require a finite timestamp.');
        const elapsed = Math.max(0, now - started);
        const t = elapsed % DEMO_CYCLE_MS;
        const cycle = Math.floor(elapsed / DEMO_CYCLE_MS);
        const { index, start, beat: script } = beatAt(t);

        const tasks = TASKS.map(([title, status], i) => ({ id: `demo-task-${i}`, title, spec: title, status, runId: RUN_ID }));
        const workers = [];
        const events = [];
        const agents = new Map();

        const add = (role, workerState, taskTitle, id, taskId = id) => {
            const dispatchId = `demo-dispatch-${cycle}-${index}-${id}`;
            workers.push({
                dispatchId, taskId: taskId == null ? null : `demo-task-${taskId}`, runId: RUN_ID, workerState, dispatchStatus: workerState === 'pending' ? 'pending' : workerState === 'failed' ? 'failed' : workerState === 'succeeded' ? 'completed' : 'dispatched',
                terminalState: workerState === 'running' ? 'running' : 'exited', terminalHandle: `demo-term-${(id % 3) + 1}`,
                worktreeId: `demo-repo::/demo/wt-${(id % 2) + 1}`, label: role, worktreeName: `wt-${(id % 2) + 1}`,
                taskTitle, taskSpec: taskTitle, liveness: ['failed', 'succeeded'].includes(workerState) ? 'exited' : workerState === 'pending' ? 'queued' : 'live', livenessReason: null,
                nextAction: workerState === 'pending' ? 'await-dispatch' : 'observe', agent: role, model: null, exitCause: null, host: 'demo-box'
            });
            return dispatchId;
        };

        // Collaboration beats put the whole group on one task; every other beat keeps a task per role,
        // so working agents stay at their own desks where the lit screen and pill are easy to read.
        const taskFor = i => script.meeting ? script.label : (script.labels?.[i] || 'Idle hand-off');
        for (let i = 0; i < script.running; i++) add(roles[i], 'running', taskFor(i), i);
        for (let i = 0; i < script.pending; i++) add(roles[3 + i], 'pending', script.labels?.[0] || tasks[2][0], 3 + i);

        const event = (agent, kind, ts) => {
            events.push({ ts: iso(ts), session: RUN_ID, kind, agent });
            const row = agents.get(agent) || { agent, invoked: 0, completed: 0, lastTs: iso(ts) };
            if (kind === 'invoked') row.invoked += 1; else row.completed += 1;
            row.lastTs = iso(ts);
            agents.set(agent, row);
        };

        // Every running role was invoked at the start of this beat; completions
        // and failures are reported part-way through it.
        for (let i = 0; i < script.running; i++) event(roles[i], 'invoked', now - (t - start));
        if (script.complete) {
            const done = now - (t - start) + script.hold / 2;
            if (now > done) {
                add(roles[5], 'succeeded', 'Profile the audio mixer under load', 8, 3);
                event(roles[5], 'completed', done);
            }
        }
        if (script.fail) {
            const failed = now - (t - start) + script.hold / 2;
            if (now > failed) add(roles[5], 'failed', 'Harden the replay buffer against partial reads', 9, null);
        }
        if (script.meeting) event(roles[4], 'invoked', now - 4_000);

        const auditAgents = [...agents.values()].map(a => ({ ...a, active: Math.max(0, a.invoked - a.completed) }));
        const counts = workers.reduce((acc, w) => { acc[w.workerState] = (acc[w.workerState] || 0) + 1; return acc; }, {});

        return {
            ts: now,
            workers,
            demo: true,
            workerScope: { runId: RUN_ID, objective: 'Ship the campaign slice: input, save, audio', startedAt: iso(started), live: script.running > 0, hidden: 0 },
            runs: [{
                id: RUN_ID, objective: 'Ship the campaign slice: input, save, audio', coordinatorHandle: 'demo-term-1',
                createdAt: iso(started), legacy: false, total: workers.length, counts, failed: counts.failed || 0,
                live: workers.filter(w => w.workerState !== 'pending').length, workers
            }],
            terminals: ['demo-term-1', 'demo-term-2', 'demo-term-3'].map((handle, i) => ({ handle, title: i === 0 ? 'campaign / coordinator' : `worker ${i}`, status: i === 0 ? 'running' : 'idle' })),
            worktrees: [1, 2].map(n => ({ name: `wt-${n}`, branch: `demo/slice-${n}`, path: `/demo/wt-${n}` })),
            paseo: [{ id: 'demo-paseo-1', shortId: 'd1', name: roles[0], provider: 'demo', thinking: 'high', status: 'running', cwd: '/demo', created: iso(started) }],
            quotas: [
                { provider: 'anthropic', name: 'Claude Code', kind: 'weekly', user: 'demo', windows: [{ name: '5h', used: 38, remaining: 62, resetsAt: iso(now + 3_600_000) }, { name: 'week', used: 71, remaining: 29, resetsAt: iso(now + 86_400_000) }] },
                { provider: 'openai', name: 'Codex', kind: 'weekly', user: 'demo', windows: [{ name: 'week', used: 54, remaining: 46, resetsAt: iso(now + 172_800_000) }] }
            ],
            kanban: [], kanbanStats: {},
            orcaTasks: tasks,
            audit: { source: 'demo://agent-audit.log', events: events.slice(-40), agents: auditAgents }
        };
    }

    return { tick };
}
