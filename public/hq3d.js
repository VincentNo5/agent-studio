import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOM_COLORS, floorForRoom, hash, isWorking, matchesRole } from './studio-data.js';
const CYAN = 0x36cfff, AMBER = 0xffbd72;
const roomLayout = {
    directors: [-8.6, -4.4], leads: [-8.6, 3.3], engineering: [6.8, -4.4], design: [6.8, 3.3],
    art: [-9, -4.6], audio: [0, -4.6], narrative: [9, -4.6], qa: [-9, 3.8], engines: [0, 3.8], community: [9, 3.8]
};
const floorNames = ['AGENT LOBBY & DISPATCH', 'PRODUCTION & QUALITY', 'ENGINEERING & DESIGN'];
export class Headquarters {
    constructor(container, { onSelect = () => { }, onFPS = () => { }, onFloor = () => { } } = {}) {
        this.container = container;
        this.onSelect = onSelect;
        this.onFPS = onFPS;
        this.onFloor = onFloor;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x030b16);
        this.scene.fog = new THREE.FogExp2(0x071222, .014);
        this.camera = new THREE.PerspectiveCamera(40, 1, .1, 240);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.25;
        this.renderer.domElement.setAttribute('aria-label', 'Interactive three-dimensional studio headquarters. Drag to orbit, scroll to zoom. Select agents using the roster panel.');
        this.renderer.domElement.setAttribute('tabindex', '0');
        container.append(this.renderer.domElement);
        const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
        this.environmentTarget = pmrem.fromScene(environment, .04);
        this.scene.environment = this.environmentTarget.texture;
        this.scene.environmentIntensity = .22;
        environment.dispose();
        pmrem.dispose();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = .065;
        this.controls.minDistance = 18;
        this.controls.maxDistance = 82;
        this.controls.minPolarAngle = .42;
        this.controls.maxPolarAngle = Math.PI * .48;
        this.controls.maxTargetRadius = 18;
        this.controls.enablePan = true;
        this.onControlStart = () => { this.flight = null; };
        this.controls.addEventListener('start', this.onControlStart);
        this.geometries = new Map();
        this.materials = new Map();
        this.textures = new Set();
        this.staticBatches = new Map();
        this.actors = new Map();
        this.pickables = [];
        this.rings = [];
        this.roomSigns = new Map();
        this.floorLabels = [];
        this.streams = [];
        this.low = false;
        this.particles = true;
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.floor = 0;
        this.active = new Set();
        this.lastEvent = null;
        this.pulse = 0;
        this.lights();
        this.architecture();
        this.city();
        this.flushStatics();
        this.makeParticles();
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .36, .45, 1.12);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        this.focusRing = this.ring(0, 0, 0, .65, .035, this.mat('selection', CYAN, 0, 3));
        this.focusRing.visible = false;
        this.focusLight = new THREE.PointLight(CYAN, 6, 4);
        this.scene.add(this.focusLight);
        this.focusLight.visible = false;
        this.ray = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerDown = e => { this.down = [e.clientX, e.clientY]; };
        this.pointerUp = e => { if (!this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5)
            return; this.pick(e); };
        this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
        this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
        this.keyHandler = e => { if (e.key === 'Home') {
            e.preventDefault();
            this.focusFloor(0);
        } if (['1', '2', '3'].includes(e.key))
            this.focusFloor(Number(e.key)); };
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
    mat(name, color, metalness = .5, emission = 0, opacity = 1) {
        if (!this.materials.has(name))
            this.materials.set(name, new THREE.MeshStandardMaterial({ color, metalness, roughness: .34, emissive: emission ? color : 0, emissiveIntensity: emission, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide }));
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
            const list = this.staticBatches.get(mat) || [];
            const copy = geo.index ? geo.toNonIndexed() : geo.clone();
            list.push(copy.applyMatrix4(obj.matrix));
            this.staticBatches.set(mat, list);
        }
        else {
            obj.castShadow = mat.opacity === 1;
            obj.receiveShadow = true;
            parent.add(obj);
        }
        return obj;
    }
    box(x, y, z, w, h, d, mat, parent = this.scene, batched = true) { return this.mesh(this.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat, x, y, z, w, h, d, parent, batched); }
    cyl(x, y, z, r, h, mat, batched = true, parent = this.scene) { return this.mesh(this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 32)), mat, x, y, z, r, h, r, parent, batched); }
    ring(x, y, z, r, t, mat) {
        const g = this.geo(`ring${r}:${t}`, () => new THREE.TorusGeometry(r, t, 6, 80));
        const m = this.mesh(g, mat, x, y, z, 1, 1, 1, this.scene, false);
        m.rotation.x = Math.PI / 2;
        m.castShadow = false;
        return m;
    }
    flushStatics() { for (const [mat, parts] of this.staticBatches) {
        const geo = mergeGeometries(parts);
        parts.forEach(g => g.dispose());
        if (geo) {
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = mat.opacity === 1 && !mat.emissiveIntensity;
            m.receiveShadow = true;
            this.scene.add(m);
        }
    } this.staticBatches.clear(); }
    lights() {
        this.scene.add(new THREE.HemisphereLight(0x9bcfff, 0x162132, 2));
        const key = new THREE.DirectionalLight(0xb1d7ff, 3.2);
        key.position.set(-12, 32, 20);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        Object.assign(key.shadow.camera, { left: -25, right: 25, top: 26, bottom: -24, near: 1, far: 90 });
        key.shadow.bias = -.0005;
        key.shadow.normalBias = .035;
        this.scene.add(key);
        this.key = key;
        const rim = new THREE.DirectionalLight(0x3189ff, 2.5);
        rim.position.set(10, 18, -15);
        this.scene.add(rim);
        for (let f = 0; f < 3; f++) {
            const light = new THREE.PointLight(AMBER, 90, 22, 2);
            light.position.set(-7, f * 6 + 3, -3);
            this.scene.add(light);
            const cool = new THREE.PointLight(0x43aaff, 65, 20, 2);
            cool.position.set(7, f * 6 + 3, 2);
            this.scene.add(cool);
        }
        const hub = new THREE.PointLight(CYAN, 48, 13, 2);
        hub.position.set(0, 2, 3);
        this.scene.add(hub);
    }
    label(text, x, y, z, width = 5, color = '#bdeaff', small = '') {
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(3,17,32,.93)';
        ctx.fillRect(0, 0, 768, 128);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 5, 128);
        ctx.fillStyle = '#17465c';
        ctx.fillRect(5, 126, 763, 2);
        const titleSize = small ? 38 : Math.min(64, Math.floor(690 / (text.length * .62)));
        ctx.font = `500 ${titleSize}px "Trebuchet MS", sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(text, 26, small ? 56 : 79);
        if (small) {
            ctx.font = '23px "Trebuchet MS", sans-serif';
            ctx.fillStyle = '#8eaec5';
            ctx.fillText(small, 26, 98);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textures.add(texture);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, toneMapped: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(x, y, z);
        sprite.scale.set(width, width / 5, 1);
        this.scene.add(sprite);
        return sprite;
    }
    architecture() {
        const metal = this.mat('metal', 0x172839, .78), edge = this.mat('edge', 0x344857, .8), floor = this.mat('floor', 0x193444, .72), dark = this.mat('dark', 0x081523, .68);
        const cyan = this.mat('cyan', CYAN, .25, 2.8), soft = this.mat('soft', 0x327b9a, .4, .6), amber = this.mat('amber', AMBER, .3, 3);
        const glass = this.mat('glass', 0x548ba0, .1, .04, .13);
        const shape = new THREE.Shape(), w = 14.5, d = 8.6, r = 2;
        shape.moveTo(-w + r, -d);
        shape.lineTo(w - r, -d);
        shape.quadraticCurveTo(w, -d, w, -d + r);
        shape.lineTo(w, d - r);
        shape.quadraticCurveTo(w, d, w - r, d);
        shape.lineTo(-w + r, d);
        shape.quadraticCurveTo(-w, d, -w, d - r);
        shape.lineTo(-w, -d + r);
        shape.quadraticCurveTo(-w, -d, -w + r, -d);
        const slabGeo = this.geo('slab', () => { const g = new THREE.ExtrudeGeometry(shape, { depth: .34, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .12, bevelThickness: .12, curveSegments: 12 }); g.rotateX(-Math.PI / 2); return g; });
        // One tower, tied together by continuous structural columns and an elevator.
        this.box(0, -2, 0, 28, 2, 16, dark);
        for (const x of [-13.7, 13.7])
            for (const z of [-6, 5]) {
                this.box(x, 8, z, .52, 19, .6, metal);
                this.box(x + .29, 8, z, .045, 19, .13, soft);
                for (let y = 0; y < 18; y += 1.5)
                    this.box(x, y, z + .32, .58, .06, .06, edge);
            }
        this.box(0, 8, -7.2, 3, 18, 2.2, dark);
        this.box(0, 8, -5.99, 2.5, 18, .05, glass);
        for (const x of [-1.3, 1.3])
            this.box(x, 8, -5.9, .06, 18, .06, cyan);
        for (let y = 0; y < 17; y += .65)
            this.box(0, y, -6.05, 2.5, .035, .03, edge);
        this.elevator = this.box(0, 1.5, -6.5, 2.3, 2.8, 1.8, glass, this.scene, false);
        for (let f = 0; f < 3; f++) {
            const y = f * 6;
            this.mesh(slabGeo, floor, 0, y - .34, 0);
            this.mesh(slabGeo, metal, 0, y - .68, 0, 1, .45, 1);
            // Horizontal deck edge lights, interrupted by metal mullions.
            this.box(0, y - .27, 8.65, 24.9, .065, .09, cyan);
            this.box(0, y - .59, 8.57, 25, .04, .08, soft);
            for (const x of [-14.45, 14.45])
                this.box(x, y - .3, 0, .05, .07, 12.6, soft);
            for (let x = -12; x <= 12; x += 2) {
                this.box(x, y + 1.05, 8.1, .07, 1.6, .07, edge);
                this.box(x + .96, y + .92, 8.1, 1.85, 1.3, .035, glass);
                this.box(x + .96, y + 1.77, 8.1, 1.93, .055, .06, edge);
            }
            // Rear enclosure: transparent windows, solid piers and warm practicals.
            this.box(0, y + 2.5, -8, 25, 5, .035, glass);
            for (let x = -12; x <= 12; x += 3) {
                this.box(x, y + 2.5, -8, .16, 5, .22, metal);
                this.box(x + .18, y + 2.8, -7.84, .06, 3.8, .06, amber);
            }
            this.box(0, y + 4.85, -8, 26, .22, .4, metal);
            for (const x of [-13.8, 13.8]) {
                this.box(x, y + 2.5, -3.4, .035, 4.5, 8.7, glass);
                this.box(x, y + 4.85, -3.3, .4, .24, 9, metal);
                this.box(x, y + 4.68, -3.3, .08, .04, 8.6, amber);
            }
            // Inlaid floor grid, circulation routes and contact-shadow pads.
            for (let x = -12; x <= 12; x += 3)
                this.box(x, y + .025, 0, .015, .01, 15, edge);
            for (let z = -6; z <= 6; z += 3)
                this.box(0, y + .026, z, 26, .01, .015, edge);
            for (const x of [-3.2, 3.2])
                this.box(x, y + .037, 2, .035, .012, 10, soft);
            for (const x of [-12.7, 12.7])
                for (const z of [-6.7, 6.8])
                    this.plant(x, y, z);
            // Stair flights connect adjacent decks beside the elevator spine.
            if (f < 2)
                for (let i = 0; i < 19; i++)
                    this.box(11.7, y + i * .316 + .16, -6.8 + i * .49, 2.3, .14, .5, edge);
            this.floorLabels.push(this.label(`${f + 1}F  ${floorNames[f]}`, -8, y + .45, 8.85, 7.4, '#a6eaff'));
        }
        // Crown roof frame keeps the upper storey open and legible.
        this.box(0, 17.15, -7.9, 28, .26, .65, metal);
        this.box(0, 17.34, -7.9, 26, .035, .3, cyan);
        for (const x of [-13.6, 13.6])
            this.box(x, 17.15, -1, .55, .26, 14, metal);
        this.roofSign = this.label('AGENT STUDIO', 0, 18, -7.5, 7.8, '#bdedff', 'AUTONOMOUS OPERATIONS / HEADQUARTERS');
        // Lobby core and upper holographic planning table.
        for (const [f, radius] of [[0, 3], [2, 2.25]]) {
            const y = f * 6, z = f ? 0 : 2;
            this.cyl(0, y + .16, z, radius + .65, .3, dark);
            this.cyl(0, y + .39, z, radius, .24, edge);
            this.cyl(0, y + .6, z, radius - .3, .17, metal);
            for (let i = 0; i < 3; i++)
                this.rings.push(this.ring(0, y + .35 + i * .34, z, radius - i * .43, .035, cyan));
            this.cyl(0, y + .69, z, radius - .6, .04, this.mat('hologramSurface', 0x087ba5, .65, .8, .65));
            const orb = this.mesh(this.geo('orb', () => new THREE.IcosahedronGeometry(1, 2)), this.mat('orb', 0x4ccfff, .1, 1.3, .22), 0, y + 1.9, z, f ? .7 : 1, f ? .7 : 1, f ? .7 : 1, this.scene, false);
            const wire = new THREE.LineSegments(new THREE.WireframeGeometry(orb.geometry), new THREE.LineBasicMaterial({ color: 0x8cecff, transparent: true, opacity: .7 }));
            orb.add(wire);
            this.rings.push(orb);
            const halo = this.ring(0, y + 1.9, z, f ? 1 : 1.4, .018, cyan);
            halo.rotation.x = .8;
            this.rings.push(halo);
            this.label(f ? 'PLANNING ARRAY' : 'ORCA HUB', 0, y + 1.05, z + radius, f ? 3.8 : 4.8, '#7fe5ff');
            // Transparent tapered shafts suggest scattered light, without a screen overlay.
            const shaftGeo = this.geo(`shaft${f}`, () => new THREE.CylinderGeometry(radius - .5, .45, 3.5, 32, 1, true));
            const shaft = this.mesh(shaftGeo, this.mat('shaft', 0x2b9dcc, 0, .8, .035), 0, y + 2.4, z, 1, 1, 1, this.scene, false);
            shaft.castShadow = false;
        }
        // Lobby reception, visitor benches, Paseo bay and real task display.
        this.box(-8, .85, -3.6, 6, 1.5, 1.4, metal);
        this.box(-8, 1.65, -3.6, 6.1, .15, 1.7, edge);
        this.box(-8, .9, -2.86, 5, .065, .02, amber);
        this.label('PASEO', -8, 3.3, -5.9, 4, '#ffcf8c', 'CONNECTED AGENT BAY');
        this.label('VISITOR ARRIVALS', -8, 2.4, 4.7, 4.3, '#90eaff');
        for (const x of [-8, 8])
            for (const z of [3.5, 5.8]) {
                this.box(x, .48, z, 3.5, .4, .75, dark);
                this.box(x, .86, z - .4, 3.5, .7, .18, metal);
                for (const leg of [-1.3, 1.3])
                    this.box(x + leg, .2, z, .1, .5, .6, edge);
            }
        this.taskCanvas = document.createElement('canvas');
        this.taskCanvas.width = 768;
        this.taskCanvas.height = 512;
        this.taskTexture = new THREE.CanvasTexture(this.taskCanvas);
        this.taskTexture.colorSpace = THREE.SRGBColorSpace;
        this.textures.add(this.taskTexture);
        this.box(8, 2.4, -5.8, 6.8, 3.8, .4, metal);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.35, 3.4), new THREE.MeshBasicMaterial({ map: this.taskTexture }));
        screen.position.set(8, 2.4, -5.56);
        this.scene.add(screen);
        this.drawTasks(null);
        this.label('DISPATCH / LIVE TASKS', 8, 4.7, -5.5, 5, '#a0dbff');
    }
    plant(x, y, z) {
        this.cyl(x, y + .28, z, .3, .56, this.mat('planter', 0x69757b, .6));
        const green = this.mat('leaves', 0x38776e, .05);
        for (let i = 0; i < 5; i++) {
            const a = i * 2.4;
            this.mesh(this.geo('leaf', () => new THREE.IcosahedronGeometry(1, 0)), green, x + Math.sin(a) * .21, y + .75 + i * .09, z + Math.cos(a) * .21, .2, .6, .16);
        }
    }
    city() {
        const building = this.mat('city', 0x0c1a2a, .65), windows = this.mat('windows', 0x357ba5, .2, .7), warm = this.mat('warmWindows', 0xba8151, .2, .8);
        // Deterministic architectural backdrop; these are environment lights, not agent metrics.
        for (let i = 0; i < 85; i++) {
            const h = hash(`city${i}`), a = i * 2.39996, r = 34 + (h % 55), x = Math.cos(a) * r, z = Math.sin(a) * r;
            const height = 4 + (h % 29), w = 2 + (h % 6);
            this.box(x, height / 2 - 15, z, w, height, 3 + (h % 5), building);
            for (let y = -12; y < height - 16; y += 1.8)
                for (let k = 0; k < 3; k++)
                    if ((h + k + Math.floor(y)) % 3 !== 0)
                        this.box(x - w * .33 + k * w * .32, y, z + 2.56, .25, .45, .03, (h + k) % 4 === 0 ? warm : windows);
            if (i % 3 === 0)
                this.box(x, height - 14.95, z, w, .05, 4, windows);
        }
        this.box(0, -4.2, 0, 33, .7, 21, this.mat('foundation', 0x0a1826, .8));
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), this.mat('ground', 0x050e1a, .7));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -15;
        this.scene.add(ground);
        const grid = new THREE.GridHelper(220, 60, 0x163b53, 0x0c2133);
        grid.position.y = -14.9;
        this.scene.add(grid);
    }
    setRoster(roster) {
        if (this.roster)
            return;
        this.roster = roster;
        for (const room of roster.rooms) {
            const f = floorForRoom(room), [cx, cz] = roomLayout[room] || [0, 0], members = roster.agents.filter(a => a.room === room), color = ROOM_COLORS[room] || CYAN;
            const y = (f - 1) * 6;
            this.roomSigns.set(room, this.label(room.toUpperCase(), cx, y + 3.55, cz - 1.3, room === 'engineering' ? 5 : 3.6, `#${color.toString(16)}`));
            // Room partitions and low frame imply glass offices without hiding occupants.
            this.box(cx, y + 1.6, cz - 2.1, f === 3 ? 8 : 6.6, 3.1, .025, this.materials.get('glass'));
            this.box(cx, y + 3.18, cz - 2.1, f === 3 ? 8 : 6.6, .06, .06, this.materials.get('edge'));
            const cols = f === 3 ? 4 : members.length > 9 ? 5 : 3;
            const spacing = cols === 5 ? 1.45 : 1.75;
            members.forEach((role, i) => {
                const x = cx + (i % cols - (Math.min(cols, members.length) - 1) / 2) * spacing;
                const z = cz + Math.floor(i / cols) * 1.5 - 1;
                this.desk(x, y, z, color, role.name);
                this.createActor(role.name, role, x, y + .08, z + .64, color);
            });
        }
        this.flushStatics();
    }
    desk(x, y, z, color, key) {
        const metal = this.materials.get('metal'), edge = this.materials.get('edge');
        this.box(x, y + .8, z, 1.48, .12, .82, edge);
        this.box(x, y + .38, z, .08, .75, .65, metal);
        this.box(x, y + .05, z, 1, .08, .65, metal);
        this.box(x, y + 1.15, z - .17, 1.08, .61, .1, metal);
        this.box(x, y + .92, z - .17, .08, .23, .1, edge);
        // Shared inactive screens have real architectural light; activity is added in update().
        this.box(x, y + 1.16, z - .105, .97, .49, .015, this.mat(`screen${color}`, color, .1, .35));
        for (let i = 0; i < 3; i++)
            this.box(x - .3, y + 1.3 - i * .12, z - .09, .22 + (hash(key + i) % 5) * .09, .022, .01, this.mat('code', 0x8ebfd0, 0, .55));
        this.box(x, y + .88, z + .19, .65, .025, .23, metal);
        this.cyl(x, y + .36, z + .65, .25, .12, metal);
        this.box(x, y + .62, z + .94, .44, .48, .07, edge);
    }
    createActor(id, data, x, y, z, color, visitor = false) {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        g.rotation.y = 0;
        this.scene.add(g);
        const parts = [];
        const add = (geo, mat, px, py, pz, sx, sy, sz, parent = g) => { const m = this.mesh(geo, mat, px, py, pz, sx, sy, sz, parent, false); m.visible = false; parts.push(m); return m; };
        const sphere = this.geo('head', () => new THREE.SphereGeometry(1, 12, 10)), box = this.geometries.get('box');
        const cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 16));
        const dark = this.materials.get('dark'), edge = this.materials.get('edge');
        const ink = this.mat('ink', 0x111a24, .08), white = this.mat('shirt', 0xe8f2f8, .06), pants = this.mat('pants', 0x1a2938, .25);
        const h = hash(id), room = data?.room || 'lobby';
        const skinTones = [0xf4d0ae, 0xe3b18b, 0xc08563, 0x95633f];
        const hairTones = [0x1a1e27, 0x3a2822, 0x6d4a33, 0xb07b45, 0xd9b47e, 0x27354d, 0x5c3450];
        const skin = this.mat(`skin${h % skinTones.length}`, skinTones[h % skinTones.length], .04);
        const hair = this.mat(`hair${h % hairTones.length}`, hairTones[h % hairTones.length], .12);
        const outfit = this.mat(`coat${color}`, color, .1), trim = this.mat(`trim${color}`, color, .12, 1.3);
        const limbs = [];
        let head;

        if (visitor) {
            // The specialised agents from the reference: a rounded white robot with a dark visor,
            // two lit eyes, coloured ear pods, chest light and an antenna.
            const shell = this.mat('robotShell', 0xe9f4fa, .28);
            const robotTrim = this.mat(`robot${color}`, color, .15, 1.8);
            for (const side of [-1, 1]) {
                const arm = new THREE.Group();
                arm.position.set(side * .27, .90, 0);
                g.add(arm);
                add(box, shell, 0, -.15, 0, .11, .30, .12, arm);
                add(sphere, robotTrim, 0, -.32, 0, .058, .058, .052, arm);
                limbs.push(arm);
                const leg = new THREE.Group();
                leg.position.set(side * .115, .44, 0);
                g.add(leg);
                add(box, dark, 0, -.20, 0, .15, .32, .16, leg);
                add(box, shell, 0, -.38, .03, .17, .08, .20, leg);
                limbs.push(leg);
            }
            add(box, shell, 0, .76, 0, .44, .38, .30);
            add(box, dark, 0, .66, 0, .46, .06, .32);
            add(sphere, robotTrim, 0, .80, .16, .07, .07, .03);
            head = new THREE.Group();
            head.position.set(0, 1.22, 0);
            g.add(head);
            add(sphere, shell, 0, 0, 0, .30, .29, .27, head);
            add(box, ink, 0, .01, .235, .40, .15, .05, head);
            add(sphere, robotTrim, -.085, .02, .268, .034, .034, .02, head);
            add(sphere, robotTrim, .085, .02, .268, .034, .034, .02, head);
            add(cyl, dark, 0, .32, 0, .012, .14, .012, head);
            add(sphere, robotTrim, 0, .40, 0, .038, .038, .038, head);
            for (const side of [-1, 1]) {
                const pod = add(cyl, robotTrim, side * .30, .02, 0, .05, .07, .05, head);
                pod.rotation.z = Math.PI / 2;
            }
        } else {
            const style = h % 5;
            for (const side of [-1, 1]) {
                const arm = new THREE.Group();
                arm.position.set(side * .255, .93, 0);
                g.add(arm);
                add(box, outfit, 0, -.15, 0, .115, .30, .13, arm);
                add(sphere, skin, 0, -.32, 0, .062, .066, .06, arm);
                limbs.push(arm);
                const leg = new THREE.Group();
                leg.position.set(side * .11, .46, 0);
                g.add(leg);
                add(box, pants, 0, -.20, 0, .135, .34, .15, leg);
                add(box, ink, 0, -.39, .045, .155, .09, .22, leg);
                limbs.push(leg);
            }
            // Rounded torso, shirt, belt and lanyard: the reference cast wears a uniform
            // with a tablet, so the silhouette reads at distance without textures.
            add(box, outfit, 0, .78, 0, .41, .40, .27);
            add(box, white, 0, .86, .141, .17, .20, .02);
            add(box, trim, 0, .79, .147, .032, .30, .012);
            add(box, ink, 0, .585, 0, .42, .07, .28);
            add(box, white, .135, .88, .147, .07, .045, .022);
            add(box, edge, 0, .64, .225, .28, .20, .025);
            add(box, this.mat('slate', 0xbfeaff, .1, .9), 0, .64, .242, .24, .16, .008);
            head = new THREE.Group();
            head.position.set(0, 1.25, 0);
            g.add(head);
            add(sphere, skin, 0, 0, 0, .30, .31, .28, head);
            add(sphere, hair, 0, .04, -.03, .31, .30, .29, head);
            add(box, hair, 0, .145, .205, .30, .11, .075, head);
            if (style === 1 || style === 4) {
                const len = style === 4 ? .30 : .20;
                add(box, hair, -.272, -.04, .015, .065, len, .17, head);
                add(box, hair, .272, -.04, .015, .065, len, .17, head);
            }
            if (style === 2) {
                add(sphere, hair, 0, .015, -.315, .09, .15, .09, head);
                add(box, trim, 0, .115, -.27, .07, .035, .05, head);
            }
            if (style === 3)
                add(sphere, hair, 0, .31, -.11, .115, .10, .115, head);
            // Face: oversized eyes with a highlight, a small smile and blush.
            for (const side of [-1, 1]) {
                add(sphere, ink, side * .105, -.01, .275, .034, .040, .018, head);
                add(sphere, this.mat('eyeHi', 0xffffff, 0, 2.2), side * .115, .006, .291, .010, .013, .008, head);
            }
            add(box, ink, 0, -.105, .286, .062, .014, .014, head);
            add(sphere, this.mat('blush', 0xff9fa6, .05, .35), -.185, -.065, .235, .036, .018, .012, head);
            add(sphere, this.mat('blush', 0xff9fa6, .05, .35), .185, -.065, .235, .036, .018, .012, head);
            // Department accessories, matching the reference sheet's silhouettes.
            if (['engineering', 'engines', 'qa'].includes(room) || (room === 'directors' && h % 2 === 0)) {
                add(box, ink, -.105, -.01, .301, .095, .012, .01, head);
                add(box, ink, .105, -.01, .301, .095, .012, .01, head);
                add(box, ink, 0, -.01, .303, .05, .01, .01, head);
                add(box, ink, -.19, -.01, .288, .012, .07, .012, head);
                add(box, ink, .19, -.01, .288, .012, .07, .012, head);
            }
            if (['audio', 'narrative', 'community'].includes(room)) {
                add(box, trim, 0, .285, 0, .54, .025, .04, head);
                for (const side of [-1, 1]) {
                    const cup = add(cyl, trim, side * .295, .005, 0, .052, .075, .052, head);
                    cup.rotation.z = Math.PI / 2;
                    add(cyl, ink, side * .30, .005, 0, .036, .045, .036, head).rotation.z = Math.PI / 2;
                }
            }
            if (['design', 'art'].includes(room) && style !== 3) {
                const beret = add(cyl, trim, -.03, .275, 0, .27, .05, .27, head);
                beret.rotation.z = .12;
                beret.rotation.x = .08;
            } else if (['community'].includes(room) || (room === 'art' && style === 3)) {
                add(cyl, trim, 0, .255, 0, .30, .055, .30, head);
                add(box, trim, 0, .225, .22, .26, .028, .16, head);
            }
            if (['directors', 'leads'].includes(room)) {
                add(box, white, 0, .905, .147, .16, .09, .02);
                add(box, this.mat('tie', 0xe9b978, .2, .5), 0, .825, .158, .055, .18, .016);
            }
        }

        // A single broad invisible pick target makes small people easy to select.
        const pick = new THREE.Mesh(this.geo('pick', () => new THREE.BoxGeometry(.9, 1.7, .85)), this.mat('pick', 0, 0, 0, 0));
        pick.position.y = .8;
        pick.visible = false;
        pick.userData.actorId = id;
        g.add(pick);
        this.pickables.push(pick);
        const halo = this.ring(x, y + .04, z, .48, .018, this.mat('activity', 0x48e8d0, .1, 2));
        halo.visible = false;
        const actor = { id, data, group: g, parts, limbs, head, halo, home: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x, y, z), phase: (hash(id) % 100) / 10, visitor, busy: false, status: 'idle' };
        this.actors.set(id, actor);
        this.actorBatchesDirty = true;
        return actor;

    }
    batchActors() {
        // Each body part keeps a local transform for articulation. GPU instances
        // share geometry and material, so fingers/limbs do not each cost a draw call.
        for (const batch of this.actorBatches || []) {
            this.scene.remove(batch.mesh);
            batch.mesh.dispose();
        }
        const groups = new Map();
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
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.actorBatches.push({ mesh, parts });
        }
        this.actorBatchesDirty = false;
    }
    updateActorInstances() {
        if (this.actorBatchesDirty)
            this.batchActors();
        for (const actor of this.actors.values())
            actor.group.updateMatrixWorld(true);
        for (const { mesh, parts } of this.actorBatches || []) {
            parts.forEach((part, i) => mesh.setMatrixAt(i, part.matrixWorld));
            mesh.instanceMatrix.needsUpdate = true;
        }
    }
    update(state, active, board) {
        this.state = state;
        this.active = active;
        this.drawTasks(board);
        const visitors = new Set();
        for (const w of state.workers || []) {
            if (!w.dispatchId)
                continue;
            const id = `worker:${w.dispatchId}`;
            visitors.add(id);
            let a = this.actors.get(id);
            if (!a) {
                const h = hash(id), side = h % 2 ? 1 : -1, x = side * (5 + (h % 6) * 1.15), z = -.8 + (Math.floor(h / 9) % 7) * .9;
                const robotColors = [0x54d9fa, 0x6de0bc, 0xff8fb8, 0xffbd72];
                a = this.createActor(id, w, x, 0.08, z, robotColors[h % robotColors.length], true);
            }
            a.data = w;
            a.busy = isWorking(w);
            a.status = w.workerState || w.dispatchStatus || 'unknown';
            // A status change moves the visitor smoothly between its arrival and dispatch station.
            a.target.copy(a.home);
            if (a.busy)
                a.target.z = Math.max(-1, a.home.z - 1.3);
        }
        for (const [id, a] of this.actors) {
            if (a.visitor && !visitors.has(id)) {
                this.scene.remove(a.group, a.halo);
                this.pickables = this.pickables.filter(p => p.userData.actorId !== id);
                this.actors.delete(id);
                this.actorBatchesDirty = true;
                continue;
            }
            if (!a.visitor) {
                a.busy = active.has(id);
                const associated = (state.workers || []).find(w => matchesRole(w, a.data));
                a.status = associated?.workerState || (a.busy ? 'working' : 'idle');
            }
            a.halo.visible = a.busy;
        }
        for (const [room, sign] of this.roomSigns) {
            const busy = this.roster?.agents.some(a => a.room === room && active.has(a.name));
            sign.material.color.set(busy ? 0xffffff : 0x99b3c9);
        }
        this.updateStreams();
        const event = state.audit?.events?.at(-1), eventKey = event ? `${event.ts}:${event.agent}:${event.kind}` : null;
        if (this.lastEvent && eventKey !== this.lastEvent)
            this.pulse = 1;
        this.lastEvent = eventKey;
    }
    drawTasks(board) { const c = this.taskCanvas.getContext('2d'); c.fillStyle = '#04182a'; c.fillRect(0, 0, 768, 512); c.fillStyle = '#71ddff'; c.font = '32px monospace'; c.fillText('LIVE DISPATCH', 42, 65); c.fillStyle = '#5b869c'; c.fillRect(42, 92, 684, 2); c.font = '28px monospace'; if (!board) {
        c.fillText('Awaiting state', 42, 158);
    }
    else {
        c.fillText(`${board.source.toUpperCase()} / ${board.total} TASKS`, 42, 150);
        ['running', 'pending', 'blocked'].forEach((lane, i) => { c.fillStyle = i === 2 ? '#f3b984' : '#a7d9ef'; c.fillText(lane.toUpperCase(), 42, 228 + i * 85); c.fillText(String(board.counts[lane] || 0), 630, 228 + i * 85); });
    } this.taskTexture.needsUpdate = true; }
    makeParticles() {
        const count = 850, positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const h = hash(`dust${i}`);
            positions[i * 3] = (h % 6000) / 100 - 30;
            positions[i * 3 + 1] = ((h >>> 8) % 2600) / 100 - 3;
            positions[i * 3 + 2] = ((h >>> 16) % 4500) / 100 - 22;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x64bbe7, size: .035, transparent: true, opacity: .55, depthWrite: false, sizeAttenuation: true }));
        this.scene.add(this.dust);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 48 * 3), 3));
        sg.setDrawRange(0, 0);
        this.energy = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x5ee5ff, size: .07, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.energy.frustumCulled = false;
        this.scene.add(this.energy);
    }
    updateStreams() { this.streams = []; for (const room of this.roster?.rooms || [])
        if (this.roster.agents.some(a => a.room === room && this.active.has(a.name))) {
            const [x, z] = roomLayout[room] || [0, 0], y = (floorForRoom(room) - 1) * 6;
            this.streams.push(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.2, 2), new THREE.Vector3(2, y * .5 + 2, 7), new THREE.Vector3(x * .7, y + .4, 7), new THREE.Vector3(x, y + 1, z)]));
        } this.energy.geometry.setDrawRange(0, this.streams.length * (this.low ? 12 : 48)); }
    pick(event) { const rect = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); this.ray.setFromCamera(this.pointer, this.camera); const hit = this.ray.intersectObjects(this.pickables)[0]; if (hit) {
        this.select(hit.object.userData.actorId);
        this.onSelect(hit.object.userData.actorId);
    } }
    select(id, focus = true) { const a = this.actors.get(id); this.selected = id; this.focusRing.visible = !!a; this.focusLight.visible = !!a; if (a && focus) {
        const target = a.group.position.clone().add(new THREE.Vector3(0, 1, 0));
        this.fly(target, target.clone().add(new THREE.Vector3(13, a.home.y < 11 ? 4 : 10, 18)));
    } }
    highlight(ids) { this.highlighted = ids ? new Set(ids) : null; for (const [id, a] of this.actors) {
        a.halo.visible = a.busy || !!this.highlighted?.has(id);
        a.halo.material = this.highlighted?.has(id) ? this.materials.get('selection') : this.materials.get('activity');
    } }
    focusFloor(f) { this.floor = f; this.onFloor(f); for (const l of this.floorLabels) l.visible = f === 0; if (this.roofSign) this.roofSign.visible = f === 0; if (!f) {
        this.reset();
        return;
    } const y = (f - 1) * 6 + 1.8, lobby = f === 1; this.fly(new THREE.Vector3(0, y + (lobby ? .8 : 0), 0), new THREE.Vector3(22, y + (lobby ? 8 : f < 3 ? 3 : 12), lobby ? 35 : 31)); }
    reset(immediate = false) { this.floor = 0; this.onFloor(0); for (const l of this.floorLabels) l.visible = true; if (this.roofSign) this.roofSign.visible = true; const target = new THREE.Vector3(0, 7, 0), position = new THREE.Vector3(26, 24, 40); if (immediate) {
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
    setParticles(value) { this.particles = value; this.dust.visible = value; this.energy.visible = value; }
    setLow(value) { this.low = value; this.bloom.enabled = !value; this.renderer.setPixelRatio(value ? 1 : Math.min(devicePixelRatio, 1.65)); this.composer.setPixelRatio(value ? 1 : Math.min(devicePixelRatio, 1.65)); this.renderer.shadowMap.enabled = !value; this.key.castShadow = !value; this.dust.geometry.setDrawRange(0, value ? 200 : 850); this.updateStreams(); this.resize(); }
    resize() { const w = this.container.clientWidth, h = this.container.clientHeight; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); this.composer?.setSize(w, h); }
    animate(now) {
        this.frame = null;
        if (this.disposed || document.hidden)
            return;
        this.frame = requestAnimationFrame(t => this.animate(t));
        const dt = Math.min((now - this.lastFrame) / 1000, .05);
        this.lastFrame = now;
        this.time += this.reduced ? 0 : dt;
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
            this.rings.forEach((m, i) => { m.rotation.z = t * (i % 2 ? -.12 : .15); });
            this.elevator.position.y = 1.7 + (Math.sin(t * .12) * .5 + .5) * 12;
            this.dust.rotation.y = t * .008;
            this.pulse = Math.max(0, this.pulse - dt * .5);
            for (const a of this.actors.values()) {
                const moving = a.group.position.distanceTo(a.target) > .02;
                a.group.position.lerp(a.target, 1 - Math.exp(-dt * 2));
                a.head.rotation.y = Math.sin(t * .8 + a.phase) * .13;
                const work = a.busy ? Math.sin(t * 7 + a.phase) * .12 : 0;
                a.limbs[0].rotation.x = moving ? Math.sin(t * 6 + a.phase) * .5 : a.busy ? -.8 + work : .05;
                a.limbs[2].rotation.x = moving ? -Math.sin(t * 6 + a.phase) * .5 : a.status === 'blocked' ? -.4 : a.busy ? -.8 - work : .03;
                a.limbs[1].rotation.x = moving ? -Math.sin(t * 6 + a.phase) * .4 : 0;
                a.limbs[3].rotation.x = moving ? Math.sin(t * 6 + a.phase) * .4 : 0;
                if (/review/.test(a.status))
                    a.limbs[2].rotation.x = -1.9;
                if (/communicat|awaiting|waiting/.test(a.status)) {
                    a.limbs[0].rotation.x = -1.2;
                    a.head.rotation.y = Math.sin(t * .9 + a.phase) * .35;
                }
                if (/succeeded|completed/.test(a.status))
                    a.limbs[2].rotation.z = -.35;
                a.halo.position.copy(a.group.position);
                a.halo.position.y += .025;
            }
            if (this.particles) {
                const attr = this.energy.geometry.attributes.position, per = this.low ? 12 : 48;
                this.streams.forEach((curve, i) => { for (let j = 0; j < per; j++) {
                    const p = curve.getPoint((j / per + t * .13) % 1);
                    attr.setXYZ(i * per + j, p.x, p.y, p.z);
                } });
                attr.needsUpdate = true;
                this.energy.material.size = .07 + this.pulse * .06;
            }
        }
        const selected = this.actors.get(this.selected);
        if (selected) {
            this.focusRing.position.copy(selected.group.position);
            this.focusRing.position.y += .03;
            this.focusLight.position.copy(selected.group.position).add(new THREE.Vector3(0, 2, 0));
        }
        this.updateActorInstances();
        if (this.low)
            this.renderer.render(this.scene, this.camera);
        else
            this.composer.render();
        this.frames++;
        if (now - this.fpsStart > 1000) {
            this.onFPS(Math.round(this.frames * 1000 / (now - this.fpsStart)));
            this.frames = 0;
            this.fpsStart = now;
        }
    }
    dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.controls.dispose(); removeEventListener('resize', this.resizeHandler); document.removeEventListener('visibilitychange', this.visibilityHandler); this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown); this.renderer.domElement.removeEventListener('pointerup', this.pointerUp); this.renderer.domElement.removeEventListener('keydown', this.keyHandler); const gs = new Set(this.geometries.values()), ms = new Set(this.materials.values()); this.scene.traverse(o => { o.shadow?.dispose(); if (o.isInstancedMesh)
        o.dispose(); if (o.geometry)
        gs.add(o.geometry); if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
            ms.add(m); }); gs.forEach(g => g.dispose()); ms.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.composer.passes.forEach(pass => pass.dispose?.()); this.composer.dispose(); this.environmentTarget.dispose(); this.renderer.dispose(); }
}
