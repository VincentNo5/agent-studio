import { test, expect } from 'bun:test';
import * as THREE from 'three';
import roster from '../roster.json';
import { DEFAULT_VIEW, FEATURE_WALL, FLOOR, LOUNGE_SEATS, OFFICE_ZONES, SCOREBOARD } from '../public/hq3d.js';
import { buildWorld } from './fixtures/world.js';

const VIEWPORT = { width: 1440, height: 900 };
function defaultCamera() {
    const camera = new THREE.PerspectiveCamera(DEFAULT_VIEW.fov, VIEWPORT.width / VIEWPORT.height, .1, 320);
    camera.position.set(...DEFAULT_VIEW.position);
    camera.lookAt(new THREE.Vector3(...DEFAULT_VIEW.target));
    camera.updateMatrixWorld(true);
    return camera;
}
const screenY = (camera, x, y, z) => (1 - new THREE.Vector3(x, y, z).project(camera).y) / 2 * VIEWPORT.height;

test('every zone is furnished, not just labelled', async () => {
    const world = await buildWorld(roster);
    // Anything standing above the floor slabs and rugs counts; contact shadows do not.
    const pieces = world.placements.filter(p => p.y > .05 && p.material !== 'contact');
    for (const [key, zone] of Object.entries(OFFICE_ZONES)) {
        const inside = pieces.filter(p => zone.contains(p.x, p.z)).length;
        expect({ key, furnished: inside >= 8 }).toEqual({ key, furnished: true });
    }
});

test('the quota repeater hangs on the feature wall, faces the default camera and its numerals stay readable', async () => {
    const world = await buildWorld(roster);
    const board = world.quotaRepeater, camera = defaultCamera();
    expect(board.parent).toBe(world.scene);
    // Mounted flush on the wall's south face, inside the wall's run and below its cap.
    expect(board.position.z).toBeGreaterThan(FEATURE_WALL.z + FEATURE_WALL.t / 2);
    expect(board.position.z).toBeLessThan(FEATURE_WALL.z + FEATURE_WALL.t / 2 + .1);
    expect(board.position.x - SCOREBOARD.w / 2).toBeGreaterThanOrEqual(FEATURE_WALL.x0);
    expect(board.position.x + SCOREBOARD.w / 2).toBeLessThanOrEqual(FEATURE_WALL.x1);
    expect(board.position.y + SCOREBOARD.h / 2).toBeLessThan(FEATURE_WALL.h);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(board.quaternion);
    const toCamera = camera.position.clone().sub(board.position).normalize();
    expect(normal.dot(toCamera)).toBeGreaterThan(.5);
    const { top, bottom } = board.userData.digits;
    // Larger than this and the board starts to dominate the entrance; smaller and the numbers stop reading.
    for (const x of [board.position.x - SCOREBOARD.w / 4, board.position.x + SCOREBOARD.w / 4])
        expect(screenY(camera, x, bottom, board.position.z) - screenY(camera, x, top, board.position.z)).toBeGreaterThanOrEqual(26);
    // The wayfinding band below it is on the same wall and at least 20 px tall in view.
    const way = world.wayfinding;
    expect(way.position.z).toBeGreaterThan(FEATURE_WALL.z);
    expect(screenY(camera, way.position.x, way.position.y - way.scale.y / 2, way.position.z) - screenY(camera, way.position.x, way.position.y + way.scale.y / 2, way.position.z)).toBeGreaterThanOrEqual(20);
    expect(world.scene.children.some(o => o.isSprite)).toBe(false);
});

test('the open south and east edges of the plate are covered by planters or the vestibule', async () => {
    const world = await buildWorld(roster);
    const covered = (x, z) => world.edgeCover.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
    for (let x = FLOOR.minX + .5; x <= FLOOR.maxX - .5; x += .25)
        expect({ x, covered: covered(x, FLOOR.maxZ - .3) }).toEqual({ x, covered: true });
    for (let z = FLOOR.minZ + .5; z <= FLOOR.maxZ - .5; z += .25)
        expect({ z, covered: covered(FLOOR.maxX - .3, z) }).toEqual({ z, covered: true });
});

test('nothing in the south band or overhead hides a seated agent from the default camera', async () => {
    const world = await buildWorld(roster);
    world.scene.updateMatrixWorld(true);
    const camera = defaultCamera();
    const solids = world.scene.children.filter(o => o.isMesh && !o.isInstancedMesh && !o.material.transparent && !o.material.isMeshBasicMaterial);
    const ray = new THREE.Raycaster();
    for (const agent of roster.agents) {
        const head = world.actors.get(agent.name).group.position.clone().add(new THREE.Vector3(0, 1.25, 0));
        const direction = head.clone().sub(camera.position), distance = direction.length();
        ray.set(camera.position, direction.normalize());
        ray.far = distance - .3;
        const blockers = ray.intersectObjects(solids, false).filter(hit => hit.point.z > 2.5 || hit.point.y > 2.2);
        expect({ agent: agent.name, blockers: blockers.length }).toEqual({ agent: agent.name, blockers: 0 });
    }    // Lounge sitters: only their own sofa or chair (within reach of the seat) may sit on the sight line.
    for (const seat of LOUNGE_SEATS) {
        const head = new THREE.Vector3(seat.x, 1.15, seat.z), direction = head.clone().sub(camera.position), distance = direction.length();
        ray.set(camera.position, direction.normalize());
        ray.far = distance - .3;
        const blockers = ray.intersectObjects(solids, false).filter(hit => Math.hypot(hit.point.x - seat.x, hit.point.z - seat.z) > .8);
        expect({ seat: seat.key, blockers: blockers.length }).toEqual({ seat: seat.key, blockers: 0 });
    }
});
