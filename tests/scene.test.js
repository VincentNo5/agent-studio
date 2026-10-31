import { test, expect } from 'bun:test';
import * as THREE from 'three';
import roster from '../roster.json';
import { DIRECTOR_ID, FLOOR, Headquarters, OFFICE_ZONES } from '../public/hq3d.js';
import { buildWorld } from './fixtures/world.js';

test('every roster role has an actor seated at its own desk, plus the orchestrator in the director office', async () => {
    const world = await buildWorld(roster);
    expect(world.actors.size).toBe(roster.agents.length + 1);
    for (const agent of roster.agents) {
        const actor = world.actors.get(agent.name);
        expect(actor).toBeDefined();
        expect(actor.desk.role).toBe(agent.name);
        expect(actor.spot.seated).toBe(true);
        expect(actor.group.position.x).toBeCloseTo(actor.desk.seatX);
        expect(actor.group.position.z).toBeCloseTo(actor.desk.seatZ);
        expect(OFFICE_ZONES.openDesks.contains(actor.group.position.x, actor.group.position.z)).toBe(true);
    }
    const director = world.actors.get(DIRECTOR_ID).group.position;
    expect(OFFICE_ZONES.director.contains(director.x, director.z)).toBe(true);
    expect(world.roomFloorLabels.size).toBe(roster.rooms.length);
});

test('back walls stand full height and the floor plate stays inside its footprint', async () => {
    const world = await buildWorld(roster);
    const walls = world.scene.children.find(m => m.material === world.materials.get('travertine'));
    walls.geometry.computeBoundingBox();
    expect(walls.geometry.boundingBox.max.y).toBeGreaterThan(3);
    const floor = world.scene.children.find(m => m.material === world.materials.get('oakFloor'));
    floor.geometry.computeBoundingBox();
    expect(floor.geometry.boundingBox.max.x).toBeLessThanOrEqual(FLOOR.maxX + .01);
    expect(floor.geometry.boundingBox.max.z).toBeLessThanOrEqual(FLOOR.maxZ + .01);
});

test('meeting display and quota display hang on real walls, in the scene graph, with no floating billboards', async () => {
    const world = await buildWorld(roster);
    expect(world.marketScreen.parent).toBe(world.scene);
    expect(world.quotaSign.parent).toBe(world.scene);
    const tv = world.marketScreen.position, quota = world.quotaSign.position;
    expect(OFFICE_ZONES.meeting.contains(tv.x, tv.z)).toBe(true);
    // The quota panel is recessed in the back wall behind the desk area, not standing in the open.
    expect(quota.z).toBeLessThan(FLOOR.minZ + 1);
    expect(quota.z).toBeGreaterThan(FLOOR.minZ);
    expect(quota.y).toBeGreaterThan(1);
    expect(world.scene.children.some(o => o.isSprite)).toBe(false);
});

test('polling does not teleport agents and removes visitors no longer on the floor', async () => {
    const world = await buildWorld(roster), positions = new Map([...world.actors].map(([id, a]) => [id, a.group.position.clone()]));
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

test('a busy visitor takes a spare hot-desk, never a desk a roster role owns', async () => {
    const world = await buildWorld(roster);
    world.update({ workers: [{ dispatchId: 'guest', workerState: 'running', liveness: 'live' }] }, new Map(), null);
    const guest = world.actors.get('worker:guest'), owned = new Set(world.deskSlots.map(slot => slot.index));
    expect(guest.deskIndex).not.toBeNull();
    expect(owned.has(guest.deskIndex)).toBe(false);
});

test('the cast is a handful of instanced draws and instance transforms are finite', async () => {
    const world = await buildWorld(roster);
    world.updateActorInstances();
    expect(world.actorBatches.length).toBeLessThanOrEqual(4);
    expect(world.actorBatches.reduce((n, b) => n + b.parts.length, 0)).toBeGreaterThan(20 * roster.agents.length);
    for (const batch of world.actorBatches)
        expect([...batch.mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
});

test('static furniture merges into a few dozen draws', async () => {
    const world = await buildWorld(roster);
    const meshes = world.scene.children.filter(o => o.isMesh && !o.isInstancedMesh);
    expect(meshes.length).toBeLessThan(60);
});

test('selecting an agent flies the camera to a viewpoint above the floor slab', async () => {
    const world = await buildWorld(roster);
    world.onFloor = () => { };
    world.focusRing = {};
    world.focusLight = {};
    let destination;
    world.fly = (target, position) => { destination = { target, position }; };
    world.scene.updateMatrixWorld(true);
    const decks = world.scene.children.filter(o => o.material === world.materials.get('oakFloor'));
    for (const actor of world.actors.values()) {
        world.select(actor.id);
        const direction = destination.target.clone().sub(destination.position);
        const ray = new THREE.Raycaster(destination.position, direction.clone().normalize(), 0, direction.length());
        expect(ray.intersectObjects(decks, false).length).toBe(0);
    }
});

test('status map drives actors, and only an observed transition plays the completion burst', async () => {
    const world = await buildWorld(roster), board = { source: 'Orca', total: 0, counts: {} };
    const state = { workers: [{ dispatchId: 'queued', dispatchStatus: 'pending' }], audit: { events: [] } };
    world.update(state, new Map([['qa-tester', { status: 'completed' }], ['engine-programmer', { status: 'working' }], ['gameplay-programmer', { status: 'failed' }]]), board);
    expect(world.actors.get('qa-tester').status).toBe('completed');
    expect(world.actors.get('qa-tester').burst).toBe(0);
    expect(world.actors.get('engine-programmer').busy).toBe(true);
    expect(world.actors.get('gameplay-programmer').status).toBe('failed');
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
    const world = await buildWorld(roster);
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

test('a zero-size container never poisons the camera projection with NaN', () => {
    const sizes = [];
    const world = Object.create(Headquarters.prototype);
    Object.assign(world, {
        container: { clientWidth: 0, clientHeight: 0 },
        camera: new THREE.PerspectiveCamera(),
        renderer: { setSize: (width, height) => sizes.push(['renderer', width, height]) },
        composer: { setSize: (width, height) => sizes.push(['composer', width, height]) },
        grade: { uniforms: { aspect: { value: 0 } } },
    });
    world.resize();
    expect(world.camera.aspect).toBe(1);
    expect(world.grade.uniforms.aspect.value).toBe(1);
    expect(sizes).toEqual([['renderer', 1, 1], ['composer', 1, 1]]);
});
