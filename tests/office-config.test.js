import { test, expect } from 'bun:test';
import roster from '../roster.json';
import { DESK, DESK_COUNT, LOUNGE_CAPACITY, LOUNGE_SEATS, MEETING_SEATS, OFFICE_ZONES, deskLayout, deskSlotsForRoster, spareDesks } from '../public/hq3d.js';

test('AI office config includes every required zone and one stable desk per roster role', () => {
  expect(Object.keys(OFFICE_ZONES).sort()).toEqual([
    'corridor', 'director', 'entrance', 'library', 'lounge', 'meeting', 'openDesks', 'pantry', 'reception',
  ]);
  const slots = deskSlotsForRoster(roster);
  expect(slots).toHaveLength(roster.agents.length);
  expect(new Set(slots.map(slot => slot.role))).toEqual(new Set(roster.agents.map(agent => agent.name)));
  expect(new Set(slots.map(slot => slot.index)).size).toBe(slots.length);
  expect(slots.every(slot => OFFICE_ZONES.openDesks.contains(slot.x, slot.z) && OFFICE_ZONES.openDesks.contains(slot.seatX, slot.seatZ))).toBe(true);
  expect(deskSlotsForRoster(roster)).toEqual(slots);
  // Input order does not move anyone.
  expect(deskSlotsForRoster({ ...roster, agents: [...roster.agents].reverse() })).toEqual(slots);
});

test('desks come in pods of four with 26 role desks and six spare hot-desks', () => {
  const desks = deskLayout(), slots = deskSlotsForRoster(roster);
  expect(desks).toHaveLength(DESK_COUNT);
  expect(DESK_COUNT).toBe(32);
  expect(spareDesks(slots)).toHaveLength(DESK_COUNT - roster.agents.length);
  const pods = new Map();
  for (const desk of desks) pods.set(desk.pod, [...(pods.get(desk.pod) || []), desk]);
  for (const pod of pods.values()) expect(pod).toHaveLength(4);
  // Desks never overlap; aisles between pods are at least 1.7 m.
  for (const a of desks) for (const b of desks) {
    if (a === b) continue;
    const overlap = Math.abs(a.x - b.x) < DESK.w - .01 && Math.abs(a.z - b.z) < DESK.d - .01;
    expect(overlap).toBe(false);
  }
  const podX = [...new Set(desks.map(desk => desk.podX))].sort((a, b) => a - b);
  for (let i = 1; i < podX.length; i++) expect(podX[i] - podX[i - 1] - 2 * DESK.w).toBeGreaterThanOrEqual(1.7);
});

test('meeting room seats eight and the lounge seats eight, of which at most six are used', () => {
  expect(MEETING_SEATS).toHaveLength(8);
  expect(MEETING_SEATS.every(seat => OFFICE_ZONES.meeting.contains(seat.x, seat.z))).toBe(true);
  expect(LOUNGE_SEATS).toHaveLength(8);
  expect(LOUNGE_SEATS.every(seat => OFFICE_ZONES.lounge.contains(seat.x, seat.z))).toBe(true);
  expect(LOUNGE_CAPACITY).toBe(6);
});
