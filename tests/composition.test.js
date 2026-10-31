import { test, expect } from 'bun:test';
import * as THREE from 'three';
import roster from '../roster.json';
import { AISLE_PENDANTS, DEFAULT_VIEW, DIRECTOR_SEAT, FEATURE_WALL, FLOOR, FLOOR_VIEW, HUD_CLEAR, LOUNGE_PENDANTS, LOUNGE_SEATS, MEETING_SEATS, OFFICE_ZONES, SCOREBOARD, WAYFINDING, deskLayout } from '../public/hq3d.js';
import { buildWorld, statusMap } from './fixtures/world.js';

const VIEWPORT = { width: 1440, height: 900 };
function cameraFor(view) {
    const camera = new THREE.PerspectiveCamera(view.fov, VIEWPORT.width / VIEWPORT.height, .1, 320);
    camera.position.set(...view.position);
    camera.lookAt(new THREE.Vector3(...view.target));
    camera.updateMatrixWorld(true);
    return camera;
}
const toScreen = (camera, x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x + 1) / 2 * VIEWPORT.width, y: (1 - v.y) / 2 * VIEWPORT.height };
};
const clearOfHud = ({ x, y }) => x >= HUD_CLEAR.left && x <= HUD_CLEAR.right && y >= HUD_CLEAR.top && y <= HUD_CLEAR.bottom && (x > HUD_CLEAR.titleRight || y > HUD_CLEAR.titleBottom);
const corners = (zone, inset = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [zone.x + sx * (zone.w / 2 - inset), zone.z + sz * (zone.d / 2 - inset)]);

test('the default camera keeps every desk clear of the HUD and every zone on screen', () => {
    const camera = cameraFor(DEFAULT_VIEW), misses = [], offscreen = [];
    const inView = ({ x, y }) => x >= 0 && x <= VIEWPORT.width && y >= 0 && y <= VIEWPORT.height;
    const check = (label, x, y, z) => { const p = toScreen(camera, x, y, z); if (!inView(p)) offscreen.push(label); };
    const clearCheck = (label, x, y, z) => { const p = toScreen(camera, x, y, z); if (!inView(p)) offscreen.push(label); else if (!clearOfHud(p)) misses.push(label); };
    // Seated agents are the thing being watched: they must never sit under a panel.
    for (const desk of deskLayout())
        clearCheck(`desk ${desk.index}`, desk.seatX, 1.25, desk.seatZ);
    // Glass rooms: the corners facing the camera must be legible; the far corners may graze the panel.
    for (const key of ['director', 'meeting'])
        for (const [x, z] of corners(OFFICE_ZONES[key]))
            for (const y of [0, 2.85])
                (x > OFFICE_ZONES[key].x ? clearCheck : check)(`${key} ${x},${y},${z}`, x, y, z);
    // The north wall stays on screen behind its own title block.
    for (let x = FLOOR.minX; x <= 14; x += 1.5)
        check(`north wall ${x}`, x, 3.4, FLOOR.minZ);
    // South band zones must be in frame; the bottom panel may graze them, as before.
    for (const key of ['library', 'reception', 'lounge', 'pantry'])
        for (const [x, z] of corners(OFFICE_ZONES[key], 1.5))
            check(`${key} ${x},${z}`, x, 0, z);
    expect(offscreen).toEqual([]);
    expect(misses).toEqual([]);
});

test('/floor keeps a closer view than the overview', () => {
    const distance = view => new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...view.target));
    expect(distance(FLOOR_VIEW)).toBeLessThan(distance(DEFAULT_VIEW) * .8);
});

test('the scoreboard sits off the entry axis at the east end of the feature wall; the wordmark leads', async () => {
    const world = await buildWorld(roster);
    const board = world.quotaRepeater, camera = cameraFor(DEFAULT_VIEW);
    const mid = (FEATURE_WALL.x0 + FEATURE_WALL.x1) / 2;
    expect(board.position.x).toBeGreaterThan(mid);
    // Clear of the vestibule's centre line by most of a metre, and within the east third of the wall run.
    expect(board.position.x - SCOREBOARD.w / 2).toBeGreaterThan(.8);
    expect(board.position.x).toBeGreaterThan(FEATURE_WALL.x1 - (FEATURE_WALL.x1 - FEATURE_WALL.x0) / 3);
    // The wordmark is wider on screen than the board, and the board's face is held below full brightness.
    const width = (x0, x1, y, z) => toScreen(camera, x1, y, z).x - toScreen(camera, x0, y, z).x;
    const wordmark = world.wordmark;
    expect(width(wordmark.position.x - wordmark.scale.x / 2, wordmark.position.x + wordmark.scale.x / 2, wordmark.position.y, wordmark.position.z))
        .toBeGreaterThan(width(board.position.x - SCOREBOARD.w / 2, board.position.x + SCOREBOARD.w / 2, board.position.y, board.position.z));
    expect(board.material.color.r).toBeLessThan(.9);
    // The wayfinding band takes the entry axis, low on the wall.
    expect(WAYFINDING.x - WAYFINDING.w / 2).toBeLessThan(0);
    expect(WAYFINDING.x + WAYFINDING.w / 2).toBeGreaterThan(0);
    expect(WAYFINDING.x + WAYFINDING.w / 2).toBeLessThan(board.position.x - SCOREBOARD.w / 2);
});

test('no ceiling fixture hangs over a seated agent', () => {
    const seats = [...deskLayout().map(d => ({ key: `desk:${d.index}`, x: d.seatX, z: d.seatZ })), ...MEETING_SEATS, ...LOUNGE_SEATS, DIRECTOR_SEAT];
    const clearance = 1;
    for (const seat of seats) {
        for (const [x, , z] of LOUNGE_PENDANTS)
            expect({ seat: seat.key, far: Math.hypot(seat.x - x, seat.z - z) >= clearance }).toEqual({ seat: seat.key, far: true });
        for (const x of AISLE_PENDANTS.xs) {
            const dx = Math.max(0, Math.abs(seat.x - x) - AISLE_PENDANTS.length / 2);
            expect({ seat: seat.key, far: Math.hypot(dx, seat.z - AISLE_PENDANTS.z) >= clearance }).toEqual({ seat: seat.key, far: true });
        }
        // The perimeter soffit stays within the back-wall plaster band (1.5 m deep): no seat sits under it.
        expect(seat.z - (FLOOR.minZ + 1.5)).toBeGreaterThan(.3);
        expect(seat.x - (FLOOR.minX + 1.5)).toBeGreaterThan(.3);
    }
});

test('idle agents recede but stay present; working agents keep full colour', async () => {
    const world = await buildWorld(roster);
    world.update({ workers: [] }, statusMap({ 'qa-tester': 'working' }));
    world.batchActors();
    const dim = id => world.actors.get(id).parts[0].userData.dim;
    expect(dim('qa-tester')).toBe(1);
    expect(dim('ai-programmer')).toBeGreaterThanOrEqual(.78);
    expect(dim('ai-programmer')).toBeLessThan(.9);
});
