import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOM_COLORS, STATUS_META, floorForRoom, hash, workerStatus } from './studio-data.js';
const CYAN = 0x36cfff, AMBER = 0xffbd72;
// Status colours come from the same table as the HUD chips, converted to linear space.
const STATUS_COLORS = Object.fromEntries(Object.entries(STATUS_META).map(([key, meta]) => [key, new THREE.Color(meta.color)]));
const BADGE_INDEX = { working: 0, completed: 1, pending: 2, failed: 3, idle: 4 }, BADGE_CELLS = 6;
const _matrix = new THREE.Matrix4(), _position = new THREE.Vector3(), _scale = new THREE.Vector3(), _color = new THREE.Color(), _quat = new THREE.Quaternion(), _ice = new THREE.Color(0xdff6ff);
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
        this.statuses = new Map();
        this.lastEvent = null;
        this.pulse = 0;
        this.clock = 0;
        this.lights();
        this.architecture();
        this.city();
        this.loadAssetKit();
        this.flushStatics();
        this.makeParticles();
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        // Soft bloom: screens and status lights glow without washing out the building or HUD.
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .42, .5, 1.05);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        // The selection ring is neutral ice, outside the status halo, so it never hides the status colour.
        this.focusRing = this.ring(0, 0, 0, .7, .022, this.mat('selection', 0xdff6ff, 0, 1.6));
        this.focusRing.visible = false;
        this.focusLight = new THREE.PointLight(0xfff1df, 5, 4);
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
        const list = this.staticBatches.get(mat) || [];
        list.push((geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix));
        this.staticBatches.set(mat, list);
    }
    // Static furniture with a local frame (rotated chairs, angled lamp arms) still merges into the material batches.
    batchGroup(x, y, z, ry, build) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        group.rotation.y = ry;
        build((geo, mat, px, py, pz, sx, sy, sz, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.rotation.set(rx, 0, rz); group.add(m); });
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
    // Soft elliptical contact shadow shared by desks (merged) and characters (instanced).
    contactMaterial() {
        if (!this.materials.has('contact')) {
            const map = this.canvasTexture(128, 128, c => { const g = c.createRadialGradient(64, 64, 4, 64, 64, 63); g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(.55, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
            this.materials.set('contact', new THREE.MeshBasicMaterial({ color: 0x000000, map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        }
        return this.materials.get('contact');
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
            m.castShadow = !mat.transparent && mat.opacity === 1 && !mat.emissiveIntensity;
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
        // Warm interiors on the working decks, cool rim from the dispatch side: cyan stays the energy accent.
        for (let f = 0; f < 3; f++) {
            const light = new THREE.PointLight(f ? 0xffb066 : AMBER, f ? 125 : 90, 22, 2);
            light.position.set(-7, f * 6 + 3.6, -2.5);
            this.scene.add(light);
            const cool = new THREE.PointLight(0x3f9dff, f ? 50 : 65, 20, 2);
            cool.position.set(7, f * 6 + 3, 2);
            this.scene.add(cool);
        }
        const hub = new THREE.PointLight(CYAN, 48, 13, 2);
        hub.position.set(0, 2, 3);
        this.scene.add(hub);
    }
    // Dark glass plate: vertical gradient, 1px hairline, inner top highlight and a department accent bar.
    paintLabel(ctx, text, color, small = '', chips = null) {
        const W = 768, H = 128, r = 16;
        ctx.clearRect(0, 0, W, H);
        ctx.beginPath();
        ctx.moveTo(r, 1);
        ctx.arcTo(W - 1, 1, W - 1, H - 1, r);
        ctx.arcTo(W - 1, H - 1, 1, H - 1, r);
        ctx.arcTo(1, H - 1, 1, 1, r);
        ctx.arcTo(1, 1, W - 1, 1, r);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, H);
        fill.addColorStop(0, 'rgba(14,38,60,.95)');
        fill.addColorStop(1, 'rgba(3,13,25,.95)');
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(132,205,236,.3)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.09)';
        ctx.fillRect(r, 4, W - r * 2, 2);
        ctx.fillStyle = color;
        ctx.fillRect(14, 24, 5, H - 48);
        const sub = small || chips;
        const titleSize = sub ? 40 : Math.min(62, Math.floor(690 / (text.length * .62)));
        ctx.font = `600 ${titleSize}px "Avenir Next", "Trebuchet MS", sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(text, 38, sub ? 58 : 82);
        ctx.font = '500 27px "Avenir Next", "Trebuchet MS", sans-serif';
        if (chips) {
            let x = 38;
            for (const chip of chips) {
                ctx.fillStyle = chip.color;
                ctx.beginPath();
                ctx.arc(x + 7, 92, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#c9dfec';
                ctx.fillText(chip.text, x + 22, 101);
                x += 22 + ctx.measureText(chip.text).width + 26;
            }
        }
        else if (small) {
            ctx.fillStyle = '#8eaec5';
            ctx.fillText(small, 38, 101);
        }
    }
    // Floor plates are fixed panels mounted just outside the facade. A billboard would swing
    // its far half behind the mullions and get sliced; a plate in front of the deck edge cannot.
    plate(text, x, y, z, width, color) {
        const map = this.canvasTexture(768, 128, c => this.paintLabel(c, text, color));
        map.anisotropy = 4;
        const mesh = new THREE.Mesh(this.geo('plate', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
        mesh.position.set(x, y, z);
        mesh.scale.set(width, width / 6, 1);
        mesh.rotation.set(-.08, .18, 0);
        mesh.renderOrder = 5;
        this.scene.add(mesh);
        return mesh;
    }
    // Floor plates and the roof sign belong to the tower overview; any close focus hides them.
    showLabels(visible) {
        for (const l of this.floorLabels)
            l.visible = visible;
        if (this.roofSign)
            this.roofSign.visible = visible;
    }
    label(text, x, y, z, width = 5, color = '#bdeaff', small = '') {
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 128;
        this.paintLabel(canvas.getContext('2d'), text, color, small);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        this.textures.add(texture);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, toneMapped: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(x, y, z);
        sprite.scale.set(width, width / 6, 1);
        sprite.userData = { canvas, text, color };
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
            // Warm ceiling light strips: under the deck above, or under the crown frame on 3F.
            const warmStrip = this.mat('ceilingWarm', 0xffd09a, .1, 2.4);
            if (f < 2)
                for (const z of [-4.8, -.6, 3.6])
                    for (const x of [-7, 7]) {
                        this.box(x, y + 5.47, z, 9.6, .06, .26, metal);
                        this.box(x, y + 5.42, z, 9.2, .035, .12, warmStrip);
                    }
            else {
                this.box(0, y + 4.98, -7.55, 24, .035, .12, warmStrip);
                for (const x of [-13.25, 13.25])
                    this.box(x, y + 4.98, -1, .12, .035, 12.5, warmStrip);
            }
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
            this.floorLabels.push(this.plate(`${f + 1}F  ${floorNames[f]}`, -8, y + .5, 9.5, 7.4, '#a6eaff'));
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
        const glass = this.materials.get('glass'), edge = this.materials.get('edge');
        if (!this.materials.has('rug'))
            this.materials.set('rug', new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: .92, metalness: .05 }));
        const rug = this.materials.get('rug');
        for (const room of roster.rooms) {
            const f = floorForRoom(room), [cx, cz] = roomLayout[room] || [0, 0], members = roster.agents.filter(a => a.room === room), color = ROOM_COLORS[room] || CYAN;
            const y = (f - 1) * 6;
            const sign = this.label(room.toUpperCase(), cx, y + 3.55, cz - 1.3, room === 'engineering' ? 5 : 3.8, `#${color.toString(16).padStart(6, '0')}`);
            sign.userData.room = room;
            this.roomSigns.set(room, sign);
            // Room partitions and low frame imply glass offices without hiding occupants.
            this.box(cx, y + 1.6, cz - 2.1, f === 3 ? 8 : 6.6, 3.1, .025, glass);
            this.box(cx, y + 3.18, cz - 2.1, f === 3 ? 8 : 6.6, .06, .06, edge);
            this.box(cx, y + .16, cz - 2.1, f === 3 ? 8 : 6.6, .05, .06, this.materials.get('soft'));
            const cols = f === 3 ? 4 : members.length > 9 ? 5 : 3;
            const spacing = cols === 5 ? 1.45 : 1.75;
            const rows = Math.ceil(members.length / cols), width = (Math.min(cols, members.length) - 1) * spacing;
            // Warm floor zone under each department: warm interiors against the cool deck and cyan accents.
            this.box(cx, y + .122, cz - 1 + (rows - 1) * .75 + .3, width + 2.3, .006, rows * 1.5 + 1.1, rug);
            // Low glass side partitions between neighbouring departments.
            for (const side of [-1, 1]) {
                const px = cx + side * (width / 2 + 1.15);
                if (Math.abs(px) > 13.2 || (f === 3 && Math.abs(px) < 3.2))
                    continue;
                this.box(px, y + .75, cz - .9 + (rows - 1) * .5, .02, 1.25, rows * 1.5 + .6, glass);
                this.box(px, y + 1.39, cz - .9 + (rows - 1) * .5, .05, .04, rows * 1.5 + .6, edge);
            }
            members.forEach((role, i) => {
                const x = cx + (i % cols - (Math.min(cols, members.length) - 1) / 2) * spacing;
                const z = cz + Math.floor(i / cols) * 1.5 - 1;
                this.desk(x, y, z, color, role.name);
                const actor = this.createActor(role.name, role, x, y + .08, z + .64, color);
                actor.desk = new THREE.Vector3(x, y, z);
            });
        }
        this.flushStatics();
        this.statusAssets();
    }
    desk(x, y, z, color, key) {
        const metal = this.materials.get('metal'), edge = this.materials.get('edge'), box = this.geometries.get('box'), h = hash(key);
        const cyl = this.geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 32));
        const fabric = this.mat('fabric', 0x24384c, .15), shade = this.mat('lampShade', 0x2a3644, .7), glow = this.mat('lampGlow', 0xffc887, .1, 2.6);
        // Contact shadow grounds the desk and its chair.
        this.mesh(this.geo('flat', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.contactMaterial(), x + .15, y + .128, z + .35, 2.1, 1, 1.7);
        this.box(x, y + .8, z, 1.48, .12, .82, edge);
        this.box(x, y + .38, z, .08, .75, .65, metal);
        this.box(x, y + .05, z, 1, .08, .65, metal);
        this.box(x, y + 1.15, z - .17, 1.08, .61, .1, metal);
        this.box(x, y + .92, z - .17, .08, .23, .1, edge);
        // Shared inactive screens have real architectural light; status is carried by the desk strip and halo.
        this.box(x, y + 1.16, z - .105, .97, .49, .015, this.mat(`screen${color}`, color, .1, .35));
        for (let i = 0; i < 3; i++)
            this.box(x - .3, y + 1.3 - i * .12, z - .09, .22 + (hash(key + i) % 5) * .09, .022, .01, this.mat('code', 0x8ebfd0, 0, .55));
        this.box(x, y + .88, z + .19, .65, .025, .23, metal);
        // Desk lamp: weighted base, angled arm and a warm practical head.
        this.batchGroup(x - .64, y + .86, z - .22, .5, add => {
            add(cyl, metal, 0, .012, 0, .075, .024, .075);
            add(box, edge, 0, .17, 0, .022, .32, .022);
            add(box, edge, .07, .33, .03, .022, .2, .022, 0, -1.1);
            add(cyl, shade, .17, .37, .05, .07, .08, .07, 0, .5);
            add(cyl, glow, .185, .335, .05, .055, .012, .055, 0, .5);
        });
        if (h % 3 !== 1) {
            this.cyl(x + .64, y + .92, z - .22, .065, .12, this.mat('planter', 0x69757b, .6));
            const green = this.mat('leaves', 0x38776e, .05), leaf = this.geo('leaf', () => new THREE.IcosahedronGeometry(1, 0));
            for (let i = 0; i < 4; i++) {
                const a = i * 1.7 + h % 7;
                this.mesh(leaf, green, x + .64 + Math.sin(a) * .045, y + 1.04 + i * .03, z - .22 + Math.cos(a) * .045, .055, .12, .045);
            }
        }
        // Chair with a backrest, pulled out beside the agent so the character stays readable.
        this.batchGroup(x + .58, y, z + .86, -.55 + (h % 5) * .05, add => {
            add(cyl, metal, 0, .045, 0, .24, .03, .24);
            add(cyl, metal, 0, .24, 0, .035, .36, .035);
            add(box, fabric, 0, .45, 0, .46, .08, .44);
            add(box, fabric, 0, .76, .2, .44, .46, .07, -.12);
            add(box, edge, 0, .76, .24, .3, .3, .02, -.12);
            for (const side of [-1, 1])
                add(box, edge, side * .23, .58, -.02, .035, .035, .3);
        });
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
        const outfit = this.mat(`coat${color}`, color, .1), trim = this.mat(`trim${color}`, color, .12, .55);
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
                add(sphere, outfit, 0, -.01, 0, .078, .07, .078, arm);
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
                // Slightly larger eyes keep faces legible from the elevated overview camera.
                add(sphere, ink, side * .105, -.01, .272, .041, .049, .02, head);
                add(sphere, this.mat('eyeHi', 0xffffff, 0, 2.2), side * .117, .012, .29, .013, .016, .008, head);
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
        // Status halo, badge and contact shadow are drawn by the shared instanced status layer.
        // `status` starts unknown so the first poll does not replay a completion pulse.
        const actor = { id, data, group: g, parts, limbs, head, home: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x, y, z), phase: (hash(id) % 100) / 10, visitor, busy: false, status: null, burst: 0, nod: 0 };
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
            g.addColorStop(.42, 'rgba(255,255,255,.08)');
            g.addColorStop(.68, 'rgba(255,255,255,.95)');
            g.addColorStop(.76, 'rgba(255,255,255,.5)');
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
                    mv.xy += position.xy * badge.w * clamp(-mv.z / 24.0, 1.0, 2.2);
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
        const desks = list.filter(a => a.desk);
        const layer = { list, desks, badgeAttr, shadows: make(kit.flat, kit.contact, n, 1), halos: make(kit.flat, kit.halo, n, 2), bursts: make(kit.flat, kit.halo, n, 3), badges: make(this.badgeGeometry, kit.badge, n, 20), strips: desks.length ? make(this.geometries.get('box'), kit.strip, desks.length, 0) : null };
        for (let i = 0; i < n; i++) {
            layer.halos.setColorAt(i, black);
            layer.bursts.setColorAt(i, black);
        }
        // Desk-front status strips are static geometry; only their instance colours change.
        desks.forEach((a, i) => {
            layer.strips.setMatrixAt(i, _matrix.compose(_position.set(a.desk.x, a.desk.y + .8, a.desk.z + .418), _quat, _scale.set(1.3, .035, .016)));
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
        const t = this.clock || 0, calm = this.reduced;
        layer.list.forEach((a, i) => {
            const p = a.group.position, status = a.status || 'idle', lit = !!this.highlighted?.has(a.id), wave = Math.sin(t * 3.2 + a.phase);
            layer.shadows.setMatrixAt(i, _matrix.compose(_position.set(p.x, p.y + .052, p.z), _quat, _scale.set(.95, 1, .8)));
            // Halo brightness carries the status rhythm. Reduced motion keeps colour plus a slow opacity breath, no scaling.
            let glow = 0, size = 1.3;
            if (status === 'working') {
                glow = calm ? .95 + Math.sin(t * 1.9 + a.phase) * .15 : 1 + wave * .35;
                size = calm ? 1.3 : 1.3 + wave * .06;
            }
            else if (status === 'completed')
                glow = .9;
            else if (status === 'pending')
                glow = .55 + Math.sin(t * (calm ? 1.2 : 1.7) + a.phase) * (calm ? .12 : .3);
            else if (status === 'failed')
                glow = calm ? .75 : .42 + .42 * THREE.MathUtils.smoothstep(Math.sin(t * 2.4), -.25, .25);
            if (a.burst > 0) {
                a.burst = Math.max(0, a.burst - dt / 1.5);
                if (calm)
                    glow += a.burst * .8;
            }
            if (lit)
                glow = Math.max(glow * 1.35, .8);
            layer.halos.setColorAt(i, _color.copy(lit && status === 'idle' ? _ice : STATUS_COLORS[status]).multiplyScalar(glow));
            layer.halos.setMatrixAt(i, _matrix.compose(_position.set(p.x, p.y + .062, p.z), _quat, _scale.setScalar(glow ? size : 0)));
            // A brief expanding ring marks the observed transition to completed.
            const burst = calm ? 0 : a.burst;
            layer.bursts.setColorAt(i, _color.copy(STATUS_COLORS.completed).multiplyScalar(burst * 1.4));
            layer.bursts.setMatrixAt(i, _matrix.compose(_position.set(p.x, p.y + .07, p.z), _quat, _scale.setScalar(burst ? 1.3 + (1 - burst) * 2.6 : 0)));
            const bob = calm || status !== 'working' ? 0 : Math.sin(t * 2.2 + a.phase) * .03;
            layer.badges.setMatrixAt(i, _matrix.compose(_position.set(p.x, p.y + (a.visitor ? 1.98 : 2.02) + bob, p.z), _quat, _scale.setScalar(1)));
            layer.badgeAttr.setXYZW(i, BADGE_INDEX[status] ?? 4, status === 'pending' && !calm ? .8 + wave * .2 : 1, status === 'working' ? 1 : 0, status === 'idle' ? 0 : .34);
        });
        for (const mesh of [layer.shadows, layer.halos, layer.bursts, layer.badges])
            mesh.instanceMatrix.needsUpdate = true;
        layer.halos.instanceColor.needsUpdate = true;
        layer.bursts.instanceColor.needsUpdate = true;
        layer.badgeAttr.needsUpdate = true;
        layer.badges.material.uniforms.time.value = calm ? 0 : t;
        if (this.stripsDirty && layer.strips) {
            const gain = { working: 1.7, completed: 1.05, pending: 1, failed: 1.1, idle: .2 };
            layer.desks.forEach((a, i) => layer.strips.setColorAt(i, _color.copy(STATUS_COLORS[a.status || 'idle']).multiplyScalar(gain[a.status || 'idle'])));
            layer.strips.instanceColor.needsUpdate = true;
            this.stripsDirty = false;
        }
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
        this.updateStatusLayer(this.frameDt || 0);
    }
    setStatus(a, status) {
        if (a.status === status)
            return;
        // Only an observed transition plays the completion burst and nod; the first poll does not.
        if (status === 'completed' && a.status) {
            a.burst = 1;
            a.nod = 1;
        }
        a.status = status;
        a.busy = status === 'working';
        this.stripsDirty = true;
    }
    update(state, statuses = new Map(), board) {
        this.state = state;
        this.statuses = statuses;
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
            this.setStatus(a, (statuses.get(id) || workerStatus(w)).status);
            // A status change moves the visitor smoothly between its arrival and dispatch station.
            a.target.copy(a.home);
            if (a.busy)
                a.target.z = Math.max(-1, a.home.z - 1.3);
        }
        for (const [id, a] of this.actors) {
            if (a.visitor && !visitors.has(id)) {
                this.scene.remove(a.group);
                this.pickables = this.pickables.filter(p => p.userData.actorId !== id);
                this.actors.delete(id);
                this.actorBatchesDirty = true;
                continue;
            }
            if (!a.visitor)
                this.setStatus(a, statuses.get(id)?.status || 'idle');
        }
        this.updateRoomSigns();
        this.updateStreams();
        const event = state.audit?.events?.at(-1), eventKey = event ? `${event.ts}:${event.agent}:${event.kind}` : null;
        if (this.lastEvent && eventKey !== this.lastEvent)
            this.pulse = 1;
        this.lastEvent = eventKey;
    }
    // Room signs carry live per-department counts; canvases are repainted only when the counts change.
    updateRoomSigns() {
        for (const [room, sign] of this.roomSigns) {
            const members = this.roster?.agents.filter(a => a.room === room) || [];
            const count = s => members.filter(m => this.actors.get(m.name)?.status === s).length;
            const chips = ['working', 'completed', 'pending', 'failed'].map(s => [count(s), s]).filter(([n]) => n).map(([n, s]) => ({ text: `${n} ${STATUS_META[s].label.toLowerCase()}`, color: STATUS_META[s].color }));
            const key = chips.map(c => c.text).join('|') || 'idle';
            if (sign.userData.key === key)
                continue;
            sign.userData.key = key;
            this.paintLabel(sign.userData.canvas.getContext('2d'), sign.userData.text, sign.userData.color, `${members.length} agent${members.length === 1 ? '' : 's'} · idle`, chips.length ? chips : null);
            sign.material.map.needsUpdate = true;
            sign.material.color.set(count('working') ? 0xffffff : 0xb9cad8);
        }
    }
    drawTasks(board) {
        const c = this.taskCanvas.getContext('2d'), bg = c.createLinearGradient(0, 0, 0, 512);
        bg.addColorStop(0, '#072339');
        bg.addColorStop(1, '#03111f');
        c.fillStyle = bg;
        c.fillRect(0, 0, 768, 512);
        c.fillStyle = '#71ddff';
        c.font = '600 30px "Avenir Next", sans-serif';
        c.fillText('LIVE DISPATCH', 42, 64);
        c.fillStyle = 'rgba(120,200,235,.3)';
        c.fillRect(42, 88, 684, 2);
        c.font = '26px "Avenir Next", sans-serif';
        if (!board) {
            c.fillStyle = '#7d9db3';
            c.fillText('Awaiting state', 42, 150);
        }
        else {
            c.fillStyle = '#9fc0d4';
            c.fillText(`${board.source.toUpperCase()} · ${board.total} TASKS`, 42, 140);
            const done = board.source === 'Orca' ? 'completed' : 'done';
            [['running', 'working'], ['pending', 'pending'], ['blocked', 'failed'], [done, 'completed']].forEach(([lane, status], i) => {
                const y = 210 + i * 76, color = STATUS_META[status].color;
                c.fillStyle = color;
                c.beginPath();
                c.arc(54, y - 9, 8, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = '#d3eaff';
                c.font = '26px "Avenir Next", sans-serif';
                c.fillText(lane.toUpperCase(), 80, y);
                c.fillStyle = color;
                c.font = '600 30px ui-monospace, monospace';
                c.fillText(String(board.counts[lane] || 0).padStart(4, ' '), 620, y);
            });
        }
        this.taskTexture.needsUpdate = true;
    }
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
        if (this.roster.agents.some(a => a.room === room && this.actors.get(a.name)?.status === 'working')) {
            const [x, z] = roomLayout[room] || [0, 0], y = (floorForRoom(room) - 1) * 6;
            this.streams.push(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.2, 2), new THREE.Vector3(2, y * .5 + 2, 7), new THREE.Vector3(x * .7, y + .4, 7), new THREE.Vector3(x, y + 1, z)]));
        } this.energy.geometry.setDrawRange(0, this.streams.length * (this.low ? 12 : 48)); }
    pick(event) { const rect = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); this.ray.setFromCamera(this.pointer, this.camera); const hit = this.ray.intersectObjects(this.pickables)[0]; if (hit) {
        this.select(hit.object.userData.actorId);
        this.onSelect(hit.object.userData.actorId);
    } }
    select(id, focus = true) { const a = this.actors.get(id); this.selected = id; this.focusRing.visible = !!a; this.focusLight.visible = !!a; if (a && focus) {
        this.showLabels(false);
        const target = a.group.position.clone().add(new THREE.Vector3(0, 1, 0));
        this.fly(target, target.clone().add(new THREE.Vector3(13, a.home.y < 11 ? 4 : 10, 18)));
    } }
    // Lane filters brighten matching halos; idle matches get a neutral ice halo so status colours stay truthful.
    highlight(ids) { this.highlighted = ids ? new Set(ids) : null; }
    pose(a, t, moving, dt) {
        const [leftArm, leftLeg, rightArm, rightLeg] = a.limbs, s = a.status, phase = a.phase;
        // Heads bias toward the default camera (+x, above) so faces read at the overview angle.
        let la = .05, ra = .03, laz = 0, raz = 0, ll = 0, rl = 0, yaw = .16 + Math.sin(t * .8 + phase) * .13, pitch = -.05;
        if (moving) {
            const step = Math.sin(t * 6 + phase);
            la = step * .5;
            ra = -step * .5;
            ll = -step * .4;
            rl = step * .4;
        }
        else if (s === 'working') {
            const key = Math.sin(t * 7 + phase) * .12;
            la = -.8 + key;
            ra = -.8 - key;
            yaw = .1 + Math.sin(t * .6 + phase) * .05;
            pitch = .1 + Math.sin(t * 1.7 + phase) * .02;
        }
        else if (s === 'completed') {
            la = ra = -.18;
            laz = -.08;
            raz = .08;
            yaw = .18;
        }
        else if (s === 'pending') {
            la = ra = -.55;
            laz = .45;
            raz = -.45;
            yaw = .16 + Math.sin(t * .5 + phase) * .4;
            rl = Math.max(0, Math.sin(t * 3.2 + phase)) * .16;
        }
        else if (s === 'failed') {
            la = ra = .02;
            laz = -.1;
            raz = .1;
            yaw = 0;
            pitch = .34;
        }
        if (a.nod > 0) {
            a.nod = this.reduced ? 0 : Math.max(0, a.nod - dt / 1.6);
            pitch = Math.sin((1 - a.nod) * Math.PI * 4) * .22 * a.nod;
        }
        leftArm.rotation.set(la, 0, laz);
        rightArm.rotation.set(ra, 0, raz);
        leftLeg.rotation.x = ll;
        rightLeg.rotation.x = rl;
        a.head.rotation.set(pitch, yaw, 0);
    }
    focusFloor(f) { this.floor = f; this.onFloor(f); this.showLabels(f === 0); if (!f) {
        this.reset();
        return;
    } const y = (f - 1) * 6 + 1.8, lobby = f === 1; this.fly(new THREE.Vector3(0, y + (lobby ? .8 : 0), 0), new THREE.Vector3(22, y + (lobby ? 8 : f < 3 ? 3 : 12), lobby ? 35 : 31)); }
    reset(immediate = false) { this.floor = 0; this.onFloor(0); this.showLabels(true); const target = new THREE.Vector3(0, 7, 0), position = new THREE.Vector3(26, 24, 40); if (immediate) {
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
        // rAF timestamps can precede the performance.now() taken at construction; never step backwards.
        const dt = Math.max(0, Math.min((now - this.lastFrame) / 1000, .05));
        this.lastFrame = now;
        this.time += this.reduced ? 0 : dt;
        this.clock += dt;
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
            this.rings.forEach((m, i) => { m.rotation.z = t * (i % 2 ? -.12 : .15); });
            this.elevator.position.y = 1.7 + (Math.sin(t * .12) * .5 + .5) * 12;
            this.dust.rotation.y = t * .008;
            this.pulse = Math.max(0, this.pulse - dt * .5);
            for (const a of this.actors.values()) {
                const moving = a.group.position.distanceTo(a.target) > .02;
                a.group.position.lerp(a.target, 1 - Math.exp(-dt * 2));
                this.pose(a, t, moving, dt);
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
        else
            // Reduced motion: no walking or gestures, but every agent still holds its status pose.
            for (const a of this.actors.values()) {
                a.group.position.copy(a.target);
                this.pose(a, 0, false, dt);
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
    loadAssetKit() {
        // Optional Blender-authored kit. The procedural scene stays complete if the
        // file is absent or fails to parse; this is a quality upgrade, not a dependency.
        new GLTFLoader().load('/assets/studio-kit.glb', gltf => {
            if (this.disposed) return;
            const kit = gltf.scene;
            kit.name = 'BLENDER_STUDIO_KIT';
            kit.scale.setScalar(.92);
            kit.rotation.y = -.55;
            kit.position.set(8.2, .12, 4.4);
            kit.traverse(o => {
                if (!o.isMesh) return;
                o.castShadow = true;
                o.receiveShadow = true;
                o.frustumCulled = true;
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                    if (m?.isMeshStandardMaterial) {
                        m.envMapIntensity = .9;
                        if (/cyan/i.test(m.name)) {
                            m.emissive.setHex(0x1b8cac);
                            m.emissiveIntensity = .45;
                        } else if (/green/i.test(m.name)) {
                            m.emissive.setHex(0x1d7d4d);
                            m.emissiveIntensity = .35;
                        }
                        m.needsUpdate = true;
                    }
                }
            });
            const base = this.cyl(8.2, .05, 4.4, 3.15, .1, this.mat('kitBase', 0x0b2336, .55, .1));
            base.receiveShadow = true;
            this.ring(8.2, .13, 4.4, 2.95, .018, this.mat('kitRim', CYAN, 0, 1.4));
            const key = new THREE.PointLight(0xffcf9a, 7, 8);
            key.position.set(8.2, 3.2, 5.6);
            const fill = new THREE.PointLight(0x4ccfff, 4.5, 7);
            fill.position.set(6.6, 1.2, 3.4);
            this.scene.add(kit, key, fill);
            this.assetKit = kit;
            this.label('BLENDER KIT', 8.2, 2.2, 6.5, 4.1, '#ffcf8c', 'MCP → GLB · OPTIONAL');
        }, undefined, () => {
            // Keep the procedural floor untouched; no console noise for an optional asset.
        });
    }
    dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.controls.dispose(); removeEventListener('resize', this.resizeHandler); document.removeEventListener('visibilitychange', this.visibilityHandler); this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown); this.renderer.domElement.removeEventListener('pointerup', this.pointerUp); this.renderer.domElement.removeEventListener('keydown', this.keyHandler); const gs = new Set(this.geometries.values()), ms = new Set(this.materials.values()); this.scene.traverse(o => { o.shadow?.dispose(); if (o.isInstancedMesh)
        o.dispose(); if (o.geometry)
        gs.add(o.geometry); if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
            ms.add(m); }); gs.forEach(g => g.dispose()); ms.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.composer.passes.forEach(pass => pass.dispose?.()); this.composer.dispose(); this.environmentTarget.dispose(); this.renderer.dispose(); }
}
