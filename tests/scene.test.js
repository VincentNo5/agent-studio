import { test, expect } from 'bun:test';
import * as THREE from 'three';
import { Headquarters } from '../public/hq3d.js';
import roster from '../roster.json';
// Exercise actual geometry builders without requiring a GPU or a browser process.
// Canvas 2D is the only platform dependency of the builders: every drawing call is a no-op.
const gradient = { addColorStop() { } };
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : key === 'measureText' ? () => ({ width: 10 }) : () => gradient });
async function buildWorld() {
    const saved = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    try {
        const world = Object.create(Headquarters.prototype);
        Object.assign(world, { scene: new THREE.Scene(), geometries: new Map(), materials: new Map(), textures: new Set(), staticBatches: new Map(), actors: new Map(), deskSlots: [], kitTemplates: null, gameTemplates: null, gamePulse: [], beacons: [], kitPromise: Promise.resolve(false), gameKitPromise: Promise.resolve(false), pickables: [], rings: [], roomSigns: new Map(), roomFloorLabels: new Map(), floorLabels: [], streams: [], statuses: new Map(), clock: 0 });
        world.architecture();
        await world.setRoster(roster);
        world.makeParticles();
        return world;
    }
    finally {
        globalThis.document = saved;
    }
}
test('all 49 roster characters and their stations fit inside the single campus floor', async () => {
    const world = await buildWorld();
    expect(world.actors.size).toBe(roster.agents.length);
    expect(world.roomFloorLabels.size).toBe(roster.rooms.length);
    const structure = world.scene.children.find(m => m.material === world.materials.get('metal'));
    expect(structure).toBeDefined();
    structure.geometry.computeBoundingBox();
    expect(structure.geometry.boundingBox.max.y).toBeGreaterThan(4);
    for (const actor of world.actors.values()) {
        expect(Math.abs(actor.home.x)).toBeLessThan(24);
        expect(Math.abs(actor.home.z)).toBeLessThan(17);
        expect(Math.abs(actor.home.y)).toBeLessThan(.2);
    }
});
test('polling does not teleport agents and removes visitors no longer on the floor', async () => {
    const world = await buildWorld(), positions = new Map([...world.actors].map(([id, a]) => [id, a.group.position.clone()]));
    const state = { workers: [{ dispatchId: 'test-dispatch', workerState: 'running', liveness: 'live' }], audit: { events: [] } };
    const board = { source: 'Orca', total: 0, counts: {} };
    world.update(state, new Map([['engine-programmer', { status: 'working' }]]), board);
    const visitor = world.actors.get('worker:test-dispatch');
    const before = visitor.group.position.clone();
    world.update(state, new Map([['engine-programmer', { status: 'completed' }]]), board);
    expect(visitor.group.position.equals(before)).toBe(true);
    for (const [id, position] of positions)
        expect(world.actors.get(id).group.position.equals(position)).toBe(true);
    world.update({ ...state, workers: [] }, new Map(), board);
    expect(world.actors.has('worker:test-dispatch')).toBe(false);
});
test('character parts are instanced and instance transforms are finite', async () => {
    const world = await buildWorld();
    world.updateActorInstances();
    // Chibi characters add face, hair and department accessories: ~1.5k parts still collapse
    // to a few dozen instanced draw calls (one per material/geometry pair), not one per part.
    expect(world.actorBatches.length).toBeLessThan(80);
    expect(world.actorBatches.reduce((n, b) => n + b.parts.length, 0)).toBeGreaterThan(600);
    for (const batch of world.actorBatches)
        expect([...batch.mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
});
test('lower-floor camera presets keep every roster agent visible through the open facade', async () => {
    const world = await buildWorld();
    world.onFloor = () => { };
    world.focusRing = {};
    world.focusLight = {};
    let destination;
    world.fly = (target, position) => { destination = { target, position }; };
    world.scene.updateMatrixWorld(true);
    const decks = world.scene.children.filter(o => o.material === world.materials.get('floor'));
    for (const actor of world.actors.values()) {
        if (actor.home.y > 10)
            continue;
        world.select(actor.id);
        const direction = destination.target.clone().sub(destination.position);
        const ray = new THREE.Raycaster(destination.position, direction.clone().normalize(), 0, direction.length());
        expect(ray.intersectObjects(decks, false).length).toBe(0);
    }
    world.focusFloor(2);
    for (const actor of world.actors.values()) {
        if (actor.home.y > 10)
            continue;
        const target = actor.home.clone().add(new THREE.Vector3(0, 1, 0));
        const direction = target.clone().sub(destination.position);
        const ray = new THREE.Raycaster(destination.position, direction.clone().normalize(), 0, direction.length());
        expect(ray.intersectObjects(decks, false).length).toBe(0);
    }
});
test('status map drives actors, and only an observed transition plays the completion burst', async () => {
    const world = await buildWorld(), board = { source: 'Orca', total: 0, counts: {} };
    const state = { workers: [{ dispatchId: 'queued', dispatchStatus: 'pending' }], audit: { events: [] } };
    world.update(state, new Map([['qa-tester', { status: 'completed' }], ['engine-programmer', { status: 'working' }], ['sound-designer', { status: 'failed' }]]), board);
    expect(world.actors.get('qa-tester').status).toBe('completed');
    expect(world.actors.get('qa-tester').burst).toBe(0);
    expect(world.actors.get('engine-programmer').busy).toBe(true);
    expect(world.actors.get('sound-designer').status).toBe('failed');
    expect(world.actors.get('ai-programmer').status).toBe('idle');
    // A visitor without a map entry falls back to its own reported state.
    expect(world.actors.get('worker:queued').status).toBe('pending');
    world.update(state, new Map([['engine-programmer', { status: 'completed' }]]), board);
    const finished = world.actors.get('engine-programmer');
    expect(finished.status).toBe('completed');
    expect(finished.burst).toBe(1);
    expect(finished.nod).toBe(1);
    expect(world.actors.get('qa-tester').status).toBe('idle');
});
test('status halos, badges, shadows and desk strips are a handful of instanced draws', async () => {
    const world = await buildWorld();
    world.update({ workers: [{ dispatchId: 'live', workerState: 'running', liveness: 'live' }], audit: { events: [] } }, new Map([['qa-tester', { status: 'completed' }]]), { source: 'Orca', total: 0, counts: {} });
    world.updateActorInstances();
    const layer = world.statusLayer, n = world.actors.size;
    expect(world.statusMeshes.length).toBe(5);
    expect(world.statusMeshes.every(m => m.isInstancedMesh)).toBe(true);
    expect(layer.halos.count).toBe(n);
    expect(layer.strips.count).toBe(roster.agents.length);
    const index = id => layer.list.indexOf(world.actors.get(id));
    const badge = id => [0, 1, 2, 3].map(k => layer.badgeAttr.array[index(id) * 4 + k]);
    // Icon cell, opacity, spinner flag, size: working spins, completed is a check, idle has no badge.
    expect(badge('worker:live')[0]).toBe(0);
    expect(badge('worker:live')[2]).toBe(1);
    expect(badge('qa-tester').slice(0, 3)).toEqual([1, 1, 0]);
    expect(badge('ai-programmer')[3]).toBe(0);
    const halo = new THREE.Color();
    layer.halos.getColorAt(index('ai-programmer'), halo);
    expect(halo.getHex()).toBe(0);
    layer.halos.getColorAt(index('qa-tester'), halo);
    expect(halo.g).toBeGreaterThan(halo.r);
    for (const mesh of world.statusMeshes)
        expect([...mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
});
