import { describe, test, expect } from 'bun:test';
import { workKind, workSelection, workLines, workingNow, workingItems, workingSummary } from '../public/studio-data.js';
import { readFileSync } from 'node:fs';

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
        expect(workLines({ dispatchId: 'tool:omp' })).toEqual({ task: 'tool:omp', who: '— · — · —', left: '—' });
        expect(workLines({ dispatchId: 'd', label: 'L', agent: 'codex', provider: null, model: 'gpt-5' }).who).toBe('codex · — · gpt-5');
        expect(workLines({ dispatchId: 'd', taskTitle: 'Fix', remaining: 3 }).left).toBe('remaining: 3 · next: —');
    });
    test('remainingTasks counts only when a task list was reported', () => {
        const w = { dispatchId: 'd', taskTitle: 'T', remainingTasks: ['Next one', 'Later'] };
        expect(workLines(w, true).left).toBe('remaining: 2 · next: Next one');
        expect(workLines({ ...w, remainingTasks: [] }, true).left).toBe('remaining: 0 · next: —');
        expect(workLines({ ...w, remainingTasks: [] }, false).left).toBe('—');
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
    test('header metric, strip and Agent status group all count workingItems', () => {
        const src = readFileSync(new URL('../public/studio.js', import.meta.url), 'utf8');
        expect(src).toContain('workingSummary(workingItems(state, firstSeen), roleCounts.working)');
        expect(src).toContain('const working = workingItems(state, firstSeen)');
        expect(src).toContain("const items = workingItems(state, firstSeen)");
        expect(src).toMatch(/status === 'working' \? items\.map/);
        expect(src).not.toContain('workingNow(');
    });
});
