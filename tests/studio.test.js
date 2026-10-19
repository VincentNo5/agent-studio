import { describe, test, expect } from 'bun:test';
import { activeRoles, isWorking, taskBoard, readJSON, outputBlocks } from '../public/studio-data.js';
const roster = { agents: [{ name: 'qa-tester' }, { name: 'engine-programmer' }] };
describe('live state interpretation', () => {
    test('settled workers cannot light a role, active audit and working task matches can', () => {
        const state = { workers: [{ liveness: 'live', workerState: 'succeeded', taskTitle: 'engine-programmer' }, { liveness: 'live', workerState: 'running', taskSpec: 'Ask QA-TESTER' }], audit: { agents: [] } };
        expect([...activeRoles(state, roster)]).toEqual(['qa-tester']);
        expect(isWorking({ dispatchStatus: 'pending', workerState: 'cancelled' })).toBe(false);
        state.audit.agents = [{ agent: 'engine-programmer', active: 1 }];
        expect(activeRoles(state, roster).has('engine-programmer')).toBe(true);
    });
    test('Orca owns the task board when tasks exist, preserving extra statuses', () => {
        const board = taskBoard({ orcaTasks: [{ status: 'running' }, { status: 'custom' }], kanbanStats: { running: 8 } });
        expect(board.source).toBe('Orca');
        expect(board.counts.running).toBe(1);
        expect(board.counts.custom).toBe(1);
        expect(taskBoard({ kanban: [], kanbanStats: { todo: 3 } }).counts.todo).toBe(3);
        expect(taskBoard({}).total).toBe(0);
    });
    test('HTML errors are rejected before parsing and successful HTML is rejected too', async () => {
        await expect(readJSON(new Response('<html>Forbidden</html>', { status: 403, headers: { 'content-type': 'text/html' } }))).rejects.toThrow('HTTP 403');
        await expect(readJSON(new Response('<html/>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow('Expected JSON');
        expect(await readJSON(Response.json({ workers: [] }))).toEqual({ workers: [] });
    });
    test('worker output supports transcripts, tails and empty records', () => {
        expect(outputBlocks({ transcript: { messages: [{ role: 'assistant', blocks: [{ type: 'text', text: 'Actual output' }] }] } }, 60).lines.join(' ')).toContain('Actual output');
        expect(outputBlocks({ terminal: { tail: ['one', 'two'] } }, 1).lines).toEqual(['two']);
        expect(outputBlocks({}, 60).lines).toEqual([]);
    });
});
