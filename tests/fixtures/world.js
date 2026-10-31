import * as THREE from 'three';
import { Headquarters } from '../../public/hq3d.js';

// Exercise the real scene builders without a GPU or a browser process.
// Canvas 2D is the only platform dependency of the builders: every drawing call is a no-op.
const gradient = { addColorStop() { } };
const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : key === 'measureText' ? () => ({ width: 10 }) : () => gradient });

export async function buildWorld(roster, phase = 'day') {
    const saved = globalThis.document;
    globalThis.document = {
        createElement: () => ({
            width: 0, height: 0, getContext: () => context, style: { setProperty() { }, }, dataset: {}, className: '', textContent: '',
        }),
    };
    try {
        const world = Object.create(Headquarters.prototype);
        Object.assign(world, { scene: new THREE.Scene(), geometries: new Map(), materials: new Map(), textures: new Set(), staticBatches: new Map(), actors: new Map(), deskSlots: [], pickables: [], roomFloorLabels: new Map(), roleLabels: new Map(), statuses: new Map(), clock: 0, currentPhase: phase, container: { clientWidth: 1440, clientHeight: 900, dataset: {} }, camera: new THREE.PerspectiveCamera(), tagLayer: { style: {}, append() { } } });
        world.architecture();
        await world.setRoster(roster);
        world.makeParticles();
        return world;
    }
    finally {
        globalThis.document = saved;
    }
}

export const statusMap = entries => new Map(Object.entries(entries).map(([id, value]) => [id, typeof value === 'string' ? { status: value } : value]));
