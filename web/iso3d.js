/**
 * iso3d.ts — Real-3D village renderer (Three.js / WebGL).
 *
 * A true 3D isometric tycoon scene: a stone platform with grass and trees,
 * six visually distinct buildings that physically rise as they level up, a
 * day/night cycle (moving sun, warm windows and lamps that glow at dusk),
 * chimney smoke, low-poly workers casting shadows, gold-coin pops, drag to
 * rotate, pinch/wheel to zoom, and raycast tap-to-upgrade.
 *
 * Three.js is vendored locally (web/vendor/three.module.js) and resolved via
 * the document import map, so the game still works fully offline. Conforms to
 * the same VillageRenderer shape as the 2D fallback (`iso.ts`).
 */
import * as THREE from 'three';
import { BUILDING_TYPES } from '../src/types.js';
const LAYOUT = {
    mine: { gx: 1.4, gy: 1.4 },
    farm: { gx: 4.6, gy: 1.4 },
    sawmill: { gx: 1.2, gy: 4.4 },
    market: { gx: 3.0, gy: 3.0 },
    blacksmith: { gx: 4.8, gy: 4.6 },
    castle: { gx: 3.0, gy: 5.7 },
};
const PALETTES = {
    mine: { body: 0x8b8f99, roof: 0xcaa24a, trim: 0x5d626b },
    farm: { body: 0xd9b277, roof: 0x7fc25a, trim: 0x8a6e44 },
    sawmill: { body: 0xb07d4f, roof: 0x8a5a36, trim: 0x6a4326 },
    market: { body: 0xd49a63, roof: 0xd24f52, trim: 0x8c5d38 },
    blacksmith: { body: 0x767b88, roof: 0xe0773c, trim: 0x4a4e58 },
    castle: { body: 0xaab0bd, roof: 0x8a6fd6, trim: 0x666b78 },
};
/** Per-village daytime sky/ground/grass tints, cycled. */
const THEMES = [
    { ground: 0x7c6a52, grass: 0x6f8a4a, sky: 0x9fd0ff },
    { ground: 0x84766a, grass: 0x7a9a55, sky: 0xb8d8e8 },
    { ground: 0x6f6256, grass: 0x5f7d46, sky: 0xa8c8e0 },
    { ground: 0x8a7a64, grass: 0x86a05c, sky: 0xc0d8e8 },
];
const NIGHT_SKY = new THREE.Color(0x10131f);
const TILE = 2.0;
const GRID = 7;
const HALF = (GRID * TILE) / 2;
const DAY_CYCLE = 100; // seconds for a full day/night loop
function tileToWorld(gx, gy) {
    return { x: gx * TILE - HALF, z: gy * TILE - HALF };
}
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
        this.world = new THREE.Group();
        this.buildings = new Map();
        this.workers = [];
        this.coins = [];
        this.smoke = [];
        /** Emissive materials (windows, lamps) brightened at night. */
        this.nightMats = [];
        this.raycaster = new THREE.Raycaster();
        this.raf = 0;
        this.last = 0;
        this.t = 0;
        this.dayT = 18; // start mid-morning
        this.smokeTimer = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.viewSize = 16;
        this.targetViewSize = 16;
        this.aspect = 1;
        this.themeVillage = 0;
        this.daySky = new THREE.Color(0x9fd0ff);
        // Pointer state (drag rotate + pinch zoom + tap)
        this.pointers = new Map();
        this.dragging = false;
        this.dragMoved = 0;
        this.lastPX = 0;
        this.lastPinch = 0;
        this.pinching = false;
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
        sc.far = 90;
        this.sun.shadow.bias = -0.0004;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);
        const theme = THEMES[0];
        this.platform = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 1.2, 1.0, GRID * TILE + 1.2), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.95 }));
        this.platform.position.y = -0.5;
        this.platform.receiveShadow = true;
        this.world.add(this.platform);
        const base = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 2.2, 2.2, GRID * TILE + 2.2), new THREE.MeshStandardMaterial({ color: 0x3a3340, roughness: 1 }));
        base.position.y = -2.1;
        base.receiveShadow = true;
        this.world.add(base);
        this.grass = new THREE.Mesh(new THREE.BoxGeometry(GRID * TILE + 5.5, 0.6, GRID * TILE + 5.5), new THREE.MeshStandardMaterial({ color: theme.grass, roughness: 1 }));
        this.grass.position.y = -1.0;
        this.grass.receiveShadow = true;
        this.world.add(this.grass);
        this.buildPaths();
        this.buildBuildings();
        this.decorate();
        this.applyTheme(1);
        this.resize();
        window.addEventListener('resize', () => this.resize());
        canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', (e) => this.onPointerUp(e));
        window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    }
    /** Light stone paths from the central market toward each building. */
    buildPaths() {
        const mat = new THREE.MeshStandardMaterial({ color: 0x9c8b6e, roughness: 1 });
        const c = tileToWorld(LAYOUT.market.gx, LAYOUT.market.gy);
        for (const type of BUILDING_TYPES) {
            if (type === 'market')
                continue;
            const b = tileToWorld(LAYOUT[type].gx, LAYOUT[type].gy);
            const dx = b.x - c.x, dz = b.z - c.z;
            const len = Math.hypot(dx, dz);
            const path = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, len), mat);
            path.position.set((b.x + c.x) / 2, 0.04, (b.z + c.z) / 2);
            path.rotation.y = Math.atan2(dx, dz);
            path.receiveShadow = true;
            this.world.add(path);
        }
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
            const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.08), new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.9 }));
            door.position.set(0, 0.35, 0.78);
            group.add(door);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.0, 4), new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.7, flatShading: true }));
            roof.castShadow = true;
            roof.rotation.y = Math.PI / 4;
            roof.position.y = 1.5;
            group.add(roof);
            // Two warm windows that light up at night.
            this.addWindow(group, -0.4, 0.78, 0.5);
            this.addWindow(group, 0.4, 0.78, 0.5);
            this.addDetails(type, group, pal);
            const pickMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
            pickMesh.position.y = 2.2;
            pickMesh.userData.type = type;
            group.add(pickMesh);
            group.visible = false;
            this.world.add(group);
            this.buildings.set(type, { group, body, roof, pickMesh, level: 0, shownHeight: 1 });
        }
    }
    addWindow(group, x, y, z) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x3a3320, emissive: 0xffce6a, emissiveIntensity: 0, roughness: 0.5,
        });
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.06), mat);
        win.position.set(x, y, z);
        group.add(win);
        this.nightMats.push(mat);
    }
    /** Type-specific props that make each building recognisable. */
    addDetails(type, group, pal) {
        const std = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
        const add = (m, x, y, z) => {
            m.position.set(x, y, z);
            m.castShadow = true;
            group.add(m);
        };
        switch (type) {
            case 'mine': {
                const cart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.7), std(0x4a4e58));
                add(cart, 1.0, 0.2, 0.9);
                const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), std(0xf6c244, 0.4));
                add(ore, 1.0, 0.42, 0.9);
                break;
            }
            case 'farm': {
                const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12), std(0xc9c2b0));
                add(silo, 1.0, 0.55, -0.6);
                const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.3, 12), std(0x9a5a3a));
                add(cap, 1.0, 1.25, -0.6);
                const field = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.9), std(0x6f9a44, 1));
                field.receiveShadow = true;
                field.castShadow = false;
                field.position.set(0, 0.05, 1.4);
                group.add(field);
                break;
            }
            case 'sawmill': {
                for (let i = 0; i < 3; i++) {
                    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 8), std(0x8a5a36));
                    log.rotation.z = Math.PI / 2;
                    add(log, 1.05, 0.18 + i * 0.32, 0.7 - (i % 2) * 0.18);
                }
                break;
            }
            case 'market': {
                const awning = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.7), std(0xe24b4b));
                awning.position.set(0, 1.05, 0.95);
                awning.rotation.x = -0.5;
                awning.castShadow = true;
                group.add(awning);
                for (let i = -1; i <= 1; i += 2) {
                    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), std(0xb0813f));
                    add(crate, i * 0.5, 0.18, 1.05);
                }
                break;
            }
            case 'blacksmith': {
                const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), std(0x3a3a40));
                add(chimney, 0.5, 1.4, -0.4);
                const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.22), std(0x2c2c34, 0.5));
                add(anvil, 1.0, 0.2, 0.8);
                break;
            }
            case 'castle': {
                for (const sx of [-0.85, 0.85]) {
                    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.7, 10), std(pal.body));
                    add(tower, sx, 0.85, -0.2);
                    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 10), std(pal.roof));
                    add(top, sx, 1.95, -0.2);
                }
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), std(0x6b5a3a));
                add(pole, 0, 2.3, 0);
                const flag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.03), std(0xf6c244, 0.6));
                add(flag, 0.22, 2.5, 0);
                break;
            }
        }
    }
    /** Decorative trees + glowing lamp posts around the platform. */
    decorate() {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e8a3c, roughness: 0.9, flatShading: true });
        const treeSpots = [
            [-HALF - 1.6, -HALF - 1.6], [HALF + 1.6, -HALF - 1.6],
            [-HALF - 1.6, HALF + 1.6], [HALF + 1.6, HALF + 1.6],
        ];
        for (const [x, z] of treeSpots) {
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
        const postMat = new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 1 });
        const lampSpots = [[0, -HALF - 1.2], [0, HALF + 1.2], [-HALF - 1.2, 0], [HALF + 1.2, 0]];
        for (const [x, z] of lampSpots) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), postMat);
            post.position.set(x, -0.2, z);
            post.castShadow = true;
            this.world.add(post);
            const bulbMat = new THREE.MeshStandardMaterial({ color: 0x4a4020, emissive: 0xffd070, emissiveIntensity: 0 });
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), bulbMat);
            bulb.position.set(x, 0.6, z);
            this.world.add(bulb);
            this.nightMats.push(bulbMat);
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
        this.themeVillage = village;
        this.platform.material.color.setHex(theme.ground);
        this.grass.material.color.setHex(theme.grass);
        this.daySky = new THREE.Color(theme.sky);
        this.scene.fog = new THREE.Fog(theme.sky, 70, 120);
    }
    setState(state) {
        let total = 0;
        for (const type of BUILDING_TYPES) {
            const b = this.buildings.get(type);
            b.level = Math.max(0, Math.floor(state.buildings[type]));
            b.group.visible = b.level > 0;
            total += b.level;
        }
        if (state.village !== this.themeVillage)
            this.applyTheme(state.village);
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
    bodyHeight(type, level) {
        const base = type === 'castle' ? 1.6 : 1.0;
        return base + Math.min(level, 28) * 0.2;
    }
    coinPop(type) {
        const b = this.buildings.get(type);
        if (!b)
            return;
        const top = b.shownHeight + 1.6;
        for (let i = 0; i < 8; i++) {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xffd95a, metalness: 0.6, roughness: 0.3, emissive: 0x4a3a00 }));
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(b.group.position.x + (Math.random() - 0.5), top, b.group.position.z + (Math.random() - 0.5));
            this.world.add(mesh);
            this.coins.push({ mesh, vy: 3 + Math.random() * 2.5, life: 0 });
        }
        this.ensureRunning();
    }
    spawnSmoke() {
        const b = this.buildings.get('blacksmith');
        if (!b || !b.group.visible)
            return;
        const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.55, roughness: 1 });
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat);
        puff.position.set(b.group.position.x + 0.5, b.shownHeight + 1.4, b.group.position.z - 0.4);
        this.world.add(puff);
        this.smoke.push({ mesh: puff, vy: 0.7 + Math.random() * 0.4, life: 0 });
    }
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
            console.warn('[village] 3D render halted', err);
            this.stop();
            return;
        }
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    update(dt) {
        // Rotation (drag + gentle idle drift) and smooth zoom.
        if (!this.dragging && !this.pinching)
            this.targetYaw += dt * 0.05;
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
        this.world.rotation.y = this.yaw;
        if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
            this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
            this.updateCameraFrustum();
        }
        this.updateDayNight();
        // Buildings rise toward their level height.
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
            c.mesh.scale.setScalar(Math.max(0, 1 - c.life));
        }
        this.coins = this.coins.filter((c) => { if (c.life >= 1) {
            this.world.remove(c.mesh);
            return false;
        } return true; });
        // Chimney smoke.
        this.smokeTimer -= dt;
        if (this.smokeTimer <= 0) {
            this.smokeTimer = 0.55;
            this.spawnSmoke();
        }
        for (const s of this.smoke) {
            s.life += dt;
            s.mesh.position.y += s.vy * dt;
            s.mesh.scale.setScalar(1 + s.life * 1.4);
            s.mesh.material.opacity = Math.max(0, 0.55 * (1 - s.life / 2));
        }
        this.smoke = this.smoke.filter((s) => { if (s.life >= 2) {
            this.world.remove(s.mesh);
            return false;
        } return true; });
    }
    updateDayNight() {
        this.dayT += 1 / 60; // ~1 unit/frame; cycle length in seconds approx
        const phase = (this.dayT / DAY_CYCLE) % 1;
        const elev = Math.sin(phase * Math.PI * 2);
        const day = Math.max(0, Math.min(1, (elev + 0.25) / 0.6));
        const night = 1 - day;
        const ang = phase * Math.PI * 2;
        this.sun.position.set(Math.cos(ang) * 22, 6 + Math.max(0, Math.sin(ang)) * 26, Math.sin(ang) * 14 + 6);
        this.sun.intensity = 0.15 + day * 2.2;
        this.hemi.intensity = 0.32 + day * 0.78;
        const sky = this.daySky.clone().lerp(NIGHT_SKY, night);
        this.scene.background = sky;
        if (this.scene.fog)
            this.scene.fog.color.copy(sky);
        const glow = night * 1.7;
        for (const m of this.nightMats)
            m.emissiveIntensity = glow;
    }
    // --- Pointer & wheel: drag rotate, pinch zoom, tap upgrade -----------------
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
            if (this.lastPinch > 0 && d > 0) {
                this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize * (this.lastPinch / d)));
            }
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
        const had = this.pointers.delete(e.pointerId);
        if (!had)
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
        this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize + e.deltaY * 0.01));
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
        const picks = [];
        for (const b of this.buildings.values())
            if (b.group.visible)
                picks.push(b.pickMesh);
        const hits = this.raycaster.intersectObjects(picks, false);
        if (hits.length > 0) {
            const type = hits[0].object.userData.type;
            if (type)
                this.onTapBuilding(type);
        }
    }
}
