import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STATUS_META, hash, workerStatus } from './studio-data.js';

// ---- Floor plan ------------------------------------------------------------------------------
// One 42 × 22 m floor plate, cut away on the south and east edges so the default south-east
// camera looks straight in. Back walls (north, west) are travertine with bronze-framed glazing.
export const FLOOR = Object.freeze({ minX: -21, maxX: 21, minZ: -11.5, maxZ: 10.5 });
const zone = (label, x0, x1, z0, z1) => Object.freeze({ label, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, contains: (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 });
export const OFFICE_ZONES = Object.freeze({
    director: zone("DIRECTOR'S OFFICE", -21, -12.5, -11.5, -4.1),
    meeting: zone('MEETING ROOM', -21, -12.5, -4.1, 3.4),
    openDesks: zone('STUDIO FLOOR', -9.5, 21, -11.5, 3.6),
    library: zone('LIBRARY', -21, -10, 3.6, 10.5),
    corridor: zone('MAIN AISLE', -10, 13, 1.9, 3.6),
    reception: zone('RECEPTION', -10, 4.6, 3.6, 10.5),
    lounge: zone('LOUNGE', 4.6, 13, 3.6, 10.5),
    pantry: zone('PANTRY', 13, 21, 3.6, 10.5),
    entrance: zone('ENTRANCE', -1.6, 1.6, 8.8, 11.4),
});
// The south band is closed by a south-facing feature wall: the plant wall and wordmark (west) are the hero; the
// quota scoreboard sits at the east end, off the entry axis, and the wayfinding band runs low on the axis between them.
export const FEATURE_WALL = Object.freeze({ x0: -9, x1: 4.4, z: 5.3, h: 3.4, t: .3 });
export const SCOREBOARD = Object.freeze({ x: 2.6, y: 2.42, w: 3.3, h: 1.62 });
export const WAYFINDING = Object.freeze({ x: -1.45, y: .64, w: 4.6, h: 1.08 });
// Scoreboard canvas: the percentage glyphs run from `digitTop` to the `digitBase` baseline.
const SCORE_CANVAS = Object.freeze({ w: 1536, h: 754, digitTop: 88, digitBase: 716 });
// Default view: a high three-quarter from the south-east that holds the three glass rooms, the pods and the south
// band inside the window the HUD leaves free (≈240 px on the left, ≈300 px on the right, the title overlay on top).
export const DEFAULT_VIEW = Object.freeze({ target: Object.freeze([-1, 0, 1]), position: Object.freeze([13.44, 36.48, 38.4]), fov: 36 });
// /floor has no side panels on the left: a closer spatial view of the same three-quarter.
export const FLOOR_VIEW = Object.freeze({ target: Object.freeze([1.6, 0, -.6]), position: Object.freeze([17.8, 21.7, 25.7]), fov: 36 });
// The part of a 1440 × 900 frame the HUD leaves open, in px.
export const HUD_CLEAR = Object.freeze({ left: 255, right: 1135, top: 112, bottom: 714, titleRight: 585, titleBottom: 200 });

// Pods of four (2 × 2, back to back). Column gaps are 2.4 m aisles, the rows share a 3 m main aisle.
const POD_X = [-5.4, -.2, 5, 10.2], POD_Z = [-6.6, -.6];
// Teams fill the south row first (nearest the camera); the north-east pod is left for hot-desking.
const POD_ORDER = [[0, 1], [0, 0], [1, 1], [1, 0], [2, 1], [2, 0], [3, 1], [3, 0]];
export const DESK = Object.freeze({ w: 1.4, d: .7, h: .75 });
export const DESK_COUNT = POD_ORDER.length * 4;
// Ceiling fixtures over the open floor: three 5.2 m linear runs along the main aisle, stopping short of the lounge sofa, and a globe cluster over the lounge table.
export const AISLE_PENDANTS = Object.freeze({ z: 4.15, y: 2.95, xs: Object.freeze([-6.6, -1.0, 4.5]), length: 5.2 });
export const LOUNGE_PENDANTS = Object.freeze([[8.2, 2.95, 6.1], [8.7, 2.8, 6.2], [9.15, 3.0, 6.05]].map(Object.freeze));
export const LOUNGE_CAPACITY = 6;
export const DIRECTOR_ID = 'orchestrator';

/** Every desk on the floor: pod `p`, seats 0–1 on the north side (facing south), 2–3 on the south side. */
export function deskLayout(pods = POD_ORDER.length) {
    const desks = [];
    for (let p = 0; p < pods; p++) {
        const [col, row] = POD_ORDER[p] || [POD_X.length + Math.floor((p - POD_ORDER.length) / 2), (p - POD_ORDER.length) % 2];
        const podX = POD_X[col] ?? POD_X[POD_X.length - 1] + (col - POD_X.length + 1) * 5.2, podZ = POD_Z[row];
        for (let s = 0; s < 4; s++) {
            const side = s < 2 ? -1 : 1, x = podX + (s % 2 ? .7 : -.7);
            desks.push({ index: desks.length, pod: p, podX, podZ, side, x, y: 0, z: podZ + side * .35, seatX: x, seatZ: podZ + side * 1.02, heading: side < 0 ? 0 : Math.PI });
        }
    }
    return desks;
}

/** Teams get whole pods; inside a team, alphabetical order keeps every seat stable if roster input order changes. */
export function deskSlotsForRoster(roster) {
    const agents = (roster?.agents || []).filter(agent => agent?.name);
    const rooms = [...new Set(agents.map(agent => agent.room || ''))].sort();
    const teams = rooms.map(room => agents.filter(agent => (agent.room || '') === room).map(agent => agent.name).sort());
    const pods = teams.reduce((n, names) => n + Math.ceil(names.length / 4), 0);
    const desks = deskLayout(Math.max(POD_ORDER.length, pods)), slots = [];
    let pod = 0;
    teams.forEach((names, t) => {
        names.forEach((role, i) => slots.push({ ...desks[pod * 4 + i], role, room: rooms[t] }));
        pod += Math.ceil(names.length / 4);
    });
    return slots;
}

/** Desks no roster role owns: hot-desks for Orca workers that map to no role. */
export function spareDesks(slots) {
    const used = new Set(slots.map(slot => slot.index));
    return deskLayout(Math.max(POD_ORDER.length, Math.ceil((Math.max(-1, ...used) + 1) / 4))).filter(desk => !used.has(desk.index));
}

// ---- Walkable routes -------------------------------------------------------------------------
// Agents never cut through furniture: every spot has an `exit` list that leads out to the spine
// (the west aisle or the south walk), and a route is old exit → spine → new exit reversed.
const WEST_AISLE_X = -11.1, SOUTH_WALK_Z = 2.9, GAP_X = [-8.1, -2.8, 2.4, 7.6, 12.9];
const MEETING_TV = Object.freeze({ x: -16.75, y: 1.6, z: -3.9 });
const pt = (x, z) => ({ x, z });
// Tolerant to the per-person lane offset added to every waypoint.
const onSpine = p => Math.abs(p.x - WEST_AISLE_X) < .35 || Math.abs(p.z - SOUTH_WALK_Z) < .35;
const wrapAngle = a => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export function deskSpot(desk, stance = 'seat') {
    const behind = desk.seatZ + desk.side * .85;
    const gap = GAP_X.reduce((best, x) => Math.abs(x - desk.seatX) < Math.abs(best - desk.seatX) ? x : best);
    const exit = [pt(desk.seatX, behind), pt(gap, behind), pt(gap, SOUTH_WALK_Z)];
    const group = `desk:${desk.index}`;
    if (stance === 'seat')
        return { key: group, group, x: desk.seatX, z: desk.seatZ, heading: desk.heading, seated: true, exit };
    const outward = Math.sign(desk.x - desk.podX) || 1;
    return { key: `${group}:stand`, group, x: desk.seatX + outward * .62, z: desk.seatZ + desk.side * .1, heading: desk.heading, seated: false, exit };
}
const seat = (key, x, z, heading, exit, look = 0) => Object.freeze({ key, group: key, x, z, heading, seated: true, exit, look });
// Meeting chairs face each other across the table; heads turn toward the display on the north wall.
export const MEETING_SEATS = Object.freeze([-1.29, -.43, .43, 1.29].flatMap((dz, i) => [
    seat(`meeting:${i * 2}`, -17.8, -.1 + dz, Math.PI / 2, [pt(-18.6, -.1 + dz), pt(-18.6, 2.6), pt(-13.3, 2.6), pt(WEST_AISLE_X, 2.6)], .75),
    seat(`meeting:${i * 2 + 1}`, -15.7, -.1 + dz, -Math.PI / 2, [pt(-14.9, -.1 + dz), pt(-14.9, 2.6), pt(-13.3, 2.6), pt(WEST_AISLE_X, 2.6)], -.75),
]));
// Lounge seats in fill order: north sofa (faces the camera), both armchairs, then the south sofa. Capacity 8.
// Every exit steps clear of the furniture and leaves north up the lounge's west aisle (x 5.25), past the wall's end.
const LOUNGE = Object.freeze({ x: 8.8, z: 6.2, aisleX: 5.25 });
export const LOUNGE_SEATS = Object.freeze([
    ...[-.75, 0, .75].map((dx, i) => seat(`lounge:${i}`, LOUNGE.x + dx, LOUNGE.z - 1.62, 0, [pt(LOUNGE.x + dx, LOUNGE.z - .82), pt(LOUNGE.aisleX, LOUNGE.z - .82), pt(LOUNGE.aisleX, SOUTH_WALK_Z)])),
    seat('lounge:3', 6.12, LOUNGE.z, Math.PI / 2, [pt(6.82, LOUNGE.z), pt(6.82, LOUNGE.z - .82), pt(LOUNGE.aisleX, LOUNGE.z - .82), pt(LOUNGE.aisleX, SOUTH_WALK_Z)]),
    seat('lounge:4', 11.48, LOUNGE.z, -Math.PI / 2, [pt(10.78, LOUNGE.z), pt(10.78, LOUNGE.z - .82), pt(LOUNGE.aisleX, LOUNGE.z - .82), pt(LOUNGE.aisleX, SOUTH_WALK_Z)]),
    ...[0, -.75, .75].map((dx, i) => seat(`lounge:${5 + i}`, LOUNGE.x + dx, LOUNGE.z + 1.62, Math.PI, [pt(LOUNGE.x + dx, LOUNGE.z + .82), pt(LOUNGE.aisleX, LOUNGE.z + .82), pt(LOUNGE.aisleX, SOUTH_WALK_Z)])),
]);
export const DIRECTOR_SEAT = seat('director', -16.75, -9.7, 0, [pt(-15.1, -9.7), pt(-15.1, -5.5), pt(-13.3, -5.5), pt(WEST_AISLE_X, -5.5)]);
// Visitors with no hot-desk wait at reception, facing the desk, and leave round the west end of the feature wall.
const RECEPTION_EXIT_X = -9.6;
const corridorSpot = i => {
    const x = -8.4 + (i % 5) * .8, z = 7.45 + Math.floor(i / 5) * .8;
    return { key: `corridor:${i}`, group: null, x, z, heading: Math.PI, seated: false, exit: [pt(RECEPTION_EXIT_X, z), pt(RECEPTION_EXIT_X, SOUTH_WALK_Z)] };
};

/** Waypoints from one spot to another along the aisles. Points on the west aisle and the south walk meet at one corner. */
export function routeBetween(fromExit, toExit) {
    const back = [...toExit].reverse(), a = fromExit[fromExit.length - 1], b = back[0];
    const westA = Math.abs(a.x - WEST_AISLE_X) < .35, westB = Math.abs(b.x - WEST_AISLE_X) < .35;
    const points = [...fromExit, ...(westA !== westB ? [pt(WEST_AISLE_X, SOUTH_WALK_Z)] : []), ...back];
    return points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > .01);
}

export function phaseForShanghai(value = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const hour = Number(parts.find(part => part.type === 'hour')?.value || 12);
    if (hour >= 7 && hour < 17)
        return 'day';
    if ((hour >= 5 && hour < 7) || (hour >= 17 && hour < 20))
        return 'dusk';
    return 'night';
}

/** Only an observed transition into `completed` celebrates; the first status an actor reports never does. */
export function celebratesCompletion(previous, next) {
    return next === 'completed' && previous != null && previous !== 'completed';
}

/** Wall-sign rows: the first two providers in feed order, each with its most constrained remaining window. */
export function quotaSignRows(quotas) {
    const rows = [];
    for (const quota of quotas || []) {
        const name = String(quota?.provider || quota?.name || '').trim();
        if (!name || rows.some(row => row.key === name.toLowerCase()))
            continue;
        let remaining = null;
        for (const window of quota.windows || []) {
            const value = Number.isFinite(window?.remaining) ? window.remaining : Number.isFinite(window?.used) ? 100 - window.used : null;
            if (value != null)
                remaining = remaining == null ? value : Math.min(remaining, value);
        }
        const pct = remaining == null ? null : Math.round(Math.max(0, Math.min(100, remaining)));
        rows.push({ key: name.toLowerCase(), name: name.toUpperCase(), pct, label: pct == null ? '—' : `${pct}%` });
        if (rows.length === 2)
            break;
    }
    return rows;
}

/** TV copy for a `/market` payload. A missing payload, `offline: true` or two empty sources all read NO SIGNAL. */
export function marketScreen(data) {
    if (!data || data.offline || (!data.btc && !data.fearGreed))
        return { signal: false };
    const btc = data.btc && Number.isFinite(data.btc.usd) ? data.btc : null, fg = data.fearGreed && Number.isFinite(data.fearGreed.value) ? data.fearGreed : null;
    const change = btc && Number.isFinite(btc.change24h) ? btc.change24h : null;
    return {
        signal: true,
        price: btc ? `$${Math.round(btc.usd).toLocaleString('en-US')}` : '—',
        change: change == null ? '24H —' : `${change >= 0 ? '▲ +' : '▼ '}${change.toFixed(2)}% 24H`,
        trend: change == null ? 'flat' : change >= 0 ? 'up' : 'down',
        fearGreed: fg ? String(Math.round(fg.value)) : '—',
        mood: fg ? String(fg.label || 'Unknown').toUpperCase() : 'UNAVAILABLE',
    };
}

export const CONFETTI = Object.freeze({ count: 120, life: 1.2, gravity: 9.5 });

// ---- Lighting looks --------------------------------------------------------------------------
// `stepPhase()` eases every value toward the active look each frame.
const look = (sky, fog, values) => ({ sky0: new THREE.Color(sky[0]), sky1: new THREE.Color(sky[1]), sky2: new THREE.Color(sky[2]), fog: new THREE.Color(fog), ...values });
const PHASE_LOOKS = {
    day: look([0xaab6bd, 0xc9c6bd, 0x8d877c], 0xc4beb3, { density: .0022, key: 2.15, hemi: .44, rim: .22, environment: .26, interior: .1, warmth: 0, exposure: 1.0, glow: 0, strips: .5 }),
    dusk: look([0x25304a, 0x9d7466, 0x6a5149], 0x5f5a62, { density: .0034, key: 1.15, hemi: .55, rim: .45, environment: .22, interior: .65, warmth: .5, exposure: 1.05, glow: .35, strips: 1.6 }),
    night: look([0x03060c, 0x0a111d, 0x101825], 0x0a0f18, { density: .0045, key: .1, hemi: .13, rim: .14, environment: .06, interior: 1, warmth: .85, exposure: 1.02, glow: 1, strips: 2.6 }),
};
const PHASE_SCALARS = ['density', 'key', 'hemi', 'rim', 'environment', 'interior', 'warmth', 'exposure', 'glow', 'strips'];
const PHASE_COLORS = ['sky0', 'sky1', 'sky2', 'fog'];
const _warm = new THREE.Color(0xffa45a);
// Restrained grade, applied in linear light before tone mapping: warm highlights, cool shadows, a slightly deeper low end
// and an exposure falloff toward the frame edges. Saturated pixels (status cyan/amber/green/red, signage) are left alone.
export const GRADE = Object.freeze({ vignette: .24, split: .05, depth: .09 });
const GradeShader = {
    uniforms: { tDiffuse: { value: null }, vignette: { value: GRADE.vignette }, split: { value: GRADE.split }, depth: { value: GRADE.depth }, aspect: { value: 1.6 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float split; uniform float depth; uniform float aspect; varying vec2 vUv;
void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, vec3(.2126, .7152, .0722));
    float hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b));
    float neutral = 1.0 - smoothstep(.3, .65, (hi - lo) / max(hi, 1e-4));
    float t = smoothstep(.04, .5, l);
    vec3 tint = mix(vec3(1.0 - split, 1.0, 1.0 + split * 1.3), vec3(1.0 + split, 1.0, 1.0 - split * 1.2), t);
    c.rgb *= mix(vec3(1.0), tint, neutral);
    c.rgb *= mix(1.0 - depth, 1.0, smoothstep(.0, .3, l));
    vec2 d = (vUv - .5) * vec2(aspect / 1.6, 1.0) * 2.0;
    c.rgb *= 1.0 - vignette * smoothstep(.45, 1.6, dot(d, d));
    gl_FragColor = c;
}`,
};
// Status colours come from the same table as the HUD chips, converted to linear space.
const STATUS_COLORS = Object.fromEntries(Object.entries(STATUS_META).map(([key, meta]) => [key, new THREE.Color(meta.color)]));
const BADGE_INDEX = { working: 0, completed: 1, pending: 2, failed: 3, idle: 4 }, BADGE_CELLS = 6;
const SCREEN_GAIN = { working: 1, pending: .55, failed: .5, completed: .38, idle: .14 };
const _matrix = new THREE.Matrix4(), _position = new THREE.Vector3(), _scale = new THREE.Vector3(), _color = new THREE.Color(), _quat = new THREE.Quaternion(), _ice = new THREE.Color(0xdff6ff);
const _spin = new THREE.Quaternion(), _euler = new THREE.Euler(), _screen = new THREE.Vector3(), _failRed = new THREE.Color(1, .32, .3);
// Facing roughly toward the default camera (south-east); completed agents turn this way to celebrate.
const CAMERA_HEADING = .62;

// People: skin, hair, trousers and shoes come from the role's hash; the top carries the role hue.
const SKIN = [0xf1d1b6, 0xe2b691, 0xc79470, 0x9b6a48, 0x6e4a33];
const HAIR = [0x1e1b18, 0x3a2a20, 0x5f4330, 0x9a7a52, 0x8b8784, 0x2b2420];
const PANTS = [0x2c3036, 0x3c4150, 0x5a5247, 0x23262b, 0x6b675f];
const SHOES = [0x1b1b1d, 0xe7e2d8, 0x55392a, 0x2d2f33];
const EYE = 0x1a1716;
const POSE_KEYS = ['hipY', 'lean', 'thighL', 'thighR', 'kneeL', 'kneeR', 'shXL', 'shXR', 'abdL', 'abdR', 'elL', 'elR', 'headP', 'headY'];
const _stand = Object.fromEntries(POSE_KEYS.map(key => [key, 0])), _sit = Object.fromEntries(POSE_KEYS.map(key => [key, 0]));
const blend = (key, k) => _stand[key] + (_sit[key] - _stand[key]) * k;

const SPEECH_GENERIC = [
    'Shipping beats perfect.', 'The build is green. Suspicious.', 'I found the bug. It was me.',
    'One more commit and we ship.', 'I need five more minutes.', 'This is fine. Probably.',
    'Who moved my semicolon?', 'The tests pass locally.', 'I have a theory about this.',
    'Coffee first, then refactor.'
];
const SPEECH_VISITORS = [
    'Just passing through.', 'I brought snacks.', 'Is this the engine room?',
    'I am only here for the coffee.', 'Do not mind me.'
];
const SPEECH_ROLES = {
    'ai-programmer': ['The pathfinding is learning to cut corners.', 'My NPCs are becoming self-aware.'],
    'analytics-engineer': ['I found a metric nobody asked for.', 'The dashboard is lying, gently.'],
    'devops-engineer': ['It works on my machine. That is the problem.', 'The pipeline is green. For now.'],
    'engine-programmer': ['I shaved 0.2ms off the frame.', 'The renderer and I have an understanding.'],
    'gameplay-programmer': ['The jump feels 4% too floaty.', 'I turned the fun knob up to eleven.'],
    'network-programmer': ['Latency is just spice.', 'The packet loss is a feature.'],
    'performance-analyst': ['The profiler says it is the profiler.', 'Sixty frames or it did not happen.'],
    'qa-tester': ['I broke it. You are welcome.', 'I found an edge case in the edge case.'],
    'security-engineer': ['I trust no input.', 'That is not a bug, it is an exploit.'],
    'tools-programmer': ['I built a tool to avoid this meeting.', 'The build script has feelings now.'],
    'ui-programmer': ['The button is one pixel off.', 'The hover state is load-bearing.'],
    'godot-csharp-specialist': ['C# in Godot? Bold.', 'The signals are strong with this one.'],
    'godot-gdextension-specialist': ['I live in the extension layer.', 'Native code, native problems.'],
    'godot-gdscript-specialist': ['GDScript is fine. Mostly.', 'Tabs, not spaces. Obviously.'],
    'godot-shader-specialist': ['One more shader pass.', 'The normals are lying again.'],
    'godot-specialist': ['Godot says hello.', 'The scene tree is balanced today.'],
    'unity-addressables-specialist': ['Everything is an asset.', 'The addressables are addressable.'],
    'unity-dots-specialist': ['Data-oriented. Feelings-oriented.', 'The entities are behaving.'],
    'unity-shader-specialist': ['One more shader pass.', 'The specular is doing something.'],
    'unity-specialist': ['The scene is not dirty.', 'Unity and I have reached an accord.'],
    'unity-ui-specialist': ['The UI is pixel perfect. Trust me.', 'Canvas scaling is a lifestyle.'],
    'ue-blueprint-specialist': ['Blueprints are just visual C++.', 'The node graph is load-bearing.'],
    'ue-gas-specialist': ['Gameplay ability: procrastinate.', 'The ability system has abilities.'],
    'ue-replication-specialist': ['It is only a race condition if they notice.', 'Replicate all the things.'],
    'ue-umg-specialist': ['UMG: U Must Grind.', 'The widget hierarchy is a mood.'],
    'unreal-specialist': ['Unreal says hello.', 'The engine is warm today.']
};
const ROLE_SHORT = {
    'ai-programmer': 'AI', 'gameplay-programmer': 'GAMEPLAY', 'engine-programmer': 'ENGINE',
    'network-programmer': 'NETWORK', 'security-engineer': 'SECURITY', 'tools-programmer': 'TOOLS',
    'ui-programmer': 'UI', 'analytics-engineer': 'ANALYTICS', 'devops-engineer': 'DEVOPS',
    'performance-analyst': 'PERF', 'qa-tester': 'QA',
    'godot-csharp-specialist': 'GODOT C#', 'godot-gdextension-specialist': 'GODOT EXT',
    'godot-gdscript-specialist': 'GODOT SCRIPT', 'godot-shader-specialist': 'GODOT SHADER',
    'godot-specialist': 'GODOT', 'unity-addressables-specialist': 'UNITY ADDR',
    'unity-dots-specialist': 'UNITY DOTS', 'unity-shader-specialist': 'UNITY SHADER', 'unity-specialist': 'UNITY', 'unity-ui-specialist': 'UNITY UI', 'unreal-specialist': 'UNREAL',
    'ue-blueprint-specialist': 'UE BLUEPRINT', 'ue-gas-specialist': 'UE GAS',
    'ue-replication-specialist': 'UE REPL', 'ue-umg-specialist': 'UE UMG'
};
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace', SANS = '"Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif';

export class Headquarters {
    constructor(container, { onSelect = () => { }, onFPS = () => { }, onFloor = () => { }, onStats = () => { }, phase = 'auto', view = 'overview' } = {}) {
        this.view = view === 'floor' ? FLOOR_VIEW : DEFAULT_VIEW;
        this.container = container;
        this.onSelect = onSelect;
        this.onFPS = onFPS;
        this.onFloor = onFloor;
        this.onStats = onStats;
        this.dprCap = Math.min(devicePixelRatio, 1.65);
        this.dpr = this.dprCap;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xd4d0c8, .0022);
        this.camera = new THREE.PerspectiveCamera(this.view.fov, 1, .1, 320);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(this.dpr);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // The composer renders several passes per frame; count them all, reset once per frame.
        this.renderer.info.autoReset = false;
        this.renderer.domElement.setAttribute('aria-label', 'Interactive three-dimensional studio headquarters. Drag to orbit, scroll to zoom. Select agents using the roster panel.');
        this.renderer.domElement.setAttribute('tabindex', '0');
        container.append(this.renderer.domElement);
        this.tagLayer = document.createElement('div');
        this.tagLayer.className = 'role-tag-layer';
        container.append(this.tagLayer);
        this.speechLayer = document.createElement('div');
        this.speechLayer.className = 'speech-layer';
        this.speechLayer.setAttribute('aria-live', 'polite');
        this.speechBubble = document.createElement('div');
        this.speechBubble.className = 'speech-bubble';
        this.speechBubble.setAttribute('role', 'status');
        this.speechLayer.append(this.speechBubble);
        container.append(this.speechLayer);
        this.speechActor = null;
        this.speechTimer = null;
        this.lastSpeech = '';
        const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
        this.environmentTarget = pmrem.fromScene(environment, .04);
        this.scene.environment = this.environmentTarget.texture;
        this.scene.environmentIntensity = .42;
        environment.dispose();
        pmrem.dispose();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = .065;
        this.controls.minDistance = 9;
        this.controls.maxDistance = 80;
        this.controls.minPolarAngle = .35;
        this.controls.maxPolarAngle = Math.PI * .44;
        this.controls.maxTargetRadius = 16;
        this.controls.enablePan = true;
        this.onControlStart = () => { this.flight = null; };
        this.controls.addEventListener('start', this.onControlStart);
        this.geometries = new Map();
        this.materials = new Map();
        this.textures = new Set();
        this.staticBatches = new Map();
        this.actors = new Map();
        this.deskSlots = [];
        this.pickables = [];
        this.roomFloorLabels = new Map();
        this.roleLabels = new Map();
        this.hovered = null;
        this.low = false;
        this.particles = true;
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.floor = 0;
        this.statuses = new Map();
        this.lastEvent = null;
        this.pulse = 0;
        this.clock = 0;
        this.lights();
        this.architecture();
        this.sky();
        this.setPhase(phase);
        this.flushStatics();
        this.makeParticles();
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        // Bloom only catches values above 1: neon, signage and ceiling strips. Lit surfaces and screens stay below it.
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .38, .4, 1.25);
        this.composer.addPass(this.bloom);
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
        this.composer.addPass(new OutputPass());
        // The selection ring is neutral ice, outside the status halo, so it never hides the status colour.
        this.focusRing = this.ring(0, 0, 0, .62, .018, this.mat('selection', 0xdff6ff, { emissive: 1.6 }));
        this.focusRing.visible = false;
        this.focusLight = new THREE.PointLight(0xfff1df, 4, 4);
        this.scene.add(this.focusLight);
        this.focusLight.visible = false;
        this.ray = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerDown = e => { this.down = [e.clientX, e.clientY]; };
        this.pointerUp = e => { if (!this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5)
            return; this.pick(e); };
        this.hoverHandler = e => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
            this.ray.setFromCamera(this.pointer, this.camera);
            const hit = this.ray.intersectObjects(this.pickables)[0];
            const id = hit?.object.userData.actorId || null;
            if (id !== this.hovered) {
                this.hovered = id;
                this.updateRoleTags();
            }
        };
        this.leaveHandler = () => { this.hovered = null; this.updateRoleTags(); };
        this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
        this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
        this.renderer.domElement.addEventListener('pointermove', this.hoverHandler);
        this.renderer.domElement.addEventListener('pointerleave', this.leaveHandler);
        this.keyHandler = e => { if (e.key === 'Home') {
            e.preventDefault();
            this.reset();
        } };
        this.renderer.domElement.addEventListener('keydown', this.keyHandler);
        this.resizeHandler = () => this.resize();
        addEventListener('resize', this.resizeHandler);
        this.visibilityHandler = () => { this.lastFrame = performance.now(); if (!document.hidden && !this.frame)
            this.frame = requestAnimationFrame(t => this.animate(t)); };
        document.addEventListener('visibilitychange', this.visibilityHandler);
        this.resize();
        this.reset(true);
        this.lastFrame = performance.now();
        this.fpsStart = this.lastFrame;
        this.frames = 0;
        this.time = 0;
        this.frame = requestAnimationFrame(t => this.animate(t));
    }
    // ---- Primitives -----------------------------------------------------------------------------
    mat(name, color, { metal = 0, rough = .62, emissive = 0, opacity = 1, map = null, env = 1, physical = null } = {}) {
        if (!this.materials.has(name)) {
            // `physical` adds sheen (upholstery) or clearcoat/specular (glass) without a transmission pass.
            const Material = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
            const material = new Material({ color, metalness: metal, roughness: rough, emissive: emissive ? color : 0, emissiveIntensity: emissive, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide, map, ...physical });
            material.envMapIntensity = env;
            material.name = name;
            this.materials.set(name, material);
        }
        return this.materials.get(name);
    }
    geo(name, create) { if (!this.geometries.has(name))
        this.geometries.set(name, create()); return this.geometries.get(name); }
    mesh(geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, parent = this.scene, batched = true) {
        const obj = new THREE.Mesh(geo, mat);
        obj.position.set(x, y, z);
        obj.scale.set(sx, sy, sz);
        if (batched) {
            obj.updateMatrix();
            this.batchGeometry(geo, mat, obj.matrix);
        }
        else {
            obj.castShadow = mat.opacity === 1;
            obj.receiveShadow = true;
            parent.add(obj);
        }
        return obj;
    }
    batchGeometry(geo, mat, matrix) {
        // Footprint log: lets tests check every zone is furnished and nothing in the south band hides an agent.
        (this.placements ||= []).push({ x: matrix.elements[12], y: matrix.elements[13], z: matrix.elements[14], material: mat.name || '' });
        const list = this.staticBatches.get(mat) || [];
        list.push((geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix));
        this.staticBatches.set(mat, list);
    }
    // Static furniture with a local frame (rotated chairs, sofas, lamps) still merges into the material batches.
    batchGroup(x, y, z, ry, build) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        group.rotation.y = ry;
        build((geo, mat, px, py, pz, sx, sy, sz, rx = 0, rz = 0, rry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.rotation.set(rx, rry, rz); group.add(m); });
        group.updateMatrixWorld(true);
        for (const m of group.children)
            this.batchGeometry(m.geometry, m.material, m.matrixWorld);
    }
    canvasTexture(width, height, paint) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        paint(canvas.getContext('2d'), width, height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textures.add(texture);
        return texture;
    }
    // Soft elliptical contact shadow, merged under furniture and instanced under people.
    contactMaterial() {
        if (!this.materials.has('contact')) {
            const map = this.canvasTexture(128, 128, c => { const g = c.createRadialGradient(64, 64, 2, 64, 64, 63); g.addColorStop(0, 'rgba(0,0,0,.82)'); g.addColorStop(.45, 'rgba(0,0,0,.5)'); g.addColorStop(.8, 'rgba(0,0,0,.14)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
            this.materials.set('contact', new THREE.MeshBasicMaterial({ color: 0x000000, map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        }
        return this.materials.get('contact');
    }
    contact(x, z, w, d, y = .004) { this.mesh(this.geo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.contactMaterial(), x, y, z, w, 1, d); }
    box(x, y, z, w, h, d, mat, parent = this.scene, batched = true) { return this.mesh(this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat, x, y, z, w, h, d, parent, batched); }
    cyl(x, y, z, r, h, mat, batched = true, parent = this.scene) { return this.mesh(this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20)), mat, x, y, z, r, h, r, parent, batched); }
    ring(x, y, z, r, t, mat) {
        const m = this.mesh(this.geo(`ring${r}:${t}`, () => new THREE.TorusGeometry(r, t, 6, 64)), mat, x, y, z, 1, 1, 1, this.scene, false);
        m.rotation.x = Math.PI / 2;
        m.castShadow = false;
        return m;
    }
    flushStatics() { for (const [mat, parts] of this.staticBatches) {
        const geo = mergeGeometries(parts);
        parts.forEach(g => g.dispose());
        if (geo) {
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = !mat.transparent && mat.opacity === 1 && !(mat.emissiveIntensity > .5) && !mat.userData.noShadow;
            m.receiveShadow = !mat.isMeshBasicMaterial;
            this.scene.add(m);
        }
    } this.staticBatches.clear(); }
    // ---- Procedural textures ------------------------------------------------------------------
    // Deterministic noise so the floor and walls never change between loads.
    rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
    // Oak planks: per-board tone, grain and dark joints; the matching bump map sinks the joints.
    oakTexture() {
        const rows = 8, rowH = 128, layout = [];
        const rnd = this.rng(7), tones = ['#c39f6e', '#b48f5f', '#cfae7f', '#bd9866', '#a98656', '#c8a675', '#b99463', '#d2b385'];
        for (let row = 0; row < rows; row++) {
            let x = -Math.floor(rnd() * 380);
            while (x < 1024) {
                const len = 300 + Math.floor(rnd() * 260);
                layout.push({ x, y: row * rowH, len, tone: tones[Math.floor(rnd() * tones.length)], seed: Math.floor(rnd() * 1e6) });
                x += len;
            }
        }
        const map = this.canvasTexture(1024, 1024, g => {
            for (const board of layout) {
                g.fillStyle = board.tone;
                g.fillRect(board.x, board.y, board.len, rowH);
                const r = this.rng(board.seed);
                for (let i = 0; i < 22; i++) {
                    const yy = board.y + 6 + r() * (rowH - 12), xx = board.x + r() * board.len;
                    g.strokeStyle = i % 3 ? 'rgba(96,66,36,.14)' : 'rgba(255,244,222,.14)';
                    g.lineWidth = i % 4 ? 1.2 : 2.4;
                    g.beginPath();
                    g.moveTo(xx - 220, yy);
                    g.bezierCurveTo(xx - 70, yy - 5, xx + 80, yy + 5, xx + 240, yy);
                    g.stroke();
                }
                // A soft sheen gradient across each board breaks up the flat colour field.
                const sheen = g.createLinearGradient(board.x, 0, board.x + board.len, 0);
                sheen.addColorStop(0, 'rgba(0,0,0,.05)');
                sheen.addColorStop(.5, 'rgba(255,255,255,.04)');
                sheen.addColorStop(1, 'rgba(0,0,0,.06)');
                g.fillStyle = sheen;
                g.fillRect(board.x, board.y, board.len, rowH);
            }
            g.fillStyle = 'rgba(62,42,22,.62)';
            for (const board of layout) {
                g.fillRect(board.x, board.y, 5, rowH);
                g.fillRect(board.x, board.y + rowH - 5, board.len, 5);
            }
        });
        const bump = this.canvasTexture(1024, 1024, g => {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, 1024, 1024);
            g.fillStyle = '#000';
            for (const board of layout) {
                g.fillRect(board.x, board.y, 6, rowH);
                g.fillRect(board.x, board.y + rowH - 6, board.len, 6);
            }
        });
        bump.colorSpace = THREE.NoColorSpace;
        return { map, bump };
    }
    noiseTexture(size, base, specks, seed) {
        return this.canvasTexture(size, size, g => {
            const rnd = this.rng(seed);
            g.fillStyle = base;
            g.fillRect(0, 0, size, size);
            for (let i = 0; i < specks.count; i++) {
                const r = specks.min + rnd() * (specks.max - specks.min);
                g.fillStyle = rnd() > .5 ? specks.dark : specks.light;
                g.beginPath();
                g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
                g.fill();
            }
        });
    }
    // Vein-cut travertine: horizontal bedding, open pores and block joints.
    travertineTexture() {
        return this.canvasTexture(512, 512, g => {
            const rnd = this.rng(19);
            g.fillStyle = '#e2d5c0';
            g.fillRect(0, 0, 512, 512);
            for (let i = 0; i < 60; i++) {
                const y = rnd() * 512, h = 1 + rnd() * 7;
                g.fillStyle = rnd() > .45 ? `rgba(176,150,112,${(.12 + rnd() * .16).toFixed(2)})` : 'rgba(255,250,238,.3)';
                g.fillRect(0, y, 512, h);
            }
            for (let i = 0; i < 520; i++) {
                g.fillStyle = `rgba(120,98,70,${(.18 + rnd() * .25).toFixed(2)})`;
                g.fillRect(rnd() * 512, rnd() * 512, 1.5 + rnd() * 7, 1 + rnd() * 1.6);
            }
            // Stone joints, so the walls read as cut blocks rather than paint.
            g.fillStyle = 'rgba(120,100,76,.35)';
            g.fillRect(0, 0, 512, 2);
            g.fillRect(0, 0, 2, 512);
        });
    }
    feltTexture() {
        return this.noiseTexture(256, '#5d6b57', { count: 5200, min: .5, max: 1.2, dark: 'rgba(40,48,38,.45)', light: 'rgba(132,146,120,.35)' }, 23);
    }
    carpetTexture() {
        // 0.6 m carpet tiles laid quarter-turned: alternate tiles shift tone so the field has a visible grid.
        return this.canvasTexture(256, 256, g => {
            const rnd = this.rng(5);
            for (let ty = 0; ty < 2; ty++)
                for (let tx = 0; tx < 2; tx++) {
                    const horizontal = (tx + ty) % 2 === 0;
                    g.fillStyle = horizontal ? '#646565' : '#5a5c5d';
                    g.fillRect(tx * 128, ty * 128, 128, 128);
                    for (let i = 0; i < 520; i++) {
                        g.fillStyle = rnd() > .5 ? 'rgba(40,42,44,.4)' : 'rgba(140,140,136,.25)';
                        g.fillRect(tx * 128 + rnd() * 128, ty * 128 + rnd() * 128, horizontal ? 4 : 1, horizontal ? 1 : 4);
                    }
                }
            g.fillStyle = 'rgba(30,30,32,.35)';
            for (const v of [0, 128]) {
                g.fillRect(v, 0, 1, 256);
                g.fillRect(0, v, 256, 1);
            }
        });
    }
    rugTexture() {
        // Hand-tufted rug: deep terracotta field, a bone border and a tonal inner line.
        return this.canvasTexture(512, 512, g => {
            g.fillStyle = '#e4d6bf';
            g.fillRect(0, 0, 512, 512);
            g.fillStyle = '#8e4e33';
            g.fillRect(26, 26, 460, 460);
            g.strokeStyle = 'rgba(232,206,170,.55)';
            g.lineWidth = 4;
            g.strokeRect(52, 52, 408, 408);
            const rnd = this.rng(31);
            for (let i = 0; i < 2600; i++) {
                g.fillStyle = rnd() > .5 ? 'rgba(60,28,16,.22)' : 'rgba(200,120,84,.18)';
                g.fillRect(30 + rnd() * 452, 30 + rnd() * 452, 1.5, 1.5);
            }
        });
    }
    screenTexture() {
        return this.canvasTexture(256, 160, g => {
            g.fillStyle = '#0c1216';
            g.fillRect(0, 0, 256, 160);
            g.fillStyle = 'rgba(255,255,255,.08)';
            g.fillRect(0, 0, 54, 160);
            const rnd = this.rng(3);
            for (let i = 0; i < 15; i++) {
                g.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,.95)' : 'rgba(220,230,236,.55)';
                g.fillRect(66 + (i % 3) * 8, 14 + i * 9, 40 + rnd() * 130, 3);
            }
            for (let i = 0; i < 8; i++) {
                g.fillStyle = 'rgba(255,255,255,.35)';
                g.fillRect(10, 14 + i * 16, 32, 4);
            }
        });
    }
    // ---- Palette ------------------------------------------------------------------------------
    palette() {
        if (this.P)
            return this.P;
        // Material hierarchy: each surface differs in roughness, metalness and relief, not only in colour.
        const repeat = (texture, x, y) => { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(x, y); texture.anisotropy = 8; return texture; };
        const oak = this.mat('oakFloor', 0xe6dbcd, { rough: .46, env: .7 });
        const oakMaps = this.oakTexture();
        oak.map = repeat(oakMaps.map, 14, 8);
        oak.bumpMap = repeat(oakMaps.bump, 14, 8);
        oak.bumpScale = 1.4;
        const carpet = this.mat('carpet', 0xe2e2e2, { rough: 1, env: .2 });
        carpet.map = repeat(this.carpetTexture(), 18.8, 11.2);
        const travertine = this.mat('travertine', 0xffffff, { rough: .93, env: .45 });
        travertine.map = repeat(this.travertineTexture(), 3, 1);
        travertine.bumpMap = travertine.map;
        travertine.bumpScale = .9;
        const glass = this.mat('glass', 0xcfe2de, { rough: .03, opacity: .2, env: 2.4, physical: { clearcoat: 1, clearcoatRoughness: .04, ior: 1.52, specularIntensity: 1 } });
        glass.emissive.setHex(0xffc58a);
        glass.userData.glowScale = .1;
        const frost = this.mat('frost', 0xf4f2ec, { rough: .85, opacity: .6 });
        frost.emissive.setHex(0xffd7a8);
        frost.userData.glowScale = .12;
        const strip = this.mat('lightStrip', 0xfff1dc, { emissive: 1 });
        strip.userData.stripScale = 1;
        const shade = this.mat('lampShade', 0xf3ead9, { rough: .9, emissive: 0 });
        shade.emissive.setHex(0xffc98e);
        shade.userData.stripScale = .55;
        this.windowGlowMaterials = [glass, frost];
        this.stripMaterials = [strip, shade];
        const felt = this.mat('felt', 0xffffff, { rough: 1, env: .15 });
        felt.map = repeat(this.feltTexture(), 2, 2);
        felt.bumpMap = felt.map;
        felt.bumpScale = 1.2;
        const rug = this.mat('rugDark', 0xffffff, { rough: 1, env: .2 });
        rug.map = this.rugTexture();
        rug.map.anisotropy = 8;
        const upholstery = { sheen: 1, sheenRoughness: .55, sheenColor: new THREE.Color(0xfff4e6) };
        const P = this.P = {
            oak, carpet, travertine, glass, frost, strip, shade, felt,
            plinth: this.mat('plinth', 0x2c2926, { rough: .7 }),
            bronze: this.mat('bronze', 0x3a2c22, { metal: .9, rough: .32, env: 1.8 }),
            brass: this.mat('brass', 0xc9a264, { metal: 1, rough: .24, env: 2.2 }),
            desk: this.mat('deskTop', 0xece8df, { rough: .5 }),
            charcoal: this.mat('charcoal', 0x2e3033, { metal: .35, rough: .45 }),
            fabric: this.mat('chairFabric', 0x3a3c40, { rough: .9 }),
            device: this.mat('device', 0x1b1d20, { metal: .4, rough: .35 }),

            walnut: this.mat('walnut', 0x5e3f2a, { rough: .4, env: 1.1 }),
            oakJoinery: this.mat('oakJoinery', 0xbf9a68, { rough: .5 }),
            plaster: this.mat('plaster', 0xf1ede6, { rough: .9 }),
            leaf: this.mat('leaf', 0x587a4c, { rough: .78 }),
            leafDark: this.mat('leafDark', 0x34503a, { rough: .85 }),

            sofa: this.mat('sofa', 0xd6cbb8, { rough: .92, env: .5, physical: upholstery }),
            sage: this.mat('sageVelvet', 0x6f8a68, { rough: .9, env: .5, physical: upholstery }),
            rug: this.mat('rug', 0xbfb29d, { rough: 1, env: .3 }),
            rugDark: rug,
            ceramic: this.mat('ceramic', 0xf1eee7, { rough: .45 }),
        };
        // Shared stand-ins keep the material count, and so the draw count, low.
        P.keys = P.linen = P.ceramic;
        P.pot = P.travertine;
        const bookA = this.mat('bookA', 0x7d8b78, { rough: .8 }), bookB = this.mat('bookB', 0xb79a6c, { rough: .8 });
        P.books = [bookA, bookB, bookB, bookA];
        // Floors, rugs and small trim add nothing visible to the shadow map; skip them as casters.
        for (const m of [oak, carpet, P.rug, P.rugDark, P.plinth, P.brass, P.ceramic, bookA, bookB, P.plaster, shade])
            m.userData.noShadow = true;
        return P;
    }
    // ---- Lighting & sky -----------------------------------------------------------------------
    lights() {
        this.hemi = new THREE.HemisphereLight(0xe9eef4, 0x7a6e60, 1.05);
        this.scene.add(this.hemi);
        this.key = new THREE.DirectionalLight(0xffe7c9, 2.6);
        this.key.position.set(-13, 30, 11);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(2048, 2048);
        Object.assign(this.key.shadow.camera, { left: -25, right: 25, top: 21, bottom: -21, near: 1, far: 80 });
        this.key.shadow.bias = -.00035;
        this.key.shadow.normalBias = .025;
        this.key.shadow.radius = 3;
        this.scene.add(this.key);
        this.rim = new THREE.DirectionalLight(0xd3e1ff, .4);
        this.rim.position.set(18, 14, 20);
        this.scene.add(this.rim);
        // Warm pools that carry the evening look: director, meeting, lounge, pantry and the open floor.
        this.interiorLights = [
            [-16.75, 2.9, -7.8, 0xffd3a1, 16, 9], [-16.75, 2.9, -.2, 0xffe1bd, 16, 9],
            [8.8, 2.6, 6.2, 0xffc58c, 14, 8], [17, 2.6, 6.8, 0xffc890, 14, 8], [2.6, 3.1, -3.6, 0xffe6c4, 26, 16],
        ].map(([x, y, z, color, intensity, distance]) => {
            const light = new THREE.PointLight(color, intensity, distance, 2);
            light.position.set(x, y, z);
            light.userData.baseIntensity = intensity;
            light.userData.baseDistance = distance;
            light.userData.baseColor = new THREE.Color(color);
            this.scene.add(light);
            return light;
        });
    }
    sky() {
        // One gradient dome whose three stops are uniforms, so phase changes cross-fade without texture swaps.
        this.scene.background = null;
        this.skyUniforms = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
        this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
            uniforms: this.skyUniforms,
            vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying float vY; void main(){ vec3 c = vY > .0 ? mix(mid, top, smoothstep(.0, .7, vY)) : mix(bottom, mid, smoothstep(-.5, .0, vY)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
            side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
        }));
        this.skyDome.renderOrder = -10;
        this.skyDome.frustumCulled = false;
        this.scene.add(this.skyDome);
    }
    setPhase(mode = 'auto') {
        this.phaseMode = ['auto', 'day', 'dusk', 'night'].includes(mode) ? mode : 'auto';
        const phase = this.phaseMode === 'auto' ? phaseForShanghai() : this.phaseMode;
        if (phase === this.currentPhase)
            return;
        const first = !this.currentPhase;
        this.currentPhase = phase;
        if (this.container)
            this.container.dataset.phase = phase;
        this.phaseTarget = PHASE_LOOKS[phase];
        this.phaseSettling = true;
        // The first look is applied at once; every later change eases in over ~1.5 s.
        if (first)
            this.stepPhase(0, true);
        if (this.state)
            this.update(this.state, this.statuses, this.lastBoard);
    }
    stepPhase(dt, instant = false) {
        const now = this.phaseNow ||= { ...PHASE_LOOKS.day, sky0: PHASE_LOOKS.day.sky0.clone(), sky1: PHASE_LOOKS.day.sky1.clone(), sky2: PHASE_LOOKS.day.sky2.clone(), fog: PHASE_LOOKS.day.fog.clone() };
        const target = this.phaseTarget, k = instant ? 1 : 1 - Math.exp(-dt * 2.2);
        let delta = 0;
        for (const key of PHASE_SCALARS) {
            const d = target[key] - now[key];
            now[key] += d * k;
            delta = Math.max(delta, Math.abs(d));
        }
        for (const key of PHASE_COLORS)
            now[key].lerp(target[key], k);
        if (instant || delta < .002) {
            for (const key of PHASE_SCALARS)
                now[key] = target[key];
            for (const key of PHASE_COLORS)
                now[key].copy(target[key]);
            this.phaseSettling = false;
        }
        this.skyUniforms?.top.value.copy(now.sky0);
        this.skyUniforms?.mid.value.copy(now.sky1);
        this.skyUniforms?.bottom.value.copy(now.sky2);
        if (this.scene.fog) {
            this.scene.fog.color.copy(now.fog);
            this.scene.fog.density = now.density;
        }
        if (this.groundShadow)
            this.groundShadow.material.opacity = .3 + now.glow * .25;
        if (this.key)
            this.key.intensity = now.key;
        if (this.hemi)
            this.hemi.intensity = now.hemi;
        if (this.rim)
            this.rim.intensity = now.rim;
        this.scene.environmentIntensity = now.environment;
        // Night keeps a few warm pools: the fixtures shift toward amber and lose reach.
        for (const light of this.interiorLights || []) {
            light.intensity = light.userData.baseIntensity * now.interior;
            light.distance = light.userData.baseDistance * (1 - now.warmth * .25);
            light.color.copy(light.userData.baseColor).lerp(_warm, now.warmth * .5);
        }
        if (this.renderer)
            this.renderer.toneMappingExposure = now.exposure;
        const pool = this.materials.get('pendantPool');
        if (pool)
            pool.opacity = .14 + now.glow * .4;
        // The reception wordmark is backlit: a soft halo by day, blooming at night.
        this.wordmark?.material.color.setScalar(1.5 + now.glow * .4);
        for (const material of this.windowGlowMaterials || [])
            material.emissiveIntensity = now.glow * (material.userData.glowScale ?? 1);
        for (const material of this.stripMaterials || [])
            material.emissiveIntensity = now.strips * (material.userData.stripScale ?? 1);
    }
    // ---- Architecture ---------------------------------------------------------------------------
    architecture() {
        this.officeZones = OFFICE_ZONES;
        const P = this.palette(), { minX, maxX, minZ, maxZ } = FLOOR, W = maxX - minX, D = maxZ - minZ, cz = (minZ + maxZ) / 2;
        // Plinth and a soft ground shadow so the cutaway reads as a model sitting on the backdrop.
        this.box(0, -.36, cz, W + .3, .7, D + .3, P.plinth);
        this.box(0, -.01, cz, W, .02, D, P.oak);
        const groundMap = this.canvasTexture(256, 256, c => { const g = c.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.6, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 256); });
        this.groundShadow = new THREE.Mesh(this.geo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0, map: groundMap, transparent: true, opacity: .3, depthWrite: false, fog: false }));
        this.groundShadow.position.set(1.5, -.72, cz + 1.5);
        this.groundShadow.scale.set(W * 1.55, 1, D * 1.8);
        this.scene.add(this.groundShadow);
        // Floor hierarchy: slate carpet tiles under the pods, oak planks through the south band, travertine in the arrival hall.
        this.box(2.4, .004, -3.6, 22.6, .012, 13.4, P.carpet);
        this.box(0, .005, 7.95, 7.2, .012, 5.1, P.travertine);
        for (const [x, z, w, d] of [[2.4, -10.3, 22.6, .03], [2.4, 3.1, 22.6, .03], [-8.9, -3.6, .03, 13.4], [13.7, -3.6, .03, 13.4], [-3.6, 7.95, .03, 5.1], [3.6, 7.95, .03, 5.1]])
            this.box(x, .012, z, w, .006, d, P.brass);
        this.edgeCover = [];
        this.walls(P);
        this.ceiling(P);
        this.directorOffice(P);
        this.meetingRoom(P);
        this.deskArea(P);
        this.library(P);
        this.lounge(P);
        this.pantry(P);
        this.northWall(P);
        this.reception(P);
        this.vestibule(P);
        this.aislePendants(P);
        this.loungePendants(P);
        this.roomsClock(P);
        this.windowPlanters(P);
        this.zonePlaques();
    }
    // Back walls only: travertine piers with full-height bronze-framed glazing. South and east stay open.
    walls(P) {
        const { minX, maxX, minZ, maxZ } = FLOOR, h = 3.4, t = .32;
        const run = (axis, fixed, from, to) => {
            const length = to - from, bays = Math.round(length / 4.2), bay = length / bays;
            for (let i = 0; i <= bays; i++) {
                const c = from + i * bay;
                if (axis === 'x')
                    this.box(c, h / 2, fixed, .9, h, t, P.travertine);
                else
                    this.box(fixed, h / 2, c, t, h, .9, P.travertine);
                if (i === bays)
                    break;
                const mid = c + bay / 2, span = bay - .9;
                const put = (a, y, b, w, hh, d, m) => axis === 'x' ? this.box(a, y, b, w, hh, d, m) : this.box(b, y, a, d, hh, w, m);
                put(mid, h / 2, fixed, span, h - .3, .03, P.glass);
                put(mid, .12, fixed, span, .24, t * .8, P.travertine);
                put(mid, h - .1, fixed, span, .2, t * .8, P.travertine);
                for (let m = 0; m <= 2; m++)
                    put(c + .45 + m * span / 2, h / 2, fixed, .05, h - .3, .07, P.bronze);
                put(mid, 2.35, fixed, span, .05, .07, P.bronze);
            }
        };
        run('x', minZ - t / 2 + .02, minX, maxX);
        run('z', minX - t / 2 + .02, minZ, maxZ);
        // A thin bronze edge on the open sides reads as the section cut through the facade.
        this.box(0, .02, maxZ + .02, maxX - minX, .05, .06, P.bronze);
        this.box(maxX + .02, .02, (minZ + maxZ) / 2, .06, .05, maxZ - minZ, P.bronze);
    }
    // Ceiling: a plaster band on the back walls with recessed linear light strips.
    ceiling(P) {
        const { minX, maxX, minZ, maxZ } = FLOOR, y = 3.42, cz = (minZ + maxZ) / 2;
        this.box(0, y, minZ + .7, maxX - minX, .14, 1.4, P.plaster);
        this.box(minX + .7, y, cz, 1.4, .14, maxZ - minZ, P.plaster);
        this.box(0, y - .08, minZ + 1.38, maxX - minX - 1.4, .025, .05, P.strip);
        this.box(minX + 1.38, y - .08, cz + .7, .05, .025, maxZ - minZ - 1.4, P.strip);
        // Perimeter soffit: a dropped plaster fascia on the band's inner edge with a bronze reveal, so the ceiling line
        // frames the open plan. It stays on the back walls, where nothing sits between it and the camera.
        this.box(.7, y - .2, minZ + 1.43, maxX - minX - 1.4, .3, .06, P.plaster);
        this.box(minX + 1.43, y - .2, cz + .7, .06, .3, maxZ - minZ - 1.4, P.plaster);
        this.box(.7, y - .36, minZ + 1.43, maxX - minX - 1.4, .02, .07, P.bronze);
        this.box(minX + 1.43, y - .36, cz + .7, .07, .02, maxZ - minZ - 1.4, P.bronze);
        // Nothing hangs over the pods: a pendant above the floor would cross a seated agent in the cutaway view.
    }
    // Glass partitions with dark-bronze mullions and a frosted manifestation band.
    partition(x0, z0, x1, z1, h = 2.85) {
        const P = this.palette(), len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const put = (along, y, w, hh, d, m) => alongX ? this.box(cx + along, y, cz, w, hh, d, m) : this.box(cx, y, cz + along, d, hh, w, m);
        put(0, h / 2, len, h, .025, P.glass);
        put(0, 1.15, len, .14, .03, P.frost);
        put(0, h, len, .06, .08, P.bronze);
        put(0, .03, len, .06, .08, P.bronze);
        const bays = Math.max(1, Math.round(len / 1.5));
        for (let i = 0; i <= bays; i++)
            put(-len / 2 + i * len / bays, h / 2, .045, h, .06, P.bronze);
    }
    plant(x, z, s = 1, tall = false) {
        const P = this.palette(), blob = this.geo('blob', () => new THREE.IcosahedronGeometry(1, 1));
        this.mesh(this.geo('pot', () => new THREE.CylinderGeometry(1, .82, 1, 20)), P.pot, x, .26 * s, z, .3 * s, .52 * s, .3 * s);
        const leaves = tall ? [[0, 1.35, 0, .42], [-.18, 1.0, .1, .36], [.2, 1.1, -.08, .34], [.05, .7, .15, .3]] : [[0, .75, 0, .36], [-.16, .66, .1, .26], [.17, .7, -.06, .27]];
        leaves.forEach(([dx, dy, dz, r], i) => this.mesh(blob, i % 2 ? P.leafDark : P.leaf, x + dx * s, dy * s, z + dz * s, r * s, r * 1.15 * s, r * s));
        this.contact(x, z, .9 * s, .9 * s);
    }
    chair(x, z, heading) {
        const P = this.palette(), box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20));
        // Task chair: five-star base, gas lift, charcoal seat and mesh back. Local +z is the sitter's front.
        this.batchGroup(x, 0, z, heading, add => {
            for (let i = 0; i < 5; i++) {
                const a = i * Math.PI * 2 / 5;
                add(box, P.charcoal, Math.sin(a) * .15, .07, Math.cos(a) * .15, .035, .03, .3, 0, 0, a);
                add(cyl, P.device, Math.sin(a) * .29, .03, Math.cos(a) * .29, .03, .05, .03);
            }
            add(cyl, P.charcoal, 0, .26, 0, .025, .36, .025);
            add(box, P.fabric, 0, .46, .02, .5, .07, .48);
            add(box, P.fabric, 0, .82, -.25, .46, .5, .05, -.12);
            add(box, P.charcoal, 0, .58, -.26, .06, .26, .03, -.1);
            for (const s of [-1, 1]) {
                add(box, P.charcoal, s * .26, .58, 0, .03, .2, .03);
                add(box, P.fabric, s * .26, .69, .02, .06, .03, .26);
            }
        });
        this.contact(x, z, .75, .75);
    }
    // ---- Zones ----------------------------------------------------------------------------------
    directorOffice(P) {
        // Glass box on the north-west: east wall with a door, south wall shared with the meeting room.
        this.partition(-12.5, -11.5, -12.5, -6.1);
        this.partition(-12.5, -4.9, -12.5, -4.1);
        this.box(-12.5, 2.82, -5.5, .08, .06, 1.2, P.bronze);
        this.contact(-16.75, -8.6, 3.6, 3.0);
        this.box(-16.75, .006, -8.4, 3.6, .012, 2.8, P.rugDark);
        // Walnut executive desk 2.0 × 0.9 with brass inlay, a screen and a reading lamp.
        this.box(-16.75, .73, -8.85, 2.0, .05, .9, P.walnut);
        this.box(-16.75, .757, -8.42, 2.0, .006, .02, P.brass);
        for (const s of [-1, 1])
            this.box(-16.75 + s * .92, .36, -8.85, .1, .71, .82, P.walnut);
        this.box(-16.75, .45, -9.22, 1.74, .5, .03, P.walnut);
        this.box(-17.0, .76, -9.05, .42, .012, .14, P.keys);
        this.monitorArm(-17.0, -8.62, 0, P);
        this.box(-16.15, .77, -8.7, .26, .02, .34, P.linen);
        this.chair(-16.75, -9.7, 0);
        this.chair(-17.35, -7.75, Math.PI);
        this.chair(-16.15, -7.75, Math.PI);
        // Bookshelf on the west wall and a media credenza with the live-dispatch screen on the north wall.
        this.bookshelf(-20.6, -8.2, Math.PI / 2, 2.6, P);
        this.box(-16.75, .35, -11.05, 3.2, .7, .5, P.walnut);
        this.taskCanvas = document.createElement('canvas');
        this.taskCanvas.width = 768;
        this.taskCanvas.height = 432;
        this.taskTexture = new THREE.CanvasTexture(this.taskCanvas);
        this.taskTexture.colorSpace = THREE.SRGBColorSpace;
        this.textures.add(this.taskTexture);
        this.box(-16.75, 1.75, -11.22, 1.76, 1.02, .05, P.device);
        const tasks = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: this.taskTexture, toneMapped: false }));
        tasks.position.set(-16.75, 1.75, -11.19);
        tasks.scale.set(1.68, .945, 1);
        this.scene.add(tasks);
        this.drawTasks(null);
        this.floorLamp(-19.9, -10.6, P);
        this.plant(-13.3, -10.9, .9, true);
    }
    meetingRoom(P) {
        this.partition(-12.5, -4.1, -12.5, 2.0);
        this.box(-12.5, 2.82, 2.6, .08, .06, 1.2, P.bronze);
        this.partition(-12.5, 3.2, -12.5, 3.4);
        this.partition(-21, 3.4, -12.5, 3.4);
        // Director / meeting divider: glass either side of a solid travertine media wall that carries the display.
        this.partition(-21, -4.1, -19.45, -4.1);
        this.partition(-14.05, -4.1, -12.5, -4.1);
        this.box(-16.75, 1.42, -4.1, 5.4, 2.84, .32, P.travertine);
        this.box(-16.75, 2.87, -4.1, 5.4, .06, .36, P.bronze);
        // Wall-mounted LED display, drawn from /market. Bezel sits proud of the travertine.
        this.marketCanvas = document.createElement('canvas');
        this.marketCanvas.width = 1024;
        this.marketCanvas.height = 512;
        this.marketTexture = new THREE.CanvasTexture(this.marketCanvas);
        this.marketTexture.colorSpace = THREE.SRGBColorSpace;
        this.marketTexture.anisotropy = 8;
        this.textures.add(this.marketTexture);
        const tv = new THREE.Group(), bezel = new THREE.Mesh(this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), P.device);
        bezel.scale.set(3.94, 2.02, .06);
        const screen = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: this.marketTexture, toneMapped: false }));
        screen.scale.set(3.8, 1.9, 1);
        screen.position.z = .032;
        tv.add(bezel, screen);
        tv.position.set(MEETING_TV.x, MEETING_TV.y, -4.1 + .16 + .03);
        tv.name = 'meeting-display';
        this.marketScreen = tv;
        this.scene.add(tv);
        this.drawMarket(null);
        // Acoustic felt on the west wall, the 3.2 × 1.4 table and eight chairs.
        this.box(-20.72, 1.55, -.1, .06, 1.6, 4.2, P.felt);
        for (let i = 0; i < 6; i++)
            this.box(-20.68, 1.55, -1.85 + i * .7, .03, 1.6, .02, P.bronze);
        this.box(-16.75, .006, -.1, 3.6, .012, 5.0, P.rug);
        this.contact(-16.75, -.1, 2.6, 4.4);
        this.box(-16.75, .73, -.1, 1.4, .05, 3.2, P.oakJoinery);
        for (const z of [-1.1, .9])
            this.box(-16.75, .36, z, .5, .71, .12, P.bronze);
        for (const s of MEETING_SEATS)
            this.chair(s.x, s.z, s.heading);
        this.plant(-20.2, 2.7, .85, true);
    }
    deskArea(P) {
        this.desks = deskLayout();
        const geoPlane = this.geo('plane', () => new THREE.PlaneGeometry(1, 1));
        this.screenMaterial = new THREE.MeshBasicMaterial({ map: this.screenTexture(), color: 0xffffff });
        this.screens = new THREE.InstancedMesh(geoPlane, this.screenMaterial, this.desks.length);
        this.screens.name = 'desk-screens';
        const pods = new Map();
        for (const desk of this.desks) {
            pods.set(desk.pod, desk);
            const toward = -desk.side;
            // Off-white top, charcoal panel legs, pedestal on the outer side.
            this.box(desk.x, .735, desk.z, DESK.w - .02, .03, DESK.d - .02, P.desk);
            for (const s of [-1, 1])
                this.box(desk.x + s * .66, .36, desk.z, .04, .72, .62, P.charcoal);
            const outward = Math.sign(desk.x - desk.podX);
            this.box(desk.x + outward * .43, .3, desk.z + desk.side * .02, .4, .56, .55, P.desk);
            this.box(desk.x + outward * .43, .45, desk.z + desk.side * .3, .2, .012, .012, P.charcoal);
            // Monitor (0.55 × 0.33, tilted 8°), keyboard and mouse face the sitter.
            const mz = desk.z - desk.side * .18, heading = desk.heading;
            this.monitorArm(desk.x, mz, heading, P);
            this.box(desk.x - .05, .758, desk.z + desk.side * .16, .42, .014, .13, P.keys);
            this.box(desk.x + .27, .758, desk.z + desk.side * .16, .06, .016, .1, P.keys);
            _quat.setFromEuler(_euler.set(-.14, heading + Math.PI, 0, 'YXZ'));
            this.screens.setMatrixAt(desk.index, _matrix.compose(_position.set(desk.x, .96, mz + desk.side * .05), _quat, _scale.set(.53, .31, 1)));
            // A brass task lamp on every second desk.
            if (desk.index % 2 === 0)
                this.taskLamp(desk.x + outward * .5, desk.z + toward * .18, heading, P);
            this.chair(desk.seatX, desk.seatZ, desk.heading);
        }
        // Low felt privacy screen down the spine of each pod, plus one soft contact shadow per pod.
        for (const desk of pods.values()) {
            this.box(desk.podX, .9, desk.podZ, 2.78, .3, .03, P.felt);
            this.box(desk.podX, 1.052, desk.podZ, 2.78, .012, .04, P.brass);
            this.contact(desk.podX, desk.podZ, 3.6, 2.6);
        }
        this.screens.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < this.desks.length; i++)
            this.screens.setColorAt(i, _color.setScalar(.03));
        this.screens.instanceColor.needsUpdate = true;
        this.screens.receiveShadow = false;
        this.scene.add(this.screens);
        // North band: long oak credenza, books, planting. East strip: phone booths and a standing table.
        this.box(2.4, .36, -10.95, 20, .72, .5, P.oakJoinery);
        for (let i = 0; i < 18; i++)
            if (i % 4 !== 1)
                this.box(-7 + i * 1.1, .87, -10.95, .5, .3, .2, P.books[i % 4]);
        for (const x of [-8.6, 13.6, 18.5])
            this.plant(x, -10.6, 1.05, true);
        for (const z of [-9.4, -6.9])
            this.phoneBooth(19.6, z, P);
        this.box(16.4, 1.02, -3.4, .8, .05, 2.6, P.oakJoinery);
        for (const z of [-4.3, -2.5])
            this.box(16.4, .5, z, .08, 1.0, .5, P.charcoal);
        this.contact(16.4, -3.4, 1.4, 3.2);
        for (const [x, z] of [[-8.6, 1.4], [15.6, 1.8], [19.8, -1.6], [-8.6, -6.6]])
            this.plant(x, z, 1, true);
        for (const x of POD_X)
            this.plant(x, 2.15, .75);
    }
    monitorArm(x, z, heading, P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
        this.batchGroup(x, .75, z, heading, add => {
            add(box, P.device, 0, .008, -.02, .2, .016, .15);
            add(box, P.device, 0, .11, -.05, .04, .2, .03);
            add(box, P.device, 0, .21, -.035, .56, .34, .022, .14);
        });
    }
    taskLamp(x, z, heading, P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20));
        this.batchGroup(x, .75, z, heading, add => {
            add(cyl, P.brass, 0, .01, 0, .06, .02, .06);
            add(box, P.brass, 0, .19, 0, .014, .36, .014, 0, .18);
            add(box, P.brass, -.08, .37, .04, .014, .2, .014, 1.2, -.3);
            add(cyl, P.shade, -.13, .36, .1, .05, .07, .05, .5);
        });
    }
    bookshelf(x, z, heading, width, P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
        this.batchGroup(x, 0, z, heading, add => {
            add(box, P.walnut, 0, 1.0, 0, width, 2.0, .04);
            for (let r = 0; r < 5; r++)
                add(box, P.walnut, 0, .05 + r * .47, .16, width, .03, .34);
            for (const s of [-1, 1])
                add(box, P.walnut, s * width / 2, 1.0, .16, .04, 2.0, .34);
            for (let r = 0; r < 4; r++)
                for (let i = 0; i < 9; i++)
                    if ((i + r) % 5 !== 3)
                        add(box, P.books[(i + r * 2) % 4], -width / 2 + .2 + i * (width - .4) / 9, .23 + r * .47, .16, .1 + (i % 3) * .03, .3 + (i % 2) * .05, .24);
        });
    }
    floorLamp(x, z, P) {
        this.cyl(x, .015, z, .16, .03, P.brass);
        this.cyl(x, .8, z, .014, 1.6, P.brass);
        this.mesh(this.geo('shadeCone', () => new THREE.CylinderGeometry(.16, .24, .3, 20, 1, true)), P.shade, x, 1.65, z);
        this.contact(x, z, .6, .6);
    }
    phoneBooth(x, z, P) {
        this.box(x, 1.15, z, 1.3, 2.3, 1.3, P.glass);
        this.box(x, 2.32, z, 1.36, .06, 1.36, P.oakJoinery);
        this.box(x, .03, z, 1.36, .06, 1.36, P.bronze);
        this.box(x + .6, 1.15, z, .06, 2.3, 1.26, P.felt);
        this.box(x + .35, .76, z, .4, .04, .6, P.oakJoinery);
        for (const dx of [-.65, .65])
            for (const dz of [-.65, .65])
                this.box(x + dx, 1.15, z + dz, .05, 2.3, .05, P.bronze);
        this.contact(x, z, 1.7, 1.7);
    }
    sofa(x, z, heading, P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
        // 2.2 m sofa; local +z is its front.
        this.batchGroup(x, 0, z, heading, add => {
            add(box, P.sofa, 0, .21, 0, 2.2, .3, .9);
            add(box, P.sofa, 0, .42, .06, 2.0, .14, .74);
            add(box, P.sofa, 0, .64, -.34, 2.2, .5, .22, -.08);
            for (const s of [-1, 1])
                add(box, P.sofa, s * 1.02, .4, 0, .16, .4, .9);
            for (const s of [-1, 1])
                add(box, P.bronze, s * .9, .03, 0, .05, .06, .7);
        });
        this.contact(x, z, 2.6, 1.3);
    }
    armchair(x, z, heading, P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
        this.batchGroup(x, 0, z, heading, add => {
            add(box, P.sage, 0, .24, 0, .85, .32, .8);
            add(box, P.sage, 0, .44, .06, .66, .12, .62);
            add(box, P.sage, 0, .66, -.32, .85, .5, .18, -.1);
            for (const s of [-1, 1])
                add(box, P.sage, s * .36, .44, 0, .14, .3, .8);
        });
        this.contact(x, z, 1.1, 1.1);
    }
    // The lounge sits on the walkway in front of the camera: a terracotta rug, two sofas, two armchairs.
    lounge(P) {
        const { x, z } = LOUNGE;
        this.box(x, .006, z, 6.6, .012, 4.7, P.rugDark);
        this.sofa(x, z - 1.75, 0, P);
        this.sofa(x, z + 1.75, Math.PI, P);
        this.armchair(6.1, z, Math.PI / 2, P);
        this.armchair(11.5, z, -Math.PI / 2, P);
        // Low travertine table with a bowl and books, a side table and two floor lamps.
        this.box(x, .19, z, 1.5, .36, .8, P.walnut);
        this.box(x, .385, z, 1.56, .03, .86, P.travertine);
        this.cyl(x - .35, .44, z, .16, .08, P.ceramic);
        this.box(x + .35, .42, z + .05, .34, .05, .24, P.books[1]);
        this.contact(x, z, 2.0, 1.2);
        for (const [lx, lz] of [[6.1, z - 1.9], [11.5, z + 1.9]])
            this.floorLamp(lx, lz, P);
        this.plant(12.4, z - 2.0, 1.05, true);
        this.plant(5.4, z + 2.6, .95, true);
        this.plant(12.2, z + 2.9, .8);
    }
    // The original south-west lounge is now a quiet library: sofas, armchairs and shelving under the west glazing.
    library(P) {
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1));
        this.box(-15.5, .006, 7, 3.4, .012, 2.4, P.rug);
        this.contact(-15.5, 7, 6.2, 4.6);
        // Two 2.2 m sofas facing each other; local +z is the front of each sofa.
        for (const [x, heading] of [[-17.75, Math.PI / 2], [-13.25, -Math.PI / 2]])
            this.batchGroup(x, 0, 7, heading, add => {
                add(box, P.sofa, 0, .21, 0, 2.2, .3, .9);
                add(box, P.sofa, 0, .42, .06, 2.0, .14, .74);
                add(box, P.sofa, 0, .64, -.34, 2.2, .5, .22, -.08);
                for (const s of [-1, 1])
                    add(box, P.sofa, s * 1.02, .4, 0, .16, .4, .9);
                for (const s of [-1, 1])
                    add(box, P.bronze, s * .9, .03, 0, .05, .06, .7);
            });
        for (const [z, heading] of [[5, 0], [9, Math.PI]])
            this.batchGroup(-15.5, 0, z, heading, add => {
                add(box, P.sage, 0, .24, 0, .85, .32, .8);
                add(box, P.sage, 0, .44, .06, .66, .12, .62);
                add(box, P.sage, 0, .66, -.32, .85, .5, .18, -.1);
                for (const s of [-1, 1])
                    add(box, P.sage, s * .36, .44, 0, .14, .3, .8);
            });
        // Low travertine table, two floor lamps and a planter divider facing the aisle.
        this.box(-15.5, .19, 7, .75, .36, 1.3, P.travertine);
        this.box(-15.5, .385, 7, .78, .03, 1.33, P.travertine);
        this.cyl(-15.4, .43, 6.8, .07, .06, P.ceramic);
        this.floorLamp(-19.3, 4.4, P);
        this.floorLamp(-12.4, 9.4, P);
        this.box(-10.45, .3, 5.6, .5, .6, 2.6, P.pot);
        for (let i = 0; i < 5; i++)
            this.mesh(this.geo('blob', () => new THREE.IcosahedronGeometry(1, 1)), i % 2 ? P.leafDark : P.leaf, -10.45, .78, 4.5 + i * .55, .32, .36, .32);
        this.contact(-10.45, 5.6, .9, 3);
        this.bookshelf(-20.6, 7, Math.PI / 2, 3.2, P);
        this.plant(-20.2, 9.25, 1, true);
    }
    pantry(P) {
        // Travertine back wall with a 5 m counter run, open shelving and the neon wordmark.
        this.box(17, 1.4, 3.9, 7, 2.8, .25, P.travertine);
        this.box(17, 2.83, 3.9, 7, .06, .29, P.bronze);
        this.box(17, .44, 4.34, 5, .86, .62, P.oakJoinery);
        this.box(17, .89, 4.34, 5.06, .05, .66, P.travertine);
        for (let i = 0; i < 6; i++)
            this.box(14.9 + i * .84, .45, 4.655, .006, .78, .01, P.bronze);
        this.box(15.8, .92, 4.3, .5, .012, .38, P.device);
        this.mesh(this.geo('tap', () => new THREE.TorusGeometry(.12, .012, 6, 16, Math.PI)), P.brass, 15.8, 1.04, 4.12, 1, 1, 1);
        this.cyl(15.8, .98, 4.12 - .12, .012, .14, P.brass);
        // Espresso machine: charcoal body, brass group heads.
        this.box(18.7, 1.12, 4.25, .62, .42, .42, P.device);
        this.box(18.7, 1.35, 4.25, .64, .04, .44, P.brass);
        for (const dx of [-.14, .14])
            this.cyl(18.7 + dx, 1.0, 4.48, .035, .06, P.brass);
        for (const y of [1.5, 1.86])
            this.box(17, y, 4.18, 5, .035, .3, P.oakJoinery);
        for (let i = 0; i < 12; i++)
            this.cyl(14.8 + i * .4, (i % 2 ? 1.86 : 1.5) + .08, 4.16, .045, .12, i % 3 ? P.ceramic : P.pot);
        // Neon wordmark: soft glow, mounted on a slim bronze rail, 2.2 m wide.
        const neonMap = this.canvasTexture(1024, 256, c => {
            c.clearRect(0, 0, 1024, 256);
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font = `italic 500 132px Georgia, "Times New Roman", serif`;
            c.shadowColor = 'rgba(255,170,110,.9)';
            c.shadowBlur = 26;
            c.strokeStyle = '#ffb27e';
            c.lineWidth = 8;
            c.strokeText('agent studio', 512, 132);
            c.shadowBlur = 0;
            c.strokeStyle = '#fff1e2';
            c.lineWidth = 3;
            c.strokeText('agent studio', 512, 132);
        });
        this.neon = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: neonMap, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.9, 1.9, 1.9) }));
        this.neon.position.set(17, 2.35, 4.05);
        this.neon.scale.set(2.2, .55, 1);
        this.neon.name = 'pantry-neon';
        this.scene.add(this.neon);
        for (const dx of [-.9, .9])
            this.box(17 + dx, 2.35, 4.04, .02, .3, .02, P.bronze);
        // Island with two stools.
        this.box(17, .5, 6.4, 2.2, 1.0, .7, P.oakJoinery);
        this.box(17, 1.02, 6.4, 2.3, .04, .9, P.travertine);
        this.contact(17, 6.6, 3, 2);
        for (const x of [16.45, 17.55]) {
            this.cyl(x, .37, 7.15, .02, .74, P.brass);
            this.cyl(x, .76, 7.15, .19, .06, P.fabric);
            this.cyl(x, .26, 7.15, .14, .015, P.brass);
            this.contact(x, 7.15, .55, .55);
        }
        this.plant(20.0, 5.0, 1, true);
        this.plant(13.9, 9.2, .9, true);
    }
    // North wall: travertine feature panel with the original quota display, flanked by felt acoustic panels.
    northWall(P) {
        this.box(6, 1.45, -11.32, 9, 2.9, .3, P.travertine);
        this.box(6, 2.93, -11.32, 9.04, .06, .34, P.bronze);
        this.quotaCanvas = document.createElement('canvas');
        this.quotaCanvas.width = 1024;
        this.quotaCanvas.height = 384;
        this.quotaTexture = new THREE.CanvasTexture(this.quotaCanvas);
        this.quotaTexture.colorSpace = THREE.SRGBColorSpace;
        this.quotaTexture.anisotropy = 8;
        this.textures.add(this.quotaTexture);
        this.box(6, 1.72, -11.145, 2.54, 1.02, .02, P.device);
        for (const [dx, dy, w, h] of [[0, .53, 2.62, .04], [0, -.53, 2.62, .04], [-1.29, 0, .04, 1.1], [1.29, 0, .04, 1.1]])
            this.box(6 + dx, 1.72 + dy, -11.135, w, h, .03, P.bronze);
        const quota = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: this.quotaTexture, toneMapped: false }));
        quota.position.set(6, 1.72, -11.13);
        quota.scale.set(2.4, .95, 1);
        quota.name = 'corridor-quota';
        this.quotaSign = quota;
        this.scene.add(quota);
        // Felt baffles: rough, deep olive, proud of the stone with a bronze shadow gap.
        for (const x of [2.15, 3.0, 9.0, 9.85]) {
            this.box(x, 1.5, -11.13, .72, 2.3, .06, P.felt);
            this.box(x, .33, -11.12, .72, .03, .07, P.bronze);
        }
        // West of the display: a framed colour-field canvas on its own stone panel.
        this.box(-4.6, 1.45, -11.32, 5.6, 2.9, .3, P.travertine);
        this.box(-4.6, 2.93, -11.32, 5.64, .06, .34, P.bronze);
        const art = this.canvasTexture(1024, 448, c => {
            const fields = [['#c98b5a', '#a5643f'], ['#d9c6a0', '#bfa77c'], ['#6f8a68', '#4e6a4c'], ['#2f3b45', '#1e272f']];
            c.fillStyle = '#efe7d8';
            c.fillRect(0, 0, 1024, 448);
            const rnd = this.rng(77);
            fields.forEach(([a, b], i) => {
                const g = c.createLinearGradient(0, 0, 0, 448);
                g.addColorStop(0, a);
                g.addColorStop(1, b);
                c.fillStyle = g;
                c.globalAlpha = .92;
                const x = 40 + i * 236 + (rnd() - .5) * 30, w = 200 + rnd() * 70, top = 36 + rnd() * 70;
                c.fillRect(x, top, w, 448 - top - 36 - rnd() * 60);
            });
            c.globalAlpha = 1;
        });
        art.colorSpace = THREE.SRGBColorSpace;
        const artMat = this.mat('artwork', 0xffffff, { rough: .85, env: .3 });
        artMat.map = art;
        this.box(-4.6, 1.6, -11.15, 3.86, 1.74, .04, P.oakJoinery);
        this.mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), artMat, -4.6, 1.6, -11.125, 3.7, 1.6, 1);
        // East end: a rhythm of felt acoustic panels at stepped heights.
        this.box(17.2, 1.45, -11.32, 6.4, 2.9, .3, P.travertine);
        this.box(17.2, 2.93, -11.32, 6.44, .06, .34, P.bronze);
        for (const [x, hh] of [[14.6, 1.9], [15.45, 2.3], [16.3, 1.6], [17.15, 2.3], [18, 1.9], [18.85, 2.3], [19.7, 1.6]]) {
            this.box(x, .45 + hh / 2, -11.13, .72, hh, .06, P.felt);
            this.box(x, .42, -11.12, .72, .03, .07, P.bronze);
        }
    }
    // Rooms wayfinding at the west aisle: a wall clock over a directory plate on the mullion between the two rooms.
    roomsClock(P) {
        const x = OFFICE_ZONES.meeting.x + OFFICE_ZONES.meeting.w / 2 + .06, z = -4.1;
        this.box(x - .03, 2.0, z, .04, 1.56, .8, P.bronze);
        this.clockCanvas = document.createElement('canvas');
        this.clockCanvas.width = 256;
        this.clockCanvas.height = 512;
        this.clockTexture = new THREE.CanvasTexture(this.clockCanvas);
        this.clockTexture.colorSpace = THREE.SRGBColorSpace;
        this.clockTexture.anisotropy = 8;
        this.textures.add(this.clockTexture);
        const material = new THREE.MeshStandardMaterial({ map: this.clockTexture, roughness: .5, metalness: .1, emissive: 0xffe2b8, emissiveMap: this.clockTexture, emissiveIntensity: .25 });
        material.userData.glowScale = .5;
        this.windowGlowMaterials.push(material);
        const face = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), material);
        face.position.set(x, 2.0, z);
        face.rotation.y = Math.PI / 2;
        face.scale.set(.72, 1.44, 1);
        face.name = 'rooms-clock';
        this.roomsClockFace = face;
        this.scene.add(face);
        this.clockMinute = -1;
        this.drawClock();
    }
    // Shanghai wall time, matching the HUD clock. Checked once a second, redrawn once a minute.
    drawClock() {
        const minutes = Math.floor(Date.now() / 60000 + 480) % 1440;
        if (minutes === this.clockMinute || !this.clockCanvas)
            return;
        this.clockMinute = minutes;
        const c = this.clockCanvas.getContext('2d'), cx = 128, cy = 128, r = 112, font = `"Bahnschrift", "Avenir Next Condensed", "Arial Narrow", ${SANS}`;
        c.fillStyle = '#2b221b';
        c.fillRect(0, 0, 256, 512);
        c.fillStyle = '#f4efe6';
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#c9a264';
        c.lineWidth = 8;
        c.stroke();
        c.fillStyle = '#2b221b';
        for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2, long = i % 3 === 0;
            c.save();
            c.translate(cx + Math.sin(a) * (r - 20), cy - Math.cos(a) * (r - 20));
            c.rotate(a);
            c.fillRect(-(long ? 5 : 3), -(long ? 14 : 8), long ? 10 : 6, long ? 28 : 16);
            c.restore();
        }
        const hand = (turn, length, width) => {
            c.save();
            c.translate(cx, cy);
            c.rotate(turn * Math.PI * 2);
            c.fillRect(-width / 2, -length, width, length + 14);
            c.restore();
        };
        hand((minutes % 720) / 720, 58, 10);
        hand((minutes % 60) / 60, 88, 6);
        c.fillStyle = '#b8862f';
        c.beginPath();
        c.arc(cx, cy, 9, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#e9c98f';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `700 46px ${font}`;
        c.fillText('ROOMS', cx, 300);
        c.font = `600 30px ${font}`;
        c.fillText('DIRECTOR', cx, 372);
        c.fillText('MEETING', cx, 428);
        c.fillStyle = 'rgba(233,201,143,.4)';
        c.fillRect(48, 336, 160, 3);
        this.clockTexture.needsUpdate = true;
    }
    // South band centrepiece: a south-facing travertine wall that faces the camera. West: the reception backdrop
    // (plant wall, backlit wordmark, reception desk). Centre: the quota scoreboard over the wayfinding band.
    reception(P) {
        const { x0, x1, z, h, t } = FEATURE_WALL, front = z + t / 2, len = x1 - x0, cx = (x0 + x1) / 2;
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), blob = this.geo('blob', () => new THREE.IcosahedronGeometry(1, 1));
        this.box(cx, h / 2, z, len, h, t, P.travertine);
        this.box(cx, h + .03, z, len + .04, .06, t + .04, P.bronze);
        this.box(cx, .04, front + .006, len, .08, .012, P.bronze);
        // Plant wall in an oak frame, 4.8 × 3.0 m.
        const gx = -6.3, gw = 4.8, gy = 1.65, gh = 3.0;
        this.box(gx, gy, front + .04, gw, gh, .06, P.leafDark);
        for (const [dx, dy, w, hh] of [[0, gh / 2, gw + .12, .06], [0, -gh / 2, gw + .12, .06], [-gw / 2, 0, .06, gh], [gw / 2, 0, .06, gh]])
            this.box(gx + dx, gy + dy, front + .08, w, hh, .1, P.oakJoinery);
        const rnd = this.rng(41);
        for (let row = 0; row < 7; row++)
            for (let col = 0; col < 11; col++) {
                const r = .2 + rnd() * .14;
                this.mesh(blob, (row + col) % 3 ? P.leaf : P.leafDark, gx - gw / 2 + .25 + col * (gw - .5) / 10 + (rnd() - .5) * .15, gy - gh / 2 + .25 + row * (gh - .5) / 6 + (rnd() - .5) * .12, front + .12, r, r * 1.1, .1);
            }
        // Backlit wordmark: halo-lit letters stood off the plant wall.
        const wordmark = this.canvasTexture(1024, 256, c => {
            c.clearRect(0, 0, 1024, 256);
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font = `italic 600 150px Georgia, "Times New Roman", serif`;
            c.shadowColor = 'rgba(255,214,150,1)';
            c.shadowBlur = 34;
            c.fillStyle = 'rgba(255,226,180,.9)';
            c.fillText('agent studio', 512, 128);
            c.shadowBlur = 10;
            c.fillText('agent studio', 512, 128);
            c.shadowBlur = 0;
            c.fillStyle = '#fff8ec';
            c.fillText('agent studio', 512, 128);
        });
        this.wordmark = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: wordmark, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
        this.wordmark.position.set(gx, 2.42, front + .24);
        this.wordmark.scale.set(4.3, 1.1, 1);
        this.wordmark.name = 'reception-wordmark';
        this.scene.add(this.wordmark);
        // Reception desk: fluted oak front, travertine top, brass kick, close to the wall so the wordmark stays clear.
        const dz = 6.3;
        this.batchGroup(gx, 0, dz, 0, add => {
            add(box, P.oakJoinery, 0, .52, 0, 3.2, 1.0, .72);
            for (let i = 0; i < 26; i++)
                add(box, P.walnut, -1.5 + i * .12, .54, .365, .045, .88, .02);
            add(box, P.travertine, 0, 1.045, .02, 3.32, .05, .82);
            add(box, P.brass, 0, .04, .37, 3.2, .08, .02);
            add(box, P.travertine, -.95, .76, -.5, 1.2, .04, .4);
        });
        this.cyl(gx + 1.2, 1.17, dz, .09, .2, P.ceramic);
        for (const [lx, ly, lz, r] of [[0, 1.4, 0, .16], [-.08, 1.32, .06, .12], [.08, 1.34, -.04, .12]])
            this.mesh(blob, P.leaf, gx + 1.2 + lx, ly, dz + lz, r, r * 1.2, r);
        this.monitorArm(gx - .6, dz - .1, Math.PI, P);
        this.contact(gx, dz, 3.8, 1.4);
        // Quota scoreboard at the wall's east end, off the entry axis. The numerals fill most of the board so it can
        // stay compact, and the face is held below full brightness so it never outshines the wordmark.
        const { x: sx, y: sy, w: sw, h: sh } = SCOREBOARD;
        this.box(sx, sy, front + .03, sw + .14, sh + .14, .06, P.device);
        for (const [dx, dy, w, hh] of [[0, sh / 2 + .08, sw + .2, .04], [0, -sh / 2 - .08, sw + .2, .04], [-sw / 2 - .08, 0, .04, sh + .2], [sw / 2 + .08, 0, .04, sh + .2], [0, 0, .03, sh]])
            this.box(sx + dx, sy + dy, front + .065, w, hh, .03, P.bronze);
        this.scoreCanvas = document.createElement('canvas');
        this.scoreCanvas.width = SCORE_CANVAS.w;
        this.scoreCanvas.height = SCORE_CANVAS.h;
        this.scoreTexture = new THREE.CanvasTexture(this.scoreCanvas);
        this.scoreTexture.colorSpace = THREE.SRGBColorSpace;
        this.scoreTexture.anisotropy = 8;
        this.textures.add(this.scoreTexture);
        const board = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: this.scoreTexture, toneMapped: false, color: new THREE.Color(.6, .6, .6) }));
        board.position.set(sx, sy, front + .065);
        board.scale.set(sw, sh, 1);
        board.name = 'reception-scoreboard';
        board.userData.digits = { top: sy + sh * (.5 - SCORE_CANVAS.digitTop / SCORE_CANVAS.h), bottom: sy + sh * (.5 - SCORE_CANVAS.digitBase / SCORE_CANVAS.h) };
        this.quotaRepeater = board;
        this.scene.add(board);
        // Wayfinding band low on the entry axis: brass letters on dark bronze, sized to read from the default camera.
        const way = this.canvasTexture(2048, 280, c => {
            c.fillStyle = '#2b221b';
            c.fillRect(0, 0, 2048, 280);
            c.fillStyle = '#e9c98f';
            c.textBaseline = 'middle';
            c.font = `condensed 700 200px "Bahnschrift", "Avenir Next Condensed", "Arial Narrow", ${SANS}`;
            // Each item owns a third of the band; wide fonts condense rather than shrink, keeping the cap height.
            const items = ['←  MEETING', 'STUDIO  ↑', 'LOUNGE  →'], cell = 2048 / 3;
            c.textAlign = 'center';
            items.forEach((text, i) => {
                const fit = Math.min(1, (cell - 70) / c.measureText(text).width);
                c.save();
                c.translate(cell * (i + .5), 146);
                c.scale(fit, 1);
                c.fillText(text, 0, 0);
                c.restore();
            });
            c.fillStyle = 'rgba(233,201,143,.35)';
            for (const x of [cell, cell * 2])
                c.fillRect(x - 2, 50, 4, 180);
        });
        way.anisotropy = 8;
        const wayMat = new THREE.MeshStandardMaterial({ map: way, metalness: .35, roughness: .4, emissive: 0xffd9a0, emissiveMap: way, emissiveIntensity: .12 });
        wayMat.userData.glowScale = .6;
        this.windowGlowMaterials.push(wayMat);
        this.materials.set('wayfinding', wayMat);
        this.wayfinding = new THREE.Mesh(this.geo('plane', () => new THREE.PlaneGeometry(1, 1)), wayMat);
        this.wayfinding.position.set(WAYFINDING.x, WAYFINDING.y, front + .02);
        this.wayfinding.scale.set(WAYFINDING.w, WAYFINDING.h, 1);
        this.wayfinding.name = 'reception-wayfinding';
        this.scene.add(this.wayfinding);
        this.drawQuota([]);
        // Dark coir runner from the vestibule to the wall gives the pale arrival hall a path and some weight.
        this.box(0, .009, 7.2, 1.98, .004, 3.48, P.brass);
        this.box(0, .013, 7.2, 1.9, .008, 3.4, P.plinth);
        // A bench for waiting visitors beside the plant wall's west end.
        this.box(-8.9, .23, 8.6, .45, .05, 2.2, P.oakJoinery);
        for (const dz2 of [-.95, .95])
            this.box(-8.9, .11, 8.6 + dz2, .4, .22, .06, P.bronze);
        this.contact(-8.9, 8.6, 1, 2.6);
        this.plant(-9.3, 6.2, .95, true);
        // Flanking plants sit where, in view, they fall beyond the band's ends.
        this.plant(4.55, 6.15, .7);
        this.plant(-3.75, 6.2, .8);
    }
    // Entrance vestibule: glass box with outer and inner double doors, a bronze roof edge and a travertine fascia.
    vestibule(P) {
        const z0 = 8.9, z1 = FLOOR.maxZ, hw = 1.6, h = 2.7, mid = (z0 + z1) / 2, dep = z1 - z0;
        for (const s of [-1, 1]) {
            this.box(s * hw, h / 2, mid, .025, h, dep, P.glass);
            for (const z of [z0, z1])
                this.box(s * hw, h / 2, z, .07, h, .07, P.bronze);
        }
        this.box(0, h, mid, hw * 2, .02, dep, P.glass);
        this.box(0, h + .05, z1, hw * 2 + .1, .1, .1, P.bronze);
        this.box(0, h + .05, z0, hw * 2 + .1, .1, .1, P.bronze);
        for (const z of [z0, z1])
            for (const s of [-1, 1]) {
                this.box(s * .6, 1.25, z, 1.12, 2.46, .03, P.glass);
                this.box(s * 1.2, 1.25, z, .05, 2.5, .06, P.brass);
                this.box(s * .1, 1.1, z + .05, .03, .9, .03, P.brass);
            }
        this.box(0, 2.53, z1, hw * 2, .06, .08, P.brass);
        this.box(0, 2.62, z1 + .02, hw * 2 - .2, .02, .04, P.strip);
        this.box(0, .012, mid, hw * 2 - .3, .01, dep - .3, P.plinth);
    }
    // A long linear pendant over the main aisle, south of the pods so it never crosses a seated agent in view.
    aislePendants(P) {
        const { z, y, xs, length: L } = AISLE_PENDANTS, cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20));
        for (const x of xs) {
            this.box(x, y, z, L, .07, .12, P.brass);
            this.box(x, y - .04, z, L - .1, .014, .08, P.strip);
            // Uplight slot on top: the run reads as a lit line from the high camera, day and night.
            this.box(x, y + .037, z, L - .2, .006, .035, P.strip);
            for (const s of [-1, 0, 1])
                this.mesh(cyl, P.bronze, x + s * (L / 2 - .5), (y + 3.4) / 2, z, .009, 3.4 - y, .009);
        }
        // The pool of light it throws on the floor ties the run to its height; one additive draw for all three.
        if (!this.materials.has('pendantPool')) {
            const map = this.canvasTexture(256, 64, c => { const g = c.createRadialGradient(128, 32, 4, 128, 32, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.setTransform(1, 0, 0, .25, 0, 24); c.fillStyle = g; c.fillRect(0, 0, 256, 256); });
            const pool = new THREE.MeshBasicMaterial({ color: 0xffd9a8, map, transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
            pool.name = 'pendantPool';
            this.materials.set('pendantPool', pool);
        }
        for (const x of xs)
            this.mesh(this.geo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.materials.get('pendantPool'), x, .02, z, L + 1.2, 1, 2.4);
    }
    // Three small globe pendants over the lounge table, hung high so they clear every sitter's sight line.
    loungePendants(P) {
        const globe = this.geo('globe', () => new THREE.SphereGeometry(1, 20, 12)), cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 20));
        for (const [x, y, z] of LOUNGE_PENDANTS) {
            this.mesh(globe, P.shade, x, y, z, .17, .17, .17);
            this.mesh(cyl, P.bronze, x, (y + 3.4) / 2, z, .008, 3.4 - y, .008);
            this.box(x, 3.39, z, .14, .02, .14, P.brass);
        }
    }
    // Planter troughs along the open south and east edges close the plate: no bare slab at the frame edge.
    planterRun(x0, z0, x1, z1, P) {
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const w = .56, blob = this.geo('blob', () => new THREE.IcosahedronGeometry(1, 1));
        this.box(cx, .27, cz, alongX ? len : w, .54, alongX ? w : len, P.travertine);
        this.box(cx, .545, cz, alongX ? len - .08 : w - .08, .01, alongX ? w - .08 : len - .08, P.plinth);
        const n = Math.max(1, Math.round(len / .42));
        for (let i = 0; i < n; i++) {
            const k = (i + .5) / n, r = .26 + (hash(`hedge${cx}:${i}`) % 7) * .012;
            this.mesh(blob, i % 3 ? P.leaf : P.leafDark, x0 + (x1 - x0) * k, .7, z0 + (z1 - z0) * k, alongX ? r * 1.25 : r, r * .85, alongX ? r : r * 1.25);
        }
        this.edgeCover.push({ x0: Math.min(x0, x1) - (alongX ? 0 : w / 2), x1: Math.max(x0, x1) + (alongX ? 0 : w / 2), z0: Math.min(z0, z1) - (alongX ? w / 2 : 0), z1: Math.max(z0, z1) + (alongX ? w / 2 : 0) });
    }
    windowPlanters(P) {
        const { minX, maxX, minZ, maxZ } = FLOOR, e = .3;
        this.planterRun(minX + .3, maxZ - e, -1.75, maxZ - e, P);
        this.planterRun(1.75, maxZ - e, maxX - e - .28, maxZ - e, P);
        this.planterRun(maxX - e, minZ + .3, maxX - e, maxZ - e + .28, P);
        // The vestibule itself closes the gap between the two south runs.
        this.edgeCover.push({ x0: -1.75, x1: 1.75, z0: 8.9, z1: maxZ });
    }
    // Small brass plaques at each zone entry, all from one atlas so they merge into a single draw.
    zonePlaques() {
        const plaques = [
            ["DIRECTOR'S OFFICE", -12.47, 1.55, -6.55, Math.PI / 2],
            ['MEETING ROOM', -12.47, 1.55, 1.55, Math.PI / 2],
            ['LIBRARY', -10.19, .36, 6.1, Math.PI / 2],
            ['LOUNGE', FEATURE_WALL.x1 + .01, 1.55, FEATURE_WALL.z, Math.PI / 2],
            ['RECEPTION', -6.3, .82, 6.68, 0],
            ['PANTRY', 13.75, 1.55, 4.04, 0],
            ['ENTRANCE', 0, 2.96, FLOOR.maxZ + .06, 0],
            ['STUDIO FLOOR', 2.4, .5, -10.69, 0],
        ];
        this.plaques = this.plaqueBatch('zonePlaques', plaques);
    }
    plaqueBatch(name, plaques) {
        const rows = plaques.length, atlas = this.canvasTexture(512, 96 * rows, c => {
            plaques.forEach(([text], i) => {
                const y = i * 96, g = c.createLinearGradient(0, y, 0, y + 96);
                g.addColorStop(0, '#dcbf87');
                g.addColorStop(.5, '#c4a066');
                g.addColorStop(1, '#a8854f');
                c.fillStyle = g;
                c.fillRect(0, y, 512, 96);
                c.strokeStyle = 'rgba(70,50,25,.55)';
                c.lineWidth = 3;
                c.strokeRect(8, y + 8, 496, 80);
                c.fillStyle = '#3a2b19';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.font = `600 ${text.length > 14 ? 40 : 46}px ${SANS}`;
                c.fillText(text, 256, y + 50);
            });
        });
        atlas.anisotropy = 4;
        const material = this.mat(name, 0xffffff, { metal: .55, rough: .35, map: atlas });
        material.userData.noShadow = true;
        material.emissive.setHex(0x6b5534);
        material.emissiveMap = atlas;
        material.userData.glowScale = .5;
        material.emissiveIntensity = (this.phaseNow?.glow ?? 0) * .5;
        this.windowGlowMaterials?.push(material);
        plaques.forEach(([, x, y, z, ry], i) => {
            const geo = new THREE.PlaneGeometry(1.1, .2), uv = geo.attributes.uv;
            for (let k = 0; k < uv.count; k++)
                uv.setY(k, (rows - 1 - i + uv.getY(k)) / rows);
            const m = new THREE.Mesh(geo, material);
            m.position.set(x, y, z);
            m.rotation.y = ry;
            m.updateMatrix();
            this.batchGeometry(geo, material, m.matrix);
            geo.dispose();
        });
        return plaques.map(([text]) => text);
    }
    // ---- Roster ---------------------------------------------------------------------------------
    async setRoster(roster) {
        if (this.roster)
            return;
        this.roster = roster;
        const slots = deskSlotsForRoster(roster);
        this.deskSlots = slots;
        this.spareDesks = spareDesks(slots);
        const byName = new Map(roster.agents.map(agent => [agent.name, agent]));
        slots.forEach((slot, index) => {
            const role = byName.get(slot.role), hue = (index * .61803398875 + .05) % 1;
            const top = new THREE.Color().setHSL(hue, .46, .5).getHex();
            const actor = this.createActor(role.name, role, deskSpot(slot), { top });
            actor.desk = slot;
            actor.deskIndex = slot.index;
            actor.agentColor = top;
            actor.screenColor = new THREE.Color(top).lerp(new THREE.Color(0xffffff), .55);
        });
        // The orchestrator is the one person in the director's office; no roster role takes that chair.
        this.createActor(DIRECTOR_ID, { name: DIRECTOR_ID }, DIRECTOR_SEAT, { top: 0x2b2f36, pants: 0x2b2f36, shoes: 0x1b1b1d, kind: 'director' }, { pickable: false });
        // Team plaques on a brass totem at the first pod of each team.
        const teams = [], seen = new Set();
        for (const slot of slots)
            if (!seen.has(slot.room)) {
                seen.add(slot.room);
                teams.push(slot);
            }
        const P = this.palette();
        teams.forEach(slot => {
            const x = slot.podX - 1.62, z = slot.podZ;
            this.cyl(x, .5, z, .025, 1.0, P.brass);
            this.cyl(x, .01, z, .14, .02, P.brass);
        });
        const labels = this.plaqueBatch('teamPlaques', teams.map(slot => [String(slot.room || 'team').toUpperCase(), slot.podX - 1.62, 1.1, slot.podZ, Math.PI / 4]));
        teams.forEach((slot, i) => this.roomFloorLabels.set(slot.room, labels[i]));
        this.flushStatics();
        this.statusAssets();
        this.makeConfetti();
        this.stripsDirty = true;
        if (this.state)
            this.update(this.state, this.statuses, this.lastBoard);
    }
    createActor(id, data, spot, look, { visitor = false, pickable = true } = {}) {
        const g = new THREE.Group();
        g.position.set(spot.x, 0, spot.z);
        g.rotation.y = spot.heading;
        this.scene.add(g);
        const h = hash(id), body = new THREE.Group();
        body.scale.setScalar(.95 + (h % 8) * .01);
        g.add(body);
        const parts = [];
        const material = this.mat('actor', 0xffffff, { rough: .72 });
        const box = this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), sphere = this.geo('aSphere', () => new THREE.SphereGeometry(1, 14, 10)), capsule = this.geo('aCapsule', () => new THREE.CapsuleGeometry(.5, 1, 4, 10));
        const add = (geo, color, parent, px, py, pz, sx, sy, sz) => { const m = new THREE.Mesh(geo, material); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.visible = false; m.userData.instanceColor = color; parent.add(m); parts.push(m); return m; };
        const skin = SKIN[h % SKIN.length], hair = HAIR[(h >>> 3) % HAIR.length], top = look.top, pants = look.pants ?? PANTS[(h >>> 5) % PANTS.length], shoes = look.shoes ?? SHOES[(h >>> 7) % SHOES.length];
        const legs = [], arms = [];
        for (const s of [-1, 1]) {
            const hip = new THREE.Group();
            hip.position.set(s * .095, .88, 0);
            body.add(hip);
            add(capsule, pants, hip, 0, -.21, 0, .15, .23, .16);
            const knee = new THREE.Group();
            knee.position.y = -.44;
            hip.add(knee);
            add(capsule, pants, knee, 0, -.2, 0, .12, .2, .13);
            add(box, shoes, knee, 0, -.42, .05, .11, .07, .24);
            legs.push({ hip, knee });
        }
        const hips = new THREE.Group();
        hips.position.y = .88;
        body.add(hips);
        add(box, pants, hips, 0, .02, 0, .32, .17, .2);
        add(capsule, top, hips, 0, .3, 0, .37, .27, .22);
        add(capsule, skin, hips, 0, .6, 0, .09, .06, .09);
        if (look.kind === 'director') {
            add(box, 0xf2efe8, hips, 0, .42, .1, .1, .22, .03);
            add(box, 0xc4a066, hips, 0, .38, .113, .035, .16, .01);
        }
        else if (visitor)
            add(box, 0xf4f1ea, hips, .07, .3, .112, .07, .09, .01);
        const head = new THREE.Group();
        head.position.y = .74;
        hips.add(head);
        add(sphere, skin, head, 0, 0, 0, .1, .12, .11);
        add(sphere, hair, head, 0, .035, -.018, .108, .108, .115);
        const style = (h >>> 9) % 4;
        if (style === 1)
            add(box, hair, head, 0, -.07, -.07, .2, .2, .08);
        else if (style === 2)
            add(sphere, hair, head, 0, .1, -.1, .055, .055, .055);
        for (const s of [-1, 1])
            add(sphere, EYE, head, s * .038, .012, .098, .014, .017, .01);
        for (const s of [-1, 1]) {
            const shoulder = new THREE.Group();
            shoulder.position.set(s * .225, .5, 0);
            hips.add(shoulder);
            add(capsule, top, shoulder, 0, -.14, 0, .095, .15, .1);
            const elbow = new THREE.Group();
            elbow.position.y = -.29;
            shoulder.add(elbow);
            add(capsule, top, elbow, 0, -.12, 0, .08, .13, .08);
            add(sphere, skin, elbow, 0, -.27, 0, .042, .05, .042);
            arms.push({ shoulder, elbow, side: s });
        }
        if (pickable) {
            // A single broad invisible pick target makes small people easy to select.
            const pick = new THREE.Mesh(this.geo('pick', () => new THREE.BoxGeometry(.8, 1.75, .8)), this.mat('pick', 0, { opacity: 0 }));
            pick.position.y = .85;
            pick.visible = false;
            pick.userData.actorId = id;
            g.add(pick);
            this.pickables.push(pick);
        }
        const actor = {
            id, data, kind: look.kind || (visitor ? 'visitor' : 'role'), group: g, body, parts, rig: { hips, head, legs, arms },
            phase: (h % 100) / 10, lane: ((h >>> 11) % 7 - 3) * .1, pace: 1.25 + ((h >>> 14) % 6) * .06, visitor, busy: false, status: null, burst: 0, nod: 0, hop: 0, fade: 1, leaving: false,
            home: new THREE.Vector3(spot.x, 0, spot.z), target: new THREE.Vector3(spot.x, 0, spot.z), path: [], pathIndex: 0, spot, mode: spot.seated ? 'desk' : 'waiting',
            heading: spot.heading, goalHeading: spot.heading, walkDir: spot.heading, sit: spot.seated ? 1 : 0, lookYaw: spot.look || 0, badgeY: spot.seated ? 1.58 : 2.02, deskIndex: null,
        };
        if (!visitor && pickable && this.tagLayer) {
            const tag = document.createElement('div');
            tag.className = 'role-tag';
            tag.textContent = ROLE_SHORT[id] || id.replace(/-/g, ' ');
            tag.style.setProperty('--tag', `#${top.toString(16).padStart(6, '0')}`);
            this.tagLayer.append(tag);
            actor.roleTag = tag;
            this.roleLabels.set(id, tag);
        }
        this.actors.set(id, actor);
        this.actorList = [...this.actors.values()];
        this.actorBatchesDirty = true;
        return actor;
    }
    removeActor(id) {
        const actor = this.actors.get(id);
        if (!actor)
            return;
        this.scene.remove(actor.group);
        this.roleLabels.get(id)?.remove();
        this.roleLabels.delete(id);
        if (this.speechActor === id)
            this.hideSpeech();
        this.pickables = this.pickables.filter(p => p.userData.actorId !== id);
        this.actors.delete(id);
        this.actorList = [...this.actors.values()];
        this.actorBatchesDirty = true;
        this.stripsDirty = true;
    }
    batchActors() {
        // Every body part keeps a local transform for articulation, but all people share one material
        // and three geometries: the whole cast is three instanced draws, coloured per instance.
        for (const batch of this.actorBatches || []) {
            this.scene.remove(batch.mesh);
            batch.mesh.dispose();
        }
        const groups = new Map();
        for (const actor of this.actors.values()) {
            // Working agents keep their full colour; everyone else recedes so the active ones read first.
            const dim = actor.status === 'working' ? 1 : actor.status === 'pending' ? .92 : actor.status === 'failed' ? 1 : actor.status === 'completed' ? .95 : .8;
            for (const part of actor.parts)
                part.userData.dim = dim;
        }
        for (const actor of this.actors.values())
            for (const part of actor.parts) {
                const key = `${part.geometry.uuid}:${part.material.uuid}`;
                if (!groups.has(key))
                    groups.set(key, []);
                groups.get(key).push(part);
            }
        this.actorBatches = [];
        for (const parts of groups.values()) {
            const mesh = new THREE.InstancedMesh(parts[0].geometry, parts[0].material, parts.length);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            parts.forEach((part, index) => mesh.setColorAt(index, _color.setHex(part.userData.instanceColor ?? 0xffffff).multiplyScalar(part.userData.dim ?? 1)));
            mesh.instanceColor.needsUpdate = true;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.actorBatches.push({ mesh, parts });
        }
        this.actorBatchesDirty = false;
        this.buildStatusLayer();
    }
    // Shared generated textures/materials for every status cue: one draw call per layer, not per agent.
    statusAssets() {
        if (this.statusKit)
            return this.statusKit;
        const flat = this.geo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
        const ring = this.canvasTexture(128, 128, c => {
            const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(.5, 'rgba(255,255,255,.06)');
            g.addColorStop(.72, 'rgba(255,255,255,.9)');
            g.addColorStop(.8, 'rgba(255,255,255,.4)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g;
            c.fillRect(0, 0, 128, 128);
        });
        const atlas = this.canvasTexture(128 * BADGE_CELLS, 128, c => this.paintBadges(c));
        const halo = new THREE.MeshBasicMaterial({ map: ring, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const strip = new THREE.MeshBasicMaterial({ toneMapped: false });
        // Camera-facing quads that pick an atlas cell per instance; the working cell gets a rotating arc.
        const badge = new THREE.ShaderMaterial({
            uniforms: { map: { value: atlas }, time: { value: 0 } },
            vertexShader: `
                attribute vec4 badge;
                varying vec2 vUv;
                varying vec4 vBadge;
                void main() {
                    vUv = uv;
                    vBadge = badge;
                    vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    // Grow gently with distance: readable at overview zoom, modest in close-ups.
                    mv.xy += position.xy * badge.w * clamp(-mv.z / 22.0, 1.0, 2.4);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform sampler2D map;
                uniform float time;
                varying vec2 vUv;
                varying vec4 vBadge;
                vec4 cell(float index, vec2 uv) { return texture2D(map, vec2((index + clamp(uv.x, .004, .996)) / ${BADGE_CELLS}.0, clamp(uv.y, .004, .996))); }
                void main() {
                    vec4 c = cell(vBadge.x, vUv);
                    if (vBadge.z > .5) {
                        float a = -time * 4.0;
                        vec2 p = vUv - .5;
                        p = vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y) + .5;
                        vec4 arc = cell(${BADGE_CELLS - 1}.0, p);
                        c = vec4(mix(c.rgb, arc.rgb, arc.a), max(c.a, arc.a));
                    }
                    c.a *= vBadge.y;
                    if (c.a < .01) discard;
                    gl_FragColor = c;
                    #include <colorspace_fragment>
                }`,
            transparent: true,
            depthWrite: false,
            toneMapped: false
        });
        this.materials.set('statusHalo', halo);
        this.materials.set('statusStrip', strip);
        this.materials.set('statusBadge', badge);
        return this.statusKit = { flat, halo, strip, badge, contact: this.contactMaterial() };
    }
    // Badge atlas: working, completed, pending, failed, idle, spinner arc. Shape differs per status, not only colour.
    paintBadges(c) {
        const cell = (i, status, glyph) => {
            const color = STATUS_META[status].color;
            c.save();
            c.translate(i * 128 + 64, 64);
            c.beginPath();
            if (status === 'failed') {
                c.moveTo(0, -50);
                c.lineTo(52, 42);
                c.lineTo(-52, 42);
                c.closePath();
            }
            else
                c.arc(0, 0, 45, 0, Math.PI * 2);
            c.fillStyle = 'rgba(4,14,26,.94)';
            c.fill();
            c.lineWidth = 7;
            c.lineJoin = 'round';
            c.strokeStyle = color;
            c.globalAlpha = status === 'working' ? .3 : 1;
            c.stroke();
            c.globalAlpha = 1;
            c.fillStyle = color;
            c.lineWidth = 11;
            c.lineCap = 'round';
            glyph();
            c.restore();
        };
        cell(0, 'working', () => { c.beginPath(); c.moveTo(-11, -18); c.lineTo(20, 0); c.lineTo(-11, 18); c.closePath(); c.fill(); });
        cell(1, 'completed', () => { c.beginPath(); c.moveTo(-21, 2); c.lineTo(-6, 17); c.lineTo(22, -15); c.stroke(); });
        cell(2, 'pending', () => {
            // Hourglass: two glass bulbs meeting at a waist, sand settled in the lower bulb.
            c.lineWidth = 6;
            c.lineJoin = 'round';
            c.beginPath();
            c.moveTo(-15, -22); c.lineTo(15, -22); c.lineTo(2, -1); c.lineTo(15, 22); c.lineTo(-15, 22); c.lineTo(-2, -1);
            c.closePath();
            c.stroke();
            c.beginPath(); c.moveTo(-21, -25); c.lineTo(21, -25); c.moveTo(-21, 25); c.lineTo(21, 25); c.stroke();
            c.beginPath(); c.moveTo(0, 7); c.lineTo(10, 19); c.lineTo(-10, 19); c.closePath(); c.fill();
        });
        cell(3, 'failed', () => { c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 8); c.stroke(); c.beginPath(); c.arc(0, 25, 6, 0, Math.PI * 2); c.fill(); });
        cell(4, 'idle', () => { c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill(); });
        c.save();
        c.translate((BADGE_CELLS - 1) * 128 + 64, 64);
        c.strokeStyle = STATUS_META.working.color;
        c.lineWidth = 8;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(0, 0, 45, -Math.PI / 2, Math.PI / 4);
        c.stroke();
        c.restore();
    }
    buildStatusLayer() {
        for (const mesh of this.statusMeshes || []) {
            this.scene.remove(mesh);
            mesh.dispose();
        }
        this.badgeGeometry?.dispose();
        const kit = this.statusAssets(), list = [...this.actors.values()], n = Math.max(1, list.length), black = new THREE.Color(0);
        const make = (geo, mat, count, order) => {
            const mesh = new THREE.InstancedMesh(geo, mat, count);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.renderOrder = order;
            for (let i = 0; i < count; i++)
                mesh.setMatrixAt(i, _matrix.makeScale(0, 0, 0));
            this.scene.add(mesh);
            return mesh;
        };
        this.badgeGeometry = new THREE.PlaneGeometry(1, 1);
        const badgeAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.badgeGeometry.setAttribute('badge', badgeAttr);
        const desks = list.filter(a => a.desk && !a.visitor);
        const layer = { list, desks, badgeAttr, shadows: make(kit.flat, kit.contact, n, 1), halos: make(kit.flat, kit.halo, n, 2), bursts: make(kit.flat, kit.halo, n, 3), badges: make(this.badgeGeometry, kit.badge, n, 20), strips: desks.length ? make(this.geometries.get('box'), kit.strip, desks.length, 0) : null };
        for (let i = 0; i < n; i++) {
            layer.halos.setColorAt(i, black);
            layer.bursts.setColorAt(i, black);
        }
        // Desk-edge status strips are static geometry; only their instance colours change.
        desks.forEach((a, i) => {
            layer.strips.setMatrixAt(i, _matrix.compose(_position.set(a.desk.x, .752, a.desk.z + a.desk.side * .352), _quat.identity(), _scale.set(1.3, .012, .012)));
            layer.strips.setColorAt(i, black);
        });
        this.statusLayer = layer;
        this.statusMeshes = [layer.shadows, layer.halos, layer.bursts, layer.badges, layer.strips].filter(Boolean);
        this.stripsDirty = true;
    }
    updateStatusLayer(dt) {
        const layer = this.statusLayer;
        if (!layer)
            return;
        if (this.screens && this.frameDt > 0)
            this.paintScreens();
        const t = this.clock || 0, calm = this.reduced, list = layer.list;
        _quat.identity();
        for (let i = 0; i < list.length; i++) {
            const a = list[i], p = a.group.position, status = a.status || 'idle', lit = !!this.highlighted?.has(a.id), wave = Math.sin(t * 3.2 + a.phase), f = a.fade ?? 1;
            layer.shadows.setMatrixAt(i, _matrix.compose(_position.set(p.x, .012, p.z), _quat, _scale.set(.8 * f, 1, .7 * f)));
            // Halo brightness carries the status rhythm. Reduced motion keeps colour plus a slow opacity breath, no scaling.
            let glow = 0, size = 1.1;
            if (status === 'working') {
                glow = calm ? .85 + Math.sin(t * 1.9 + a.phase) * .12 : .9 + wave * .3;
                size = calm ? 1.1 : 1.1 + wave * .05;
            }
            else if (status === 'completed')
                glow = .8;
            else if (status === 'pending')
                glow = .5 + Math.sin(t * (calm ? 1.2 : 1.7) + a.phase) * (calm ? .1 : .25);
            else if (status === 'failed')
                glow = calm ? .7 : .4 + .4 * THREE.MathUtils.smoothstep(Math.sin(t * 2.4), -.25, .25);
            if (a.burst > 0) {
                a.burst = Math.max(0, a.burst - dt / 1.5);
                if (calm)
                    glow += a.burst * .8;
            }
            if (lit)
                glow = Math.max(glow * 1.35, .8);
            layer.halos.setColorAt(i, _color.copy(lit && status === 'idle' ? _ice : STATUS_COLORS[status]).multiplyScalar(glow));
            layer.halos.setMatrixAt(i, _matrix.compose(_position.set(p.x, .02, p.z), _quat, _scale.setScalar(glow ? size * f : 0)));
            // A brief expanding ring marks the observed transition to completed.
            const burst = calm ? 0 : a.burst;
            layer.bursts.setColorAt(i, _color.copy(STATUS_COLORS.completed).multiplyScalar(burst * 1.4));
            layer.bursts.setMatrixAt(i, _matrix.compose(_position.set(p.x, .03, p.z), _quat, _scale.setScalar(burst ? (1.1 + (1 - burst) * 2.4) * f : 0)));
            const bob = calm || status !== 'working' ? 0 : Math.sin(t * 2.2 + a.phase) * .025;
            layer.badges.setMatrixAt(i, _matrix.compose(_position.set(p.x, p.y + a.badgeY + bob, p.z), _quat, _scale.setScalar(f)));
            layer.badgeAttr.setXYZW(i, BADGE_INDEX[status] ?? 4, (status === 'pending' && !calm ? .8 + wave * .2 : 1) * f, status === 'working' ? 1 : 0, status === 'idle' ? 0 : .3 * f);
        }
        layer.shadows.instanceMatrix.needsUpdate = true;
        layer.halos.instanceMatrix.needsUpdate = true;
        layer.bursts.instanceMatrix.needsUpdate = true;
        layer.badges.instanceMatrix.needsUpdate = true;
        layer.halos.instanceColor.needsUpdate = true;
        layer.bursts.instanceColor.needsUpdate = true;
        layer.badgeAttr.needsUpdate = true;
        layer.badges.material.uniforms.time.value = calm ? 0 : t;
        if (this.stripsDirty) {
            this.stripsDirty = false;
            const gain = { working: 1.5, completed: 1, pending: 1, failed: 1.1, idle: .18 };
            if (layer.strips) {
                for (let i = 0; i < layer.desks.length; i++) {
                    const a = layer.desks[i], s = a.status || 'idle';
                    layer.strips.setColorAt(i, _color.copy(STATUS_COLORS[s]).multiplyScalar(a.mode === 'desk' && !a.leaving ? gain[s] : .08));
                }
                layer.strips.instanceColor.needsUpdate = true;
            }
            this.paintScreens();
        }
    }
    // Monitors follow their owner: bright while working, dim while idle, a screensaver glow when away.
    paintScreens() {
        if (!this.screens)
            return;
        const owners = this.screenOwners ||= new Array(this.desks.length);
        owners.fill(null);
        for (const a of this.actors.values())
            if (a.deskIndex != null && a.deskIndex < owners.length)
                owners[a.deskIndex] = a;
        for (let i = 0; i < owners.length; i++) {
            const a = owners[i];
            if (!a || a.leaving)
                _color.setScalar(.025);
            else if (a.mode !== 'desk')
                _color.setScalar(.07);
            else {
                const s = a.status || 'idle';
                // A lit screen that breathes is the clearest "someone is typing in there" cue at distance.
                const pulse = s === 'working' && !this.reduced ? .86 + .14 * Math.sin((this.clock || 0) * 3.1 + i) : 1;
                _color.copy(s === 'failed' ? _failRed : a.screenColor || _ice).multiplyScalar((SCREEN_GAIN[s] ?? .14) * pulse);
            }
            this.screens.setColorAt(i, _color);
        }
        this.screens.instanceColor.needsUpdate = true;
    }
    updateActorInstances() {
        if (this.actorBatchesDirty)
            this.batchActors();
        const actors = this.actorList || [], batches = this.actorBatches || [];
        for (let i = 0; i < actors.length; i++)
            actors[i].group.updateMatrixWorld(true);
        for (let b = 0; b < batches.length; b++) {
            const { mesh, parts } = batches[b];
            for (let i = 0; i < parts.length; i++)
                mesh.setMatrixAt(i, parts[i].matrixWorld);
            mesh.instanceMatrix.needsUpdate = true;
        }
        this.updateStatusLayer(this.frameDt || 0);
    }
    setStatus(a, status) {
        if (a.status === status)
            return;
        if (celebratesCompletion(a.status, status)) {
            a.burst = 1;
            a.nod = 1;
            a.hop = 1;
            a.celebrateUntil = (this.clock || 0) + 7;
            this.burstConfetti(a);
        }
        a.status = status;
        a.busy = status === 'working';
        this.stripsDirty = true;
        this.actorBatchesDirty = true;
    }
    // ---- Routing & placement --------------------------------------------------------------------
    /** Point the actor at a new spot. Walks along the aisles; a move within the same desk is a short step. */
    place(actor, spot, mode) {
        if (actor.mode !== mode)
            this.stripsDirty = true;
        actor.mode = mode;
        if (actor.spot?.key === spot.key) {
            actor.settled = true;
            return;
        }
        const walking = actor.pathIndex < actor.path.length, from = actor.spot;
        if (!actor.settled && mode !== 'off-duty') {
            // The first state after load shows where everyone is now; it does not replay their walks.
            actor.path = [];
            actor.group.position.set(spot.x, 0, spot.z);
            actor.heading = actor.group.rotation.y = spot.heading;
            actor.sit = spot.seated ? 1 : 0;
        }
        else if (from && from.group && from.group === spot.group) {
            if (!walking)
                actor.path = [];
        }
        else if (from?.exit?.length && spot.exit?.length) {
            let prefix = from.exit;
            if (walking) {
                // Re-routed mid-walk: return to the nearest aisle junction already on the current route.
                prefix = [];
                const unshift = p => pt(p.x - actor.lane, p.z - actor.lane);
                for (let i = actor.pathIndex - 1; i >= 0; i--) {
                    prefix.push(unshift(actor.path[i]));
                    if (onSpine(actor.path[i]))
                        break;
                }
                if (!prefix.length || !onSpine(prefix[prefix.length - 1])) {
                    prefix = [];
                    for (let i = actor.pathIndex; i < actor.path.length; i++) {
                        prefix.push(unshift(actor.path[i]));
                        if (onSpine(actor.path[i]))
                            break;
                    }
                }
            }
            actor.path = routeBetween(prefix.length ? prefix : from.exit, spot.exit).map(p => new THREE.Vector3(p.x, 0, p.z));
        }
        else
            actor.path = [];
        actor.pathIndex = 0;
        actor.settled = true;
        // A small personal lane offset keeps people walking the same aisle from overlapping.
        for (let i = 0; i < actor.path.length; i++) {
            actor.path[i].x += actor.lane;
            actor.path[i].z += actor.lane;
        }
        actor.spot = spot;
        actor.target.set(spot.x, 0, spot.z);
        actor.goalHeading = spot.heading;
        actor.lookYaw = spot.look || 0;
        this.stripsDirty = true;
    }
    // Morning (or a manual switch away from night): the next placement walks them back in through the door.
    comeBack(actor) {
        actor.leaving = false;
    }
    update(state, statuses = new Map(), board) {
        this.state = state;
        this.statuses = statuses;
        this.lastBoard = board;
        this.drawTasks(board);
        this.drawQuota(state.quotas || []);
        const now = this.clock || 0, phase = this.currentPhase;
        // Orca workers that map to no roster role are visitors: busy ones take a hot-desk, the rest wait in the corridor.
        const represented = new Set();
        for (const [id, entry] of statuses)
            if (!id.startsWith('worker:') && entry?.worker?.dispatchId)
                represented.add(entry.worker.dispatchId);
        const visitors = [];
        for (const worker of state.workers || []) {
            if (!worker.dispatchId || represented.has(worker.dispatchId) || (worker.agent && this.actors.has(worker.agent)))
                continue;
            const id = `worker:${worker.dispatchId}`;
            let actor = this.actors.get(id);
            if (!actor)
                actor = this.createActor(id, worker, corridorSpot(hash(id) % 6), { top: 0xb7ae9f, pants: 0x3a3d42 }, { visitor: true });
            actor.data = worker;
            this.setStatus(actor, (statuses.get(id) || workerStatus(worker)).status);
            visitors.push(actor);
        }
        const present = new Set(visitors.map(actor => actor.id));
        for (const [id, actor] of [...this.actors])
            if (actor.visitor && !present.has(id))
                this.removeActor(id);
        visitors.sort((a, b) => a.id.localeCompare(b.id));
        let hot = 0, queue = 0;
        for (const actor of visitors) {
            this.comeBack(actor);
            const desk = actor.busy ? this.spareDesks?.[hot] : null;
            if (desk) {
                hot++;
                actor.deskIndex = desk.index;
                this.place(actor, deskSpot(desk), 'desk');
            }
            else {
                actor.deskIndex = null;
                this.place(actor, corridorSpot(queue++), 'waiting');
            }
        }
        const crew = [];
        for (const [id, actor] of this.actors) {
            if (actor.visitor || actor.kind === 'director')
                continue;
            this.setStatus(actor, statuses.get(id)?.status || 'idle');
            crew.push(actor);
        }
        // Two or more working roles on the same task meet at the table, one chair each.
        const tasks = new Map();
        for (const actor of crew) {
            const key = actor.status === 'working' ? String(statuses.get(actor.id)?.task || '').trim().toLowerCase() : '';
            if (key)
                tasks.set(key, [...(tasks.get(key) || []), actor.id]);
        }
        const meeting = phase === 'night' ? new Map() : new Map([...tasks.values()].filter(ids => ids.length >= 2).flat().sort().slice(0, MEETING_SEATS.length).map((id, i) => [id, i]));
        // The lounge holds the first few roles resting after a completed task, never more than its capacity.
        const resting = phase === 'night' ? [] : crew.filter(a => a.status === 'completed' && !meeting.has(a.id) && !(a.celebrateUntil > now)).map(a => a.id).sort().slice(0, LOUNGE_CAPACITY);
        const lounge = new Map(resting.map((id, i) => [id, i]));
        for (const actor of crew) {
            this.comeBack(actor);
            if (meeting.has(actor.id))
                this.place(actor, MEETING_SEATS[meeting.get(actor.id)], 'meeting');
            else if (lounge.has(actor.id))
                this.place(actor, LOUNGE_SEATS[lounge.get(actor.id)], 'lounge');
            else if (actor.desk)
                this.place(actor, deskSpot(actor.desk, actor.status === 'idle' || actor.status === 'working' ? 'seat' : 'stand'), 'desk');
        }
        // The orchestrator works whenever a coordinator session or any worker is live.
        const director = this.actors.get(DIRECTOR_ID);
        if (director) {
            const live = (state.paseo || []).some(session => session.status === 'running') || (state.workers || []).some(worker => worker.workerState === 'running');
            this.setStatus(director, live ? 'working' : 'idle');
            this.comeBack(director);
            this.place(director, DIRECTOR_SEAT, 'director');
        }
        this.stripsDirty = true;
        if (this.container) {
            this.container.dataset.lounge = String(lounge.size);
            this.container.dataset.meeting = String(meeting.size);
        }
        const event = state.audit?.events?.at(-1), eventKey = event ? `${event.ts}:${event.agent}:${event.kind}` : null;
        if (this.lastEvent && eventKey !== this.lastEvent)
            this.pulse = 1;
        this.lastEvent = eventKey;
    }
    // ---- Motion ---------------------------------------------------------------------------------
    stepActor(a, t, dt) {
        const p = a.group.position;
        let moving = false, budget = (a.leaving ? a.pace + .6 : a.pace) * dt;
        while (budget > 0) {
            const walking = a.pathIndex < a.path.length, goal = walking ? a.path[a.pathIndex] : a.target;
            const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
            if (d < 1e-4) {
                if (walking) {
                    a.pathIndex++;
                    continue;
                }
                break;
            }
            moving = true;
            a.walkDir = Math.atan2(dx, dz);
            if (d <= budget) {
                p.x = goal.x;
                p.z = goal.z;
                budget -= d;
                if (walking)
                    a.pathIndex++;
                else
                    break;
            }
            else {
                p.x += dx / d * budget;
                p.z += dz / d * budget;
                budget = 0;
            }
        }
        const arrived = !moving && a.pathIndex >= a.path.length;
        a.heading += wrapAngle((moving ? a.walkDir : this.restHeading(a)) - a.heading) * (1 - Math.exp(-dt * (moving ? 10 : 5)));
        a.group.rotation.y = a.heading;
        const sit = arrived && a.spot?.seated ? 1 : 0;
        a.sit += (sit - a.sit) * (1 - Math.exp(-dt * 7));
        if (Math.abs(sit - a.sit) < .002)
            a.sit = sit;
        a.badgeY = 2.02 - .44 * a.sit;
        this.fadeActor(a, a.leaving && p.z > FLOOR.maxZ - .3 ? 0 : 1, dt);
        let hop = 0;
        if (a.hop > 0) {
            a.hop = Math.max(0, a.hop - dt / 1.05);
            hop = Math.sin((1 - a.hop) * Math.PI) * .45;
        }
        p.y = hop + (moving ? Math.abs(Math.sin(t * 7.2 + a.phase)) * .025 : 0);
        this.pose(a, t, dt, moving);
    }
    restHeading(a) {
        if (a.mode === 'desk' && a.spot && !a.spot.seated) {
            if (a.status === 'failed')
                return a.goalHeading + Math.PI;
            if (a.status === 'completed')
                return CAMERA_HEADING;
        }
        return a.goalHeading;
    }
    pose(a, t, dt, moving) {
        const s = _stand, c = _sit, ph = a.phase, st = a.status || 'idle', calm = this.reduced;
        s.hipY = .88; s.lean = 0; s.thighL = s.thighR = 0; s.kneeL = s.kneeR = 0;
        s.shXL = s.shXR = .04; s.abdL = s.abdR = .07; s.elL = s.elR = -.12; s.headP = 0; s.headY = Math.sin(t * .5 + ph) * .25;
        if (moving) {
            const w = Math.sin(t * 7.2 + ph);
            s.thighL = w * .42; s.thighR = -w * .42; s.kneeL = Math.max(0, -w) * .65; s.kneeR = Math.max(0, w) * .65;
            s.shXL = -w * .36; s.shXR = w * .36; s.elL = s.elR = -.3; s.headY = 0; s.headP = .04;
        }
        else if (st === 'pending') {
            s.shXL = s.shXR = -.55; s.abdL = s.abdR = -.3; s.elL = s.elR = -1.75;
            s.headY = Math.sin(t * .7 + ph) * .45;
            s.kneeR = Math.max(0, Math.sin(t * 3.4 + ph)) * .2; s.thighR = -s.kneeR * .4;
        }
        else if (st === 'failed') {
            s.lean = .1; s.headP = .5; s.headY = 0; s.shXL = s.shXR = .08; s.abdL = s.abdR = .02; s.elL = s.elR = -.05;
        }
        else if (st === 'completed') {
            if (a.celebrateUntil > this.clock) {
                const b = calm ? 0 : Math.sin(t * 6 + ph);
                s.shXL = s.shXR = -.15; s.abdL = s.abdR = 2.5 + b * .14; s.elL = s.elR = -.25; s.headP = -.25; s.headY = 0;
            }
            else {
                s.shXL = -.25; s.shXR = .15; s.abdL = .2; s.abdR = .12; s.elL = -.5; s.headP = -.08;
            }
        }
        c.hipY = .55; c.lean = 0; c.thighL = c.thighR = -1.45; c.kneeL = c.kneeR = 1.3; c.headP = 0; c.headY = 0;
        c.shXL = c.shXR = 0; c.abdL = c.abdR = .1; c.elL = c.elR = -.6;
        if (a.mode === 'lounge') {
            c.lean = -.32; c.thighL = c.thighR = -1.25; c.kneeL = 1.0; c.kneeR = 1.15; c.shXL = c.shXR = .12; c.abdL = c.abdR = .3; c.elL = c.elR = -.55;
            c.headP = -.08; c.headY = Math.sin(t * .45 + ph) * .5;
        }
        else if (a.mode === 'meeting') {
            const g = calm ? 0 : Math.max(0, Math.sin(t * .9 + ph * 3));
            c.lean = .06; c.shXL = -.5; c.shXR = -.5 - g * .5; c.abdL = c.abdR = .08; c.elL = -.95; c.elR = -.95 + g * .4;
            c.headP = .02; c.headY = a.lookYaw + Math.sin(t * .4 + ph) * .15;
        }
        else if (st === 'working') {
            const k = calm ? 0 : Math.sin(t * 9 + ph) * .07;
            c.lean = .14; c.shXL = -.5 + k; c.shXR = -.5 - k; c.abdL = c.abdR = .05; c.elL = c.elR = -1.0;
            c.headP = .16; c.headY = Math.sin(t * .35 + ph) * .08;
        }
        else {
            // Idle at the desk: leaning back, hands in the lap, glancing around.
            c.lean = -.24; c.thighL = c.thighR = -1.35; c.kneeL = c.kneeR = 1.1; c.shXL = c.shXR = .1; c.abdL = c.abdR = .18; c.elL = c.elR = -.75;
            c.headP = -.12; c.headY = Math.sin(t * .3 + ph) * .35;
        }
        if (a.nod > 0) {
            a.nod = calm ? 0 : Math.max(0, a.nod - dt / 1.6);
            s.headP = c.headP = Math.sin((1 - a.nod) * Math.PI * 4) * .22 * a.nod;
        }
        const k = a.sit, { hips, head, legs, arms } = a.rig;
        const hipY = blend('hipY', k);
        hips.position.y = hipY;
        hips.rotation.x = blend('lean', k);
        legs[0].hip.position.y = legs[1].hip.position.y = hipY;
        legs[0].hip.rotation.x = blend('thighL', k);
        legs[1].hip.rotation.x = blend('thighR', k);
        legs[0].knee.rotation.x = blend('kneeL', k);
        legs[1].knee.rotation.x = blend('kneeR', k);
        arms[0].shoulder.rotation.set(blend('shXL', k), 0, -blend('abdL', k));
        arms[1].shoulder.rotation.set(blend('shXR', k), 0, blend('abdR', k));
        arms[0].elbow.rotation.x = blend('elL', k);
        arms[1].elbow.rotation.x = blend('elR', k);
        head.rotation.set(blend('headP', k), blend('headY', k), 0);
    }
    fadeActor(a, goal, dt) {
        if (a.fade === goal)
            return;
        a.fade = goal > a.fade ? Math.min(goal, a.fade + dt / .9) : Math.max(goal, a.fade - dt / .9);
        a.group.scale.setScalar(Math.max(.001, a.fade));
    }
    // ---- Screens --------------------------------------------------------------------------------
    drawTasks(board) {
        if (!this.taskCanvas)
            return;
        const c = this.taskCanvas.getContext('2d'), W = 768, H = 432;
        c.fillStyle = '#0b1117';
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#e9dcc3';
        c.font = `600 34px ${SANS}`;
        c.textAlign = 'left';
        c.fillText('LIVE DISPATCH', 40, 62);
        c.fillStyle = 'rgba(201,165,108,.5)';
        c.fillRect(40, 84, W - 80, 2);
        c.font = `28px ${SANS}`;
        if (!board) {
            c.fillStyle = '#8c98a3';
            c.fillText('Awaiting state', 40, 150);
        }
        else {
            c.fillStyle = '#aab6c0';
            c.fillText(`${board.source.toUpperCase()} · ${board.total} TASKS`, 40, 132);
            const done = board.source === 'Orca' ? 'completed' : 'done';
            [['running', 'working'], ['pending', 'pending'], ['blocked', 'failed'], [done, 'completed']].forEach(([lane, status], i) => {
                const y = 196 + i * 62, color = STATUS_META[status].color;
                c.fillStyle = color;
                c.beginPath();
                c.arc(52, y - 10, 9, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = '#e6edf2';
                c.font = `28px ${SANS}`;
                c.fillText(lane.toUpperCase(), 76, y);
                c.fillStyle = color;
                c.font = `700 34px ${MONO}`;
                c.textAlign = 'right';
                c.fillText(String(board.counts[lane] || 0), W - 40, y);
                c.textAlign = 'left';
            });
        }
        this.taskTexture.needsUpdate = true;
    }
    drawMarket(data) {
        if (!this.marketCanvas)
            return;
        const c = this.marketCanvas.getContext('2d'), W = 1024, H = 512, view = marketScreen(data);
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.fillStyle = '#05090e';
        c.fillRect(0, 0, W, H);
        c.font = `700 52px ${MONO}`;
        c.fillStyle = '#9fd8ef';
        c.fillText('BTC / USD', 40, 78);
        c.textAlign = 'right';
        c.fillStyle = view.signal ? '#4fe08f' : '#ff5d6c';
        c.fillText(view.signal ? '● LIVE' : '● OFF', W - 40, 78);
        c.textAlign = 'left';
        if (!view.signal) {
            c.fillStyle = 'rgba(255,255,255,.05)';
            for (let y = 110; y < H - 20; y += 14)
                c.fillRect(20, y, W - 40, 5);
            c.textAlign = 'center';
            c.fillStyle = '#ff5d6c';
            c.font = `800 168px ${MONO}`;
            c.fillText('NO SIGNAL', W / 2, 320);
            c.fillStyle = '#c3ced8';
            c.font = `600 52px ${MONO}`;
            c.fillText('MARKET FEED OFFLINE', W / 2, 420);
        }
        else {
            c.fillStyle = '#ffffff';
            c.font = `800 168px ${MONO}`;
            c.fillText(view.price, 32, 248);
            c.fillStyle = view.trend === 'down' ? '#ff6b78' : view.trend === 'up' ? '#4fe08f' : '#9fb3c4';
            c.font = `700 62px ${MONO}`;
            c.fillText(view.change, 40, 326);
            c.fillStyle = '#ffb547';
            c.font = `800 122px ${MONO}`;
            c.fillText(view.fearGreed, 32, 476);
            const x = 64 + c.measureText(view.fearGreed).width;
            c.fillStyle = '#ffffff';
            c.font = `700 66px ${MONO}`;
            c.fillText(view.mood, x, 420);
            c.fillStyle = '#9fb3c4';
            c.font = `600 42px ${MONO}`;
            c.fillText('FEAR & GREED', x, 474);
        }
        this.marketTexture.needsUpdate = true;
    }
    setMarket(data) {
        this.drawMarket(data);
        if (this.container)
            this.container.dataset.market = marketScreen(data).signal ? 'live' : 'no-signal';
    }
    drawQuota(quotas) {
        if (!this.quotaCanvas)
            return;
        const rows = quotaSignRows(quotas), summary = rows.map(row => `${row.name} ${row.label}`).join(' · ') || 'none';
        // State polls every two seconds; only repaint and re-upload when the sign's text changes.
        if (summary === this.quotaSummary)
            return;
        this.quotaSummary = summary;
        if (this.container)
            this.container.dataset.quota = summary;
        const c = this.quotaCanvas.getContext('2d'), W = 1024, H = 384;
        const tone = pct => pct == null ? '#7f93a8' : pct < 20 ? '#ff5d6c' : pct < 50 ? '#ffb547' : '#4fe08f';
        c.textBaseline = 'alphabetic';
        c.fillStyle = '#070b0f';
        c.fillRect(0, 0, W, H);
        c.textAlign = 'left';
        c.fillStyle = '#d9c39a';
        c.font = `700 40px ${MONO}`;
        c.fillText('AI QUOTA LEFT', 32, 52);
        if (!rows.length) {
            c.textAlign = 'center';
            c.fillStyle = '#ffb547';
            c.font = `800 118px ${MONO}`;
            c.fillText('NO QUOTA', W / 2, 200);
            c.fillText('DATA', W / 2, 330);
        }
        // Two large rows so provider and percentage both read from the default camera.
        rows.forEach((row, index) => {
            const y = 186 + index * 150;
            c.textAlign = 'left';
            c.fillStyle = '#f2f8fc';
            c.font = `800 104px ${MONO}`;
            c.fillText(row.name.slice(0, 9), 28, y);
            c.textAlign = 'right';
            c.fillStyle = tone(row.pct);
            c.font = `800 124px ${MONO}`;
            c.fillText(row.label, W - 28, y + 4);
            c.fillStyle = '#1b2731';
            c.fillRect(28, y + 22, W - 56, 12);
            if (row.pct != null) {
                c.fillStyle = tone(row.pct);
                c.fillRect(28, y + 22, (W - 56) * row.pct / 100, 12);
            }
        });
        this.quotaTexture.needsUpdate = true;
        this.drawScoreboard(rows);
    }
    // Reception repeater: one provider per half, the percentage as tall as the board allows.
    drawScoreboard(rows) {
        if (!this.scoreCanvas)
            return;
        const c = this.scoreCanvas.getContext('2d'), { w: W, h: H, digitTop, digitBase } = SCORE_CANVAS, half = W / 2;
        const tone = pct => pct == null ? '#7f93a8' : pct < 20 ? '#ff5d6c' : pct < 50 ? '#ffb547' : '#4fe08f';
        const digitFont = size => `condensed 800 ${size}px "Bahnschrift", "Avenir Next Condensed", "Arial Narrow", ${SANS}`;
        c.fillStyle = '#16110d';
        c.fillRect(0, 0, W, H);
        c.textBaseline = 'alphabetic';
        // Glyph cap height is ~0.72 em; size the font so the digits fill digitTop → digitBase.
        const size = Math.round((digitBase - digitTop) / .72);
        if (!rows.length) {
            c.textAlign = 'center';
            c.fillStyle = '#ffb547';
            c.font = digitFont(Math.round(size * .55));
            c.fillText('NO QUOTA DATA', W / 2, (digitTop + digitBase) / 2 + size * .2);
        }
        rows.forEach((row, index) => {
            const x0 = index * half + 44, x1 = (index + 1) * half - 44;
            c.textAlign = 'left';
            c.fillStyle = '#d9c39a';
            c.font = `700 64px ${MONO}`;
            c.fillText(row.name.slice(0, 10), x0, 74);
            c.textAlign = 'right';
            c.fillStyle = 'rgba(217,195,154,.6)';
            c.font = `600 40px ${MONO}`;
            c.fillText('LEFT', x1, 70);
            c.font = digitFont(size);
            c.fillStyle = tone(row.pct);
            // Condense horizontally rather than shrink, so the glyph height (what reads at distance) holds.
            const width = c.measureText(row.label).width, fit = Math.min(1, (x1 - x0) / Math.max(1, width));
            c.save();
            c.translate((x0 + x1) / 2, digitBase);
            c.scale(fit, 1);
            c.textAlign = 'center';
            c.fillText(row.label, 0, 0);
            c.restore();
            c.fillStyle = '#2b231c';
            c.fillRect(x0, H - 32, x1 - x0, 14);
            if (row.pct != null) {
                c.fillStyle = tone(row.pct);
                c.fillRect(x0, H - 32, (x1 - x0) * row.pct / 100, 14);
            }
        });
        if (rows.length === 2) {
            c.fillStyle = '#2b231c';
            c.fillRect(half - 2, 30, 4, H - 60);
        }
        this.scoreTexture.needsUpdate = true;
    }
    // ---- Confetti -------------------------------------------------------------------------------
    makeConfetti() {
        if (this.confetti)
            return;
        const { count } = CONFETTI, palette = [0x4fe08f, 0x54d9fa, 0xffb547, 0xff6688, 0xc7a6ff, 0xfff1c9];
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
        this.confetti = new THREE.InstancedMesh(this.geo('confettiQuad', () => new THREE.PlaneGeometry(.2, .3)), material, count);
        this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Launch velocity and spin are fixed per piece up front; a burst only replays them from a new origin.
        this.confettiVelocity = new Float32Array(count * 3);
        this.confettiSpin = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            const seed = hash(`confetti-${i}`), angle = (i / count) * Math.PI * 2 + (seed % 100) / 160, speed = 1.6 + ((seed >>> 8) % 100) / 60;
            this.confettiVelocity.set([Math.cos(angle) * speed, 3.4 + ((seed >>> 16) % 100) / 45, Math.sin(angle) * speed], i * 3);
            this.confettiSpin.set([4 + (seed % 7), 3 + ((seed >>> 4) % 5)], i * 2);
            this.confetti.setMatrixAt(i, _matrix.makeScale(0, 0, 0));
            this.confetti.setColorAt(i, _color.setHex(palette[i % palette.length]));
        }
        this.confetti.instanceColor.needsUpdate = true;
        this.confetti.frustumCulled = false;
        this.confetti.visible = false;
        this.scene.add(this.confetti);
        this.confettiOrigin = new THREE.Vector3();
        this.confettiAge = Infinity;
        this.confettiBursts = 0;
    }
    burstConfetti(actor) {
        if (!this.confetti || this.reduced)
            return;
        const p = actor.group.position, atDesk = actor.desk && Math.hypot(p.x - actor.desk.x, p.z - actor.desk.z) < 2;
        const at = atDesk ? actor.desk : p;
        this.confettiOrigin.set(at.x, 1.4, at.z);
        this.confettiAge = 0;
        this.confetti.visible = true;
        this.confettiBursts++;
        if (this.container) {
            this.container.dataset.confetti = 'active';
            this.container.dataset.confettiBursts = String(this.confettiBursts);
        }
    }
    updateConfetti(dt) {
        if (!this.confetti?.visible)
            return;
        const { count, life, gravity } = CONFETTI, t = this.confettiAge += dt, o = this.confettiOrigin, v = this.confettiVelocity, spin = this.confettiSpin;
        if (t >= life) {
            this.confetti.visible = false;
            if (this.container)
                delete this.container.dataset.confetti;
            return;
        }
        // Pieces shrink away over the last quarter of the burst instead of popping out.
        const size = t > life * .75 ? (life - t) / (life * .25) : 1;
        for (let i = 0; i < count; i++) {
            _position.set(o.x + v[i * 3] * t, Math.max(.03, o.y + v[i * 3 + 1] * t - .5 * gravity * t * t), o.z + v[i * 3 + 2] * t);
            _spin.setFromEuler(_euler.set(t * spin[i * 2], i, t * spin[i * 2 + 1], 'XYZ'));
            this.confetti.setMatrixAt(i, _matrix.compose(_position, _spin, _scale.setScalar(size)));
        }
        this.confetti.instanceMatrix.needsUpdate = true;
    }
    // ---- Particles, picking, camera -------------------------------------------------------------
    makeParticles() {
        // A few warm dust motes in the light; nothing that reads as a game effect.
        const count = 260, positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const h = hash(`dust${i}`);
            positions[i * 3] = (h % 4000) / 100 - 20;
            positions[i * 3 + 1] = .4 + ((h >>> 8) % 280) / 100;
            positions[i * 3 + 2] = ((h >>> 16) % 2200) / 100 - 11;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff1d8, size: .03, transparent: true, opacity: .35, depthWrite: false, sizeAttenuation: true }));
        this.scene.add(this.dust);
    }
    pick(event) { const rect = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); this.ray.setFromCamera(this.pointer, this.camera); const hit = this.ray.intersectObjects(this.pickables)[0]; if (hit) {
        const id = hit.object.userData.actorId;
        this.speak(id);
        this.select(id);
        this.onSelect(id);
    } }
    select(id, focus = true) { const a = this.actors.get(id); this.selected = id; this.focusRing.visible = !!a; this.focusLight.visible = !!a; if (a && focus) {
        const target = a.group.position.clone().add(new THREE.Vector3(0, .9, 0));
        this.fly(target, target.clone().add(new THREE.Vector3(6.5, 6, 8.5)));
    } }
    highlight(ids) { this.highlighted = ids ? new Set(ids) : null; }
    showLabels() { }
    focusFloor() { this.floor = 0; this.onFloor(0); this.reset(); }
    // Default view: a three-quarter from the south-east over the pods, the south band and the scoreboard wall.
    reset(immediate = false) { this.floor = 0; this.onFloor(0); const target = new THREE.Vector3(...this.view.target), position = new THREE.Vector3(...this.view.position); if (immediate) {
        this.controls.target.copy(target);
        this.camera.position.copy(position);
        this.controls.update();
    }
    else
        this.fly(target, position); }
    fly(target, position) { this.flight = { target, position }; if (this.reduced) {
        this.controls.target.copy(target);
        this.camera.position.copy(position);
        this.flight = null;
    } }
    speak(id) {
        const a = this.actors.get(id);
        if (!a || !this.speechBubble)
            return;
        const lines = a.visitor ? SPEECH_VISITORS : (SPEECH_ROLES[id] || SPEECH_GENERIC);
        let text = lines[Math.floor(Math.random() * lines.length)];
        if (lines.length > 1 && text === this.lastSpeech)
            text = lines[(lines.indexOf(text) + 1) % lines.length];
        this.lastSpeech = text;
        this.speechActor = id;
        this.speechBubble.textContent = text;
        this.speechBubble.style.display = 'block';
        this.speechBubble.classList.remove('show');
        void this.speechBubble.offsetWidth;
        this.speechBubble.classList.add('show');
        clearTimeout(this.speechTimer);
        this.speechTimer = setTimeout(() => this.hideSpeech(), 6000);
        this.updateSpeech();
    }
    hideSpeech() {
        clearTimeout(this.speechTimer);
        this.speechTimer = null;
        this.speechActor = null;
        if (!this.speechBubble)
            return;
        this.speechBubble.classList.remove('show');
        this.speechBubble.style.display = 'none';
    }
    updateSpeech() {
        if (!this.speechBubble || !this.speechActor)
            return;
        const a = this.actors.get(this.speechActor);
        if (!a) { this.hideSpeech(); return; }
        const w = this.container.clientWidth, h = this.container.clientHeight, v = _screen;
        a.group.getWorldPosition(v);
        v.y += a.badgeY + .45;
        v.project(this.camera);
        const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * h;
        const bx = Math.max(110, Math.min(w - 110, x));
        const by = Math.max(70, Math.min(h - 80, y));
        this.speechBubble.style.display = 'block';
        this.speechBubble.style.transform = `translate(-50%,-100%) translate(${bx}px,${by}px)`;
    }
    setRoleLabels(value) { this.showRoleLabels = value; if (this.tagLayer) this.tagLayer.style.display = value ? 'block' : 'none'; }
    updateRoleTags() {
        if (!this.tagLayer) return;
        const w = this.container.clientWidth, h = this.container.clientHeight, v = _screen, actors = this.actorList || [], eye = this.camera.position;
        const STATUS_WORD = { working: 'WORKING', pending: 'PENDING', failed: 'FAILED', completed: 'DONE' };
        const placed = [];
        for (let i = 0; i < actors.length; i++) {
            const a = actors[i], id = a.id, tag = a.roleTag;
            if (!tag)
                continue;
            a.group.getWorldPosition(v);
            v.y += a.badgeY + .1;
            v.project(this.camera);
            const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * h;
            const on = v.z < 1 && v.z > -1 && x > -40 && x < w + 40 && y > -30 && y < h + 30;
            const focus = id === this.selected || id === this.hovered;
            const status = a.status || 'idle';
            const word = STATUS_WORD[status];
            // A role name stays quiet until you look at it; the status pill is what the floor is for.
            const task = String(this.statuses?.get(id)?.task || '').trim().replace(/\s+/g, ' ');
            const label = word ? (word === 'WORKING' && task ? `${word} · ${task.slice(0, 24)}${task.length > 24 ? '…' : ''}` : word) : (ROLE_SHORT[id] || id.replace(/-/g, ' '));
            if (tag.dataset.status !== status) {
                tag.dataset.status = status;
                tag.dataset.word = word ? '1' : '0';
            }
            if (tag.textContent !== label)
                tag.textContent = label;
            const near = a.group.position.distanceTo(eye) < 70;
            const show = on && near && (word || focus);
            tag.style.display = show ? 'block' : 'none';
            if (!show)
                continue;
            // Keep pills from stacking on top of each other when several agents share a room.
            let dy = 0;
            for (const p of placed)
                if (Math.abs(p.x - x) < 170 && Math.abs(p.y + p.dy - (y + dy)) < 30)
                    dy -= 24;
            placed.push({ x, y, dy });
            tag.style.transform = `translate(-50%,-50%) translate(${x}px,${y + dy}px)`;
        }
    }
    setParticles(value) { this.particles = value; if (this.dust) this.dust.visible = value; }
    setLow(value) { this.low = value; this.bloom.enabled = !value; this.dpr = value ? 1 : this.dprCap; this.renderer.setPixelRatio(this.dpr); this.composer.setPixelRatio(this.dpr); this.renderer.shadowMap.enabled = !value; this.key.castShadow = !value; this.dust.geometry.setDrawRange(0, value ? 80 : 260); this.resize(); }
    resize() { const w = Math.max(1, this.container.clientWidth || 0), h = Math.max(1, this.container.clientHeight || 0); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); this.composer?.setSize(w, h); if (this.grade)
        this.grade.uniforms.aspect.value = w / h; }
    animate(now) {
        this.frame = null;
        if (this.disposed || document.hidden)
            return;
        this.frame = requestAnimationFrame(t => this.animate(t));
        // rAF timestamps can precede the performance.now() taken at construction; never step backwards.
        const dt = Math.max(0, Math.min((now - this.lastFrame) / 1000, .05));
        this.lastFrame = now;
        this.time += this.reduced ? 0 : dt;
        this.clock += dt;
        if (this.phaseMode === 'auto' && (!this.nextPhaseCheck || now >= this.nextPhaseCheck)) {
            this.nextPhaseCheck = now + 60_000;
            this.setPhase('auto');
        }
        if (this.phaseSettling)
            this.stepPhase(dt);
        this.skyDome?.position.copy(this.camera.position);
        this.frameDt = dt;
        const t = this.time;
        if (this.flight) {
            const k = 1 - Math.exp(-dt * 4);
            this.controls.target.lerp(this.flight.target, k);
            this.camera.position.lerp(this.flight.position, k);
            if (this.camera.position.distanceTo(this.flight.position) < .02)
                this.flight = null;
        }
        this.controls.update();
        if (!this.reduced) {
            this.dust.rotation.y = t * .004;
            this.pulse = Math.max(0, this.pulse - dt * .5);
            if (this.neon)
                this.neon.material.color.setScalar(1.8 + Math.sin(t * 1.3) * .06);
            const actors = this.actorList || [];
            for (let i = 0; i < actors.length; i++)
                this.stepActor(actors[i], t, dt);
            this.updateConfetti(dt);
        }
        else
            // Reduced motion: no walking or gestures, but every agent still holds its status pose.
            for (const a of this.actorList || []) {
                a.group.position.set(a.target.x, 0, a.target.z);
                a.pathIndex = a.path.length;
                a.heading = this.restHeading(a);
                a.group.rotation.y = a.heading;
                a.sit = a.spot?.seated ? 1 : 0;
                a.badgeY = 2.02 - .44 * a.sit;
                this.fadeActor(a, a.leaving ? 0 : 1, Infinity);
                this.pose(a, 0, dt, false);
            }
        const selected = this.actors.get(this.selected);
        if (selected) {
            this.focusRing.position.copy(selected.group.position);
            this.focusRing.position.y = .03;
            this.focusLight.position.copy(selected.group.position);
            this.focusLight.position.y += 2;
        }
        this.updateActorInstances();
        this.updateRoleTags();
        this.updateSpeech();
        this.renderer.info.reset();
        if (this.low)
            this.renderer.render(this.scene, this.camera);
        else
            this.composer.render();
        this.frames++;
        if (now - this.fpsStart > 1000) {
            const fps = Math.round(this.frames * 1000 / (now - this.fpsStart));
            this.onFPS(fps);
            this.drawClock();
            // Keep the 3D floor responsive on integrated GPUs and high-DPR displays.
            // Low performance mode pins DPR at 1; otherwise nudge between 1 and the cap.
            if (!this.low) {
                if (fps < 30 && this.dpr > 1) {
                    this.dpr = Math.max(1, this.dpr - .15);
                    this.renderer.setPixelRatio(this.dpr);
                    this.composer.setPixelRatio(this.dpr);
                    this.resize();
                } else if (fps > 55 && this.dpr < this.dprCap) {
                    this.dpr = Math.min(this.dprCap, this.dpr + .1);
                    this.renderer.setPixelRatio(this.dpr);
                    this.composer.setPixelRatio(this.dpr);
                    this.resize();
                }
            }
            this.onStats({ fps, dpr: this.dpr, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles });
            if (this.container)
                this.container.dataset.drawCalls = String(this.renderer.info.render.calls);
            this.frames = 0;
            this.fpsStart = now;
        }
    }
    dispose() { this.disposed = true; clearTimeout(this.speechTimer); this.tagLayer?.remove(); this.speechLayer?.remove(); cancelAnimationFrame(this.frame); this.controls.dispose(); removeEventListener('resize', this.resizeHandler); document.removeEventListener('visibilitychange', this.visibilityHandler); this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown); this.renderer.domElement.removeEventListener('pointerup', this.pointerUp); this.renderer.domElement.removeEventListener('pointermove', this.hoverHandler); this.renderer.domElement.removeEventListener('pointerleave', this.leaveHandler); this.renderer.domElement.removeEventListener('keydown', this.keyHandler); const gs = new Set(this.geometries.values()), ms = new Set(this.materials.values()); this.scene.traverse(o => { o.shadow?.dispose(); if (o.isInstancedMesh)
        o.dispose(); if (o.geometry)
        gs.add(o.geometry); if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
            ms.add(m); }); gs.forEach(g => g.dispose()); ms.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.composer.passes.forEach(pass => pass.dispose?.()); this.composer.dispose(); this.environmentTarget.dispose(); this.renderer.dispose(); }
}
