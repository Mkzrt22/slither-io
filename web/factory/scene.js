/**
 * scene.ts — Real-3D food campus for the production-line game (high detail).
 *
 * The simulation is the same five-stage flow (receiving → prep → cooking →
 * plating → delivery), but staged as a CAMPUS rather than a conveyor: five
 * distinct buildings sit on a map, each with its own architecture, rooftop
 * sign, buffer gauge, status light and working chefs. Goods travel between
 * buildings along roads on a DIFFERENT vehicle per leg — a forklift, a cargo
 * trike, an electric tug + trolley, a box van — and delivery scooters leave the
 * map to sell. Traffic density tracks the line's real throughput, and the
 * bottleneck building glows red.
 *
 * Quality: PBR materials lit by a procedural environment map, GTAO + UnrealBloom
 * + ACES + SMAA post-processing (with a Perf fallback), soft shadows, steam and
 * sparks. Three.js is vendored/bundled; everything else is procedural, so the
 * scene is fully offline. Public API unchanged: setState() + update loop.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FactoryEngine } from '../../src/factory/FactoryEngine.js';
import { STATION_IDS } from '../../src/factory/types.js';
import { STATION_DEF_BY_ID } from '../../src/factory/config.js';
import { makeGlow } from '../iso3dtex.js';
/** Building footprint centres on the campus map (x, z). */
const BUILDING_POS = {
    receiving: [-8.4, -4.0],
    prep: [-9.0, 3.8],
    cooking: [0.0, 6.2],
    plating: [9.0, 3.8],
    delivery: [8.4, -4.0],
};
const STATION_COLOR = {
    receiving: 0x3f73b4, prep: 0x3aa06e, cooking: 0xd06536, plating: 0xc09a36, delivery: 0xb04246,
};
const STATION_ACCENT = {
    receiving: 0x7cc0ff, prep: 0x7dffb0, cooking: 0xff9a3a, plating: 0xffe27a, delivery: 0xff8a8a,
};
const STATION_FX = {
    receiving: null, prep: 'spark', cooking: 'steam', plating: 'steam', delivery: null,
};
export function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    }
    catch {
        return false;
    }
}
export class FactoryScene {
    constructor(canvas, onTapStation) {
        this.canvas = canvas;
        this.onTapStation = onTapStation;
        this.scene = new THREE.Scene();
        this.world = new THREE.Group();
        this.buildings = new Map();
        this.legs = [];
        this.particles = [];
        this.roamers = [];
        this.composer = null;
        this.bloomPass = null;
        this.quality = 'ultra';
        this.state = null;
        this.throughput = 0;
        this.bottleneck = 'cooking';
        this.steamAccum = 0;
        this.sparkAccum = 0;
        this.raf = 0;
        this.last = 0;
        this.t = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.viewSize = 19;
        this.targetViewSize = 19;
        this.aspect = 1;
        this.raycaster = new THREE.Raycaster();
        this.pointers = new Map();
        this.dragging = false;
        this.dragMoved = 0;
        this.lastPX = 0;
        this.lastPinch = 0;
        this.pinching = false;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.3;
        this.scene.background = new THREE.Color(0x121821);
        this.scene.fog = new THREE.Fog(0x121821, 34, 64);
        this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
        this.camera.position.set(16, 17, 18);
        this.camera.lookAt(0, 0.8, 0.5);
        this.scene.add(this.world);
        this.scene.add(new THREE.HemisphereLight(0xdce8ff, 0x2b3038, 0.85));
        this.sun = new THREE.DirectionalLight(0xfff1da, 2.05);
        this.sun.position.set(10, 20, 12);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.radius = 4;
        const sc = this.sun.shadow.camera;
        sc.left = -16;
        sc.right = 16;
        sc.top = 16;
        sc.bottom = -16;
        sc.near = 1;
        sc.far = 64;
        this.sun.shadow.bias = -0.0004;
        this.scene.add(this.sun, this.sun.target);
        const rim = new THREE.DirectionalLight(0x9fc0ff, 0.55);
        rim.position.set(-12, 8, -10);
        this.scene.add(rim);
        this.buildEnvMap();
        this.buildGround();
        this.buildRoads();
        this.buildBuildings();
        this.buildVehicles();
        this.buildProps();
        this.spawnRoamers(6);
        this.resize();
        this.initQuality();
        this.setupPost();
        window.addEventListener('resize', () => this.resize());
        canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', (e) => this.onPointerUp(e));
        window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    }
    // --- Post-processing pipeline ----------------------------------------------
    initQuality() {
        try {
            const forced = window.LCT_GFX;
            const saved = localStorage.getItem('chef_gfx');
            const q = forced ?? saved;
            if (q === 'basic' || q === 'ultra')
                this.quality = q;
        }
        catch { /* default ultra */ }
    }
    setupPost() {
        if (this.quality !== 'ultra' || this.composer)
            return;
        try {
            const size = new THREE.Vector2();
            this.renderer.getSize(size);
            const composer = new EffectComposer(this.renderer);
            composer.addPass(new RenderPass(this.scene, this.camera));
            const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
            gtao.output = 0;
            gtao.blendIntensity = 0.6;
            gtao.updateGtaoMaterial({
                radius: 0.9, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false,
            });
            composer.addPass(gtao);
            const bloom = new UnrealBloomPass(size, 0.42, 0.4, 0.85);
            composer.addPass(bloom);
            composer.addPass(new OutputPass());
            composer.addPass(new SMAAPass(size.x, size.y));
            this.composer = composer;
            this.bloomPass = bloom;
        }
        catch (err) {
            console.warn('[factory] post-processing unavailable, using direct render', err);
            this.composer = null;
            this.quality = 'basic';
        }
    }
    setQuality(q) {
        if (q === this.quality)
            return;
        this.quality = q;
        try {
            localStorage.setItem('chef_gfx', q);
        }
        catch { /* ignore */ }
        if (q === 'ultra')
            this.setupPost();
    }
    getQuality() { return this.quality; }
    // --- Environment map --------------------------------------------------------
    buildEnvMap() {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 256;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#5a7088');
        grad.addColorStop(0.5, '#43525f');
        grad.addColorStop(1, '#11161d');
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 256);
        g.fillStyle = '#fffdf2';
        for (const x of [70, 190, 310, 430])
            g.fillRect(x, 14, 56, 12);
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const env = pmrem.fromEquirectangular(tex).texture;
        this.scene.environment = env;
        tex.dispose();
        pmrem.dispose();
    }
    // --- Ground & roads ---------------------------------------------------------
    buildGround() {
        const ground = new THREE.Mesh(new THREE.BoxGeometry(48, 1, 44), new THREE.MeshStandardMaterial({ map: this.texGround(), color: 0x6a7a5e, roughness: 0.95, metalness: 0.05 }));
        ground.position.y = -0.5;
        ground.receiveShadow = true;
        this.world.add(ground);
        // A subtle plaza pad under the central building cluster.
        const plaza = new THREE.Mesh(new THREE.CircleGeometry(13.5, 56), new THREE.MeshStandardMaterial({ map: this.texConcrete(), color: 0x8c8f96, roughness: 0.9 }));
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.012;
        plaza.receiveShadow = true;
        this.world.add(plaza);
    }
    buildRoads() {
        const ids = STATION_IDS;
        for (let i = 0; i < ids.length - 1; i++) {
            this.addRoad(this.posOf(ids[i]), this.posOf(ids[i + 1]));
        }
        // Exit road (scooters leave) + customer arrival road, both at the front.
        this.addRoad(this.posOf('delivery'), new THREE.Vector2(BUILDING_POS.delivery[0] - 2, 11));
        this.addRoad(this.posOf('delivery'), new THREE.Vector2(BUILDING_POS.delivery[0] + 3, 12));
    }
    posOf(id) {
        return new THREE.Vector2(BUILDING_POS[id][0], BUILDING_POS[id][1]);
    }
    addRoad(a, b) {
        const dx = b.x - a.x, dz = b.y - a.y;
        const len = Math.hypot(dx, dz);
        const road = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, len), new THREE.MeshStandardMaterial({ map: this.texRoad(len), color: 0x3a3e44, roughness: 0.95 }));
        road.position.set((a.x + b.x) / 2, 0.03, (a.y + b.y) / 2);
        road.rotation.y = Math.atan2(dx, dz);
        road.receiveShadow = true;
        this.world.add(road);
        // A few kerb lamps along the road (one side, sparse).
        const n = Math.max(1, Math.floor(len / 5));
        for (let i = 1; i <= n; i++) {
            const f = i / (n + 1);
            const px = a.x + dx * f, pz = a.y + dz * f;
            const off = 1.15;
            const nx = -dz / len, nz = dx / len;
            this.addLamp(px + nx * off, pz + nz * off);
        }
    }
    addLamp(x, z) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.5 }));
        pole.position.set(x, 0.85, z);
        pole.castShadow = true;
        this.world.add(pole);
        // A small shaded head: a dim emissive bulb under a hood. The bloom pass
        // gives it a *subtle* halo — no additive sprite, which was blowing out.
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.05, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.6, metalness: 0.5 }));
        hood.position.set(x, 1.78, z);
        this.world.add(hood);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff2d2, emissive: 0xffdf9a, emissiveIntensity: 0.9 }));
        bulb.position.set(x, 1.66, z);
        this.world.add(bulb);
    }
    // --- Buildings --------------------------------------------------------------
    buildBuildings() {
        for (const id of STATION_IDS) {
            const def = STATION_DEF_BY_ID[id];
            const [x, z] = BUILDING_POS[id];
            const color = STATION_COLOR[id];
            const accent = STATION_ACCENT[id];
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            group.scale.setScalar(1.3); // bigger, more substantial buildings
            // Face the campus centre.
            group.rotation.y = Math.atan2(-x, -z) * 0.5;
            const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.45 });
            const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.9 });
            // Plot pad.
            const pad = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 3.0), concrete);
            pad.position.y = 0.08;
            pad.receiveShadow = true;
            group.add(pad);
            // Main body (scaled by level).
            const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 2.0), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
            body.position.set(0, 1.0, -0.1);
            body.castShadow = true;
            body.receiveShadow = true;
            group.add(body);
            // Trim band.
            const trim = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 2.1), dark);
            trim.position.set(0, 1.78, -0.1);
            group.add(trim);
            this.addRoof(group, id, dark);
            // Big glowing door/window panel facing front.
            const screenMat = new THREE.MeshStandardMaterial({
                map: this.texScreen(def.icon, accent), emissive: accent, emissiveIntensity: 0.85, roughness: 0.3,
            });
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), screenMat);
            screen.position.set(0, 0.95, 0.92);
            group.add(screen);
            // Rooftop sign with the station icon.
            const sign = this.makeIconSprite(def.icon);
            sign.position.set(0, 2.7, -0.1);
            sign.scale.set(1.5, 1.5, 1);
            group.add(sign);
            // Buffer gauge on the front trim.
            const gaugeBg = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1 }));
            gaugeBg.position.set(0, 1.78, 0.96);
            group.add(gaugeBg);
            const gaugeFill = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.13, 0.06), new THREE.MeshStandardMaterial({ color: 0x57e08a, emissive: 0x1a5a30, emissiveIntensity: 0.6, roughness: 0.5 }));
            gaugeFill.position.set(0, 1.78, 0.98);
            group.add(gaugeFill);
            // Status light.
            const statusMat = new THREE.MeshStandardMaterial({ color: 0x223018, emissive: 0x55e070, emissiveIntensity: 1.2, roughness: 0.4 });
            const status = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), statusMat);
            status.position.set(1.05, 2.0, 0.6);
            group.add(status);
            const statusGlow = makeGlow(0x66ff88, 0.5);
            statusGlow.position.copy(status.position);
            statusGlow.material.opacity = 0.5;
            group.add(statusGlow);
            // Bottleneck halo on the pad.
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.09, 10, 32), new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 1.0, roughness: 0.5 }));
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.06;
            ring.visible = false;
            group.add(ring);
            // Pick target.
            const pick = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 3.0), new THREE.MeshBasicMaterial({ visible: false }));
            pick.position.y = 1.5;
            pick.userData.id = id;
            group.add(pick);
            this.world.add(group);
            const door = new THREE.Vector3(x, 0, z + 2.4);
            const vis = {
                id, group, body, gaugeFill, ring, pick, screenMat, statusMat, statusGlow,
                fx: STATION_FX[id], fxAnchor: new THREE.Vector3(x, 2.4, z - 0.2),
                npcs: [], door, rate: 1,
            };
            this.buildings.set(id, vis);
        }
    }
    /** Per-type roof / extras so each building reads as a distinct place. */
    addRoof(group, id, dark) {
        const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.35, metalness: 0.7 });
        switch (id) {
            case 'receiving': {
                // Loading dock: a roller door + a parked delivery truck.
                const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.5, metalness: 0.5 }));
                door.position.set(0, 0.7, 0.96);
                group.add(door);
                const truck = new THREE.Group();
                const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x3f73b4, roughness: 0.4, metalness: 0.4 }));
                cab.position.set(0, 0.6, 0);
                cab.castShadow = true;
                truck.add(cab);
                const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 1.4), new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 }));
                box.position.set(0, 0.7, 1.2);
                box.castShadow = true;
                truck.add(box);
                for (const [wx, wz] of [[0.42, 0.1], [-0.42, 0.1], [0.45, 1.4], [-0.45, 1.4]]) {
                    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x14141a }));
                    w.rotation.z = Math.PI / 2;
                    w.position.set(wx, 0.18, wz);
                    truck.add(w);
                }
                truck.position.set(0, 0, 2.6);
                group.add(truck);
                break;
            }
            case 'cooking': {
                // Pitched roof with two steaming chimneys.
                const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.6, 0.9, 4), dark);
                roof.rotation.y = Math.PI / 4;
                roof.position.set(0, 2.3, -0.1);
                roof.scale.z = 1.3;
                group.add(roof);
                for (const cx of [-0.7, 0.7]) {
                    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 12), metal);
                    ch.position.set(cx, 2.7, -0.5);
                    ch.castShadow = true;
                    group.add(ch);
                }
                break;
            }
            case 'plating': {
                // Clean flat roof + a glass canopy.
                const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.2), metal);
                roof.position.set(0, 2.0, -0.1);
                group.add(roof);
                const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5 }));
                glass.position.set(0, 0.7, 1.0);
                group.add(glass);
                break;
            }
            case 'delivery': {
                // Dispatch depot: flat roof + two van bays with a parked van.
                const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.2), dark);
                roof.position.set(0, 1.95, -0.1);
                group.add(roof);
                const van = this.makeVan();
                van.scale.setScalar(0.9);
                van.position.set(0.4, 0, 2.4);
                van.rotation.y = Math.PI;
                group.add(van);
                break;
            }
            default: {
                // prep: sawtooth factory roof.
                for (const rx of [-0.6, 0.6]) {
                    const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.7, 0.7, 3), dark);
                    tooth.rotation.y = Math.PI / 2;
                    tooth.position.set(rx, 2.1, -0.1);
                    tooth.scale.z = 1.4;
                    group.add(tooth);
                }
            }
        }
    }
    // --- Vehicles (different per leg) -------------------------------------------
    buildVehicles() {
        const ids = STATION_IDS;
        const makers = [
            () => this.makeForklift(), // receiving → prep
            () => this.makeTrike(), // prep → cooking
            () => this.makeTug(), // cooking → plating
            () => this.makeVanCargo(), // plating → delivery
        ];
        for (let i = 0; i < ids.length - 1; i++) {
            const a = this.buildings.get(ids[i]).door.clone();
            const b = this.buildings.get(ids[i + 1]).door.clone();
            this.legs.push({ from: a, to: b, make: makers[i], pool: [], accum: 0, turn: Math.atan2(b.x - a.x, b.z - a.z) });
        }
        // Exit leg: scooters leave delivery toward the front of the map.
        const d = this.buildings.get('delivery').door.clone();
        const exit = new THREE.Vector3(d.x - 2, 0, 11.5);
        this.legs.push({ from: d, to: exit, make: () => this.makeScooter(), pool: [], accum: 0, turn: Math.atan2(exit.x - d.x, exit.z - d.z) });
        // Customer cars arrive at the delivery point to pick up orders.
        const arrival = new THREE.Vector3(d.x + 3, 0, 12.5);
        this.legs.push({ from: arrival, to: d, make: () => this.makeCar(), pool: [], accum: 0, turn: Math.atan2(d.x - arrival.x, d.z - arrival.z) });
    }
    makeCar() {
        const g = new THREE.Group();
        const cols = [0xd84a4a, 0x4a8fd8, 0x4ad88f, 0xd8c44a, 0xb46ad8, 0xe0863a];
        const col = cols[(Math.random() * cols.length) | 0];
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.34, 1.35), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.5 }));
        body.position.y = 0.36;
        body.castShadow = true;
        g.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.32, 0.72), new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.15, metalness: 0.3 }));
        cabin.position.set(0, 0.66, -0.05);
        g.add(cabin);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
        head.position.set(0, 0.68, 0.08);
        g.add(head);
        // Dim headlights (kept below the bloom threshold).
        for (const hx of [0.24, -0.24]) {
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 0.6 }));
            lamp.position.set(hx, 0.34, 0.66);
            g.add(lamp);
        }
        this.wheels(g, [[0.38, 0.46], [-0.38, 0.46], [0.38, -0.46], [-0.38, -0.46]], 0.15);
        g.visible = false;
        return g;
    }
    spawnVehicle(leg) {
        let v = leg.pool.find((x) => !x.active);
        if (!v) {
            if (leg.pool.length >= 4)
                return;
            v = { group: leg.make(), t: 0, speed: 0.22 + Math.random() * 0.08, active: false };
            this.world.add(v.group);
            leg.pool.push(v);
        }
        v.active = true;
        v.t = 0;
        v.group.visible = true;
        v.group.rotation.y = leg.turn;
    }
    // --- Vehicle meshes ---------------------------------------------------------
    wheels(g, spots, r = 0.13) {
        const m = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 });
        for (const [x, z] of spots) {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 12), m);
            w.rotation.z = Math.PI / 2;
            w.position.set(x, r, z);
            g.add(w);
        }
    }
    makeForklift() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0xf0a826, roughness: 0.5, metalness: 0.3 }));
        body.position.y = 0.45;
        body.castShadow = true;
        g.add(body);
        const cage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6 }));
        cage.position.set(0, 0.85, -0.1);
        g.add(cage);
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.6 }));
        mast.position.set(0, 0.7, 0.42);
        g.add(mast);
        // Pallet + crate cargo on the forks.
        const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.9 }));
        pallet.position.set(0, 0.2, 0.55);
        g.add(pallet);
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: 0xb0813f, roughness: 0.85 }));
        crate.position.set(0, 0.45, 0.55);
        crate.castShadow = true;
        g.add(crate);
        this.addDriver(g, 0, 0.7, -0.1);
        this.wheels(g, [[0.28, 0.25], [-0.28, 0.25], [0.26, -0.25], [-0.26, -0.25]]);
        g.visible = false;
        return g;
    }
    makeTrike() {
        const g = new THREE.Group();
        const cart = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x3aa06e, roughness: 0.5 }));
        cart.position.set(0, 0.4, -0.3);
        cart.castShadow = true;
        g.add(cart);
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0xcaa24a, roughness: 0.7 }));
        bin.position.set(0, 0.7, -0.3);
        g.add(bin);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6 }));
        head.position.set(0, 0.45, 0.4);
        g.add(head);
        this.addDriver(g, 0, 0.55, 0.18);
        this.wheels(g, [[0, 0.5], [0.3, -0.45], [-0.3, -0.45]], 0.14);
        g.visible = false;
        return g;
    }
    makeTug() {
        const g = new THREE.Group();
        const tug = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x586070, roughness: 0.4, metalness: 0.5 }));
        tug.position.set(0, 0.4, 0.35);
        tug.castShadow = true;
        g.add(tug);
        this.addDriver(g, 0, 0.6, 0.4);
        // Towed covered trolley with trays (steams a little).
        const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 }));
        trolley.position.set(0, 0.5, -0.45);
        trolley.castShadow = true;
        g.add(trolley);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.74), new THREE.MeshStandardMaterial({ color: 0xc09a36, roughness: 0.5 }));
        lid.position.set(0, 0.82, -0.45);
        g.add(lid);
        this.wheels(g, [[0.22, 0.5], [-0.22, 0.5], [0.26, -0.5], [-0.26, -0.5]], 0.12);
        g.visible = false;
        return g;
    }
    makeVan() {
        const g = new THREE.Group();
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xb04246, roughness: 0.4, metalness: 0.35 }));
        cab.position.set(0, 0.5, 0.5);
        cab.castShadow = true;
        g.add(cab);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.85, 1.0), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.5 }));
        box.position.set(0, 0.62, -0.35);
        box.castShadow = true;
        g.add(box);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 1.02), new THREE.MeshStandardMaterial({ color: 0xb04246, emissive: 0x401015, emissiveIntensity: 0.3, roughness: 0.5 }));
        stripe.position.set(0, 0.62, -0.35);
        g.add(stripe);
        this.wheels(g, [[0.4, 0.45], [-0.4, 0.45], [0.42, -0.5], [-0.42, -0.5]], 0.15);
        return g;
    }
    makeVanCargo() {
        const g = this.makeVan();
        this.addDriver(g, 0, 0.72, 0.5);
        g.visible = false;
        return g;
    }
    makeScooter() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.62), new THREE.MeshStandardMaterial({ color: 0xb2484a, roughness: 0.4, metalness: 0.3 }));
        body.position.y = 0.24;
        body.castShadow = true;
        g.add(body);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4b942, emissive: 0xff8c1a, emissiveIntensity: 0.4, roughness: 0.5 }));
        box.position.set(0, 0.46, -0.28);
        g.add(box);
        this.addDriver(g, 0, 0.5, 0.04);
        this.wheels(g, [[0, 0.28], [0, -0.28]], 0.12);
        g.visible = false;
        return g;
    }
    addDriver(g, x, y, z) {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f55c8, roughness: 0.7 }));
        body.position.set(x, y, z);
        g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
        head.position.set(x, y + 0.22, z);
        g.add(head);
    }
    // --- Props (campus dressing) -----------------------------------------------
    buildProps() {
        // Perimeter fence posts.
        const postMat = new THREE.MeshStandardMaterial({ color: 0x40454e, roughness: 0.7, metalness: 0.4 });
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 11) {
            const r = 15.5;
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), postMat);
            post.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r * 0.85);
            this.world.add(post);
        }
        // Crate stacks + barrels scattered between buildings.
        const spots = [[-2.8, 0.5], [3.0, 0.2], [-4.0, -1.0], [4.2, -1.2], [0.5, 1.6]];
        for (const [x, z] of spots) {
            const g = new THREE.Group();
            for (let i = 0; i < 3; i++) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: i % 2 ? 0xb0813f : 0x9a6f3f, roughness: 0.85 }));
                c.position.set((i % 2) * 0.52, 0.25 + Math.floor(i / 2) * 0.52, 0);
                c.castShadow = true;
                g.add(c);
            }
            g.position.set(x, 0, z);
            g.rotation.y = Math.random() * Math.PI;
            this.world.add(g);
        }
        // A few planters of greenery for life.
        for (const [x, z] of [[-11.5, 7.5], [11.5, 7.5], [-11.5, -7], [11.5, -7]]) {
            const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.9 }));
            box.position.set(x, 0.25, z);
            box.castShadow = true;
            this.world.add(box);
            const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0x4e8a3c, roughness: 0.9, flatShading: true }));
            bush.position.set(x, 0.9, z);
            bush.castShadow = true;
            this.world.add(bush);
        }
    }
    // --- NPCs -------------------------------------------------------------------
    spawnRoamers(n) {
        for (let i = 0; i < n; i++) {
            const mesh = this.makeChef();
            const x = (Math.random() - 0.5) * 10, z = (Math.random() - 0.5) * 8;
            mesh.position.set(x, 0, z);
            this.world.add(mesh);
            this.roamers.push({ mesh, x, z, tx: x, tz: z, speed: 0.7 + Math.random() * 0.7, pause: Math.random() * 2, phase: Math.random() * 6 });
        }
    }
    makeChef() {
        const w = new THREE.Group();
        const coat = new THREE.Color().setHSL(0.08 + Math.random() * 0.5, 0.15, 0.85);
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.26, 4, 8), new THREE.MeshStandardMaterial({ color: coat, roughness: 0.6 }));
        body.position.y = 0.44;
        body.castShadow = true;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
        head.position.y = 0.74;
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
        hat.position.y = 0.9;
        w.add(body, head, hat);
        return w;
    }
    syncNpcs(vis, count) {
        while (vis.npcs.length < count) {
            const chef = this.makeChef();
            const i = vis.npcs.length;
            const a = (i / 5) * Math.PI * 2;
            chef.position.set(Math.cos(a) * 1.4, 0, 1.0 + Math.sin(a) * 0.6);
            chef.userData = { phase: Math.random() * 6 };
            vis.group.add(chef);
            vis.npcs.push(chef);
        }
        while (vis.npcs.length > count) {
            const c = vis.npcs.pop();
            if (c)
                vis.group.remove(c);
        }
    }
    // --- Procedural textures ----------------------------------------------------
    paintCanvas(size) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        return { c, g: c.getContext('2d') };
    }
    finish(c, rx = 1, ry = 1) {
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.anisotropy = 4;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }
    texGround() {
        const { c, g } = this.paintCanvas(256);
        g.fillStyle = '#5f6e52';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 2600; i++) {
            g.fillStyle = ['#677a56', '#566348', '#6f8060'][(Math.random() * 3) | 0];
            g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }
        return this.finish(c, 10, 9);
    }
    texConcrete() {
        const { c, g } = this.paintCanvas(256);
        g.fillStyle = '#82868d';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = 3;
        for (let p = 0; p <= 256; p += 64) {
            g.beginPath();
            g.moveTo(0, p);
            g.lineTo(256, p);
            g.moveTo(p, 0);
            g.lineTo(p, 256);
            g.stroke();
        }
        for (let i = 0; i < 900; i++) {
            g.fillStyle = 'rgba(0,0,0,0.05)';
            g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }
        return this.finish(c, 4, 4);
    }
    texRoad(len) {
        const { c, g } = this.paintCanvas(64);
        g.fillStyle = '#34383e';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#e8c84a';
        for (let y = 6; y < 64; y += 22)
            g.fillRect(29, y, 6, 12); // dashed centre line
        g.fillStyle = '#5a5f66';
        g.fillRect(2, 0, 3, 64);
        g.fillRect(59, 0, 3, 64); // kerbs
        return this.finish(c, 1, Math.max(1, Math.round(len / 1.7)));
    }
    texScreen(emoji, accent) {
        const { c, g } = this.paintCanvas(128);
        g.fillStyle = '#0b0f14';
        g.fillRect(0, 0, 128, 128);
        g.font = '70px system-ui, "Segoe UI Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(emoji, 64, 50);
        const hex = '#' + (accent & 0xffffff).toString(16).padStart(6, '0');
        g.fillStyle = hex;
        for (let i = 0; i < 4; i++)
            g.fillRect(20 + i * 24, 92, 16, 8 + (i % 2) * 18);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        return t;
    }
    texCrate() {
        const { c, g } = this.paintCanvas(64);
        g.fillStyle = '#9a6f3f';
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 4;
        g.strokeRect(3, 3, 58, 58);
        g.beginPath();
        g.moveTo(3, 3);
        g.lineTo(61, 61);
        g.moveTo(61, 3);
        g.lineTo(3, 61);
        g.stroke();
        return this.finish(c, 1, 1);
    }
    makeIconSprite(emoji) {
        const { c, g } = this.paintCanvas(128);
        g.font = '92px system-ui, "Segoe UI Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(emoji, 64, 70);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        spr.scale.set(1.1, 1.1, 1);
        return spr;
    }
    // --- Particles --------------------------------------------------------------
    spawnParticle(anchor, kind) {
        if (this.particles.length > 90)
            return;
        const mat = kind === 'steam'
            ? new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.5, roughness: 1 })
            : new THREE.MeshStandardMaterial({ color: 0xffb24a, emissive: 0xff7a1a, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(kind === 'steam' ? new THREE.SphereGeometry(0.14, 8, 6) : new THREE.SphereGeometry(0.05, 6, 5), mat);
        mesh.position.copy(anchor);
        mesh.position.x += (Math.random() - 0.5) * 0.5;
        mesh.position.z += (Math.random() - 0.5) * 0.4;
        this.world.add(mesh);
        this.particles.push({
            mesh,
            vx: kind === 'spark' ? (Math.random() - 0.5) * 1.6 : (Math.random() - 0.5) * 0.2,
            vy: kind === 'steam' ? 0.6 + Math.random() * 0.4 : 1.2 + Math.random(),
            life: 0, max: kind === 'steam' ? 1.8 : 0.5,
        });
    }
    // --- State sync -------------------------------------------------------------
    setState(state) {
        this.state = state;
        const now = Date.now();
        this.throughput = FactoryEngine.lineThroughput(state, now);
        this.bottleneck = FactoryEngine.bottleneck(state, now);
        for (const id of STATION_IDS) {
            const vis = this.buildings.get(id);
            if (!vis)
                continue;
            const st = state.stations[id];
            vis.rate = FactoryEngine.stationRate(state, id, now);
            const grow = 1 + Math.min(st.level, 40) * 0.01;
            vis.body.scale.set(1, grow, 1);
            vis.body.position.y = 1.0 * grow;
            const cap = FactoryEngine.stationCapacity(state, id);
            const fill = id === 'delivery' ? Math.min(1, this.throughput / Math.max(0.001, vis.rate)) : Math.min(1, st.output / Math.max(1, cap));
            vis.gaugeFill.scale.x = Math.max(0.02, fill);
            vis.gaugeFill.position.x = -0.82 * (1 - fill);
            vis.gaugeFill.material.color.setHex(fill > 0.92 ? 0xff7a3a : 0x57e08a);
            vis.ring.visible = id === this.bottleneck;
            this.syncNpcs(vis, Math.min(5, 1 + st.workers));
        }
    }
    // --- Loop -------------------------------------------------------------------
    start() { if (this.raf === 0) {
        this.last = performance.now();
        this.raf = requestAnimationFrame((t) => this.loop(t));
    } }
    stop() { if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
    } }
    loop(now) {
        const dt = Math.min((now - this.last) / 1000, 0.05);
        this.last = now;
        this.t += dt;
        try {
            this.update(dt);
            if (this.quality === 'ultra' && this.composer)
                this.composer.render();
            else
                this.renderer.render(this.scene, this.camera);
        }
        catch (err) {
            console.warn('[factory] render halted', err);
            this.stop();
            return;
        }
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    update(dt) {
        if (!this.dragging && !this.pinching)
            this.targetYaw += dt * 0.025;
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
        this.world.rotation.y = this.yaw;
        if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
            this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
            this.updateCameraFrustum();
        }
        // Building life: pulsing screens, blinking status (red on bottleneck), halo.
        for (const vis of this.buildings.values()) {
            const isNeck = vis.id === this.bottleneck;
            vis.screenMat.emissiveIntensity = 0.7 + Math.sin(this.t * 3 + vis.rate) * 0.25;
            const blink = 0.6 + 0.4 * Math.sin(this.t * (isNeck ? 9 : 3));
            vis.statusMat.emissive.setHex(isNeck ? 0xff4a3a : 0x55e070);
            vis.statusMat.emissiveIntensity = 0.6 + blink;
            vis.statusGlow.material.color.setHex(isNeck ? 0xff6a4a : 0x66ff88);
            vis.statusGlow.material.opacity = 0.4 + blink * 0.4;
            if (vis.ring.visible)
                vis.ring.material.emissiveIntensity = 0.7 + Math.sin(this.t * 4) * 0.4;
            // NPC idle bob.
            for (const npc of vis.npcs) {
                const ph = npc.userData.phase;
                npc.position.y = Math.abs(Math.sin((this.t + ph) * 4)) * 0.05;
            }
        }
        // Traffic: spawn vehicles per leg proportional to throughput.
        const flow = this.throughput;
        for (const leg of this.legs) {
            if (flow > 0.0001) {
                leg.accum += dt * (0.35 + flow * 0.45);
                if (leg.accum >= 1) {
                    leg.accum -= 1;
                    this.spawnVehicle(leg);
                }
            }
            for (const v of leg.pool) {
                if (!v.active)
                    continue;
                v.t += v.speed * dt;
                const x = leg.from.x + (leg.to.x - leg.from.x) * v.t;
                const z = leg.from.z + (leg.to.z - leg.from.z) * v.t;
                v.group.position.set(x, 0, z);
                v.group.rotation.y = leg.turn;
                v.group.position.y = Math.abs(Math.sin((this.t + v.t) * 12)) * 0.02;
                if (v.t >= 1) {
                    v.active = false;
                    v.group.visible = false;
                }
            }
        }
        // Wandering chefs.
        for (const r of this.roamers) {
            if (r.pause > 0) {
                r.pause -= dt;
                continue;
            }
            const dx = r.tx - r.x, dz = r.tz - r.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.12) {
                r.tx = (Math.random() - 0.5) * 11;
                r.tz = (Math.random() - 0.5) * 8;
                r.pause = Math.random() * 1.8;
            }
            else {
                r.x += (dx / d) * r.speed * dt;
                r.z += (dz / d) * r.speed * dt;
                r.mesh.position.x = r.x;
                r.mesh.position.z = r.z;
                r.mesh.rotation.y = Math.atan2(dx, dz);
                r.mesh.position.y = Math.abs(Math.sin((this.t + r.phase) * 9)) * 0.06;
            }
        }
        // Steam / sparks at the relevant buildings.
        const cook = this.buildings.get('cooking');
        if (cook && flow > 0.001) {
            this.steamAccum += dt * (2 + cook.rate * 0.4);
            while (this.steamAccum >= 1) {
                this.steamAccum -= 1;
                this.spawnParticle(cook.fxAnchor, 'steam');
            }
        }
        const prep = this.buildings.get('prep');
        if (prep && flow > 0.001) {
            this.sparkAccum += dt * (3 + prep.rate * 0.5);
            while (this.sparkAccum >= 1) {
                this.sparkAccum -= 1;
                this.spawnParticle(prep.fxAnchor, 'spark');
            }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life += dt;
            p.vy -= dt * (p.max < 1 ? 4 : 0.2);
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            const k = 1 - p.life / p.max;
            const mat = p.mesh.material;
            mat.opacity = Math.max(0, (p.max < 1 ? 0.9 : 0.5) * k);
            if (p.max >= 1)
                p.mesh.scale.setScalar(1 + p.life * 1.5);
            if (p.life >= p.max) {
                this.world.remove(p.mesh);
                this.particles.splice(i, 1);
            }
        }
    }
    // --- Camera / input ---------------------------------------------------------
    updateCameraFrustum() {
        const vs = this.viewSize;
        this.camera.left = (-vs * this.aspect) / 2;
        this.camera.right = (vs * this.aspect) / 2;
        this.camera.top = vs / 2;
        this.camera.bottom = -vs / 2;
        this.camera.updateProjectionMatrix();
    }
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
        this.renderer.setSize(w, h, false);
        this.aspect = w / h;
        this.updateCameraFrustum();
        this.composer?.setSize(w, h);
    }
    onPointerDown(e) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) {
            this.dragging = true;
            this.dragMoved = 0;
            this.lastPX = e.clientX;
        }
        if (this.pointers.size === 2) {
            this.pinching = true;
            this.lastPinch = this.pinchDistance();
        }
    }
    onPointerMove(e) {
        if (!this.pointers.has(e.pointerId))
            return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinching && this.pointers.size >= 2) {
            const d = this.pinchDistance();
            if (this.lastPinch > 0 && d > 0)
                this.targetViewSize = Math.max(10, Math.min(28, this.targetViewSize * (this.lastPinch / d)));
            this.lastPinch = d;
        }
        else if (this.dragging) {
            const dx = e.clientX - this.lastPX;
            this.lastPX = e.clientX;
            this.dragMoved += Math.abs(dx);
            this.targetYaw -= dx * 0.008;
        }
    }
    onPointerUp(e) {
        if (!this.pointers.delete(e.pointerId))
            return;
        if (this.pointers.size < 2) {
            this.pinching = false;
            this.lastPinch = 0;
        }
        if (this.pointers.size === 0) {
            if (this.dragging && this.dragMoved < 6)
                this.tap(e);
            this.dragging = false;
        }
    }
    onWheel(e) {
        e.preventDefault();
        this.targetViewSize = Math.max(10, Math.min(28, this.targetViewSize + e.deltaY * 0.01));
    }
    pinchDistance() {
        const pts = [...this.pointers.values()];
        if (pts.length < 2)
            return 0;
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    tap(e) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const picks = [...this.buildings.values()].map((v) => v.pick);
        const hits = this.raycaster.intersectObjects(picks, false);
        if (hits.length > 0) {
            const id = hits[0].object.userData.id;
            if (id)
                this.onTapStation(id);
        }
    }
}
