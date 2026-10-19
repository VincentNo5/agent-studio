import { describe, test, expect } from 'bun:test';
import { agentStatuses, workerStatus, countStatuses, STATUS_META, STATUS_ORDER, COMPLETED_WINDOW_MS } from '../public/studio-data.js';
const roster = { agents: [{ name: 'qa-tester' }, { name: 'engine-programmer' }, { name: 'sound-designer' }] };
const now = Date.parse('2026-10-19T14:30:00Z');
const at = minutesAgo => new Date(now - minutesAgo * 60000).toISOString();
const worker = (id, fields) => ({ dispatchId: id, taskTitle: `qa-tester: ${id}`, ...fields });
const status = (state, role = 'qa-tester') => agentStatuses({ audit: { agents: [], events: [] }, ...state }, roster, now).get(role);
describe('agent status model', () => {
    test('every status has label, colour, icon and description', () => {
        for (const key of STATUS_ORDER)
            expect(Object.keys(STATUS_META[key]).sort()).toEqual(['color', 'description', 'icon', 'label']);
    });
    test('working beats pending', () => {
        const s = status({ workers: [worker('ctx_pending0001', { dispatchStatus: 'pending' }), worker('ctx_running0001', { workerState: 'running', liveness: 'live' })] });
        expect(s.status).toBe('working');
        expect(s.worker.dispatchId).toBe('ctx_running0001');
        expect(s.evidence).toBe('worker ctx_runnin… · running');
        expect(s.task).toBe('qa-tester: ctx_running0001');
        expect(s.since).toBeNull();
    });
    test('an open audit invocation is working evidence and carries the real invoke time', () => {
        const s = status({ workers: [worker('ctx_pending0001', { dispatchStatus: 'pending' })], audit: { agents: [{ agent: 'qa-tester', active: 1 }], events: [{ ts: at(4), agent: 'qa-tester', kind: 'invoked' }] } });
        expect(s.status).toBe('working');
        expect(s.evidence).toStartWith('audit invoked ');
        expect(s.since).toBe(at(4));
    });
    test('pending beats completed', () => {
        const s = status({ workers: [worker('ctx_done000001', { workerState: 'succeeded', liveness: 'exited' }), worker('ctx_queued00001', { dispatchStatus: 'pending', liveness: 'live' })] });
        expect(s.status).toBe('pending');
        expect(s.evidence).toBe('worker ctx_queued… · pending');
        expect(s.since).toBeNull();
    });
    test('failed beats completed, from worker or dispatch state', () => {
        const s = status({ workers: [worker('ctx_done000001', { workerState: 'succeeded' }), worker('ctx_broke00001', { workerState: 'failed', liveness: 'exited' })] });
        expect(s.status).toBe('failed');
        expect(s.evidence).toBe('worker ctx_broke0… · failed');
        expect(workerStatus({ dispatchId: 'ctx_x', dispatchStatus: 'failed' }).status).toBe('failed');
    });
    test('completed from a settled worker on the floor', () => {
        for (const settled of ['succeeded', 'stopped', 'cancelled']) {
            const s = status({ workers: [worker('ctx_c72df67ffba9', { workerState: settled, liveness: 'exited' })] });
            expect(s.status).toBe('completed');
            expect(s.evidence).toBe(`worker ctx_c72df6… · ${settled}`);
            // No audit completion exists for this role, so no time is invented.
            expect(s.since).toBeNull();
        }
    });
    test('completed from a recent audit event names the source and its timestamp', () => {
        const events = [{ ts: at(40), agent: 'qa-tester', kind: 'invoked' }, { ts: at(12), agent: 'qa-tester', kind: 'completed' }];
        const s = status({ audit: { agents: [{ agent: 'qa-tester', invoked: 1, completed: 1, active: 0 }], events } });
        expect(s.status).toBe('completed');
        expect(s.evidence).toStartWith('audit completed ');
        expect(s.since).toBe(at(12));
        expect(s.lastEvent).toEqual(events[1]);
        expect(s.worker).toBeNull();
    });
    test('stale audit completion falls back to idle', () => {
        const events = [{ ts: new Date(now - COMPLETED_WINDOW_MS - 60000).toISOString(), agent: 'qa-tester', kind: 'completed' }];
        const s = status({ audit: { agents: [{ agent: 'qa-tester', active: 0 }], events } });
        expect(s.status).toBe('idle');
        expect(s.evidence).toBeNull();
        expect(s.since).toBeNull();
        expect(s.lastEvent).toEqual(events[0]);
    });
    test('a later invocation means the last event is not a completion', () => {
        const events = [{ ts: at(10), agent: 'qa-tester', kind: 'completed' }, { ts: at(2), agent: 'qa-tester', kind: 'invoked' }];
        expect(status({ audit: { agents: [{ agent: 'qa-tester', active: 0 }], events } }).status).toBe('idle');
    });
    test('idle when nothing is reported, and every roster role gets an entry', () => {
        const map = agentStatuses({ workers: [] }, roster, now);
        expect([...map.keys()]).toEqual(roster.agents.map(a => a.name));
        for (const s of map.values())
            expect(s).toEqual({ status: 'idle', worker: null, task: null, evidence: null, since: null, lastEvent: null });
    });
    test('only floor-scoped workers count, not run history', () => {
        const state = { workers: [], runs: [{ workers: [worker('ctx_history0001', { workerState: 'running', liveness: 'live' })] }] };
        expect(status(state).status).toBe('idle');
    });
    test('worker status distinguishes queued, live and settled dispatches', () => {
        expect(workerStatus({ dispatchId: 'a', dispatchStatus: 'pending' }).status).toBe('pending');
        expect(workerStatus({ dispatchId: 'a', workerState: 'running', liveness: 'live' }).status).toBe('working');
        expect(workerStatus({ dispatchId: 'a', workerState: 'succeeded', dispatchStatus: 'completed', liveness: 'exited' }).status).toBe('completed');
        expect(workerStatus({ dispatchId: 'a', liveness: 'exited' }).status).toBe('idle');
    });
    test('counts cover every status and accept maps or arrays', () => {
        const counts = countStatuses(new Map([['a', { status: 'working' }], ['b', { status: 'completed' }], ['c', { status: 'idle' }], ['d', { status: 'working' }]]));
        expect(counts).toEqual({ working: 2, completed: 1, pending: 0, failed: 0, idle: 1, total: 4 });
        expect(countStatuses([{ status: 'failed' }]).failed).toBe(1);
    });
});
