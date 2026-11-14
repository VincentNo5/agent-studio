// Shared interpretation of the read-only StudioState contract.
export const SETTLED = ['succeeded', 'failed', 'stopped', 'cancelled'];
export const MOVING_STATES = ['starting', 'running', 'pending', 'dispatched', 'queued'];
export const isPresent = w => w.liveness === 'live' || w.dispatchStatus === 'pending' || MOVING_STATES.includes(w.workerState || '');
export const isWorking = w => isPresent(w) && !SETTLED.includes(w.workerState || '');
export const workerText = w => [w.taskTitle, w.taskSpec, w.label, w.worktreeName, w.agent].filter(Boolean).join(' ').toLowerCase();
export const matchesRole = (w, role) => workerText(w).includes(role.name.toLowerCase());
export function activeRoles(state, roster) {
    const hits = new Set();
    for (const a of state.audit?.agents || [])
        if (a.active > 0)
            hits.add(a.agent);
    for (const w of state.workers || []) {
        if (!isWorking(w))
            continue;
        for (const a of roster.agents)
            if (matchesRole(w, a))
                hits.add(a.name);
    }
    // A named Paseo session alone is not evidence of ongoing work. Retain the
    // old name-matching heuristic, limited to sessions reporting running status.
    for (const a of state.paseo || [])
        if (a.status === 'running') {
            for (const r of roster.agents)
                if ((a.name || '').toLowerCase().includes(r.name.toLowerCase()))
                    hits.add(r.name);
        }
    return hits;
}
// One status per agent, derived only from reported fields. Order is precedence:
// Worker/audit/session working evidence beats pending, pending beats failed,
// failed beats completed. Tool evidence only upgrades idle roles.
export const STATUS_ORDER = ['working', 'pending', 'failed', 'completed', 'idle'];
export const STATUS_META = {
    working: { label: 'Working', color: '#38d9ff', icon: '▶', description: 'A live worker or an open subagent invocation is doing this work now. On the floor: lit, pulsing monitor and a WORKING pill above the agent.' },
    completed: { label: 'Completed', color: '#4fe08f', icon: '✓', description: 'A worker on the floor has settled, or the role finished a subagent run in the last 30 minutes.' },
    pending: { label: 'Pending', color: '#ffb547', icon: '⧗', description: 'A dispatch is queued and has not started work yet. On the floor: dark monitor with an amber blink and a PENDING pill.' },
    failed: { label: 'Failed', color: '#ff5d6c', icon: '!', description: 'The matching worker or dispatch reported a failure.' },
    idle: { label: 'Idle', color: '#7f93a8', icon: '○', description: 'No current work is reported for this agent. On the floor: dimmed body, monitor dark, no pill.' }
};
export const COMPLETED_WINDOW_MS = 30 * 60 * 1000;
const COMPLETED_STATES = ['succeeded', 'stopped', 'cancelled'];
const shortId = id => !id ? 'dispatch' : id.length > 12 ? `${id.slice(0, 10)}…` : id;
const clock = ts => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }); };
/** Status of one Orca dispatch, with the field that proves it. */
export function workerStatus(w) {
    const ws = w?.workerState || '', ds = w?.dispatchStatus || '';
    const evidence = field => `worker ${shortId(w?.dispatchId)} · ${field}`;
    if (COMPLETED_STATES.includes(ws))
        return { status: 'completed', evidence: evidence(ws) };
    if (ws === 'failed' || ds === 'failed')
        return { status: 'failed', evidence: evidence('failed') };
    // A queued dispatch counts as present for following, but it has not started work.
    if (ws === 'pending' || ws === 'queued' || ds === 'pending')
        return { status: 'pending', evidence: evidence('pending') };
    if (isWorking(w))
        return { status: 'working', evidence: evidence(ws || w.liveness || 'live') };
    if (ds === 'completed')
        return { status: 'completed', evidence: evidence('dispatch completed') };
    return { status: 'idle', evidence: evidence(ws || ds || w?.liveness || 'no state') };
}
/** Map<roleName, { status, worker, task, evidence, since, lastEvent }> from floor workers and the audit feed. */
export function agentStatuses(state, roster, now = Date.now()) {
    const out = new Map(), workers = state?.workers || [];
    const audit = new Map((state?.audit?.agents || []).map(a => [a.agent, a]));
    const lastOf = new Map(), lastInvoked = new Map(), lastCompleted = new Map();
    for (const e of state?.audit?.events || []) {
        lastOf.set(e.agent, e);
        (e.kind === 'invoked' ? lastInvoked : lastCompleted).set(e.agent, e);
    }
    for (const role of roster?.agents || []) {
        const name = role.name, lastEvent = lastOf.get(name) || null, activity = audit.get(name);
        const matched = workers.filter(w => matchesRole(w, role)).map(w => ({ w, ...workerStatus(w) }));
        const first = s => matched.find(m => m.status === s);
        const task = m => m?.w.taskTitle || m?.w.label || null;
        const entry = (status, m, evidence, since = null) => out.set(name, { status, worker: m?.w || null, task: task(m), evidence, since, lastEvent });
        const working = first('working');
        if (working) {
            entry('working', working, working.evidence, lastInvoked.get(name)?.ts || null);
            continue;
        }
        if (activity?.active > 0) {
            const invoked = lastInvoked.get(name);
            entry('working', null, invoked ? `audit invoked ${clock(invoked.ts)}` : `audit · ${activity.active} open invocation${activity.active > 1 ? 's' : ''}`, invoked?.ts || null);
            continue;
        }
        const session = (state?.paseo || []).find(a => a.status === 'running' && (a.name || '').toLowerCase().includes(name.toLowerCase()));
        if (session) {
            out.set(name, { status: 'working', worker: null, task: null, evidence: `paseo ${session.name} · running`, since: null, lastEvent });
            continue;
        }
        const settled = first('pending') || first('failed') || first('completed');
        if (settled) {
            entry(settled.status, settled, settled.evidence, settled.status === 'completed' ? lastCompleted.get(name)?.ts || null : null);
            continue;
        }
        const age = lastEvent?.kind === 'completed' ? now - Date.parse(lastEvent.ts) : NaN;
        // The window keeps every role that ever finished from reading as freshly completed.
        if (age >= -60000 && age <= COMPLETED_WINDOW_MS && !(activity?.active > 0)) {
            entry('completed', null, `audit completed ${clock(lastEvent.ts)}`, lastEvent.ts);
            continue;
        }
        out.set(name, { status: 'idle', worker: null, task: null, evidence: null, since: null, lastEvent });
    }
    // Tool activity fills gaps when the Orca floor has no run to scope the worker to.
    // It must not replace a status already established by workers, audit, or sessions.
    for (const tool of state?.tools || []) {
        if (tool.state !== 'working')
            continue;
        for (const entry of tool.agents || []) {
            const current = out.get(entry.role);
            if (current?.status === 'idle')
                out.set(entry.role, { ...current, status: 'working', task: entry.task || current.task, evidence: `tool ${tool.name} · ${tool.evidence || 'writing now'}`, since: tool.lastActivity || null });
        }
    }
    return out;
}
/** Counts per status for any iterable (or Map) of `{ status }` entries. */
export function countStatuses(statuses) {
    const counts = { working: 0, completed: 0, pending: 0, failed: 0, idle: 0, total: 0 };
    for (const s of statuses instanceof Map ? statuses.values() : statuses || []) {
        counts[s.status in counts ? s.status : 'idle']++;
        counts.total++;
    }
    return counts;
}
export function taskBoard(state) {
    const orca = (state.orcaTasks || []).length > 0;
    const tasks = orca ? state.orcaTasks : state.kanban || [];
    const base = orca ? ['pending', 'ready', 'dispatched', 'running', 'blocked', 'completed', 'failed'] : ['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done'];
    const groups = {};
    for (const task of tasks)
        (groups[task.status || (orca ? 'pending' : 'todo')] ||= []).push(task);
    const lanes = [...new Set([...base, ...Object.keys(groups), ...(!orca ? Object.keys(state.kanbanStats || {}) : [])])];
    const counts = Object.fromEntries(lanes.map(lane => [lane, groups[lane]?.length || (!orca ? Number(state.kanbanStats?.[lane]) || 0 : 0)]));
    return { source: orca ? 'Orca' : 'Hermes', tasks, lanes, counts, groups, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}
export async function readJSON(response) {
    if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    if (!/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type') || ''))
        throw new Error('Expected JSON; server returned a different content type');
    return response.json();
}
export async function getJSON(url) {
    return readJSON(await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) }));
}
export function outputBlocks(data, maxBlocks = 200) {
    const out = [];
    if (Array.isArray(data.transcript?.messages) && data.transcript.messages.length) {
        for (const message of data.transcript.messages) {
            const who = message.role === 'assistant' ? data.provider || 'agent' : message.role || 'tool';
            for (const block of message.blocks || []) {
                if (block.type === 'text' && block.text)
                    out.push(`${who} › ${block.text}`);
                else if (block.type === 'tool-call')
                    out.push(`${who} › ${block.name || 'tool'} ${JSON.stringify(block.input || {})}`);
                else if (block.type === 'tool-result')
                    out.push(`  ↳ ${typeof block.output === 'string' ? block.output : JSON.stringify(block.output || '')}`);
            }
        }
        return { lines: out.slice(-maxBlocks), kind: 'transcript', clipped: out.length > maxBlocks || (data.clipping || []).includes('transcript_payload') };
    }
    const tail = data.terminal?.tail || [];
    return { lines: tail.slice(-maxBlocks), kind: tail.length ? 'terminal' : data.source || 'unknown', clipped: !!data.terminal?.truncated || tail.length > maxBlocks };
}
export const floorForRoom = room => ['directors', 'leads', 'engineering', 'design'].includes(room) ? 3 : room === 'lobby' ? 1 : 2;
export const ROOM_COLORS = { directors: 0xf6c884, leads: 0xc7b6ff, engineering: 0x42cafa, design: 0x7aa3ff, art: 0xcc8aff, audio: 0xfaaf6e, narrative: 0x81c8ff, qa: 0x56e6c1, engines: 0x8199ff, community: 0xf3bf75, lobby: 0x42dcff };
export const hash = str => { let h = 2166136261; for (const c of str)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// Live work rows: a synthetic id marks a direct tool session (`tool:`) or an omp task child.
export const workKind = w => { const id = String(w?.dispatchId || ''); return id.startsWith('omp-child:') ? 'omp-child' : id.startsWith('tool:') ? 'tool' : 'dispatch'; };
/** A dispatch or omp child opens its own detail; a direct session opens the tool it runs in. */
export const workSelection = w => workKind(w) === 'tool' ? `tool:${w.toolId}` : `worker:${w.dispatchId}`;
/**
 * The three lines of a working-now card. Unknown parts read `—`; nothing is guessed.
 * Remaining means what is still open after the current task. `remainingTasks: null` (nothing to
 * join tasks on) is unknown; `[]` is zero only when the task list was reported (`tasksKnown`).
 */
export function workLines(w, tasksKnown = false) {
    const dash = v => v == null || v === '' ? '—' : String(v);
    const task = w.taskTitle || w.label || w.dispatchId || 'Unnamed work';
    const titles = Array.isArray(w.remainingTasks) && (tasksKnown || w.remainingTasks.length) ? w.remainingTasks : null;
    const n = titles ? titles.length : typeof w.remaining === 'number' ? w.remaining : null;
    return { task, who: [w.agent, w.provider, w.model].map(dash).join(' · '), count: dash(n), left: n == null ? '—' : `remaining: ${n} · next: ${titles?.[0] || '—'}` };
}
/** Working rows only, newest first by when this browser first saw them; source order breaks ties. */
export function workingNow(workers, firstSeen = new Map()) {
    return (workers || []).map((w, i) => ({ w, i, at: firstSeen.get(w.dispatchId) ?? 0 }))
        .filter(({ w }) => workerStatus(w).status === 'working')
        .sort((a, b) => b.at - a.at || a.i - b.i).map(({ w }) => w);
}
/** The floor's workers: live ones, else the latest recorded run's. */
export const floorWorkers = state => state?.workers?.length ? state.workers : state?.runs?.[0]?.workers || [];
/**
 * Every working item (Orca dispatch, direct tool session, omp child), newest first. The header
 * metric, the Working now strip and the Agent status group all count this one list.
 */
export const workingItems = (state, firstSeen) => workingNow(floorWorkers(state), firstSeen);
/**
 * Working roster roles split by whether a working item already accounts for them. A role lit by
 * the same dispatch as an item is that item's annotation (`byItem`, keyed by dispatchId), not a
 * second row; only `roleOnly` (audit, paseo, tool evidence) adds to the working count.
 */
export function roleWork(statuses, items) {
    const ids = new Set(items.map(w => w.dispatchId).filter(Boolean)), byItem = new Map(), roleOnly = [];
    for (const [id, e] of statuses || []) {
        if (id.startsWith('worker:') || e.status !== 'working')
            continue;
        const w = e.worker;
        if (w && (items.includes(w) || (w.dispatchId && ids.has(w.dispatchId))))
            byItem.set(w.dispatchId, [...(byItem.get(w.dispatchId) || []), id]);
        else
            roleOnly.push([id, e]);
    }
    return { byItem, roleOnly };
}
/** Campus badge input: every settled status, with working replaced by the items plus role-only work. */
export const campusStatuses = (statuses, items, roleOnly) =>
    [...[...(statuses?.values() || [])].filter(e => e.status !== 'working'), ...[...items, ...roleOnly].map(() => ({ status: 'working' }))];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Header metric: the item count, then how many tools those items span and how many roles work outside them. */
export function workingSummary(items, rolesWorking = 0) {
    const tools = new Set(items.filter(w => workKind(w) !== 'dispatch').map(w => w.toolId || w.dispatchId)).size;
    return { count: items.length, sub: `${plural(items.length, 'item')} · ${plural(tools, 'tool')} · ${plural(rolesWorking, 'role')}` };
}
