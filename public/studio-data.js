// Shared interpretation of the read-only StudioState contract.
export const SETTLED = ['succeeded', 'failed', 'stopped', 'cancelled'];
export const isPresent = w => w.liveness === 'live' || w.dispatchStatus === 'pending';
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
