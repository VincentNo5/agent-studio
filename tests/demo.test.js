import { test, expect } from 'bun:test';
import roster from '../roster.json';
import { agentStatuses } from '../public/studio-data.js';
import { createDemoFeed, DEMO_START, DEMO_CYCLE_MS } from '../public/demo-state.js';

test('demo feed is deterministic and only uses roster roles', () => {
  const feedA = createDemoFeed(roster), feedB = createDemoFeed(roster);
  const now = DEMO_START + 41_000;
  expect(feedA.tick(now)).toEqual(feedB.tick(now));
  const valid = new Set(roster.agents.map(agent => agent.name));
  for (let offset = 0; offset < DEMO_CYCLE_MS; offset += 4_000) {
    const state = feedA.tick(DEMO_START + offset);
    for (const worker of state.workers) expect(valid.has(worker.agent)).toBe(true);
    for (const event of state.audit.events) expect(valid.has(event.agent)).toBe(true);
  }
});

test('demo snapshots require an explicit finite clock', () => {
  const feed = createDemoFeed(roster);
  expect(() => feed.tick()).toThrow('finite timestamp');
  expect(() => feed.tick(Number.NaN)).toThrow('finite timestamp');
});

test('demo worker identities do not change meaning and task references resolve', () => {
  const feed = createDemoFeed(roster);
  const snapshots = [2_000, 26_000, 42_000, 62_000, 74_000].map(offset => feed.tick(DEMO_START + offset));
  const meanings = new Map();
  for (const state of snapshots) {
    const taskIds = new Set(state.orcaTasks.map(task => task.id));
    for (const worker of state.workers) {
      const meaning = `${worker.agent}\0${worker.taskTitle}`;
      if (meanings.has(worker.dispatchId)) expect(meanings.get(worker.dispatchId)).toBe(meaning);
      meanings.set(worker.dispatchId, meaning);
      if (worker.taskId != null) expect(taskIds.has(worker.taskId)).toBe(true);
    }
  }
});

test('demo cycle drives working, pending, completed, failed, idle and a shared-task meeting', () => {
  const feed = createDemoFeed(roster);
  const seen = new Set();
  let meeting = false;
  for (let offset = 0; offset < DEMO_CYCLE_MS; offset += 2_000) {
    const state = feed.tick(DEMO_START + offset);
    for (const entry of agentStatuses(state, roster, DEMO_START + offset).values()) seen.add(entry.status);
    const working = state.workers.filter(worker => worker.workerState === 'running');
    meeting ||= working.some((worker, index) => working.some((other, otherIndex) => otherIndex !== index && other.taskTitle === worker.taskTitle));
  }
  expect([...seen].sort()).toEqual(['completed', 'failed', 'idle', 'pending', 'working']);
  expect(meeting).toBe(true);
});
