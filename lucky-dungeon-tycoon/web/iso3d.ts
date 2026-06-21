/**
 * iso3d.ts — Real-3D village renderer (Three.js / WebGL), maxed-out graphics.
 *
 * A true 3D isometric tycoon scene with procedural textures (stone, planks,
 * shingles, grass), a gradient sky dome with a moving sun/moon and stars, a
 * full day/night cycle (warm windows + lamp posts that glow at dusk), additive
 * glow sprites for a bloom-like feel, atmospheric particles (dust by day,
 * fireflies by night), a rippling pond, a perimeter fence, a waving flag,
 * high-resolution soft shadows, chimney smoke, wandering workers, gold-coin
 * pops, drag-to-rotate, pinch/wheel zoom, and raycast tap-to-upgrade.
 *
 * Buildings and decor use CC0 low-poly models (Kenney "City Builder" kit),
 * loaded lazily via a vendored GLTFLoader with the procedural meshes as an
 * offline-safe fallback. Three.js, the loader and all textures are vendored
 * locally, so the game stays fully offline. Conforms to the same
 * VillageRenderer shape as `iso.ts`.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BUILDING_TYPES, BuildingType, UserProfile } from '../src/types.js';
import { BUILDING_CONFIGS } from '../src/VillageEngine.js';
import {
  makeGlow, texGrass, texPlanks, texShingle, texStone, texStoneWall,
} from './iso3dtex.js';

/**
 * CC0 low-poly building models (Kenney "City Builder" kit, CC0). Each game
 * building maps to one model; the castle reuses the garage at a larger scale
 * for a grander silhouette. Loaded lazily — the procedural mesh stands in
 * until (and if) the GLB arrives, so the scene works offline and never blocks.
 */
const MODEL_DIR = 'models/';
const BUILDING_MODELS: Record<BuildingType, string> = {
  mine: 'building-garage.glb',
  farm: 'building-small-a.glb',
  sawmill: 'building-small-b.glb',
  market: 'building-small-c.glb',
  blacksmith: 'building-small-d.glb',
  castle: 'building-garage.glb',
};
/** Footprint each model is normalised to (world units), before level growth. */
const MODEL_FOOTPRINT: Record<BuildingType, number> = {
  mine: 1.9, farm: 1.8, sawmill: 1.8, market: 1.8, blacksmith: 1.8, castle: 2.5,
};

const LAYOUT: Record<BuildingType, { gx: number; gy: number }> = {
  mine: { gx: 1.4, gy: 1.4 },
  farm: { gx: 4.6, gy: 1.4 },
  sawmill: { gx: 1.2, gy: 4.4 },
  market: { gx: 3.0, gy: 3.0 },
  blacksmith: { gx: 4.8, gy: 4.6 },
  castle: { gx: 3.0, gy: 5.7 },
};

interface Palette { body: number; roof: number; trim: number; stone: boolean; }
const PALETTES: Record<BuildingType, Palette> = {
  mine:       { body: 0x8b8f99, roof: 0xcaa24a, trim: 0x5d626b, stone: true },
  farm:       { body: 0xd9b277, roof: 0x7fc25a, trim: 0x8a6e44, stone: false },
  sawmill:    { body: 0xb07d4f, roof: 0x8a5a36, trim: 0x6a4326, stone: false },
  market:     { body: 0xd49a63, roof: 0xd24f52, trim: 0x8c5d38, stone: false },
  blacksmith: { body: 0x767b88, roof: 0xe0773c, trim: 0x4a4e58, stone: true },
  castle:     { body: 0xaab0bd, roof: 0x8a6fd6, trim: 0x666b78, stone: true },
};

// Bright, saturated "toy" palettes for an App-Store idle-tycoon vibe.
const THEMES = [
  { ground: 0x9a8056, grass: 0x84c64f, skyTop: 0x49a6ee, skyBot: 0xd2efff },
  { ground: 0xa28a60, grass: 0x92d25c, skyTop: 0x57aef0, skyBot: 0xdcf3ff },
  { ground: 0x8f7752, grass: 0x7cbc48, skyTop: 0x489ce6, skyBot: 0xccebfd },
  { ground: 0xa68d63, grass: 0x9bd862, skyTop: 0x62b6f4, skyBot: 0xdef5ff },
];
const NIGHT_TOP = new THREE.Color(0x080a16);
const NIGHT_BOT = new THREE.Color(0x1a2138);

const TILE = 2.0;
const GRID = 7;
const HALF = (GRID * TILE) / 2;
const DAY_CYCLE = 110;

function tileToWorld(gx: number, gy: number): { x: number; z: number } {
  return { x: gx * TILE - HALF, z: gy * TILE - HALF };
}

interface Building3D {
  group: THREE.Group;
  /** Procedural fallback (body + roof + details), shown until the model loads. */
  proc: THREE.Group;
  body: THREE.Mesh; roof: THREE.Mesh; pickMesh: THREE.Mesh;
  /** Loaded GLB model root (null until loaded / on failure). */
  model: THREE.Group | null;
  /** Normalised base scale of the model before per-level growth. */
  modelScale: number;
  /** Approximate model height (world units) at base scale, for coin/smoke fx. */
  modelHeight: number;
  level: number; shownHeight: number;
}
interface Worker3D { mesh: THREE.Group; x: number; z: number; tx: number; tz: number; speed: number; pause: number; phase: number; }
interface Coin3D { group: THREE.Group; vy: number; life: number; }
interface Smoke3D { mesh: THREE.Mesh; vy: number; life: number; }

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class Iso3DScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly world = new THREE.Group();
  private readonly sky = new THREE.Group();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly platform: THREE.Mesh;
  private readonly grass: THREE.Mesh;

  private skyMat!: THREE.ShaderMaterial;
  private stars!: THREE.Points;
  private dust!: THREE.Points;
  private fireflies!: THREE.Points;
  private fireflyBase: Float32Array = new Float32Array(0);
  private sunSprite!: THREE.Sprite;
  private sunGlow!: THREE.Sprite;
  private moonSprite!: THREE.Sprite;
  private pondMat!: THREE.MeshStandardMaterial;
  private flag: THREE.Mesh | null = null;
  /** Warm glow sprites (windows, lamps) brightened at night. */
  private readonly nightGlow: THREE.Sprite[] = [];
  private readonly nightMats: THREE.MeshStandardMaterial[] = [];

  private readonly buildings = new Map<BuildingType, Building3D>();
  private workers: Worker3D[] = [];
  private coins: Coin3D[] = [];
  private smoke: Smoke3D[] = [];
  private floaters: { sprite: THREE.Sprite; life: number; vy: number }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly gltf = new GLTFLoader();

  private raf = 0; private last = 0; private t = 0;
  private dayT = 22; private smokeTimer = 0;
  private yaw = 0; private targetYaw = 0;
  private viewSize = 14; private targetViewSize = 14; private aspect = 1;
  private themeVillage = 0;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging = false; private dragMoved = 0; private lastPX = 0;
  private lastPinch = 0; private pinching = false;
  private boostSpeed = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTapBuilding: (type: BuildingType) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    (this.renderer as unknown as { outputColorSpace: string }).outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.camera.position.set(26, 30, 26);
    this.camera.lookAt(0, 2, 0);

    this.scene.add(this.sky);
    this.scene.add(this.world);

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a4d3a, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sun.position.set(14, 26, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 100;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Textured ground.
    const theme = THEMES[0];
    this.platform = new THREE.Mesh(
      new THREE.BoxGeometry(GRID * TILE + 1.2, 1.0, GRID * TILE + 1.2),
      new THREE.MeshStandardMaterial({ map: texStone(), color: theme.ground, roughness: 1 }),
    );
    this.platform.position.y = -0.5; this.platform.receiveShadow = true;
    this.world.add(this.platform);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(GRID * TILE + 2.2, 2.2, GRID * TILE + 2.2),
      new THREE.MeshStandardMaterial({ map: texStoneWall(0x4a4450), roughness: 1 }),
    );
    base.position.y = -2.1; base.receiveShadow = true;
    this.world.add(base);

    this.grass = new THREE.Mesh(
      new THREE.BoxGeometry(GRID * TILE + 5.6, 0.6, GRID * TILE + 5.6),
      new THREE.MeshStandardMaterial({ map: texGrass(), color: theme.grass, roughness: 1 }),
    );
    this.grass.position.y = -1.0; this.grass.receiveShadow = true;
    this.world.add(this.grass);

    this.buildSky();
    this.buildAtmosphere();
    this.buildPond();
    this.buildFence();
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

  // --- Sky, stars, sun/moon ---------------------------------------------------

  private buildSky(): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3f78c0) },
        botColor: { value: new THREE.Color(0xbfe0f0) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 botColor; varying vec3 vDir;
        void main(){ float t = clamp(vDir.y*0.5+0.5, 0.0, 1.0); t = pow(t, 0.8);
          gl_FragColor = vec4(mix(botColor, topColor, t), 1.0); }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 16), this.skyMat);
    dome.renderOrder = -1;
    this.sky.add(dome);

    // Stars.
    const N = 380; const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.5 + 0.05; // upper hemisphere
      const r = 150;
      pos[i * 3] = Math.cos(u) * Math.cos(v * Math.PI) * r;
      pos[i * 3 + 1] = Math.sin(v * Math.PI) * r;
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.sky.add(this.stars);

    // Sun (bright disc + big additive glow) and moon.
    this.sunGlow = makeGlow(0xffe6a0, 34);
    this.sky.add(this.sunGlow);
    this.sunSprite = makeGlow(0xfff4d0, 10);
    this.sky.add(this.sunSprite);
    this.moonSprite = makeGlow(0xcfe0ff, 12);
    this.moonSprite.material.opacity = 0;
    this.sky.add(this.moonSprite);
  }

  private buildAtmosphere(): void {
    // Dust motes (day).
    const D = 120; const dp = new Float32Array(D * 3);
    for (let i = 0; i < D; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 22;
      dp[i * 3 + 1] = 1 + Math.random() * 10;
      dp[i * 3 + 2] = (Math.random() - 0.5) * 22;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0xfff0c0, size: 0.12, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.dust);

    // Fireflies (night).
    const F = 46; const fp = new Float32Array(F * 3);
    this.fireflyBase = new Float32Array(F * 3);
    for (let i = 0; i < F; i++) {
      const x = (Math.random() - 0.5) * 16, y = 0.6 + Math.random() * 2.4, z = (Math.random() - 0.5) * 16;
      fp[i * 3] = x; fp[i * 3 + 1] = y; fp[i * 3 + 2] = z;
      this.fireflyBase[i * 3] = x; this.fireflyBase[i * 3 + 1] = y; this.fireflyBase[i * 3 + 2] = z;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({
      color: 0xffe070, size: 0.22, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.fireflies);
  }

  private buildPond(): void {
    this.pondMat = new THREE.MeshStandardMaterial({
      color: 0x2f6f9a, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.92,
      emissive: 0x123a52, emissiveIntensity: 0.4,
    });
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), this.pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(HALF + 1.6, -0.66, -HALF - 1.6);
    this.world.add(pond);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.12, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 1 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pond.position); ring.position.y = -0.7;
    this.world.add(ring);
  }

  private buildFence(): void {
    const postMat = new THREE.MeshStandardMaterial({ map: texPlanks(0x7a5a36), roughness: 1 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x6a4f2e, roughness: 1 });
    const edge = HALF + 0.4;
    const step = TILE;
    const postGeo = new THREE.BoxGeometry(0.12, 0.7, 0.12);
    const addPost = (x: number, z: number): void => {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, 0.15, z); p.castShadow = true; this.world.add(p);
    };
    for (let i = -GRID / 2; i <= GRID / 2; i++) {
      addPost(i * step, edge); addPost(i * step, -edge);
      addPost(edge, i * step); addPost(-edge, i * step);
    }
    // Rails along the four sides.
    const len = GRID * TILE + 0.8;
    for (const yy of [0.05, 0.32]) {
      for (const [w, d, x, z, ry] of [
        [len, 0.06, 0, edge, 0], [len, 0.06, 0, -edge, 0],
        [0.06, len, edge, 0, 0], [0.06, len, -edge, 0, 0],
      ] as Array<[number, number, number, number, number]>) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), railMat);
        rail.position.set(x, yy, z); rail.rotation.y = ry; this.world.add(rail);
      }
    }
  }

  private buildPaths(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c8b6e, roughness: 1 });
    const c = tileToWorld(LAYOUT.market.gx, LAYOUT.market.gy);
    for (const type of BUILDING_TYPES) {
      if (type === 'market') continue;
      const b = tileToWorld(LAYOUT[type].gx, LAYOUT[type].gy);
      const dx = b.x - c.x, dz = b.z - c.z;
      const len = Math.hypot(dx, dz);
      const path = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, len), mat);
      path.position.set((b.x + c.x) / 2, 0.04, (b.z + c.z) / 2);
      path.rotation.y = Math.atan2(dx, dz);
      path.receiveShadow = true;
      this.world.add(path);
    }
  }

  // --- Buildings --------------------------------------------------------------

  private buildBuildings(): void {
    for (const type of BUILDING_TYPES) {
      const pal = PALETTES[type];
      const { x, z } = tileToWorld(LAYOUT[type].gx, LAYOUT[type].gy);
      const group = new THREE.Group();
      group.position.set(x, 0, z);

      // Procedural fallback lives in its own sub-group so a loaded GLB model
      // can replace it wholesale with a single visibility toggle.
      const proc = new THREE.Group();
      group.add(proc);

      const wallTex = pal.stone ? texStoneWall(pal.body) : texPlanks(pal.body);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1, 1.5),
        new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }),
      );
      body.castShadow = true; body.receiveShadow = true; body.position.y = 0.5;
      proc.add(body);

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.7, 0.09),
        new THREE.MeshStandardMaterial({ color: pal.trim, roughness: 0.9 }),
      );
      door.position.set(0, 0.35, 0.78); proc.add(door);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.28, 1.0, 4),
        new THREE.MeshStandardMaterial({ map: texShingle(pal.roof), roughness: 0.8, flatShading: true }),
      );
      roof.castShadow = true; roof.rotation.y = Math.PI / 4; roof.position.y = 1.5;
      proc.add(roof);

      this.addWindow(proc, -0.4, 0.78, 0.5);
      this.addWindow(proc, 0.4, 0.78, 0.5);
      this.addDetails(type, proc, pal);

      // Warm glow over the door (fake bloom at night) — kept for both proc and
      // model, so windows still light up at dusk.
      const glow = makeGlow(0xffce6a, 1.4);
      glow.position.set(0, 0.8, 0.9); glow.material.opacity = 0;
      group.add(glow); this.nightGlow.push(glow);

      const pickMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 5, 2.2),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pickMesh.position.y = 2.2; pickMesh.userData.type = type; group.add(pickMesh);

      group.visible = false;
      this.world.add(group);
      const entry: Building3D = {
        group, proc, body, roof, pickMesh,
        model: null, modelScale: 1, modelHeight: 1.6,
        level: 0, shownHeight: 1,
      };
      this.buildings.set(type, entry);
      this.loadBuildingModel(type, entry);
    }
  }

  /**
   * Loads a building's CC0 GLB model and, on success, swaps out the procedural
   * fallback. Normalises the model to a fixed footprint sitting on the ground,
   * enables shadows, and (for the castle) tints it gold. Any failure leaves the
   * procedural mesh in place — the scene keeps working offline.
   */
  private loadBuildingModel(type: BuildingType, entry: Building3D): void {
    this.gltf.load(
      MODEL_DIR + BUILDING_MODELS[type],
      (gltf) => {
        const root = gltf.scene;
        // Normalise: centre on X/Z, drop base to y=0, scale to target footprint.
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);
        const footprint = Math.max(size.x, size.z) || 1;
        const scale = MODEL_FOOTPRINT[type] / footprint;
        root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        root.scale.setScalar(scale);

        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true; mesh.receiveShadow = true;
            if (type === 'castle') {
              const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
              mat.color.multiply(new THREE.Color(0xd9c178));
              mesh.material = mat;
            }
          }
        });

        entry.model = root;
        entry.modelScale = scale;
        entry.modelHeight = size.y * scale;
        entry.group.add(root);
        entry.proc.visible = false;
      },
      undefined,
      () => { /* keep the procedural fallback on any load/parse error */ },
    );
  }

  private addWindow(group: THREE.Group, x: number, y: number, z: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2418, emissive: 0xffce6a, emissiveIntensity: 0, roughness: 0.5,
    });
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.06), mat);
    win.position.set(x, y, z); group.add(win);
    this.nightMats.push(mat);
  }

  private addDetails(type: BuildingType, group: THREE.Group, pal: Palette): void {
    const std = (color: number, rough = 0.85): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: rough });
    const add = (m: THREE.Mesh, x: number, y: number, z: number): void => {
      m.position.set(x, y, z); m.castShadow = true; group.add(m);
    };
    switch (type) {
      case 'mine': {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.7), std(0x4a4e58)), 1.0, 0.2, 0.9);
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), std(0xf6c244, 0.4)), 1.0, 0.42, 0.9);
        break;
      }
      case 'farm': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12), std(0xc9c2b0)), 1.0, 0.55, -0.6);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.3, 12), std(0x9a5a3a)), 1.0, 1.25, -0.6);
        const field = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.9), new THREE.MeshStandardMaterial({ map: texGrass(), color: 0x9ac24a, roughness: 1 }));
        field.receiveShadow = true; field.position.set(0, 0.05, 1.4); group.add(field);
        break;
      }
      case 'sawmill': {
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 8), std(0x8a5a36));
          log.rotation.z = Math.PI / 2; add(log, 1.05, 0.18 + i * 0.32, 0.7 - (i % 2) * 0.18);
        }
        break;
      }
      case 'market': {
        const awning = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.7), std(0xe24b4b));
        awning.position.set(0, 1.05, 0.95); awning.rotation.x = -0.5; awning.castShadow = true; group.add(awning);
        for (let i = -1; i <= 1; i += 2) add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), std(0xb0813f)), i * 0.5, 0.18, 1.05);
        break;
      }
      case 'blacksmith': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), std(0x3a3a40)), 0.5, 1.4, -0.4);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.22), std(0x2c2c34, 0.5)), 1.0, 0.2, 0.8);
        const forge = makeGlow(0xff7a2a, 0.8); forge.position.set(1.0, 0.25, 0.8); group.add(forge); this.nightGlow.push(forge);
        break;
      }
      case 'castle': {
        for (const sx of [-0.85, 0.85]) {
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.7, 10), new THREE.MeshStandardMaterial({ map: texStoneWall(pal.body), roughness: 0.9 })), sx, 0.85, -0.2);
          add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 10), new THREE.MeshStandardMaterial({ map: texShingle(pal.roof), roughness: 0.8 })), sx, 1.95, -0.2);
        }
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), std(0x6b5a3a)), 0, 2.3, 0);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3, 6, 1), new THREE.MeshStandardMaterial({ color: 0xf6c244, roughness: 0.6, side: THREE.DoubleSide }));
        flag.position.set(0.27, 2.5, 0); group.add(flag); this.flag = flag;
        break;
      }
    }
  }

  /** Builds a single procedural pine (the tree-model fallback). */
  private proceduralTree(x: number, z: number): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e8a3c, roughness: 0.9, flatShading: true });
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 6), trunkMat);
    trunk.position.y = 0.15; trunk.castShadow = true;
    const l1 = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.1, 8), leafMat); l1.position.y = 1.1; l1.castShadow = true;
    const l2 = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 8), leafMat); l2.position.y = 1.7; l2.castShadow = true;
    tree.add(trunk); tree.add(l1); tree.add(l2);
    tree.position.set(x, -0.7, z); tree.scale.setScalar(0.85 + Math.random() * 0.4);
    this.world.add(tree);
  }

  /** Loads a decorative CC0 model, normalises it, and drops it at (x,z). */
  private loadDecor(file: string, x: number, z: number, footprint: number, y = -0.7, onFail?: () => void): void {
    this.gltf.load(MODEL_DIR + file, (gltf) => {
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const scale = footprint / (Math.max(size.x, size.z) || 1);
      root.scale.setScalar(scale);
      root.position.set(x - center.x * scale, y - box.min.y * scale, z - center.z * scale);
      root.rotation.y = Math.random() * Math.PI * 2;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.world.add(root);
    }, undefined, () => onFail?.());
  }

  private decorate(): void {
    // Tree clusters at the outer corners (CC0 model, procedural pine fallback).
    const treeSpots: Array<[number, number]> = [
      [-HALF - 1.7, -HALF - 1.7], [HALF + 1.7, -HALF - 1.7], [-HALF - 1.7, HALF + 1.7],
    ];
    for (const [x, z] of treeSpots) {
      this.loadDecor('grass-trees-tall.glb', x, z, 2.4, -0.7, () => this.proceduralTree(x, z));
    }
    // A fountain centrepiece at the remaining free corner.
    this.loadDecor('pavement-fountain.glb', HALF + 1.7, HALF + 1.7, 2.6, -0.7);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 1 });
    for (const [x, z] of [[0, -HALF - 1.2], [0, HALF + 1.2], [-HALF - 1.2, 0], [HALF + 1.2, 0]] as Array<[number, number]>) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), postMat);
      post.position.set(x, -0.2, z); post.castShadow = true; this.world.add(post);
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0x4a4020, emissive: 0xffd070, emissiveIntensity: 0 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), bulbMat);
      bulb.position.set(x, 0.6, z); this.world.add(bulb); this.nightMats.push(bulbMat);
      const glow = makeGlow(0xffd070, 1.6); glow.position.set(x, 0.6, z); glow.material.opacity = 0;
      this.world.add(glow); this.nightGlow.push(glow);
    }
  }

  private makeWorker(): Worker3D {
    const group = new THREE.Group();
    const hue = new THREE.Color().setHSL(Math.random(), 0.5, 0.55);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: hue, roughness: 0.8 }));
    body.castShadow = true; body.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
    head.castShadow = true; head.position.y = 0.78;
    group.add(body); group.add(head);
    const x = (Math.random() - 0.5) * GRID * TILE * 0.7, z = (Math.random() - 0.5) * GRID * TILE * 0.7;
    group.position.set(x, 0, z); this.world.add(group);
    return { mesh: group, x, z, tx: x, tz: z, speed: 1.0 + Math.random(), pause: Math.random() * 2, phase: Math.random() * 6 };
  }

  private applyTheme(village: number): void {
    const theme = THEMES[(Math.max(1, village) - 1) % THEMES.length];
    this.themeVillage = village;
    (this.platform.material as THREE.MeshStandardMaterial).color.setHex(theme.ground);
    (this.grass.material as THREE.MeshStandardMaterial).color.setHex(theme.grass);
    this.daySkyTop = new THREE.Color(theme.skyTop);
    this.daySkyBot = new THREE.Color(theme.skyBot);
    this.scene.fog = new THREE.Fog(theme.skyBot, 80, 150);
  }
  private daySkyTop = new THREE.Color(0x3f78c0);
  private daySkyBot = new THREE.Color(0xbfe0f0);

  public setState(state: UserProfile): void {
    let total = 0;
    for (const type of BUILDING_TYPES) {
      const b = this.buildings.get(type)!;
      b.level = Math.max(0, Math.floor(state.buildings[type]));
      b.group.visible = b.level > 0;
      total += b.level;
    }
    if (state.village !== this.themeVillage) this.applyTheme(state.village);
    const target = Math.min(14, 3 + Math.floor(total / 3));
    while (this.workers.length < target) this.workers.push(this.makeWorker());
    while (this.workers.length > target) { const w = this.workers.pop(); if (w) this.world.remove(w.mesh); }
    this.ensureRunning();
  }

  private bodyHeight(type: BuildingType, level: number): number {
    return (type === 'castle' ? 1.6 : 1.0) + Math.min(level, 28) * 0.2;
  }

  public coinPop(type: BuildingType): void {
    const b = this.buildings.get(type);
    if (!b) return;
    const top = b.shownHeight + 1.6;
    for (let i = 0; i < 8; i++) {
      const grp = new THREE.Group();
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: 0xffd95a, metalness: 0.6, roughness: 0.3, emissive: 0x4a3a00 }),
      );
      coin.rotation.x = Math.PI / 2; grp.add(coin);
      const glow = makeGlow(0xffd95a, 0.7); grp.add(glow);
      grp.position.set(b.group.position.x + (Math.random() - 0.5), top, b.group.position.z + (Math.random() - 0.5));
      this.world.add(grp);
      this.coins.push({ group: grp, vy: 3 + Math.random() * 2.5, life: 0 });
    }
    this.ensureRunning();
  }

  /** Floats a "+income" number that rises and fades over a building. */
  public floatIncome(type: BuildingType, text: string): void {
    const b = this.buildings.get(type);
    if (!b || !b.group.visible) return;
    const spr = this.makeTextSprite(text);
    spr.position.set(
      b.group.position.x + (Math.random() - 0.5) * 0.6,
      b.shownHeight + 1.5,
      b.group.position.z + (Math.random() - 0.5) * 0.6,
    );
    this.world.add(spr);
    this.floaters.push({ sprite: spr, life: 0, vy: 1.4 });
    // Cap concurrent floaters so a fast economy can't pile up draw calls.
    while (this.floaters.length > 18) {
      const f = this.floaters.shift();
      if (f) this.disposeFloater(f.sprite);
    }
    this.ensureRunning();
  }

  /** Builds a crisp gold-on-dark text sprite (cached per-call canvas). */
  private makeTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '700 60px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 9; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(text, 128, 50);
    ctx.fillStyle = '#ffe08a'; ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(2.4, 0.9, 1);
    return spr;
  }

  private disposeFloater(spr: THREE.Sprite): void {
    this.world.remove(spr);
    const m = spr.material as THREE.SpriteMaterial;
    m.map?.dispose(); m.dispose();
  }

  private spawnSmoke(): void {
    const b = this.buildings.get('blacksmith');
    if (!b || !b.group.visible) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.5, roughness: 1 });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat);
    puff.position.set(b.group.position.x + 0.5, b.shownHeight + 1.4, b.group.position.z - 0.4);
    this.world.add(puff);
    this.smoke.push({ mesh: puff, vy: 0.7 + Math.random() * 0.4, life: 0 });
  }

  private updateCameraFrustum(): void {
    const vs = this.viewSize;
    this.camera.left = (-vs * this.aspect) / 2; this.camera.right = (vs * this.aspect) / 2;
    this.camera.top = vs / 2; this.camera.bottom = -vs / 2;
    this.camera.updateProjectionMatrix();
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    this.renderer.setSize(w, h, false); this.aspect = w / h; this.updateCameraFrustum();
  }

  /** Speeds up the bustle while a production boost is active. */
  public setBoost(active: boolean): void { this.boostSpeed = active ? 2.2 : 1; }

  public start(): void { this.ensureRunning(); }
  public stop(): void { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  private ensureRunning(): void {
    if (this.raf === 0) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.loop(t)); }
  }

  private loop(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now; this.t += dt;
    try { this.update(dt); this.renderer.render(this.scene, this.camera); }
    catch (err) { console.warn('[village] 3D render halted', err); this.stop(); return; }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    if (!this.dragging && !this.pinching) this.targetYaw += dt * 0.05;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.world.rotation.y = this.yaw;
    if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
      this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
      this.updateCameraFrustum();
    }

    this.updateDayNight(dt);

    for (const type of BUILDING_TYPES) {
      const b = this.buildings.get(type)!;
      if (!b.group.visible) continue;
      if (b.model) {
        // Real model: a gentle uniform growth with level reads as "thriving"
        // without distorting the silhouette.
        const grow = b.modelScale * (1 + Math.min(b.level, 24) * 0.014);
        const cur = b.model.scale.x + (grow - b.model.scale.x) * Math.min(1, dt * 6);
        b.model.scale.setScalar(cur);
        b.shownHeight = (b.modelHeight / b.modelScale) * cur;
      } else {
        const target = this.bodyHeight(type, b.level);
        b.shownHeight += (target - b.shownHeight) * Math.min(1, dt * 6);
        b.body.scale.y = b.shownHeight; b.body.position.y = b.shownHeight / 2;
        b.roof.position.y = b.shownHeight + 0.5;
      }
    }

    const bound = GRID * TILE * 0.42;
    for (const w of this.workers) {
      if (w.pause > 0) { w.pause -= dt; continue; }
      const dx = w.tx - w.x, dz = w.tz - w.z; const d = Math.hypot(dx, dz);
      if (d < 0.15) { w.tx = (Math.random() - 0.5) * bound * 2; w.tz = (Math.random() - 0.5) * bound * 2; w.pause = (Math.random() * 1.6) / this.boostSpeed; }
      else {
        w.x += (dx / d) * w.speed * this.boostSpeed * dt; w.z += (dz / d) * w.speed * this.boostSpeed * dt;
        w.mesh.position.x = w.x; w.mesh.position.z = w.z;
        w.mesh.rotation.y = Math.atan2(dx, dz);
        w.mesh.position.y = Math.abs(Math.sin((this.t + w.phase) * 9)) * 0.07;
      }
    }

    for (const c of this.coins) {
      c.life += dt; c.vy -= 9 * dt; c.group.position.y += c.vy * dt;
      c.group.rotation.y += dt * 8; c.group.scale.setScalar(Math.max(0, 1 - c.life));
    }
    this.coins = this.coins.filter((c) => { if (c.life >= 1) { this.world.remove(c.group); return false; } return true; });

    for (const f of this.floaters) {
      f.life += dt;
      f.sprite.position.y += f.vy * dt;
      const a = f.life < 0.18 ? f.life / 0.18 : Math.max(0, 1 - (f.life - 0.18) / 1.22);
      (f.sprite.material as THREE.SpriteMaterial).opacity = a;
    }
    this.floaters = this.floaters.filter((f) => {
      if (f.life >= 1.4) { this.disposeFloater(f.sprite); return false; }
      return true;
    });

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) { this.smokeTimer = 0.55; this.spawnSmoke(); }
    for (const s of this.smoke) {
      s.life += dt; s.mesh.position.y += s.vy * dt; s.mesh.scale.setScalar(1 + s.life * 1.4);
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.5 * (1 - s.life / 2));
    }
    this.smoke = this.smoke.filter((s) => { if (s.life >= 2) { this.world.remove(s.mesh); return false; } return true; });

    // Pond shimmer + waving flag.
    if (this.pondMat) this.pondMat.emissiveIntensity = 0.3 + Math.sin(this.t * 2) * 0.15;
    if (this.flag) this.flag.rotation.z = Math.sin(this.t * 4) * 0.12;

    // Fireflies drift.
    if ((this.fireflies.material as THREE.PointsMaterial).opacity > 0.01) {
      const arr = (this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = this.fireflyBase[i] + Math.sin(this.t * 1.3 + i) * 0.6;
        arr[i + 1] = this.fireflyBase[i + 1] + Math.sin(this.t * 2.1 + i * 1.7) * 0.3;
        arr[i + 2] = this.fireflyBase[i + 2] + Math.cos(this.t * 1.1 + i) * 0.6;
      }
      (this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateDayNight(dt: number): void {
    this.dayT += dt;
    const phase = (this.dayT / DAY_CYCLE) % 1;
    const elev = Math.sin(phase * Math.PI * 2);
    const dayRaw = Math.max(0, Math.min(1, (elev + 0.25) / 0.6));
    // Idle-tycoon mood: stay bright and sunny — the trough is a gentle golden
    // dusk, never a real (dark) night, so the village always looks inviting.
    const day = 0.76 + 0.24 * dayRaw;
    const night = 1 - day;

    const ang = phase * Math.PI * 2;
    this.sun.position.set(Math.cos(ang) * 22, 6 + Math.max(-4, Math.sin(ang) * 26), Math.sin(ang) * 14 + 6);
    this.sun.intensity = 0.5 + day * 2.3;
    this.hemi.intensity = 0.6 + day * 0.85;

    // Sky gradient.
    this.skyMat.uniforms.topColor.value.copy(this.daySkyTop).lerp(NIGHT_TOP, night);
    this.skyMat.uniforms.botColor.value.copy(this.daySkyBot).lerp(NIGHT_BOT, night);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.daySkyBot).lerp(NIGHT_BOT, night);

    // Sun/moon discs in the sky.
    const R = 150;
    this.sunSprite.position.set(Math.cos(ang) * R, Math.sin(ang) * R, -40);
    this.sunGlow.position.copy(this.sunSprite.position);
    const sunVis = Math.max(0, Math.sin(ang));
    this.sunSprite.material.opacity = sunVis; this.sunGlow.material.opacity = sunVis * 0.9;
    this.moonSprite.position.set(Math.cos(ang + Math.PI) * R, Math.sin(ang + Math.PI) * R, -40);
    this.moonSprite.material.opacity = Math.max(0, Math.sin(ang + Math.PI)) * night;

    // Stars + atmosphere.
    (this.stars.material as THREE.PointsMaterial).opacity = night;
    (this.dust.material as THREE.PointsMaterial).opacity = day * 0.5;
    (this.fireflies.material as THREE.PointsMaterial).opacity = night * 0.9;

    // Window/lamp glow + emissive.
    for (const m of this.nightMats) m.emissiveIntensity = night * 1.8;
    for (const s of this.nightGlow) s.material.opacity = night * 0.85;
  }

  // --- Pointer & wheel --------------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) { this.dragging = true; this.dragMoved = 0; this.lastPX = e.clientX; }
    if (this.pointers.size === 2) { this.pinching = true; this.lastPinch = this.pinchDistance(); }
  }
  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinching && this.pointers.size >= 2) {
      const d = this.pinchDistance();
      if (this.lastPinch > 0 && d > 0) this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize * (this.lastPinch / d)));
      this.lastPinch = d;
    } else if (this.dragging) {
      const dx = e.clientX - this.lastPX; this.lastPX = e.clientX;
      this.dragMoved += Math.abs(dx); this.targetYaw -= dx * 0.008;
    }
  }
  private onPointerUp(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) { this.pinching = false; this.lastPinch = 0; }
    if (this.pointers.size === 0) { if (this.dragging && this.dragMoved < 6) this.tap(e); this.dragging = false; }
  }
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize + e.deltaY * 0.01));
  }
  private pinchDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
  private tap(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const picks: THREE.Mesh[] = [];
    for (const b of this.buildings.values()) if (b.group.visible) picks.push(b.pickMesh);
    const hits = this.raycaster.intersectObjects(picks, false);
    if (hits.length > 0) {
      const type = hits[0].object.userData.type as BuildingType | undefined;
      if (type) this.onTapBuilding(type);
    }
  }
}
