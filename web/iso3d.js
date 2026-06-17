/**
 * iso3d.ts — Real-3D village renderer (Three.js / WebGL).
 *
 * Renders the village as a true 3D isometric tycoon scene: a stone platform,
 * six buildings that physically rise as they level up, low-poly workers that
 * walk around casting shadows, gold-coin pops on upgrade, a sun with soft
 * shadow mapping, drag-to-rotate, and raycast tap-to-upgrade. Conforms to the
 * same VillageRenderer shape as the 2D fallback (`iso.ts`).
 *
 * Three.js is vendored locally (web/vendor/three.module.js) and resolved via
 * the document import map, so the game still works fully offline.
 */
import * as THREE from 'three';
import { BUILDING_TYPES } from '../src/types.js';
/** Logical grid position (0..6) of each building, centred on the platform. */
const LAYOUT = {
    mine: { gx: 1.4, gy: 1.4 },
    farm: { gx: 4.6, gy: 1.4 },
    sawmill: { gx: 1.2, gy: 4.4 },
    market: { gx: 3.0, gy: 3.0 },
    blacksmith: { gx: 4.8, gy: 4.6 },
    castle: { gx: 3.0, gy: 5.6 },
};
const PALETTES = {
    mine: { body: 0x8b8f99, roof: 0xcaa24a, trim: 0x5d626b },
    farm: { body: 0xcaa36a, roof: 0x7fc25a, trim: 0x8a6e44 },
    sawmill: { body: 0xb07d4f, roof: 0x8a5a36, trim: 0x6a4326 },
    market: { body: 0xc98a5a, roof: 0xd24f52, trim: 0x8c5d38 },
    blacksmith: { body: 0x767b88, roof: 0xe0773c, trim: 0x4a4e58 },
    castle: { body: 0x9aa0ad, roof: 0x8a6fd6, trim: 0x666b78 },
};
/** Village-themed platform/sky tints, cycled per village. */
const THEMES = [
    { ground: 0x7c6a52, grass: 0x6f8a4a, sky: 0x213048, fog: 0x2a2036 },
    { ground: 0x84766a, grass: 0x7a9a55, sky: 0x2a2440, fog: 0x241c34 },
    { ground: 0x6f6256, grass: 0x5f7d46, sky: 0x18243a, fog: 0x18203a },
    { ground: 0x8a7a64, grass: 0x86a05c, sky: 0x32263e, fog: 0x281e36 },
];
const TILE = 2.0; // world units per logical tile
const GRID = 7;
const HALF = (GRID * TILE) / 2;
function tileToWorld(gx, gy) {
    return { x: gx * TILE - HALF, z: gy * TILE - HALF };
}
/** Returns true if a WebGL context can be created (used to pick the renderer). */
export function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    }
    catch {
        return false;
    }
}
export class Iso3DScene {
    constructor(canvas, onTapBuilding) {
        this.canvas = canvas;
        this.onTapBuilding = onTapBuilding;
        this.scene = new THREE.Scene();
        this.world = new THREE.Group(); // rotated by drag
        this.buildings = new Map();
        this.workers = [];
        this.coins = [];
        this.raycaster = new THREE.Raycaster();
        this.raf = 0;
        this.last = 0;
        this.t = 0;
        this.yaw = 0.0;
        this.targetYaw = 0.0;
        this.dragging = false;
        this.dragMoved = 0;
        this.lastPX = 0;
        this.viewSize = 16;
        this.themeIndex = 0;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.18;
        this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
        this.camera.position.set(26, 30, 26);
        this.camera.lookAt(0, 2, 0);
        this.scene.add(this.world);
        // Lighting
        this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a4d3a, 1.05);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
        this.sun.position.set(14, 26, 8);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        const sc = this.sun.shadow.camera;
        sc.left = -16;
        sc.right = 16;
        sc.top = 16;
        sc.bottom = -16;
        sc.near = 1;
        sc.far = 80;
        this.sun.shadow.bias = -0.0004;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        // Platform (stone plate + thicker base)
        const theme = THEMES[0];
        this.platform = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 1.2, 1.0, GRID * TILE + 1.2), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.95 }));
        this.platform.position.y = -0.5;
        this.platform.receiveShadow = true;
        this.world.add(this.platform);
        const base = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 2.2, 2.2, GRID * TILE + 2.2), new THREE.MeshStandardMaterial({ color: 0x3a3340, roughness: 1 }));
        base.position.y = -2.1;
        base.receiveShadow = true;
        this.world.add(base);
        // A patch of grass skirt around the plate for warmth
        this.grass = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 5.5, 0.6, GRID * TILE + 5.5), new THREE.MeshStandardMaterial({ color: theme.grass, roughness: 1 }));
        this.grass.position.y = -1.0;
        this.grass.receiveShadow = true;
        this.world.add(this.grass);
        this.buildBuildings();
        this.decorate();
        this.applyTheme(0);
        this.resize();
        window.addEventListener('resize', () => this.resize());
        canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    }
    buildBuildings() {
        for (const type of BUILDING_TYPES) {
            const pal = PALETTES[type];
            const { x, z } = tileToWorld(LAYOUT[type].gx, LAYOUT[type].gy);
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.8 }));
            body.castShadow = true;
            body.receiveShadow = true;
            body.position.y = 0.5;
            group.add(body);
            // Door
            const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08), new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.9 }));
            door.position.set(0, 0.35, 0.78);
            group.add(door);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.0, 4), new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.7, flatShading: true }));
            roof.castShadow = true;
            roof.rotation.y = Math.PI / 4;
            roof.position.y = 1.5;
            group.add(roof);
            // Invisible pick proxy spanning the building for easy tapping
            const pickMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial({ visible: false }));
            pickMesh.position.y = 2;
            pickMesh.userData.type = type;
            group.add(pickMesh);
            group.visible = false; // shown once built (level > 0)
            this.world.add(group);
            this.buildings.set(type, { group, body, roof, pickMesh, level: 0, shownHeight: 1 });
        }
    }
    /** Decorative trees + lamp posts around the platform edge. */
    decorate() {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e8a3c, roughness: 0.9, flatShading: true });
        const spots = [
            [-HALF - 1.6, -HALF - 1.6], [HALF + 1.6, -HALF - 1.6],
            [-HALF - 1.6, HALF + 1.6], [HALF + 1.6, HALF + 1.6],
            [0, -HALF - 1.8], [0, HALF + 1.8],
        ];
        for (const [x, z] of spots) {
            const tree = new THREE.Group();
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 6), trunkMat);
            trunk.position.y = 0.15;
            trunk.castShadow = true;
            const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 7), leafMat);
            leaves.position.y = 1.2;
            leaves.castShadow = true;
            tree.add(trunk);
            tree.add(leaves);
            tree.position.set(x, -0.7, z);
            tree.scale.setScalar(0.85 + Math.random() * 0.4);
            this.world.add(tree);
        }
    }
    makeWorker() {
        const group = new THREE.Group();
        const hue = new THREE.Color().setHSL(Math.random(), 0.5, 0.55);
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: hue, roughness: 0.8 }));
        body.castShadow = true;
        body.position.y = 0.42;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
        head.castShadow = true;
        head.position.y = 0.78;
        group.add(body);
        group.add(head);
        const x = (Math.random() - 0.5) * GRID * TILE * 0.7;
        const z = (Math.random() - 0.5) * GRID * TILE * 0.7;
        group.position.set(x, 0, z);
        this.world.add(group);
        return { mesh: group, x, z, tx: x, tz: z, speed: 1.0 + Math.random(), pause: Math.random() * 2, phase: Math.random() * 6 };
    }
    applyTheme(village) {
        const theme = THEMES[(Math.max(1, village) - 1) % THEMES.length];
        this.themeIndex = village;
        this.platform.material.color.setHex(theme.ground);
        this.grass.material.color.setHex(theme.grass);
        this.scene.background = new THREE.Color(theme.sky);
        this.scene.fog = new THREE.Fog(theme.fog, 60, 110);
    }
    setState(state) {
        let total = 0;
        for (const type of BUILDING_TYPES) {
            const b = this.buildings.get(type);
            b.level = Math.max(0, Math.floor(state.buildings[type]));
            b.group.visible = b.level > 0;
            total += b.level;
        }
        if (state.village !== this.themeIndex) {
            this.applyTheme(state.village);
        }
        const target = Math.min(14, 3 + Math.floor(total / 3));
        while (this.workers.length < target)
            this.workers.push(this.makeWorker());
        while (this.workers.length > target) {
            const w = this.workers.pop();
            if (w)
                this.world.remove(w.mesh);
        }
        this.ensureRunning();
    }
    /** Target height (world units) of a building's body for its level. */
    bodyHeight(type, level) {
        const base = type === 'castle' ? 1.8 : 1.0;
        return base + Math.min(level, 28) * 0.22;
    }
    coinPop(type) {
        const b = this.buildings.get(type);
        if (!b)
            return;
        const top = b.shownHeight + 1.6;
        for (let i = 0; i < 7; i++) {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xffd95a, metalness: 0.6, roughness: 0.3, emissive: 0x4a3a00 }));
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(b.group.position.x + (Math.random() - 0.5), top, b.group.position.z + (Math.random() - 0.5));
            this.world.add(mesh);
            this.coins.push({ mesh, vy: 3 + Math.random() * 2.5, life: 0 });
        }
        this.ensureRunning();
    }
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        this.renderer.setSize(w, h, false);
        const aspect = w / h;
        const vs = this.viewSize;
        this.camera.left = (-vs * aspect) / 2;
        this.camera.right = (vs * aspect) / 2;
        this.camera.top = vs / 2;
        this.camera.bottom = -vs / 2;
        this.camera.updateProjectionMatrix();
    }
    start() { this.ensureRunning(); }
    stop() { if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
    } }
    ensureRunning() {
        if (this.raf === 0) {
            this.last = performance.now();
            this.raf = requestAnimationFrame((t) => this.loop(t));
        }
    }
    loop(now) {
        const dt = Math.min((now - this.last) / 1000, 0.05);
        this.last = now;
        this.t += dt;
        try {
            this.update(dt);
            this.renderer.render(this.scene, this.camera);
        }
        catch (err) {
            // A GPU/context loss must not spam the console or wedge the game.
            console.warn('[village] 3D render halted', err);
            this.stop();
            return;
        }
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    update(dt) {
        // Smooth drag rotation + gentle idle drift.
        if (!this.dragging)
            this.targetYaw += dt * 0.05;
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
        this.world.rotation.y = this.yaw;
        // Buildings rise toward their target height.
        for (const type of BUILDING_TYPES) {
            const b = this.buildings.get(type);
            if (!b.group.visible)
                continue;
            const target = this.bodyHeight(type, b.level);
            b.shownHeight += (target - b.shownHeight) * Math.min(1, dt * 6);
            b.body.scale.y = b.shownHeight;
            b.body.position.y = b.shownHeight / 2;
            b.roof.position.y = b.shownHeight + 0.5;
        }
        // Workers wander.
        const bound = GRID * TILE * 0.42;
        for (const w of this.workers) {
            if (w.pause > 0) {
                w.pause -= dt;
                continue;
            }
            const dx = w.tx - w.x, dz = w.tz - w.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.15) {
                w.tx = (Math.random() - 0.5) * bound * 2;
                w.tz = (Math.random() - 0.5) * bound * 2;
                w.pause = Math.random() * 1.6;
            }
            else {
                w.x += (dx / d) * w.speed * dt;
                w.z += (dz / d) * w.speed * dt;
                w.mesh.position.x = w.x;
                w.mesh.position.z = w.z;
                w.mesh.rotation.y = Math.atan2(dx, dz);
                w.mesh.position.y = Math.abs(Math.sin((this.t + w.phase) * 9)) * 0.07;
            }
        }
        // Coins arc up and fade.
        for (const c of this.coins) {
            c.life += dt;
            c.vy -= 9 * dt;
            c.mesh.position.y += c.vy * dt;
            c.mesh.rotation.z += dt * 8;
            const s = Math.max(0, 1 - c.life);
            c.mesh.scale.setScalar(s);
        }
        this.coins = this.coins.filter((c) => {
            if (c.life >= 1) {
                this.world.remove(c.mesh);
                return false;
            }
            return true;
        });
    }
    // --- Pointer: drag to rotate, tap to upgrade --------------------------------
    onPointerDown(e) {
        this.dragging = true;
        this.dragMoved = 0;
        this.lastPX = e.clientX;
    }
    onPointerMove(e) {
        if (!this.dragging)
            return;
        const dx = e.clientX - this.lastPX;
        this.lastPX = e.clientX;
        this.dragMoved += Math.abs(dx);
        this.targetYaw -= dx * 0.008;
    }
    onPointerUp(e) {
        if (!this.dragging)
            return;
        this.dragging = false;
        if (this.dragMoved < 6)
            this.tap(e);
    }
    tap(e) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const picks = [];
        for (const b of this.buildings.values())
            picks.push(b.pickMesh);
        const hits = this.raycaster.intersectObjects(picks, false);
        if (hits.length > 0) {
            const type = hits[0].object.userData.type;
            if (type)
                this.onTapBuilding(type);
        }
    }
}
