import { describe, test, expect } from 'bun:test';
import { workKind, workSelection, workLines, workingNow, workingItems, workingSummary, agentStatuses, workerStatus, roleWork, campusStatuses, countStatuses } from '../public/studio-data.js';

describe('working-now strip helpers', () => {
    test('kinds and selections: dispatches and omp children get their own detail, sessions their tool', () => {
        expect(workKind({ dispatchId: 'd-1' })).toBe('dispatch');
        expect(workKind({ dispatchId: 'tool:codex:42' })).toBe('tool');
        expect(workKind({ dispatchId: 'omp-child:s1:c2' })).toBe('omp-child');
        expect(workSelection({ dispatchId: 'd-1' })).toBe('worker:d-1');
        expect(workSelection({ dispatchId: 'omp-child:s1:c2', toolId: 'omp' })).toBe('worker:omp-child:s1:c2');
        expect(workSelection({ dispatchId: 'tool:codex:42', toolId: 'codex' })).toBe('tool:codex');
    });
    test('lines never guess: unknown parts read as an em dash, task never blank', () => {
        expect(workLines({ dispatchId: 'tool:omp' })).toEqual({ task: 'tool:omp', who: '— · — · —', count: '—', left: '—' });
        expect(workLines({ dispatchId: 'd', label: 'L', agent: 'codex', provider: null, model: 'gpt-5' }).who).toBe('codex · — · gpt-5');
        expect(workLines({ dispatchId: 'd', taskTitle: 'Fix', remaining: 3 }).left).toBe('remaining: 3 · next: —');
    });
    test('remainingTasks counts only when a task list was reported', () => {
        const w = { dispatchId: 'd', taskTitle: 'T', remainingTasks: ['Next one', 'Later'] };
        expect(workLines(w, true).left).toBe('remaining: 2 · next: Next one');
        expect(workLines({ ...w, remainingTasks: [] }, true).left).toBe('remaining: 0 · next: —');
        expect(workLines({ ...w, remainingTasks: [] }, false).left).toBe('—');
    });
    test('remainingTasks: null is unknown even when tasks are known; detail shows the bare value', () => {
        const w = { dispatchId: 'd', taskTitle: 'T', remainingTasks: null };
        expect(workLines(w, true)).toMatchObject({ left: '—', count: '—' });
        expect(workLines({ ...w, remainingTasks: [] }, true).count).toBe('0');
        expect(workLines({ dispatchId: 'omp-child:s:c', remaining: 3 }).count).toBe('3');
    });
    test('only working items, newest first by first-seen, source order on ties', () => {
        const ws = [
            { dispatchId: 'a', liveness: 'live', workerState: 'running' },
            { dispatchId: 'b', workerState: 'pending' },
            { dispatchId: 'tool:codex:1', liveness: 'live', workerState: 'running' },
            { dispatchId: 'omp-child:s:c', liveness: 'live', workerState: 'running' },
        ];
        const seen = new Map([['a', 1], ['tool:codex:1', 5], ['omp-child:s:c', 1]]);
        expect(workingNow(ws, seen).map(w => w.dispatchId)).toEqual(['tool:codex:1', 'a', 'omp-child:s:c']);
        expect(workingNow(ws).map(w => w.dispatchId)).toEqual(['a', 'tool:codex:1', 'omp-child:s:c']);
    });
});

describe('one working-item count across surfaces', () => {
    const state = { workers: [
        { dispatchId: 'd-1', liveness: 'live', workerState: 'running' },
        { dispatchId: 'tool:codex:42', toolId: 'codex', liveness: 'live', workerState: 'running' },
        { dispatchId: 'omp-child:s1:c2', toolId: 'omp', liveness: 'live', workerState: 'running' },
        { dispatchId: 'tool:claude:7', toolId: 'claude', workerState: 'idle' },
        { dispatchId: 'd-0', workerState: 'succeeded' },
    ] };
    test('dispatch + direct session + omp child are 3 items; idle tool and settled dispatch are not', () => {
        const items = workingItems(state);
        expect(items.map(w => w.dispatchId)).toEqual(['d-1', 'tool:codex:42', 'omp-child:s1:c2']);
        expect(workingSummary(items, 0)).toEqual({ count: 3, sub: '3 items · 2 tools · 0 roles' });
        expect(workingSummary(items.slice(0, 2), 1).sub).toBe('2 items · 1 tool · 1 role');
        expect(workingItems({ runs: [{ workers: state.workers }] })).toHaveLength(3);
    });
});

// Mirrors the studio's computeStatuses: roster roles plus a `worker:` entry per Orca dispatch.
const studioStatuses = (state, roster) => {
    const map = new Map(agentStatuses({ audit: { agents: [], events: [] }, ...state }, roster));
    for (const w of state.workers || [])
        if (workKind(w) === 'dispatch')
            map.set(`worker:${w.dispatchId}`, { ...workerStatus(w), worker: w });
    return map;
};
const surfaces = (state, roster = { agents: [] }) => {
    const statuses = studioStatuses(state, roster), items = workingItems(state), work = roleWork(statuses, items);
    return { items, work, summary: workingSummary(items, work.roleOnly.length), badge: countStatuses(campusStatuses(statuses, items, work.roleOnly)).working };
};

describe('one dispatch is counted once', () => {
    const roster = { agents: [{ name: 'qa-tester' }, { name: 'sound-designer' }] };
    const dispatch = { dispatchId: 'd-1', taskTitle: 'qa-tester: fix replay', liveness: 'live', workerState: 'running' };
    test('a dispatch naming a role is one item; the role annotates it and adds no row or badge', () => {
        const { items, work, summary, badge } = surfaces({ workers: [dispatch] }, roster);
        expect(items).toEqual([dispatch]);
        expect(work.byItem.get('d-1')).toEqual(['qa-tester']);
        expect(work.roleOnly).toHaveLength(0);
        expect(summary).toEqual({ count: 1, sub: '1 item · 0 tools · 0 roles' });
        expect(badge).toBe(1);
    });
    test('a role working outside every item is the only thing the +N roles badge counts', () => {
        const state = { workers: [dispatch], audit: { agents: [{ agent: 'sound-designer', active: 1 }], events: [] } };
        const { items, work, summary, badge } = surfaces(state, roster);
        expect(work.roleOnly.map(([id]) => id)).toEqual(['sound-designer']);
        expect(summary.sub).toBe('1 item · 0 tools · 1 role');
        expect(badge).toBe(items.length + work.roleOnly.length);
    });
    test('one working omp session: header, strip and campus badge all read 1', () => {
        const state = { workers: [{ dispatchId: 'tool:omp:42', toolId: 'omp', liveness: 'live', workerState: 'running' }] };
        const { items, summary, badge } = surfaces(state);
        expect([summary.count, items.length, badge]).toEqual([1, 1, 1]);
    });
});
