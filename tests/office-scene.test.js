import { test, expect } from 'bun:test';
import roster from '../roster.json';
import { CONFETTI, FLOOR, LOUNGE_CAPACITY, OFFICE_ZONES, celebratesCompletion, marketScreen, quotaSignRows } from '../public/hq3d.js';
import { buildWorld, statusMap } from './fixtures/world.js';

async function office(phase = 'day') {
  const world = await buildWorld(roster, phase);
  world.bursts = [];
  world.burstConfetti = actor => world.bursts.push(actor.id);
  return world;
}

test('idle and working roles sit at their own desk; pending stands at it', async () => {
  const world = await office();
  world.update({ workers: [] }, statusMap({ 'qa-tester': 'working', 'ui-programmer': 'pending' }));
  for (const agent of roster.agents) {
    const actor = world.actors.get(agent.name);
    expect(actor.mode).toBe('desk');
    expect(actor.spot.group).toBe(`desk:${actor.desk.index}`);
  }
  const idle = world.actors.get('ai-programmer');
  expect(idle.spot.seated).toBe(true);
  expect(idle.target.x).toBeCloseTo(idle.desk.seatX);
  expect(idle.target.z).toBeCloseTo(idle.desk.seatZ);
  expect(world.actors.get('qa-tester').spot.seated).toBe(true);
  expect(world.actors.get('ui-programmer').spot.seated).toBe(false);
  // A move within the same desk is a step, not a walk around the floor.
  expect(world.actors.get('ui-programmer').path).toEqual([]);
});

test('roles sharing a task walk to the meeting room along the aisles, one chair each, and return afterwards', async () => {
  const world = await office();
  // The first poll after load places everyone where they are; later changes walk.
  world.update({ workers: [] }, statusMap({}));
  const task = { status: 'working', task: 'Pair on the save-game migration' };
  world.update({ workers: [] }, statusMap({ 'qa-tester': task, 'ui-programmer': task, 'ai-programmer': { status: 'working', task: 'Solo work' } }));
  const a = world.actors.get('qa-tester'), b = world.actors.get('ui-programmer');
  expect(a.mode).toBe('meeting');
  expect(b.mode).toBe('meeting');
  expect(a.spot.key).not.toBe(b.spot.key);
  expect(OFFICE_ZONES.meeting.contains(a.target.x, a.target.z)).toBe(true);
  expect(a.path.length).toBeGreaterThan(3);
  expect(world.actors.get('ai-programmer').mode).toBe('desk');
  world.update({ workers: [] }, statusMap({}));
  expect(a.mode).toBe('desk');
  expect(a.spot.seated).toBe(true);
  expect(a.target.x).toBeCloseTo(a.desk.seatX);
});

test('the lounge holds at most six resting roles, chosen deterministically', async () => {
  const world = await office();
  const done = Object.fromEntries(roster.agents.map(agent => [agent.name, 'completed']));
  world.update({ workers: [] }, statusMap(done));
  const lounging = [...world.actors.values()].filter(actor => actor.mode === 'lounge');
  expect(lounging).toHaveLength(LOUNGE_CAPACITY);
  expect(new Set(lounging.map(actor => actor.spot.key)).size).toBe(LOUNGE_CAPACITY);
  expect(lounging.map(actor => actor.id).sort()).toEqual(roster.agents.map(agent => agent.name).sort().slice(0, LOUNGE_CAPACITY));
  for (const actor of lounging) expect(OFFICE_ZONES.lounge.contains(actor.target.x, actor.target.z)).toBe(true);
  // Everyone else stays at their desk, standing.
  const rest = [...world.actors.values()].filter(actor => actor.desk && actor.mode !== 'lounge');
  expect(rest.every(actor => actor.mode === 'desk' && !actor.spot.seated)).toBe(true);
});

test('confetti and the hop fire only on an observed transition, never for a role already completed at load', async () => {
  const world = await office();
  world.update({ workers: [] }, statusMap({ 'ui-programmer': 'completed' }));
  expect(world.bursts).toEqual([]);
  expect(world.actors.get('ui-programmer').hop).toBe(0);
  world.update({ workers: [] }, statusMap({ 'ui-programmer': 'completed', 'engine-programmer': 'working' }));
  world.update({ workers: [] }, statusMap({ 'ui-programmer': 'completed', 'engine-programmer': 'completed' }));
  expect(world.bursts).toEqual(['engine-programmer']);
  const b = world.actors.get('engine-programmer');
  expect(b.hop).toBe(1);
  // While celebrating it stands at its own desk rather than heading to the lounge.
  expect(b.mode).toBe('desk');
  expect(b.spot.seated).toBe(false);

  expect(celebratesCompletion(null, 'completed')).toBe(false);
  expect(celebratesCompletion('completed', 'completed')).toBe(false);
  expect(celebratesCompletion('failed', 'completed')).toBe(true);
});

test('confetti stays within its piece and lifetime budget', () => {
  expect(CONFETTI.count).toBeLessThanOrEqual(120);
  expect(CONFETTI.life).toBeGreaterThanOrEqual(1);
  expect(CONFETTI.life).toBeLessThanOrEqual(1.5);
});

test('night keeps everyone at their desk — nobody leaves the floor', async () => {
  const world = await office('night');
  const shared = { status: 'working', task: 'Pair on the save-game migration' };
  const entries = Object.fromEntries(roster.agents.map(agent => [agent.name, 'completed']));
  Object.assign(entries, { 'gameplay-programmer': shared, 'qa-tester': shared, 'tools-programmer': 'pending' });
  world.update({ workers: [] }, statusMap(entries));
  for (const agent of roster.agents) {
    const actor = world.actors.get(agent.name);
    expect(actor.mode).toBe('desk');
    expect(actor.spot.group).toBe(`desk:${actor.desk.index}`);
  }
  // Status still decides the pose: the working role is seated, the pending role stands.
  expect(world.actors.get('gameplay-programmer').spot.seated).toBe(true);
  expect(world.actors.get('tools-programmer').spot.seated).toBe(false);
});

test('status cues differ by state: only non-idle agents get a status word', async () => {
  const world = await office();
  world.update({ workers: [] }, statusMap({ 'qa-tester': 'working', 'ui-programmer': 'pending', 'tools-programmer': 'idle' }));
  world.updateRoleTags();
  const tag = id => world.actors.get(id).roleTag;
  expect(tag('qa-tester').dataset.status).toBe('working');
  expect(tag('qa-tester').dataset.word).toBe('1');
  expect(tag('ui-programmer').dataset.word).toBe('1');
  expect(tag('tools-programmer').dataset.word).toBe('0');
});

test('market TV shows NO SIGNAL for offline or empty payloads and formats live values', () => {
  expect(marketScreen(null).signal).toBe(false);
  expect(marketScreen({ ts: 1, btc: null, fearGreed: null, offline: true }).signal).toBe(false);
  expect(marketScreen({ ts: 1, btc: { usd: 66300, change24h: 2 }, fearGreed: null, offline: true }).signal).toBe(false);
  expect(marketScreen({ ts: 1, btc: { usd: 66300.4, change24h: -1.234 }, fearGreed: { value: 71, label: 'Greed' }, offline: false })).toEqual({
    signal: true, price: '$66,300', change: '▼ -1.23% 24H', trend: 'down', fearGreed: '71', mood: 'GREED',
  });
  const partial = marketScreen({ ts: 1, btc: null, fearGreed: { value: 20, label: 'Extreme Fear' }, offline: false });
  expect(partial).toMatchObject({ signal: true, price: '—', fearGreed: '20', mood: 'EXTREME FEAR' });
});

test('quota sign shows the first two providers at their most constrained remaining window', () => {
  expect(quotaSignRows([])).toEqual([]);
  expect(quotaSignRows(undefined)).toEqual([]);
  const rows = quotaSignRows([
    { provider: 'anthropic', windows: [{ name: '5h', remaining: 62 }, { name: 'week', remaining: 29 }] },
    { provider: 'anthropic', windows: [{ name: 'other-account', remaining: 5 }] },
    { provider: 'openai', windows: [{ name: 'week', used: 54, remaining: null }] },
    { provider: 'cursor', windows: [{ name: 'month', remaining: 90 }] },
  ]);
  expect(rows.map(row => [row.name, row.label])).toEqual([['ANTHROPIC', '29%'], ['OPENAI', '46%']]);
  expect(quotaSignRows([{ provider: 'gemini', windows: [] }])[0]).toMatchObject({ name: 'GEMINI', pct: null, label: '—' });
  expect(quotaSignRows([{ provider: 'x', windows: [{ remaining: 140 }] }])[0].label).toBe('100%');
});
