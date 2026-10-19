import { test, expect } from 'bun:test';
import * as THREE from 'three';
import { Headquarters } from '../public/hq3d.js';
import roster from '../roster.json';
// Exercise actual geometry builders without requiring a GPU or a browser process.
// Canvas text is the only platform dependency of the builders.
const context = { fillRect() { }, fillText() { } };
function buildWorld() {
    const saved = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    try {
        const world = Object.create(Headquarters.prototype);
        Object.assign(world, { scene: new THREE.Scene(), geometries: new Map(), materials: new Map(), textures: new Set(), staticBatches: new Map(), actors: new Map(), pickables: [], rings: [], roomSigns: new Map(), floorLabels: [], streams: [], active: new Set() });
        world.architecture();
        world.setRoster(roster);
        world.makeParticles();
        return world;
    }
    finally {
        globalThis.document = saved;
    }
}
test('all 49 roster characters and their stations fit inside their assigned decks', () => {
    const world = buildWorld();
    expect(world.actors.size).toBe(roster.agents.length);
    const structure = world.scene.children.find(m => m.material === world.materials.get('metal'));
    expect(structure).toBeDefined();
    structure.geometry.computeBoundingBox();
    expect(structure.geometry.boundingBox.max.y).toBeGreaterThan(17);
    for (const actor of world.actors.values()) {
        expect(Math.abs(actor.home.x)).toBeLessThan(13);
        expect(Math.abs(actor.home.z)).toBeLessThan(7.9);
        expect([6.08, 12.08]).toContain(actor.home.y);
    }
});
test('polling does not teleport agents and removes visitors no longer on the floor', () => {
    const world = buildWorld(), positions = new Map([...world.actors].map(([id, a]) => [id, a.group.position.clone()]));
    const state = { workers: [{ dispatchId: 'test-dispatch', workerState: 'running', liveness: 'live' }], audit: { events: [] } };
    const board = { source: 'Orca', total: 0, counts: {} };
    world.update(state, new Set(['engine-programmer']), board);
    const visitor = world.actors.get('worker:test-dispatch');
    const before = visitor.group.position.clone();
    world.update(state, new Set(), board);
    expect(visitor.group.position.equals(before)).toBe(true);
    for (const [id, position] of positions)
        expect(world.actors.get(id).group.position.equals(position)).toBe(true);
    world.update({ ...state, workers: [] }, new Set(), board);
    expect(world.actors.has('worker:test-dispatch')).toBe(false);
});
test('character parts are instanced and instance transforms are finite', () => {
    const world = buildWorld();
    world.updateActorInstances();
    // Chibi characters add face, hair and department accessories: ~1.5k parts still collapse
    // to a few dozen instanced draw calls (one per material/geometry pair), not one per part.
    expect(world.actorBatches.length).toBeLessThan(70);
    expect(world.actorBatches.reduce((n, b) => n + b.parts.length, 0)).toBeGreaterThan(600);
    for (const batch of world.actorBatches)
        expect([...batch.mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
});
test('lower-floor camera presets keep every roster agent visible through the open facade', () => {
    const world = buildWorld();
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
