/**
 * scene.ts — Real-3D factory floor for the production-line game (high detail).
 *
 * Renders the simulation as a literal conveyor line: five detailed machine
 * stations joined by a moving belt, with food items riding it and physically
 * transforming stage by stage (crate → chopped → cooked → plated) before a
 * delivery scooter carries them off. Item spawn density tracks the line's real
 * throughput, the bottleneck station glows red, each station shows a live
 * buffer gauge, blinking status lights, pulsing emissive panels, and its
 * assigned workers; cooking vents steam and prep throws sparks.
 *
 * Quality: PBR metal/roughness materials lit by a procedural environment map
 * (soft reflections), a textured industrial floor with hazard lanes, walls and
 * ceiling lamps, soft shadows, ACES tone-mapping, and additive glow sprites for
 * a bloom-like feel. Three.js is vendored/bundled; everything else is
 * procedural, so the scene is fully offline. Driven by setState() + a per-frame
 * update loop, preserving the same public API.
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
const STATION_X = {
    receiving: -6, prep: -3, cooking: 0, plating: 3, delivery: 6,
};
const BELT_Z = 0;
const BELT_Y = 0.6;
const SPAN = 7.2; // belt runs from -SPAN..+SPAN on X
const MACHINE_Z = -0.95;
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
        this.stations = new Map();
        this.items = [];
        this.scooters = [];
        this.particles = [];
        this.roamers = [];
        this.composer = null;
        this.bloomPass = null;
        this.quality = 'ultra';
        this.state = null;
        this.throughput = 0;
        this.bottleneck = 'cooking';
        this.spawnAccum = 0;
        this.scooterAccum = 0;
        this.steamAccum = 0;
        this.sparkAccum = 0;
        this.raf = 0;
        this.last = 0;
        this.t = 0;
        this.yaw = 0;
        this.targetYaw = 0;
        this.viewSize = 13.5;
        this.targetViewSize = 13.5;
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
        this.renderer.toneMappingExposure = 1.28;
        this.scene.background = new THREE.Color(0x10141b);
        this.scene.fog = new THREE.Fog(0x10141b, 30, 60);
        this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
        this.camera.position.set(14, 16, 18);
        this.camera.lookAt(0, 1.5, 0);
        this.scene.add(this.world);
        // Lighting: warm key + cool fill + rim, plus soft ambient.
        this.scene.add(new THREE.HemisphereLight(0xdce8ff, 0x2a2f38, 0.8));
        this.sun = new THREE.DirectionalLight(0xfff1da, 2.0);
        this.sun.position.set(9, 19, 11);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.radius = 4;
        const sc = this.sun.shadow.camera;
        sc.left = -16;
        sc.right = 16;
        sc.top = 12;
        sc.bottom = -12;
        sc.near = 1;
        sc.far = 60;
        this.sun.shadow.bias = -0.0004;
        this.scene.add(this.sun, this.sun.target);
        const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6);
        rim.position.set(-12, 8, -10);
        this.scene.add(rim);
        this.buildEnvMap();
        this.buildEnvironment();
        this.buildBelt();
        this.buildStations();
        this.buildDensity();
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
    // --- Post-processing pipeline (bloom + GTAO + ACES + SMAA) ------------------
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
    /**
     * Builds the EffectComposer chain: scene render → GTAO ambient occlusion →
     * UnrealBloom (HDR glow on emissives) → ACES tone-map/sRGB → SMAA antialias.
     * Any failure (e.g. unsupported shaders) falls back to direct rendering.
     */
    setupPost() {
        if (this.quality !== 'ultra' || this.composer)
            return;
        try {
            const size = new THREE.Vector2();
            this.renderer.getSize(size);
            const composer = new EffectComposer(this.renderer);
            composer.addPass(new RenderPass(this.scene, this.camera));
            const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
            gtao.output = 0; // GTAOPass.OUTPUT.Default
            gtao.blendIntensity = 0.6;
            gtao.updateGtaoMaterial({
                radius: 0.85, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false,
            });
            composer.addPass(gtao);
            const bloom = new UnrealBloomPass(size, 0.7, 0.55, 0.62);
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
    /** Toggles graphics quality at runtime (persisted). */
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
    // --- Procedural environment map (soft PBR reflections) ----------------------
    buildEnvMap() {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 256;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#33414f');
        grad.addColorStop(0.5, '#465462');
        grad.addColorStop(1, '#0d1117');
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 256);
        g.fillStyle = '#fffdf2';
        for (const x of [70, 190, 310, 430])
            g.fillRect(x, 18, 56, 14); // ceiling light strips
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const env = pmrem.fromEquirectangular(tex).texture;
        this.scene.environment = env;
        tex.dispose();
        pmrem.dispose();
    }
    // --- Environment: floor, walls, ceiling lamps, shelving ---------------------
    buildEnvironment() {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(36, 1, 26), new THREE.MeshStandardMaterial({ map: this.texFloor(), color: 0x70767e, roughness: 0.85, metalness: 0.15 }));
        floor.position.y = -0.5;
        floor.receiveShadow = true;
        this.world.add(floor);
        // Hazard-striped safety lane under the belt.
        const lane = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2 + 5, 0.02, 3.4), new THREE.MeshStandardMaterial({ map: this.texHazard(), roughness: 0.9 }));
        lane.position.set(0, 0.012, BELT_Z);
        lane.receiveShadow = true;
        this.world.add(lane);
        // Back + side walls with panel texture.
        const wallMat = new THREE.MeshStandardMaterial({ map: this.texPanel(), color: 0x39404a, roughness: 0.8, metalness: 0.25 });
        const back = new THREE.Mesh(new THREE.BoxGeometry(36, 10, 0.6), wallMat);
        back.position.set(0, 4.5, -7.2);
        back.receiveShadow = true;
        this.world.add(back);
        for (const sx of [-18, 18]) {
            const side = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 26), wallMat);
            side.position.set(sx, 4.5, 0);
            side.receiveShadow = true;
            this.world.add(side);
        }
        // Floor scuff base under the back wall.
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(36, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: 0xf0a826, roughness: 0.7 }));
        skirt.position.set(0, 0.25, -6.9);
        this.world.add(skirt);
        // Ceiling lamp fixtures with glow.
        for (const x of [-6, 0, 6]) {
            const housing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.6, metalness: 0.4 }));
            housing.position.set(x, 7.6, BELT_Z - 1);
            this.world.add(housing);
            const tube = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.4 }));
            tube.position.set(x, 7.5, BELT_Z - 1);
            this.world.add(tube);
            const glow = makeGlow(0xfff0c8, 6);
            glow.position.set(x, 7.2, BELT_Z - 1);
            glow.material.opacity = 0.45;
            this.world.add(glow);
        }
        // Background shelving with crates for depth.
        for (const sx of [-12, 12]) {
            const rack = new THREE.Group();
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
            for (const sy of [0.0, 1.4, 2.8]) {
                const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.4), frameMat);
                shelf.position.set(0, sy + 0.5, 0);
                shelf.castShadow = true;
                rack.add(shelf);
                for (let i = -1; i <= 1; i++) {
                    if (Math.abs(i) + (sy > 0 ? 1 : 0) === 2)
                        continue;
                    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x9a6f3f : 0xb0813f, roughness: 0.9 }));
                    crate.position.set(i * 1.05, sy + 0.95, 0);
                    crate.castShadow = true;
                    rack.add(crate);
                }
            }
            rack.position.set(sx, 0, -5.6);
            rack.rotation.y = sx < 0 ? 0.2 : -0.2;
            this.world.add(rack);
        }
    }
    // --- Density: silos, overhead infra, pillars, props, roamers ----------------
    buildDensity() {
        this.buildBackline();
        this.buildOverhead();
        this.buildPillars();
        this.buildForeground();
        this.spawnRoamers(6);
    }
    /** Bulk ingredient silos + a mixer unit along the back wall. */
    buildBackline() {
        const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.34, metalness: 0.78 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x40454e, roughness: 0.6, metalness: 0.5 });
        const pipeMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc4, roughness: 0.3, metalness: 0.8 });
        for (const [x, h] of [[-7.4, 4.4], [-4.2, 3.7], [3.6, 4.0], [7.2, 4.6]]) {
            const silo = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, h, 18), metal);
            body.position.y = h / 2 + 0.9;
            body.castShadow = true;
            body.receiveShadow = true;
            silo.add(body);
            const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.18, 0.9, 18), metal);
            hopper.position.y = 0.95;
            hopper.castShadow = true;
            silo.add(hopper);
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal);
            dome.position.y = h + 0.9;
            silo.add(dome);
            // Hoop bands.
            for (let b = 1; b < 3; b++) {
                const band = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.05, 8, 20), dark);
                band.rotation.x = Math.PI / 2;
                band.position.y = 0.9 + (h * b) / 3;
                silo.add(band);
            }
            // Ladder.
            const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.18), dark);
            ladder.position.set(0.95, h / 2 + 0.9, 0);
            silo.add(ladder);
            // Output pipe bending toward the line.
            const out = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 10), pipeMat);
            out.rotation.x = Math.PI / 2.3;
            out.position.set(0, 1.1, 0.9);
            silo.add(out);
            silo.position.set(x, 0, -5.6);
            this.world.add(silo);
        }
        // A wide mixer/oven unit centred behind the line.
        const mixer = new THREE.Group();
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 20), new THREE.MeshStandardMaterial({ color: 0x586070, roughness: 0.4, metalness: 0.6 }));
        drum.rotation.z = Math.PI / 2;
        drum.position.y = 1.5;
        drum.castShadow = true;
        mixer.add(drum);
        for (const ex of [-1.3, 1.3]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20), dark);
            cap.rotation.z = Math.PI / 2;
            cap.position.set(ex, 1.5, 0);
            mixer.add(cap);
        }
        const motor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), dark);
        motor.position.set(0, 2.7, 0);
        mixer.add(motor);
        mixer.position.set(-0.2, 0, -6.0);
        this.world.add(mixer);
        // Wall-mounted control boxes + vents along the back wall.
        for (const x of [-9.5, -1.5, 5.5, 9.5]) {
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x2f7d52, roughness: 0.6, metalness: 0.4 }));
            box.position.set(x, 2.4, -6.85);
            box.castShadow = true;
            this.world.add(box);
            const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x44ff88, emissiveIntensity: 1.2 }));
            light.position.set(x + 0.25, 2.85, -6.7);
            this.world.add(light);
        }
        for (const x of [-6, 2.5]) {
            const vent = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x4a525d, roughness: 0.7, metalness: 0.5 }));
            vent.position.set(x, 6.2, -6.9);
            this.world.add(vent);
        }
    }
    /** Overhead ducts, pipe runs and cable trays high at the back (no occlusion). */
    buildOverhead() {
        const ductMat = new THREE.MeshStandardMaterial({ color: 0x6b7079, roughness: 0.5, metalness: 0.6 });
        for (const [dz, y] of [[-4.6, 7.4], [-3.2, 6.9]]) {
            const duct = new THREE.Mesh(new THREE.BoxGeometry(30, 0.7, 0.7), ductMat);
            duct.position.set(0, y, dz);
            duct.castShadow = false;
            this.world.add(duct);
            for (let x = -12; x <= 12; x += 4) {
                const hang = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), ductMat);
                hang.position.set(x, y + 0.7, dz);
                this.world.add(hang);
            }
        }
        // Coloured pipe runs (utility lines).
        for (const [dz, col] of [[-5.0, 0xb6402f], [-5.25, 0x3a7fb6], [-5.5, 0xd0b54a]]) {
            const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 30, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.4 }));
            pipe.rotation.z = Math.PI / 2;
            pipe.position.set(0, 6.6, dz);
            this.world.add(pipe);
        }
        // Two extra lamps to brighten the wings.
        for (const x of [-10, 10]) {
            const tube = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.4 }));
            tube.position.set(x, 7.5, BELT_Z - 1);
            this.world.add(tube);
            const glow = makeGlow(0xfff0c8, 6);
            glow.position.set(x, 7.2, BELT_Z - 1);
            glow.material.opacity = 0.4;
            this.world.add(glow);
        }
    }
    /** Structural I-beam pillars at the corners for vertical framing. */
    buildPillars() {
        const beam = new THREE.MeshStandardMaterial({ color: 0x586070, roughness: 0.5, metalness: 0.55 });
        for (const [x, z] of [[-8.2, 3.2], [8.2, 3.2], [-8.2, -5.4], [8.2, -5.4]]) {
            const col = new THREE.Group();
            const web = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8, 0.5), beam);
            const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.14), beam);
            f1.position.z = 0.25;
            const f2 = f1.clone();
            f2.position.z = -0.25;
            web.castShadow = f1.castShadow = f2.castShadow = true;
            col.add(web, f1, f2);
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 0.8), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.7 }));
            base.position.y = -3.9;
            col.add(base);
            col.position.set(x, 4, z);
            this.world.add(col);
        }
    }
    /** Foreground clutter: pallets of sacks, barrels, gas bottles, carts, bins. */
    buildForeground() {
        const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.9 });
        const sackCols = [0xccb892, 0xb89a6a, 0xd6c8a0];
        const makePallet = (x, z, rot) => {
            const p = new THREE.Group();
            const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 1.0), palletMat);
            base.position.y = 0.08;
            base.castShadow = true;
            base.receiveShadow = true;
            p.add(base);
            // Stacked sacks (rounded boxes).
            for (let i = 0; i < 6; i++) {
                const sack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.42), new THREE.MeshStandardMaterial({ color: sackCols[i % 3], roughness: 0.95 }));
                sack.position.set(-0.32 + (i % 2) * 0.6, 0.34 + Math.floor(i / 2) * 0.32, -0.22 + ((Math.floor(i / 2)) % 2) * 0.18);
                sack.rotation.y = (i * 0.3) % 0.5;
                sack.castShadow = true;
                p.add(sack);
            }
            p.position.set(x, 0, z);
            p.rotation.y = rot;
            this.world.add(p);
        };
        const makeCrateStack = (x, z) => {
            const g = new THREE.Group();
            for (let i = 0; i < 5; i++) {
                const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: i % 2 ? 0xb0813f : 0x9a6f3f, roughness: 0.85 }));
                c.position.set((i % 2) * 0.62 - 0.3, 0.3 + Math.floor(i / 2) * 0.62, (Math.floor(i / 2) % 2) * 0.1);
                c.rotation.y = (i * 0.4) % 0.6;
                c.castShadow = true;
                g.add(c);
            }
            g.position.set(x, 0, z);
            this.world.add(g);
        };
        const makeBarrels = (x, z) => {
            const wood = new THREE.MeshStandardMaterial({ color: 0x3f6fb0, roughness: 0.5, metalness: 0.3 });
            const band = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6, metalness: 0.5 });
            for (const [dx, dz] of [[0, 0], [0.62, 0.1], [0.3, -0.55], [0.32, 0.62]]) {
                const b = new THREE.Group();
                const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), wood);
                body.position.y = 0.35;
                body.castShadow = true;
                b.add(body);
                for (const by of [0.16, 0.54]) {
                    const r = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.03, 6, 14), band);
                    r.rotation.x = Math.PI / 2;
                    r.position.y = by;
                    b.add(r);
                }
                b.position.set(x + dx, 0, z + dz);
                this.world.add(b);
            }
        };
        const makeGasRack = (x, z) => {
            const cage = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7, metalness: 0.4 });
            const cols = [0xcf3b3b, 0x3bcf6a, 0x3b6fcf, 0xd0b54a];
            const g = new THREE.Group();
            const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.8, transparent: true, opacity: 0.25 }));
            frame.position.y = 0.75;
            g.add(frame);
            for (let i = 0; i < 4; i++) {
                const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 12), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.4, metalness: 0.3 }));
                bottle.position.set(-0.5 + i * 0.34, 0.6, 0);
                bottle.castShadow = true;
                g.add(bottle);
                const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10), cage);
                cap.position.set(-0.5 + i * 0.34, 1.2, 0);
                g.add(cap);
            }
            void cage;
            g.position.set(x, 0, z);
            this.world.add(g);
        };
        const makeCart = (x, z, rot) => {
            const m = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.4, metalness: 0.6 });
            const cart = new THREE.Group();
            const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.7), m);
            deck.position.y = 0.45;
            deck.castShadow = true;
            cart.add(deck);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), m);
            handle.position.set(-0.55, 0.8, 0);
            cart.add(handle);
            for (const [wx, wz] of [[-0.5, 0.3], [-0.5, -0.3], [0.5, 0.3], [0.5, -0.3]]) {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x14141a }));
                w.rotation.x = Math.PI / 2;
                w.position.set(wx, 0.14, wz);
                cart.add(w);
            }
            // A crate on the cart.
            const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: 0xb0813f, roughness: 0.85 }));
            crate.position.y = 0.74;
            crate.castShadow = true;
            cart.add(crate);
            cart.position.set(x, 0, z);
            cart.rotation.y = rot;
            this.world.add(cart);
        };
        makePallet(-6.4, 3.0, 0.2);
        makePallet(-4.9, 3.4, -0.3);
        makeCrateStack(6.6, 3.1);
        makeCrateStack(-1.2, 3.7);
        makeBarrels(4.4, 3.4);
        makeGasRack(2.0, 3.5);
        makeCart(0.2, 2.7, 0.5);
        makeCart(-3.0, 2.6, -0.6);
        // A couple of bins.
        for (const [x, col] of [[5.6, 0x2f7d52], [-7.4, 0xb6402f]]) {
            const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
            bin.position.set(x, 0.4, 3.3);
            bin.castShadow = true;
            this.world.add(bin);
        }
        // Painted floor zones for legibility.
        for (const [x, w, col] of [[-5.6, 2.6, 0xd8a93a], [6.0, 2.2, 0x3a7fb6]]) {
            const zone = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, 1.8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, transparent: true, opacity: 0.25 }));
            zone.position.set(x, 0.015, 3.1);
            this.world.add(zone);
        }
    }
    /** Wandering floor workers in chef whites that pace the front aisle. */
    spawnRoamers(n) {
        for (let i = 0; i < n; i++) {
            const mesh = this.makeChef();
            const x = -7 + Math.random() * 14, z = 2 + Math.random() * 2.6;
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
    buildBelt() {
        this.beltMat = new THREE.MeshStandardMaterial({ map: this.texBelt(), color: 0x2a2e35, roughness: 0.55, metalness: 0.3 });
        const belt = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.16, 1.15), this.beltMat);
        belt.position.set(0, BELT_Y - 0.08, BELT_Z);
        belt.receiveShadow = true;
        belt.castShadow = true;
        this.world.add(belt);
        // Brushed-metal side rails.
        const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.35, metalness: 0.7 });
        for (const dz of [0.64, -0.64]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.14, 0.08), railMat);
            rail.position.set(0, BELT_Y + 0.02, BELT_Z + dz);
            rail.castShadow = true;
            this.world.add(rail);
        }
        // Roller end-caps + support legs.
        const steel = new THREE.MeshStandardMaterial({ color: 0x6b727c, roughness: 0.4, metalness: 0.6 });
        for (const ex of [-SPAN, SPAN]) {
            const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 16), steel);
            roller.rotation.x = Math.PI / 2;
            roller.position.set(ex, BELT_Y - 0.08, BELT_Z);
            this.world.add(roller);
        }
        const legMat = new THREE.MeshStandardMaterial({ color: 0x40454d, roughness: 0.7, metalness: 0.3 });
        for (let x = -SPAN + 1.2; x <= SPAN; x += 2.4) {
            for (const dz of [0.5, -0.5]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, BELT_Y - 0.1, 0.16), legMat);
                leg.position.set(x, (BELT_Y - 0.1) / 2, BELT_Z + dz);
                leg.castShadow = true;
                this.world.add(leg);
            }
        }
    }
    // --- Detailed machines ------------------------------------------------------
    buildStations() {
        for (const id of STATION_IDS) {
            const def = STATION_DEF_BY_ID[id];
            const color = STATION_COLOR[id];
            const accent = STATION_ACCENT[id];
            const group = new THREE.Group();
            group.position.set(STATION_X[id], 0, BELT_Z);
            const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.5 });
            const steel = new THREE.MeshStandardMaterial({ color: 0x868d97, roughness: 0.35, metalness: 0.75 });
            // Plinth.
            const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.34, 2.15), dark);
            plinth.position.set(0, 0.17, MACHINE_Z);
            plinth.castShadow = true;
            plinth.receiveShadow = true;
            group.add(plinth);
            // Main housing (scaled by level).
            const housing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.45, 1.75), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.55 }));
            housing.position.set(0, 1.12, MACHINE_Z);
            housing.castShadow = true;
            housing.receiveShadow = true;
            group.add(housing);
            // Beveled top cap.
            const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 1.9), steel);
            cap.position.set(0, 1.92, MACHINE_Z);
            cap.castShadow = true;
            group.add(cap);
            // Tilted control panel with an emissive screen on the belt-facing side.
            const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.08), dark);
            panel.position.set(0, 0.92, MACHINE_Z + 0.92);
            panel.rotation.x = -0.32;
            group.add(panel);
            const screenMat = new THREE.MeshStandardMaterial({
                map: this.texScreen(def.icon, accent), emissive: accent, emissiveIntensity: 0.9, roughness: 0.3,
            });
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.46), screenMat);
            screen.position.set(0, 0.93, MACHINE_Z + 0.965);
            screen.rotation.x = -0.32;
            group.add(screen);
            // Side pipes.
            const pipeMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc4, roughness: 0.3, metalness: 0.8 });
            for (const sx of [-0.86, 0.86]) {
                const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 12), pipeMat);
                pipe.position.set(sx, 1.0, MACHINE_Z - 0.6);
                pipe.castShadow = true;
                group.add(pipe);
                const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), pipeMat);
                elbow.position.set(sx, 1.75, MACHINE_Z - 0.6);
                group.add(elbow);
            }
            // Feed hopper above the belt (funnel that drops onto the line).
            const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.16, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x70767f, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }));
            hopper.position.set(0, 1.55, MACHINE_Z + 0.55);
            hopper.castShadow = true;
            group.add(hopper);
            // Spinning working part on top (speed ∝ cadence). Blades for prep, fan elsewhere.
            const rotorMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.3, metalness: 0.6 });
            const rotor = new THREE.Mesh(id === 'prep'
                ? new THREE.BoxGeometry(1.0, 0.05, 0.12)
                : new THREE.CylinderGeometry(0.07, 0.07, 0.95, 10), rotorMat);
            rotor.rotation.z = Math.PI / 2;
            rotor.position.set(0, 2.16, MACHINE_Z);
            group.add(rotor);
            // Arch the belt passes through.
            const arch = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.28, 0.55), dark);
            arch.position.set(0, 1.62, 0);
            arch.castShadow = true;
            group.add(arch);
            for (const dx of [-0.8, 0.8]) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), dark);
                post.position.set(dx, 1.05, 0);
                post.castShadow = true;
                group.add(post);
            }
            // Blinking status light.
            const statusMat = new THREE.MeshStandardMaterial({ color: 0x223018, emissive: 0x55e070, emissiveIntensity: 1.2, roughness: 0.4 });
            const status = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), statusMat);
            status.position.set(0.66, 1.78, MACHINE_Z + 0.6);
            group.add(status);
            const statusGlow = makeGlow(0x66ff88, 0.8);
            statusGlow.position.copy(status.position);
            group.add(statusGlow);
            // Icon billboard above.
            const icon = this.makeIconSprite(def.icon);
            icon.position.set(0, 2.75, MACHINE_Z);
            group.add(icon);
            // Buffer gauge on the housing front.
            const gaugeBg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1 }));
            gaugeBg.position.set(0, 0.5, MACHINE_Z + 0.9);
            group.add(gaugeBg);
            const gaugeFill = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x57e08a, emissive: 0x1a5a30, emissiveIntensity: 0.6, roughness: 0.5 }));
            gaugeFill.position.set(0, 0.5, MACHINE_Z + 0.92);
            group.add(gaugeFill);
            // Bottleneck halo ring on the floor.
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 10, 28), new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 1.0, roughness: 0.5 }));
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(0, 0.05, MACHINE_Z + 0.2);
            ring.visible = false;
            group.add(ring);
            // Invisible pick target.
            const pick = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.2, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
            pick.position.set(0, 1.4, MACHINE_Z + 0.4);
            pick.userData.id = id;
            group.add(pick);
            this.world.add(group);
            this.stations.set(id, {
                id, group, housing, rotor, gaugeFill, ring, pick, screenMat, statusMat, statusGlow,
                fx: STATION_FX[id], fxAnchor: new THREE.Vector3(STATION_X[id], 1.9, MACHINE_Z + 0.55),
                workerDots: [], rate: 1,
            });
            if (id === 'cooking')
                this.addBurner(group, accent);
        }
    }
    /** A glowing burner under the cooking station for extra warmth. */
    addBurner(group, accent) {
        const burner = makeGlow(accent, 1.6);
        burner.position.set(0, 0.55, 0.2);
        group.add(burner);
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
    texFloor() {
        const { c, g } = this.paintCanvas(256);
        g.fillStyle = '#3a4049';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 2400; i++) {
            g.fillStyle = ['#41474f', '#33383f', '#454c54'][(Math.random() * 3) | 0];
            g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }
        g.strokeStyle = 'rgba(0,0,0,0.4)';
        g.lineWidth = 3;
        for (let p = 0; p <= 256; p += 64) {
            g.beginPath();
            g.moveTo(0, p);
            g.lineTo(256, p);
            g.moveTo(p, 0);
            g.lineTo(p, 256);
            g.stroke();
        }
        return this.finish(c, 8, 6);
    }
    texHazard() {
        const { c, g } = this.paintCanvas(128);
        g.fillStyle = '#1c2026';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#f0b21f';
        for (let x = -128; x < 256; x += 28) {
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x + 14, 0);
            g.lineTo(x + 14 - 40, 128);
            g.lineTo(x - 40, 128);
            g.closePath();
            g.fill();
        }
        // Clear centre lane.
        g.fillStyle = '#22262d';
        g.fillRect(0, 26, 128, 76);
        return this.finish(c, 12, 1);
    }
    texPanel() {
        const { c, g } = this.paintCanvas(256);
        g.fillStyle = '#3a414b';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 4;
        for (let p = 0; p <= 256; p += 64) {
            g.strokeRect(p, 0, 64, 256);
            g.strokeRect(0, p, 256, 64);
        }
        g.fillStyle = '#5a626d';
        for (let y = 16; y < 256; y += 64)
            for (let x = 16; x < 256; x += 64) {
                g.beginPath();
                g.arc(x, y, 3, 0, Math.PI * 2);
                g.fill();
            }
        return this.finish(c, 6, 2);
    }
    texBelt() {
        const { c, g } = this.paintCanvas(128);
        g.fillStyle = '#23262d';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#181b21';
        for (let x = 0; x < 128; x += 16)
            g.fillRect(x, 0, 8, 128);
        return this.finish(c, SPAN * 2, 1);
    }
    texScreen(emoji, accent) {
        const { c, g } = this.paintCanvas(128);
        g.fillStyle = '#0b0f14';
        g.fillRect(0, 0, 128, 128);
        g.font = '64px system-ui, "Segoe UI Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(emoji, 64, 48);
        const hex = '#' + (accent & 0xffffff).toString(16).padStart(6, '0');
        g.fillStyle = hex;
        for (let i = 0; i < 4; i++)
            g.fillRect(18 + i * 26, 86, 18, 6 + (i % 2) * 16);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        return t;
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
    // --- Items ------------------------------------------------------------------
    makeItem() {
        const group = new THREE.Group();
        const stages = [];
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), new THREE.MeshStandardMaterial({ color: 0xb07a44, roughness: 0.8, metalness: 0.05 }));
        const chopped = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x6fb83f, roughness: 0.75 }));
        const cooked = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0843a, roughness: 0.5, metalness: 0.1, emissive: 0x3a1a00, emissiveIntensity: 0.35 }));
        const boxed = new THREE.Group();
        boxed.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.45 })));
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0xe8533a, roughness: 0.45 }));
        lid.position.y = 0.14;
        boxed.add(lid);
        for (const m of [crate, chopped, cooked, boxed]) {
            m.position.y = 0.2;
            m.castShadow = true;
            group.add(m);
            stages.push(m);
        }
        group.position.y = BELT_Y;
        this.world.add(group);
        return { group, stages, t: 0, stage: 0 };
    }
    setItemStage(item, stage) {
        if (stage === item.stage)
            return;
        item.stage = stage;
        for (let i = 0; i < item.stages.length; i++)
            item.stages[i].visible = i === stage;
    }
    // --- Scooters ---------------------------------------------------------------
    makeScooter() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.62), new THREE.MeshStandardMaterial({ color: 0xb2484a, roughness: 0.4, metalness: 0.3 }));
        body.position.y = 0.24;
        body.castShadow = true;
        g.add(body);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4b942, emissive: 0xff8c1a, emissiveIntensity: 0.35, roughness: 0.5 }));
        box.position.set(0, 0.46, -0.28);
        g.add(box);
        for (const wz of [0.28, -0.28]) {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 }));
            w.rotation.z = Math.PI / 2;
            w.position.set(0, 0.12, wz);
            g.add(w);
        }
        const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f55c8, roughness: 0.6 }));
        rider.position.set(0, 0.5, 0.04);
        g.add(rider);
        g.visible = false;
        this.world.add(g);
        return { mesh: g, t: 0, active: false };
    }
    launchScooter() {
        let s = this.scooters.find((x) => !x.active);
        if (!s) {
            if (this.scooters.length >= 6)
                return;
            s = this.makeScooter();
            this.scooters.push(s);
        }
        s.active = true;
        s.t = 0;
        s.mesh.visible = true;
    }
    // --- Particles (steam / sparks) ---------------------------------------------
    spawnParticle(anchor, kind) {
        if (this.particles.length > 90)
            return;
        const mat = kind === 'steam'
            ? new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.5, roughness: 1 })
            : new THREE.MeshStandardMaterial({ color: 0xffb24a, emissive: 0xff7a1a, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(kind === 'steam' ? new THREE.SphereGeometry(0.14, 8, 6) : new THREE.SphereGeometry(0.05, 6, 5), mat);
        mesh.position.copy(anchor);
        mesh.position.x += (Math.random() - 0.5) * 0.4;
        mesh.position.z += (Math.random() - 0.5) * 0.3;
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
            const vis = this.stations.get(id);
            if (!vis)
                continue;
            const st = state.stations[id];
            vis.rate = FactoryEngine.stationRate(state, id, now);
            const grow = 1 + Math.min(st.level, 40) * 0.012;
            vis.housing.scale.set(grow, grow, grow);
            const cap = FactoryEngine.stationCapacity(state, id);
            const fill = id === 'delivery' ? Math.min(1, this.throughput / Math.max(0.001, vis.rate)) : Math.min(1, st.output / Math.max(1, cap));
            vis.gaugeFill.scale.x = Math.max(0.02, fill);
            vis.gaugeFill.position.x = -0.58 * (1 - fill);
            vis.gaugeFill.material.color.setHex(fill > 0.92 ? 0xff7a3a : 0x57e08a);
            vis.ring.visible = id === this.bottleneck;
            this.syncWorkerDots(vis, st.workers);
        }
    }
    syncWorkerDots(vis, count) {
        while (vis.workerDots.length < count) {
            const w = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.24, 4, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6ef, roughness: 0.6 }));
            body.position.y = 0.42;
            body.castShadow = true;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
            head.position.y = 0.74;
            const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
            hat.position.y = 0.88; // chef toque
            w.add(body, head, hat);
            const i = vis.workerDots.length;
            w.position.set(-0.7 + (i % 3) * 0.7, 0, 1.25 + Math.floor(i / 3) * 0.6);
            vis.group.add(w);
            vis.workerDots.push(w);
        }
        while (vis.workerDots.length > count) {
            const d = vis.workerDots.pop();
            if (d)
                vis.group.remove(d);
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
            this.targetYaw += dt * 0.03;
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
        this.world.rotation.y = this.yaw;
        if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
            this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
            this.updateCameraFrustum();
        }
        if (this.beltMat.map)
            this.beltMat.map.offset.x -= dt * 0.7;
        const beltSpeed = Math.min(3.4, 0.6 + this.throughput * 0.5);
        for (const vis of this.stations.values()) {
            vis.rotor.rotation.x += dt * Math.min(16, 2 + vis.rate * 1.5);
            // Pulse the screen + status light; bottleneck status blinks red.
            const isNeck = vis.id === this.bottleneck;
            vis.screenMat.emissiveIntensity = 0.7 + Math.sin(this.t * 3 + vis.rate) * 0.25;
            const blink = 0.6 + 0.4 * Math.sin(this.t * (isNeck ? 9 : 3));
            vis.statusMat.emissive.setHex(isNeck ? 0xff4a3a : 0x55e070);
            vis.statusMat.emissiveIntensity = 0.6 + blink;
            vis.statusGlow.material.color.setHex(isNeck ? 0xff6a4a : 0x66ff88);
            vis.statusGlow.material.opacity = 0.4 + blink * 0.4;
            if (vis.ring.visible)
                vis.ring.material.emissiveIntensity = 0.7 + Math.sin(this.t * 4) * 0.4;
        }
        // Spawn items proportional to throughput.
        if (this.throughput > 0.0001 && this.items.length < 60) {
            this.spawnAccum += dt * this.throughput;
            while (this.spawnAccum >= 1) {
                this.spawnAccum -= 1;
                this.items.push(this.makeItem());
            }
        }
        const vel = beltSpeed / (SPAN * 2);
        for (const item of this.items) {
            item.t += vel * dt;
            const x = -SPAN + item.t * (SPAN * 2);
            item.group.position.x = x;
            const stage = x < STATION_X.prep ? 0 : x < STATION_X.cooking ? 1 : x < STATION_X.plating ? 2 : 3;
            this.setItemStage(item, stage);
            item.group.position.y = BELT_Y + Math.abs(Math.sin((x + this.t) * 6)) * 0.015;
            item.group.rotation.y += dt * 0.5;
        }
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (this.items[i].t >= 1) {
                this.world.remove(this.items[i].group);
                this.items.splice(i, 1);
                this.scooterAccum += 1;
            }
        }
        if (this.scooterAccum >= 2) {
            this.scooterAccum = 0;
            this.launchScooter();
        }
        for (const s of this.scooters) {
            if (!s.active)
                continue;
            s.t += dt * 0.5;
            s.mesh.position.set(STATION_X.delivery + s.t * 6, 0, BELT_Z + 1.5);
            s.mesh.rotation.y = Math.PI / 2;
            if (s.t >= 1) {
                s.active = false;
                s.mesh.visible = false;
            }
        }
        // Wandering floor workers pace the front aisle.
        for (const r of this.roamers) {
            if (r.pause > 0) {
                r.pause -= dt;
                continue;
            }
            const dx = r.tx - r.x, dz = r.tz - r.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.12) {
                r.tx = -7 + Math.random() * 14;
                r.tz = 2 + Math.random() * 2.6;
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
        // Steam / spark emitters scale with the relevant station's activity.
        const cook = this.stations.get('cooking');
        if (cook && this.throughput > 0.001) {
            this.steamAccum += dt * (2 + cook.rate * 0.5);
            while (this.steamAccum >= 1) {
                this.steamAccum -= 1;
                this.spawnParticle(cook.fxAnchor, 'steam');
            }
        }
        const prep = this.stations.get('prep');
        if (prep && this.throughput > 0.001) {
            this.sparkAccum += dt * (3 + prep.rate * 0.6);
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
                this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize * (this.lastPinch / d)));
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
        const picks = [...this.stations.values()].map((v) => v.pick);
        const hits = this.raycaster.intersectObjects(picks, false);
        if (hits.length > 0) {
            const id = hits[0].object.userData.id;
            if (id)
                this.onTapStation(id);
        }
    }
}
